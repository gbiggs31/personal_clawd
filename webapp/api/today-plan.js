import Anthropic from '@anthropic-ai/sdk'
import { authenticateUser } from '../lib/auth.js'
import { MODEL_SONNET } from '../lib/models.js'
import { getStravaContext } from '../lib/strava-context.js'
import { coachingStyleNote } from '../lib/coaching-style.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function kgToLbs(kg) { return Math.round(kg * 2.20462) }

function formatHistory(sets, sessions, units = 'metric') {
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
    if (sess.overall_note)  lines.push(`  Note: ${sess.overall_note}`)
    if (sess.coaching_note) lines.push(`  Coach note: ${sess.coaching_note}`)

    const ssets = (sessionSets[sid] || []).sort((a, b) => (a.set_num || 0) - (b.set_num || 0))
    for (const s of ssets) {
      const weight = s.weight_kg != null
        ? units === 'imperial' ? `${kgToLbs(s.weight_kg)}lbs` : `${s.weight_kg}kg`
        : 'bw'
      const rpe = s.rpe != null ? ` RPE${s.rpe}` : ''
      const injury = s.injury_flag ? ' [INJURY]' : ''
      lines.push(`  ${s.exercise} #${s.set_num}: ${weight} × ${s.reps || '?'}${rpe}${injury}`)
    }
  }
  return lines.join('\n')
}

function formatProfile(p) {
  const lines = []
  if (p.experience_level) lines.push(`Level: ${p.experience_level}${p.experience_years ? ` (${p.experience_years})` : ''}`)
  if (p.training_notes)   lines.push(`Programme / style: ${p.training_notes}`)
  if (p.equipment)        lines.push(`Equipment: ${p.equipment}`)
  if (p.chronic_injuries) lines.push(`Chronic injuries: ${p.chronic_injuries}`)
  return lines.length ? '=== ATHLETE PROFILE ===\n' + lines.join('\n') : ''
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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await authenticateUser(req, { requireLink: false })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, user, uid } = auth

  // POST: modify an existing plan
  if (req.method === 'POST') {
    const { currentPlan, modification } = req.body || {}
    if (!modification?.trim()) return res.status(400).json({ error: 'No modification provided' })
    try {
      const response = await anthropic.messages.create(
        {
          model: MODEL_SONNET,
          max_tokens: 1024,
          system: `You are Avenra, an AI strength-training coach. The user wants to modify their training plan for today.

Current plan:
${JSON.stringify(currentPlan, null, 2)}

Update the plan according to the user's request. Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
${SCHEMA}`,
          messages: [{ role: 'user', content: modification.trim() }],
        },
        { signal: AbortSignal.timeout(30_000) }
      )
      if (!response.content?.length) throw new Error('empty response from AI')
      const raw = response.content[0].text.trim()
      const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      const plan = JSON.parse(json)
      plan.units = currentPlan?.units || 'metric'
      return res.status(200).json(plan)
    } catch (err) {
      console.error('modify-plan error:', err)
      return res.status(500).json({ error: 'Failed to update plan' })
    }
  }

  if (!uid) return res.status(403).json({ error: 'Account not linked' })

  // Rate limit: minimum 30 seconds between plan generations per user
  const RL_KEY = '_last_plan_at'
  const { data: rlRow } = await supabase
    .from('profile')
    .select('value')
    .eq('telegram_user_id', uid)
    .eq('key', RL_KEY)
    .maybeSingle()
  if (rlRow?.value && Date.now() - new Date(rlRow.value).getTime() < 30_000) {
    return res.status(429).json({ error: 'Please wait before generating a new plan.' })
  }
  supabase.from('profile')
    .upsert({ telegram_user_id: uid, key: RL_KEY, value: new Date().toISOString() }, { onConflict: 'telegram_user_id,key' })
    .then(({ error }) => { if (error) console.error('[today-plan] rate limit upsert failed:', error.message) })

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const [{ data: sets }, { data: sessions }, { data: cycles }, { data: profileRows }] = await Promise.all([
    supabase.from('sets').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date'),
    supabase.from('sessions').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date', { ascending: false }),
    supabase.from('cycles').select('*').eq('telegram_user_id', uid).eq('status', 'active').limit(1),
    supabase.from('profile').select('key,value').eq('telegram_user_id', uid)
      .in('key', ['units', 'training_notes', 'equipment', 'experience_level', 'experience_years', 'chronic_injuries', 'coaching_style']),
  ])

  const profile = Object.fromEntries((profileRows || []).map(r => [r.key, r.value]))
  const units = profile.units || 'metric'
  const styleNote = coachingStyleNote(profile.coaching_style || 'balanced')

  // Fetch canonical coaching state assembled by the Python pipeline
  const { data: programStateRow } = await supabase
    .from('program_state')
    .select('state_json')
    .eq('telegram_user_id', uid)
    .single()

  const canonicalState = programStateRow?.state_json || {}

  const historyStr = formatHistory(sets || [], [...(sessions || [])].reverse(), units)
  const cycleStr = cycles?.[0] ? formatCycle(cycles[0]) : ''
  const profileStr = formatProfile(profile)

  // Strava context — non-blocking, degrades gracefully if unavailable
  let stravaContext = null
  try {
    stravaContext = await getStravaContext(user.id, supabase)
  } catch (err) {
    console.warn('[today-plan] strava context error (non-fatal):', err.message)
  }

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

  const unitsNote = units === 'imperial'
    ? 'The user prefers imperial units. The training history above has been converted to lbs. Set weightKg values in lbs (even though the field is named weightKg). Include coaching notes in lbs.'
    : 'The user prefers metric units. Set weightKg values in kg.'

  const systemPrompt = `You are Avenra, an AI strength-training coach. Generate a training plan for today based on the user's recent history.
${styleNote ? '\n' + styleNote : ''}

${unitsNote}

${stravaContext ? stravaContext + '\n\n' : ''}${profileStr ? profileStr + '\n\n' : ''}${cycleStr ? cycleStr + '\n\n' : ''}=== RECENT TRAINING (last 30 days) ===
${historyStr}

Today: ${today}

${canonicalSection ? canonicalSection + '\n\n' : ''}Rules:
- Follow the athlete's stated programme/style exactly (e.g. if they run PPL, respect that split; if they have a specific structure, follow it)
- Infer the logical next session from their history and programme notes — do not invent a different structure
- Target weights should reflect small progressive overload on what they've recently done
- List 4–6 exercises appropriate for the session type. The priority lift should be the main compound
- Keep coaching notes specific and actionable (not generic)
- If there are chronic injuries or recent injury flags, adjust exercise selection and add relevant notes
- Follow any active coaching rules and constraints exactly — these override generic defaults

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
${SCHEMA}`

  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL_SONNET,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate my plan for today.' }],
      },
      { signal: AbortSignal.timeout(30_000) }
    )

    if (!response.content?.length) {
      throw new Error('empty response from AI')
    }
    const raw = response.content[0].text.trim()
    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const plan = JSON.parse(json)

    // Attach units to the plan so the frontend can display correctly
    plan.units = units

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(plan)
  } catch (err) {
    console.error('today-plan error:', err)
    return res.status(500).json({ error: 'Failed to generate plan' })
  }
}
