import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

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
  if (!authRow) return res.status(403).json({ error: 'Not linked' })

  const uid = authRow.telegram_user_id
  const { sessionId, fields } = req.body || {}

  if (!sessionId || !fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'sessionId and fields required' })
  }

  // Whitelist updatable fields to prevent arbitrary writes
  const ALLOWED = ['session_type', 'overall_note', 'duration_mins', 'coaching_note']
  const safe = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
  )
  if (!Object.keys(safe).length) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update(safe)
    .eq('session_id', sessionId)
    .eq('telegram_user_id', uid)   // ownership check

  if (updateError) {
    console.error('Session update error:', updateError)
    return res.status(500).json({ error: 'Failed to update session' })
  }

  return res.status(200).json({ ok: true })
}
