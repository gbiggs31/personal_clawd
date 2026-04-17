import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL

async function getAdminUser(token, supabase) {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  if (!ADMIN_EMAIL || user.email !== ADMIN_EMAIL) return null
  return user
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const adminUser = await getAdminUser(token, supabase)
  if (!adminUser) return res.status(403).json({ error: 'Forbidden' })

  // ── GET: list all users ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    // Check which users have linked their web account
    const { data: linked } = await supabase
      .from('user_auth')
      .select('telegram_user_id')

    const linkedIds = new Set((linked || []).map(r => String(r.telegram_user_id)))

    const enriched = (users || []).map(u => ({
      ...u,
      web_linked: linkedIds.has(String(u.telegram_user_id)),
    }))

    return res.status(200).json({ users: enriched })
  }

  // ── POST: create a new user ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { firstName, lastName, email } = req.body
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' })

    // Check for existing user with this email
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single()

    if (existing) return res.status(409).json({ error: 'A user with this email already exists' })

    // Generate a unique internal ID (13-digit, outside real Telegram ID range)
    let telegramUserId
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = Date.now() * 100 + Math.floor(Math.random() * 100)
      const { data: collision } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_user_id', candidate)
        .single()
      if (!collision) { telegramUserId = candidate; break }
    }

    if (!telegramUserId) return res.status(500).json({ error: 'Failed to generate unique user ID' })

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        telegram_user_id: telegramUserId,
        first_name: firstName?.trim() || null,
        last_name: lastName?.trim() || null,
        email: email.trim().toLowerCase(),
        status: 'active',
      })
      .select()
      .single()

    if (insertError) return res.status(500).json({ error: insertError.message })

    return res.status(201).json({ user: { ...newUser, web_linked: false } })
  }

  // ── PATCH: update user status ───────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { telegramUserId, status } = req.body
    if (!telegramUserId || !['active', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'telegramUserId and valid status required' })
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({ status })
      .eq('telegram_user_id', telegramUserId)
      .select()
      .single()

    if (updateError) return res.status(500).json({ error: updateError.message })

    return res.status(200).json({ user: updated })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
