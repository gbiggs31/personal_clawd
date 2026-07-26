import Anthropic from '@anthropic-ai/sdk'
import { authenticateUser } from '../lib/auth.js'
import { MODEL_HAIKU, cachedSystem, firstText, parseJsonResponse } from '../lib/models.js'
import { parseDateFromNote } from '../lib/parse-date.js'

// The user's distinct exercise names, cached in the profile KV store.
// Rebuilding it meant selecting every set row the user has ever logged on
// every single log call — which also silently truncated at PostgREST's
// 1000-row cap, quietly degrading the name-normalisation prompt.
const VOCAB_KEY = '_exercise_vocab'

async function loadExerciseVocab(supabase, uid) {
  const { data } = await supabase
    .from('profile').select('value')
    .eq('telegram_user_id', uid).eq('key', VOCAB_KEY).maybeSingle()

  if (data?.value) {
    try {
      const parsed = JSON.parse(data.value)
      if (Array.isArray(parsed)) return parsed
    } catch { /* corrupt entry — rebuild below */ }
  }
  return null
}

async function rebuildExerciseVocab(supabase, uid) {
  // Only reached on a cache miss or when a genuinely new name appears, so the
  // wide scan happens rarely rather than on every set logged.
  const { data } = await supabase
    .from('sets').select('exercise')
    .eq('telegram_user_id', uid).not('exercise', 'is', null)
    .limit(5000)

  const names = [...new Set((data || []).map(r => r.exercise).filter(Boolean))].sort()
  await supabase.from('profile').upsert(
    { telegram_user_id: uid, key: VOCAB_KEY, value: JSON.stringify(names) },
    { onConflict: 'telegram_user_id,key' }
  )
  return names
}

/** Add newly-seen exercise names to the cached vocabulary (fire-and-forget). */
function extendExerciseVocab(supabase, uid, vocab, newNames) {
  const known = new Set(vocab.map(n => n.toLowerCase()))
  const additions = newNames.filter(n => n && !known.has(n.toLowerCase()))
  if (!additions.length) return

  const merged = [...vocab, ...additions].sort()
  supabase.from('profile')
    .upsert({ telegram_user_id: uid, key: VOCAB_KEY, value: JSON.stringify(merged) },
            { onConflict: 'telegram_user_id,key' })
    .then(({ error }) => { if (error) console.error('[log] vocab update failed:', error.message) })
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EXTRACTION_SYSTEM = `You are a gym log parser. Extract structured workout data from natural language input.

Return ONLY valid JSON — no preamble, no markdown fences, no explanation.

## Output schema (workout log)
{
  "sets": [
    {
      "exercise": "string — canonical name, e.g. 'Bench Press', 'Romanian Deadlift'",
      "set_num": "integer — 1-indexed within each exercise",
      "weight_kg": "float | null",
      "reps": "integer | null",
      "rpe": "float | null",
      "rir": "integer | null",
      "note": "string | null",
      "note_type": "set | exercise | session | null",
      "injury_flag": "boolean",
      "injury_body_part": "string | null — e.g. 'left knee', 'lower back'",
      "extras": "{ snake_case_key: value } | null"
    }
  ],
  "session_note": "string | null",
  "confidence": "float 0.0–1.0",
  "clarification_needed": "string | null — specific question to ask user"
}

## Output schema (not a workout log)
{"no_workout_data": true, "reason": "string"}

## Parsing rules

### Set notation
- "3x5 @ 100kg"       → 3 identical sets: weight=100, reps=5, set_num 1,2,3
- "8,7,6 @ 80kg"      → 3 sets reps 8, 7, 6 at same weight, set_num 1,2,3
- "building up to Xkg"→ pyramid: intermediate sets have weight_kg=null, final set has actual weight
- "5 sets of 5"        → 5 sets, weight_kg=null if not given

### RPE — infer from language cues; null if no cues present
- "easy", "comfortable", "light"                           → 6
- "solid", "good", "decent"                               → 7.5
- "hard", "tough", "challenging", "grind"                 → 8.5
- "missed a rep", "failed a rep", "couldn't lock out"     → 9.5
- "max effort", "absolute max", "true 1RM"                → 10

### RIR — infer from language cues; null if no mention
- "true failure", "failed the rep", "couldn't get another" → 0
- "almost had another", "one more maybe", "close to failure" → 1
- "couple left", "2 in reserve", "few left"                → 2

### extras dict
Use snake_case keys consistently across sessions:
- Eccentric emphasis   → eccentric_seconds: integer
- Band tension         → band_tension_kg: float
- Tempo                → tempo: "eccentric-pause-concentric" e.g. "3-1-1"
- Machine variant      → machine_variant: "hammer strength"
- Grip                 → grip_width: "wide" | "narrow" | "close"
- Cardio: distance_km, pace_min_per_km (string), duration_mins

### Note classification
- "set": note about a specific set ("form broke down on last rep")
- "exercise": note about the exercise overall ("shoulder felt tight throughout")
- "session": note about the whole session ("slept badly, low energy")

### Injury
- injury_flag=true for any pain, discomfort, niggle, soreness, or tightness that sounds concerning
- injury_body_part: specific anatomical location

### Confidence
- 1.0: everything unambiguous
- 0.75–0.99: minor assumptions made; note what was assumed
- <0.75: significant ambiguity; clarification_needed must be a specific question
- When confidence < 0.75, still populate sets with best-guess values

### Cardio
Same schema: reps=null, weight_kg=null, extras holds duration_mins/distance_km/pace etc.

### Exercise name normalisation
If a known exercises list is provided, apply these rules in order:
1. **Obvious match** — same movement, just different capitalisation, abbreviation, or casual shorthand
   (e.g. "flat bench" → "Bench Press", "rdl" → "Romanian Deadlift", "ohp" → "Overhead Press"):
   use the known name exactly, silently, at full confidence.
2. **Possible variant** — could plausibly be a distinct exercise
   (e.g. "bench press machine" when "Bench Press" is known, or "incline bench" when only "Bench Press" is known):
   set confidence < 0.75 and ask: "Is '[logged name]' the same exercise as '[known name]', or a separate one?"
3. **Clearly new** — no close match exists in the known list: use the name as written at full confidence.`

function kgToLbs(kg) { return Math.round(kg * 2.20462) }
function lbsToKg(lbs) { return Math.round(lbs * 0.453592 * 10) / 10 }

function formatSetSummary(s, logUnits) {
  const e = s.extras || {}

  // Cardio: show distance/duration/pace instead of weight×reps
  if (s.weight_kg == null && s.reps == null) {
    const parts = []
    if (e.distance_km != null)    parts.push(`${e.distance_km}km`)
    if (e.duration_mins != null)  parts.push(`${e.duration_mins} min`)
    if (e.pace_min_per_km != null) parts.push(`${e.pace_min_per_km}/km`)
    if (parts.length) return parts.join(' · ')
    return 'logged'
  }

  // Strength: weight × reps
  let w = s.weight_kg != null
    ? (logUnits === 'lbs' ? `${kgToLbs(s.weight_kg)}lbs` : `${s.weight_kg}kg`)
    : 'bw'
  const r   = s.reps != null ? s.reps : '?'
  const rpe = s.rpe != null ? ` @RPE${s.rpe}` : ''
  const rir = s.rir != null ? ` RIR${s.rir}` : ''
  return `${w}×${r}${rpe}${rir}`
}

function formatReply(sets, logUnits = 'kg') {
  const grouped = {}
  for (const s of sets) {
    const ex = s.exercise || 'Unknown'
    if (!grouped[ex]) grouped[ex] = []
    grouped[ex].push(s)
  }
  const lines = []
  for (const [ex, exSets] of Object.entries(grouped)) {
    const parts = exSets.map(s => formatSetSummary(s, logUnits))
    lines.push(`${ex}: ${parts.join(', ')}`)
  }
  return `Logged ${sets.length} set${sets.length !== 1 ? 's' : ''}:\n${lines.join('\n')}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  const { text, sessionId: incomingSessionId, clarification, partialParse } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' })

  const sessionId = incomingSessionId || crypto.randomUUID()
  const today = new Date().toISOString().split('T')[0]

  // Rate limit: 150 sets per day (protects against scripted abuse)
  const { count: setsToday } = await supabase
    .from('sets')
    .select('*', { count: 'exact', head: true })
    .eq('telegram_user_id', uid)
    .eq('date', today)
  if ((setsToday ?? 0) >= 150) {
    return res.status(429).json({ error: 'Daily logging limit reached. Please try again tomorrow.' })
  }

  // Fetch user's unit preferences
  // log_units controls the default assumption when no unit is given.
  // If not explicitly set, fall back to inferring from the display units preference
  // so that setting "Imperial" display units automatically implies lbs logging.
  const { data: profileRows } = await supabase
    .from('profile').select('key,value').eq('telegram_user_id', uid).in('key', ['units', 'log_units'])
  const profileMap = Object.fromEntries((profileRows || []).map(r => [r.key, r.value]))
  const logUnits = profileMap.log_units || (profileMap.units === 'imperial' ? 'lbs' : 'kg')

  // Inject the default unit assumption into the extraction prompt.
  // The big static spec is cached; the small per-user unit rule rides as a
  // separate trailing block so the cached prefix is identical across users.
  const unitRule = logUnits === 'lbs'
    ? 'When a weight is given with no unit, treat it as lbs and convert to kg for weight_kg (divide by 2.20462, round to 1 decimal). Weights explicitly marked kg stay as kg; weights explicitly marked lbs are also converted to kg.'
    : 'When a weight is given with no unit, treat it as kg.'
  const extractionSystem = cachedSystem(EXTRACTION_SYSTEM, `\n\n### Default weight unit\n${unitRule}`)

  // Build prompt — second-pass clarification or fresh parse
  let userContent
  // Stays null on the clarification path, where the vocabulary is never
  // loaded — extending from an empty list would overwrite the cached
  // vocabulary with just the names in this one message.
  let knownExercises = null
  if (partialParse && clarification) {
    userContent = (
      `Original log:\n${text}\n\n` +
      `User clarification:\n${clarification}\n\n` +
      `Partial parse to refine:\n${JSON.stringify(partialParse, null, 2)}`
    )
  } else {
    userContent = text.trim()
    knownExercises = await loadExerciseVocab(supabase, uid)
      ?? await rebuildExerciseVocab(supabase, uid)
    if (knownExercises?.length) {
      userContent += '\n\nKnown exercises for this user:\n' + knownExercises.map(e => `- ${e}`).join('\n')
    }
  }

  const parseResponse = await anthropic.messages.create(
    {
      model: MODEL_HAIKU,
      max_tokens: 2048,
      system: extractionSystem,
      messages: [{ role: 'user', content: userContent }],
    },
    { signal: AbortSignal.timeout(30_000) }
  )

  const rawText = firstText(parseResponse)
  if (!rawText) {
    return res.status(500).json({ error: 'No response from AI. Please try again.' })
  }

  const result = parseJsonResponse(rawText)
  if (!result) {
    return res.status(200).json({ ok: false, message: 'Could not parse workout — try rephrasing.' })
  }

  if (result.no_workout_data) {
    return res.status(200).json({ ok: false, message: result.reason || 'No workout data found.' })
  }

  if ((result.confidence ?? 1) < 0.75) {
    return res.status(200).json({
      ok: false,
      clarificationNeeded: true,
      clarificationQuestion: result.clarification_needed,
      partialParse: result,
      sessionId,
    })
  }

  const sets = result.sets || []
  if (!sets.length) {
    return res.status(200).json({ ok: false, message: 'No sets found in the workout.' })
  }

  const logDate = parseDateFromNote(text) || today

  const rows = sets.map(s => ({
    telegram_user_id: uid,
    session_id: sessionId,
    date: logDate,
    exercise: s.exercise || '',
    set_num: s.set_num || 1,
    weight_kg: s.weight_kg ?? null,
    reps: s.reps ?? null,
    rpe: s.rpe ?? null,
    rir: s.rir ?? null,
    note: s.note ?? null,
    note_type: s.note_type ?? null,
    injury_flag: s.injury_flag ?? false,
    injury_body_part: s.injury_body_part ?? null,
    extras: s.extras ?? null,
    raw_input: text,
    extraction_model: MODEL_HAIKU,
  }))

  const { error: insertError } = await supabase.from('sets').insert(rows)
  if (insertError) {
    console.error('Insert error:', insertError)
    return res.status(500).json({ error: 'Failed to save sets.' })
  }

  const exerciseNames = [...new Set(sets.map(s => s.exercise))]
  if (knownExercises) extendExerciseVocab(supabase, uid, knownExercises, exerciseNames)

  const setsPerExercise = sets.reduce((acc, s) => {
    acc[s.exercise] = (acc[s.exercise] || 0) + 1
    return acc
  }, {})

  return res.status(200).json({
    ok: true,
    sessionId,
    reply: formatReply(sets, logUnits),
    sets: sets.length,
    exerciseNames,
    setsPerExercise,
  })
}
