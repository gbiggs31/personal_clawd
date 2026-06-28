import { authenticateUser } from '../lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [{ data: sessions }, { data: sets }, { data: profileRows }] = await Promise.all([
    supabase.from('sessions').select('*').eq('telegram_user_id', uid).gte('date', cutoff).order('date', { ascending: false }),
    supabase.from('sets').select('exercise, weight_kg, reps, date').eq('telegram_user_id', uid).gte('date', cutoff),
    supabase.from('profile').select('key,value').eq('telegram_user_id', uid).eq('key', 'units'),
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

  // Last session date
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
