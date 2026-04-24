import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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
  const { sessionId, note, sessionType: providedType, startedAt } = req.body
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const { data: profileRows } = await supabase
    .from('profile').select('key,value').eq('telegram_user_id', uid).eq('key', 'units')
  const units = profileRows?.[0]?.value || 'metric'

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
        model: 'claude-sonnet-4-6',
        max_tokens: 120,
        system: SESSION_CLASSIFY_SYSTEM,
        messages: [{ role: 'user', content: `Exercises: ${exercises.join(', ')}` }],
      },
      { signal: AbortSignal.timeout(20_000) }
    )
    try {
      if (!classifyRes.content?.length) throw new Error('empty response')
      let raw = classifyRes.content[0].text.trim()
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      classification = JSON.parse(raw)
    } catch {
      classification = { session_type: 'other', cardio_flag: false, abs_flag: false, uncertain: true }
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const durationMins = startedAt
    ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
    : null

  // Generate summary BEFORE inserting session — so if this fails, session is not committed
  // and the user can retry /done without hitting "session already closed"
  const summaryContent = formatSetsForSummary(
    sessionSets, durationMins, classification.session_type, note || null, units
  )
  let summary
  try {
    const summaryRes = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SESSION_SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: summaryContent }],
      },
      { signal: AbortSignal.timeout(30_000) }
    )
    if (!summaryRes.content?.length) {
      return res.status(500).json({ error: 'Failed to generate session summary. Please try again.' })
    }
    summary = summaryRes.content[0].text.trim()
  } catch (err) {
    console.error('Summary generation error:', err.message)
    return res.status(500).json({ error: 'Failed to generate session summary. Please try again.' })
  }

  // Insert session record with summary in one step
  const sessionRow = {
    telegram_user_id: uid,
    session_id: sessionId,
    date: today,
    overall_note: note || null,
    duration_mins: durationMins,
    session_type: classification.session_type,
    cardio_flag: classification.cardio_flag || false,
    abs_flag: classification.abs_flag || false,
    summary,
  }

  const { error: sessionError } = await supabase.from('sessions').insert(sessionRow)
  if (sessionError) {
    console.error('Session insert error:', sessionError)
    return res.status(500).json({ error: 'Failed to save session.' })
  }

  return res.status(200).json({
    ok: true,
    summary,
    sessionType: classification.session_type,
    durationMins,
    uncertain: classification.uncertain || false,
  })
}

