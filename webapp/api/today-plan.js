import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function formatHistory(sets, sessions) {
  if (!sets.length && !sessions.length) return 'No workout data.'

  const sessionSets = {}
  for (const s of sets) {
    const sid = String(s.session_id || '')
    if (!sessionSets[sid]) sessionSets[sid] = []
    sessionSets[sid].push(s)
  }

  const lines = []
  for (const sess of sessions) {
    const sid = String(sess.session_id || '')
    const dur = sess.duration_mins ? ` | ${sess.duration_mins} min` : ''
    const type = sess.session_type ? ` | ${sess.session_type}` : ''
    lines.push(`\n[${sess.date}${type}${dur}]`)
    if (sess.overall_note) lines.push(`  Note: ${sess.overall_note}`)

    const ssets = (sessionSets[sid] || []).sort((a, b) => (a.set_num || 0) - (b.set_num || 0))
    for (const s of ssets) {
      const weight = s.weight_kg != null ? `${s.weight_kg}kg` : 'bw'
      const rpe = s.rpe != null ? ` RPE${s.rpe}` : ''
      const injury = s.injury_flag ? ' [INJURY]' : ''
      lines.push(`  ${s.exercise} #${s.set_num}: ${weight} × ${s.reps || '?'}${rpe}${injury}`)
    }
  }
  return lines.join('\n')
}

function formatCycle(cycle) {
  if (!cycle) return ''
  return [
    '=== ACTIVE TRAINING CYCLE ===',
    `Start: ${cycle.start_date} | End: ${cycle.end_date}`,
    `Goals: ${cycle.goals || ''}`,
    `Program:\n${cycle.workout_plan || ''}`,
  ].join('\n')
}

const SCHEMA = `{
  "workoutType": "Push | Pull | Legs | Upper | Full Body",
  "focus": "e.g. Chest + Shoulders",
  "estimatedDurationMin": 60,
  "exercises": [
    {
      "name": "Exercise Name",
      "weightKg": 100,        // number or null for bodyweight
      "sets": 4,
      "repTargets": ["5","5","5","5+"],  // one string per set, or range like "6-8"
      "note": "Optional one-sentence coaching note",
      "isPriority": true      // true for the main compound lift only
    }
  ],
  "coachingNotes": ["bullet 1", "bullet 2", "bullet 3"]  // 2–3 max
}`

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: authRow } = await supabase
    .from('user_auth')
    .select('telegram_user_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!authRow) return res.status(403).json({ error: 'Account not linked to Telegram' })

  const uid = authRow.telegram_user_id
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const [{ data: sets }, { data: sessions }, { data: cycles }] = await Promise.all([
    supabase.from('sets').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date'),
    supabase.from('sessions').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date', { ascending: false }),
    supabase.from('cycles').select('*').eq('telegram_user_id', uid).eq('status', 'active').limit(1),
  ])

  // Fetch canonical coaching state assembled by the Python pipeline
  const { data: programStateRow } = await supabase
    .from('program_state')
    .select('state_json')
    .eq('telegram_user_id', uid)
    .single()

  const canonicalState = programStateRow?.state_json || {}

  const historyStr = formatHistory(sets || [], [...(sessions || [])].reverse())
  const cycleStr = cycles?.[0] ? formatCycle(cycles[0]) : ''

  // Build the coaching rules/constraints section from canonical state
  const canonicalSection = (() => {
    const rules = canonicalState.active_rules || []
    const constraints = canonicalState.active_constraints || []
    const updates = canonicalState.coaching_updates || []
    const priorities = canonicalState.priorities || []
    if (!rules.length && !constraints.length && !updates.length) return ''

    const lines = ['=== ACTIVE COACHING RULES & CONSTRAINTS ===']
    if (rules.length) {
      lines.push('Rules:')
      rules.forEach(r => {
        const wt = r.workout_type ? ` [${r.workout_type}]` : ''
        const scope = r.applicability_type === 'durable' ? '' : ` (${r.applicability_type})`
        lines.push(`  - ${r.text}${wt}${scope}`)
      })
    }
    if (constraints.length) {
      lines.push('Constraints:')
      constraints.forEach(c => {
        const when = c.applies_while ? ` — applies while: ${c.applies_while}` : ''
        lines.push(`  - ${c.text}${when}`)
      })
    }
    if (updates.length) {
      lines.push('Other coaching updates:')
      updates.forEach(u => lines.push(`  - [${u.update_type}] ${u.description}`))
    }
    if (priorities.length) {
      lines.push(`Priorities: ${priorities.join(', ')}`)
    }
    return lines.join('\n')
  })()

  const systemPrompt = `You are Avenra, an AI strength-training coach. Generate a training plan for today based on the user's recent history.

${cycleStr ? cycleStr + '\n\n' : ''}=== RECENT TRAINING (last 30 days) ===
${historyStr}

Today: ${today}

${canonicalSection ? canonicalSection + '\n\n' : ''}Rules:
- Infer the logical next session type from the PPL pattern in their history (or their active cycle if present)
- Target weights should reflect small progressive overload on what they've recently done
- List 4–6 exercises. The priority lift should be the main compound for the day
- Keep coaching notes specific and actionable (not generic)
- If there are recent injury flags, address them
- Follow any active coaching rules and constraints exactly — these override generic defaults

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
${SCHEMA}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate my plan for today.' }],
    })

    const raw = response.content[0].text.trim()
    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const plan = JSON.parse(json)

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(plan)
  } catch (err) {
    console.error('today-plan error:', err)
    return res.status(500).json({ error: 'Failed to generate plan' })
  }
}
