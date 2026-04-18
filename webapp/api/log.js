import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: authRow } = await supabase
    .from('user_auth')
    .select('telegram_user_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!authRow) return res.status(403).json({ error: 'Account not linked to Telegram' })

  const uid = authRow.telegram_user_id
  const { text, sessionId: incomingSessionId, clarification, partialParse } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' })

  const sessionId = incomingSessionId || crypto.randomUUID()
  const today = new Date().toISOString().split('T')[0]

  // Fetch user's default logging unit preference
  const { data: profileRows } = await supabase
    .from('profile').select('key,value').eq('telegram_user_id', uid).eq('key', 'log_units')
  const logUnits = profileRows?.[0]?.value || 'kg'

  // Inject the default unit assumption into the extraction prompt
  const unitRule = logUnits === 'lbs'
    ? 'When a weight is given with no unit, treat it as lbs and convert to kg for weight_kg (divide by 2.20462, round to 1 decimal). Weights explicitly marked kg stay as kg; weights explicitly marked lbs are also converted to kg.'
    : 'When a weight is given with no unit, treat it as kg.'
  const extractionSystem = EXTRACTION_SYSTEM + `\n\n### Default weight unit\n${unitRule}`

  // Build prompt — second-pass clarification or fresh parse
  let userContent
  if (partialParse && clarification) {
    userContent = (
      `Original log:\n${text}\n\n` +
      `User clarification:\n${clarification}\n\n` +
      `Partial parse to refine:\n${JSON.stringify(partialParse, null, 2)}`
    )
  } else {
    userContent = text.trim()
    const { data: exercisesData } = await supabase
      .from('sets')
      .select('exercise')
      .eq('telegram_user_id', uid)
      .not('exercise', 'is', null)
    const knownExercises = [...new Set((exercisesData || []).map(r => r.exercise).filter(Boolean))]
    if (knownExercises.length) {
      userContent += '\n\nKnown exercises for this user:\n' + knownExercises.sort().map(e => `- ${e}`).join('\n')
    }
  }

  const parseResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: extractionSystem,
    messages: [{ role: 'user', content: userContent }],
  })

  let raw = parseResponse.content[0].text.trim()
  if (raw.startsWith('```')) {
    raw = raw.split('\n').slice(1).join('\n')
    raw = raw.split('```')[0].trim()
  }

  let result
  try {
    result = JSON.parse(raw)
  } catch {
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

  const rows = sets.map(s => ({
    telegram_user_id: uid,
    session_id: sessionId,
    date: today,
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
    extraction_model: 'claude-sonnet-4-6',
  }))

  const { error: insertError } = await supabase.from('sets').insert(rows)
  if (insertError) {
    console.error('Insert error:', insertError)
    return res.status(500).json({ error: 'Failed to save sets.' })
  }

  const exerciseNames = [...new Set(sets.map(s => s.exercise))]
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
