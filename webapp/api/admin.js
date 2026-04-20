/**
 * /api/admin
 *
 * Consolidated handler for admin operations.
 * Replaces api/admin/users.js and api/admin/reset-onboarding.js.
 *
 * Routes:
 *   GET    /api/admin?resource=users           — list all users
 *   POST   /api/admin?resource=users           — create user
 *   PATCH  /api/admin?resource=users           — update user status
 *   POST   /api/admin?action=reset-onboarding  — delete profile (reset onboarding)
 */

import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user || !ADMIN_EMAIL || user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { resource, action } = req.query

  // ── reset-onboarding ───────────────────────────────────────────────────────
  if (action === 'reset-onboarding') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const { telegramUserId } = req.body
    if (!telegramUserId) return res.status(400).json({ error: 'telegramUserId required' })

    const { error } = await supabase
      .from('profile')
      .delete()
      .eq('telegram_user_id', telegramUserId)

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  // ── users resource ─────────────────────────────────────────────────────────
  if (resource === 'users') {
    if (req.method === 'GET') {
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) return res.status(500).json({ error: error.message })

      const { data: linked } = await supabase.from('user_auth').select('telegram_user_id')
      const linkedIds = new Set((linked || []).map(r => String(r.telegram_user_id)))

      return res.status(200).json({
        users: (users || []).map(u => ({ ...u, web_linked: linkedIds.has(String(u.telegram_user_id)) })),
      })
    }

    if (req.method === 'POST') {
      const { firstName, lastName, email } = req.body
      if (!email?.trim()) return res.status(400).json({ error: 'Email is required' })

      const { data: existing } = await supabase
        .from('users').select('id').eq('email', email.trim().toLowerCase()).single()

      if (existing) return res.status(409).json({ error: 'A user with this email already exists' })

      let telegramUserId
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = Date.now() * 100 + Math.floor(Math.random() * 100)
        const { data: collision } = await supabase
          .from('users').select('id').eq('telegram_user_id', candidate).single()
        if (!collision) { telegramUserId = candidate; break }
      }

      if (!telegramUserId) return res.status(500).json({ error: 'Failed to generate unique user ID' })

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          telegram_user_id: telegramUserId,
          first_name:       firstName?.trim() || null,
          last_name:        lastName?.trim()  || null,
          email:            email.trim().toLowerCase(),
          status:           'active',
        })
        .select()
        .single()

      if (insertError) return res.status(500).json({ error: insertError.message })
      return res.status(201).json({ user: { ...newUser, web_linked: false } })
    }

    if (req.method === 'PATCH') {
      const { telegramUserId, status } = req.body
      if (!telegramUserId || !['active', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'telegramUserId and valid status required' })
      }

      const { data: updated, error: updateError } = await supabase
        .from('users').update({ status }).eq('telegram_user_id', telegramUserId).select().single()

      if (updateError) return res.status(500).json({ error: updateError.message })
      return res.status(200).json({ user: updated })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(400).json({ error: 'Missing or invalid resource/action' })
}
