import Anthropic from '@anthropic-ai/sdk'
import { authenticateUser } from '../lib/auth.js'
import { MODEL_SONNET, MODEL_HAIKU, THINKING, cachedSystem, firstText, parseJsonResponse } from '../lib/models.js'
import { coachingStyleNote } from '../lib/coaching-style.js'
import { parseDateFromNote } from '../lib/parse-date.js'

// Words that make a nearby minute count something other than session duration
// — rest periods, timed holds, and cardio blocks all read as "N min".
const NOT_A_DURATION = /rest|between|pause|hold|plank|hang|carry|walk|row|bike|jog|run|sprint|interval|round|per set|each side|amrap|emom|warm|cool/i
// "took 50 mins", "session was 50 mins", "~50 mins"
const DURATION_CUE = /(?:took|lasted|duration|session|workout|total|around|about|approx\.?|~)\s*(?:was\s*)?$/i
// "50 mins total", "50 minutes long"
const DURATION_TRAILER = /^\s*(?:session|workout|total|long|in the gym)/i

/**
 * Extract a session duration in minutes from free-form note text.
 *
 * A bare minute count is only accepted when the note actually frames it as the
 * session length: a matching cue word before it, a qualifier after it, or the
 * note opening with it. Otherwise "/done felt strong, 3 min rest between sets"
 * would record a 3-minute session.
 */
function parseDurationFromNote(text) {
  if (!text) return null
  const t = text.toLowerCase()

  // Note the trailing `s?` on the minute suffix: without it "45 mins" — the
  // most natural way to write this — matched nothing at all.
  const hm = t.match(/\b(\d+)\s*h(?:(?:ou)?rs?)?\s*(\d+)\s*m(?:in(?:ute)?s?)?\b/)
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2])

  const h = t.match(/\b(\d+)\s*h(?:(?:ou)?rs?)\b/)
  if (h) return parseInt(h[1]) * 60

  for (const m of t.matchAll(/\b(\d+)\s*m(?:in(?:ute)?s?)?\b/g)) {
    const start = m.index
    const before = t.slice(Math.max(0, start - 25), start)
    const after  = t.slice(start + m[0].length, start + m[0].length + 25)

    if (NOT_A_DURATION.test(before) || NOT_A_DURATION.test(after)) continue
    if (start === 0 || DURATION_CUE.test(before) || DURATION_TRAILER.test(after)) {
      return parseInt(m[1])
    }
  }

  return null
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SESSION_CLASSIFY_SYSTEM = `Classify a workout session from its exercise list.

Return ONLY valid JSON — no preamble, no fences:
{
  "session_type": "push | pull | legs | upper | full_body | cardio | other",
  "cardio_flag": boolean,
  "abs_flag": boolean,
  "uncertain": boolean
}

Definitions:
- push: chest, shoulders, triceps (bench, OHP, dips, flyes, lateral raises, etc.)
- pull: back, biceps (rows, pulldowns, pull-ups, curls, face pulls, etc.)
- legs: lower body (squat, deadlift, leg press, lunges, leg curl, calf raise, etc.)
- upper: meaningful mix of push AND pull exercises
- full_body: includes both upper and lower body compound work
- cardio: primarily cardiovascular (running, cycling, rowing, elliptical, etc.)
- other: doesn't fit the above (use sparingly — only if genuinely unclassifiable)

uncertain: true if you are not confident in the session_type — e.g. exercise names are ambiguous,
the list is very short (1–2 exercises), or the mix doesn't clearly fit a category.
When uncertain is true, still populate session_type with your best guess.

cardio_flag: true if ANY cardio exercise is present, regardless of session_type
abs_flag: true if ANY ab or core isolation work is present (crunches, planks, cable crunches, hanging leg raises, etc.)`

const SESSION_SUMMARY_SYSTEM = `You are a personal trainer giving a post-session debrief. The user has just finished a gym session.

Write a short, useful summary of what they did and any coaching observations. Be direct and specific — reference actual numbers. This is read immediately after training, so keep it tight.

## Format

**Session summary**
[2–3 sentences covering what was trained, total volume feel, and any standout sets or PRs]

**Coaching notes**
- [specific observation grounded in the numbers — trend, load management, technique note from session notes]
- [injury or fatigue flag if present — address it directly with a practical cue]
- [one forward-looking point — what to focus on or adjust next session]

## Rules
- 2–4 bullet points max — no padding
- Reference actual weights, reps, RPE/RIR where logged
- If injury flags are present, always include a note
- If session notes mention form issues or fatigue, address them
- Do NOT use generic praise — be direct and specific`

function kgToLbs(kg) { return Math.round(kg * 2.20462) }

function formatSetsForSummary(sets, durationMins, sessionType, note, units = 'metric') {
  const lines = []
  if (durationMins) lines.push(`Duration: ${durationMins} mins`)
  lines.push(`Session type: ${sessionType}`)
  if (note) lines.push(`Session note: ${note}`)
  lines.push(`Units: ${units}`)
  lines.push('')

  const exercises = {}
  for (const s of [...sets].sort((a, b) => (a.set_num || 0) - (b.set_num || 0))) {
    const ex = s.exercise || '?'
    if (!exercises[ex]) exercises[ex] = []
    exercises[ex].push(s)
  }

  for (const [ex, exSets] of Object.entries(exercises)) {
    const parts = exSets.map(s => {
      const w = s.weight_kg != null
        ? units === 'imperial' ? `${kgToLbs(s.weight_kg)}lbs` : `${s.weight_kg}kg`
        : 'bw'
      const r = s.reps || '?'
      const rpe = s.rpe != null ? ` @RPE${s.rpe}` : ''
      const rir = s.rir != null ? ` RIR${s.rir}` : ''
      const injury = s.injury_flag ? ' [INJURY]' : ''
      return `${w}×${r}${rpe}${rir}${injury}`
    })
    let line = `${ex}: ${parts.join(', ')}`
    const notes = exSets.filter(s => s.note).map(s => `${s.note} (${s.note_type || 'note'})`)
    if (notes.length) line += ' | Notes: ' + notes.join('; ')
    lines.push(line)
  }

  return lines.join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  const { sessionId, note, sessionType: providedType, startedAt } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const { data: profileRows } = await supabase
    .from('profile').select('key,value').eq('telegram_user_id', uid).in('key', ['units', 'coaching_style'])
  const profileMap = Object.fromEntries((profileRows || []).map(r => [r.key, r.value]))
  const units = profileMap.units || 'metric'
  const styleNote = coachingStyleNote(profileMap.coaching_style || 'balanced')

  // Check session not already closed
  const { data: existingSession } = await supabase
    .from('sessions')
    .select('session_id')
    .eq('telegram_user_id', uid)
    .eq('session_id', sessionId)
    .single()

  if (existingSession) {
    return res.status(400).json({ error: 'Session already closed.' })
  }

  // Fetch session sets
  const { data: sessionSets } = await supabase
    .from('sets')
    .select('*')
    .eq('telegram_user_id', uid)
    .eq('session_id', sessionId)
    .order('set_num')

  if (!sessionSets?.length) {
    return res.status(400).json({ error: 'No sets found for this session. Log something first.' })
  }

  // Classify session type
  let classification
  if (providedType) {
    classification = { session_type: providedType, cardio_flag: false, abs_flag: false, uncertain: false }
  } else {
    const exercises = [...new Set(sessionSets.map(s => s.exercise).filter(Boolean))]
    const classifyRes = await anthropic.messages.create(
      {
        model: MODEL_HAIKU,
        max_tokens: 120,
        system: SESSION_CLASSIFY_SYSTEM,
        messages: [{ role: 'user', content: `Exercises: ${exercises.join(', ')}` }],
      },
      { signal: AbortSignal.timeout(20_000) }
    )
    classification = parseJsonResponse(firstText(classifyRes))
      ?? { session_type: 'other', cardio_flag: false, abs_flag: false, uncertain: true }
  }

  const today = new Date().toISOString().split('T')[0]

  // Allow backdating: parse date and duration from the note text
  const dateOverride     = parseDateFromNote(note || '')
  const durationOverride = parseDurationFromNote(note || '')
  const sessionDate = dateOverride || today
  const durationMins = durationOverride
    ?? (startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000) : null)

  // If backdating, move only the sets that took today's default date. Sets the
  // user dated explicitly when logging them keep the date they were given.
  if (dateOverride) {
    await supabase.from('sets')
      .update({ date: dateOverride })
      .eq('session_id', sessionId)
      .eq('telegram_user_id', uid)
      .eq('date', today)
  }

  // Generate summary BEFORE inserting session — so if this fails, session is not committed
  // and the user can retry /done without hitting "session already closed"
  const summaryContent = formatSetsForSummary(
    sessionSets, durationMins, classification.session_type, note || null, units
  )
  let summary
  try {
    const summaryRes = await anthropic.messages.create(
      {
        model: MODEL_SONNET,
        // Runs once per session, and spotting the trend worth calling out is
        // reasoning work — so thinking is on, with headroom for it plus the
        // ~300-token debrief.
        max_tokens: 2500,
        thinking: THINKING,
        system: cachedSystem(SESSION_SUMMARY_SYSTEM, styleNote ? `\n\n${styleNote}` : ''),
        messages: [{ role: 'user', content: summaryContent }],
      },
      { signal: AbortSignal.timeout(45_000) }
    )
    summary = firstText(summaryRes)?.trim()
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate session summary. Please try again.' })
    }
  } catch (err) {
    console.error('Summary generation error:', err.message)
    return res.status(500).json({ error: 'Failed to generate session summary. Please try again.' })
  }

  // Insert session record with summary in one step
  const sessionRow = {
    telegram_user_id: uid,
    session_id: sessionId,
    date: sessionDate,
    overall_note: note || null,
    duration_mins: durationMins,
    session_type: classification.session_type,
    cardio_flag: classification.cardio_flag || false,
    abs_flag: classification.abs_flag || false,
    summary,
  }

  const { error: sessionError } = await supabase.from('sessions').insert(sessionRow)
  if (sessionError) {
    // 23505 = unique violation on session_id. The check above isn't atomic, so
    // a double-submit lands here; report it as the friendly "already closed"
    // rather than a 500.
    if (sessionError.code === '23505') {
      return res.status(400).json({ error: 'Session already closed.' })
    }
    console.error('Session insert error:', sessionError)
    return res.status(500).json({ error: 'Failed to save session.' })
  }

  return res.status(200).json({
    ok: true,
    summary,
    sessionType: classification.session_type,
    sessionDate,
    durationMins,
    uncertain: classification.uncertain || false,
  })
}

