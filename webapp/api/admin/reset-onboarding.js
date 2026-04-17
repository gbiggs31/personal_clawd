import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user || user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { telegramUserId } = req.body
  if (!telegramUserId) return res.status(400).json({ error: 'telegramUserId required' })

  const { error } = await supabase
    .from('profile')
    .delete()
    .eq('telegram_user_id', telegramUserId)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
