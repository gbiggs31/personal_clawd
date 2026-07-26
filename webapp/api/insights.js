/**
 * /api/insights?view=<history|stats>
 *
 * Consolidated read-only rollups. Replaces api/history.js and api/stats.js —
 * merged because Vercel's Hobby plan caps a deployment at 12 serverless
 * functions and adding /api/lift took the count to 13. Both were small GETs
 * over the same two tables, so they were the natural pair to combine.
 *
 *   ?view=history — last 7 days of sessions (the Today week strip)
 *   ?view=stats   — 90-day training rollup (the /stats command)
 */

import { authenticateUser } from '../lib/auth.js'

function daysAgoISO(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

// ── view=history ──────────────────────────────────────────────────────────────

async function handleHistory(res, supabase, uid) {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, date, session_type, overall_note, duration_mins')
    .eq('telegram_user_id', uid)
    .gte('date', daysAgoISO(7))
    .order('date', { ascending: false })

  return res.status(200).json({ sessions: sessions || [] })
}

// ── view=stats ────────────────────────────────────────────────────────────────

async function handleStats(res, supabase, uid) {
  const cutoff = daysAgoISO(90)

  const [{ data: sessions }, { data: sets }, { data: profileRows }] = await Promise.all([
    supabase.from('sessions')
      .select('session_type, date')
      .eq('telegram_user_id', uid).gte('date', cutoff).order('date', { ascending: false }),
    supabase.from('sets')
      .select('exercise, weight_kg, reps, date')
      .eq('telegram_user_id', uid).gte('date', cutoff),
    supabase.from('profile')
      .select('key,value').eq('telegram_user_id', uid).eq('key', 'units'),
  ])

  const units = profileRows?.[0]?.value || 'metric'
  const sessionList = sessions || []
  const setList = sets || []

  // Count by type
  const byType = {}
  for (const s of sessionList) {
    const t = s.session_type || 'other'
    byType[t] = (byType[t] || 0) + 1
  }

  // Most frequent exercises
  const exCounts = {}
  for (const s of setList) {
    if (s.exercise) exCounts[s.exercise] = (exCounts[s.exercise] || 0) + 1
  }
  const topExercises = Object.entries(exCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  // Total volume (kg × reps)
  const totalVolume = setList.reduce((acc, s) => {
    if (s.weight_kg && s.reps) acc += s.weight_kg * s.reps
    return acc
  }, 0)

  const lastSession = sessionList[0]

  const volumeDisplay = units === 'imperial'
    ? Math.round(totalVolume * 2.20462)
    : Math.round(totalVolume)

  return res.status(200).json({
    sessions90d: sessionList.length,
    byType,
    topExercises,
    totalVolume: volumeDisplay,
    units,
    lastSessionDate: lastSession?.date || null,
    lastSessionType: lastSession?.session_type || null,
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  switch (req.query.view) {
    case 'history': return handleHistory(res, supabase, uid)
    case 'stats':   return handleStats(res, supabase, uid)
    default:        return res.status(400).json({ error: 'Missing or invalid view' })
  }
}
