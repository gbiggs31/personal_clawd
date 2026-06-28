import { authenticateUser } from '../lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, date, session_type, overall_note, duration_mins')
    .eq('telegram_user_id', uid)
    .gte('date', cutoff)
    .order('date', { ascending: false })

  return res.status(200).json({ sessions: sessions || [] })
}
