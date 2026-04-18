import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function formatSet(s) {
  const weight = s.weight_kg != null ? `${s.weight_kg}kg` : 'bw'
  const reps = s.reps || '?'
  const rpe = s.rpe != null ? s.rpe : '-'
  const rir = s.rir != null ? s.rir : '-'
  const note = s.note ? ` // ${s.note}` : ''
  const injury = s.injury_flag ? ` [INJURY: ${s.injury_body_part || 'unknown'}]` : ''
  return `  ${s.exercise} #${s.set_num}: ${weight} × ${reps} | RPE ${rpe} | RIR ${rir}${injury}${note}`
}

function formatHistory(sets, sessions) {
  if (!sets.length && !sessions.length) return 'No workout data in the last 90 days.'

  const sessionSets = {}
  for (const s of sets) {
    const sid = String(s.session_id || '')
    if (!sessionSets[sid]) sessionSets[sid] = []
    sessionSets[sid].push(s)
  }

  const completedIds = new Set(sessions.map(s => String(s.session_id || '')))
  const lines = []
  const sorted = [...sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  for (const sess of sorted) {
    const sid = String(sess.session_id || '')
    const dur = sess.duration_mins ? ` | ${sess.duration_mins} mins` : ''
    lines.push(`\n[${sess.date}${dur}]`)
    if (sess.overall_note) lines.push(`  Session note: ${sess.overall_note}`)
    if (sess.summary) lines.push(`  Summary: ${sess.summary}`)

    const ssets = (sessionSets[sid] || []).sort((a, b) => (a.set_num || 0) - (b.set_num || 0))
    for (const s of ssets) lines.push(formatSet(s))
  }

  // Include sets for any session not yet closed (no sessions row yet)
  for (const [sid, ssets] of Object.entries(sessionSets)) {
    if (completedIds.has(sid) || !ssets.length) continue
    const date = ssets[0].date || 'today'
    lines.push(`\n[${date} — SESSION IN PROGRESS]`)
    const inOrder = [...ssets].sort((a, b) => (a.set_num || 0) - (b.set_num || 0))
    for (const s of inOrder) lines.push(formatSet(s))
  }

  return lines.join('\n')
}

function formatCycle(cycle) {
  if (!cycle) return ''
  const end = cycle.end_date ? new Date(cycle.end_date) : null
  const weeksLeft = end ? Math.max(0, Math.floor((end - Date.now()) / (7 * 24 * 60 * 60 * 1000))) : null
  return [
    '=== CURRENT TRAINING CYCLE ===',
    `Start: ${cycle.start_date} | End: ${cycle.end_date}${weeksLeft != null ? ` (${weeksLeft} weeks remaining)` : ''}`,
    `Goals: ${cycle.goals || ''}`,
    '',
    `Program:\n${cycle.workout_plan || ''}`,
  ].join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [{ data: sets }, { data: sessions }, { data: cycles }] = await Promise.all([
    supabase.from('sets').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date'),
    supabase.from('sessions').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date'),
    supabase.from('cycles').select('*').eq('telegram_user_id', uid).eq('status', 'active').limit(1),
  ])

  const historyStr = formatHistory(sets || [], sessions || [])
  const cycleStr = cycles?.[0] ? formatCycle(cycles[0]) : ''

  const system = `You are Avenra, an AI training assistant embedded in the user's workout log web app.

Answer questions about their training concisely and directly. Reference specific numbers, dates, and exercises from their log. Surface patterns, trends, and anything worth noting. Keep responses focused — the user can ask follow-up questions.

${cycleStr ? cycleStr + '\n\n' : ''}=== TRAINING HISTORY (last 90 days) ===
${historyStr}`

  const { messages } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' })
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: messages.slice(-12).map(m => ({ role: m.role, content: m.content })),
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err.message) })}\n\n`)
  }

  res.write('data: [DONE]\n\n')
  res.end()
}
