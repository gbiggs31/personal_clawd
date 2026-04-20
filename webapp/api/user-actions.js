/**
 * /api/user-actions?action=<consent|request-deletion>
 *
 * Consolidated handler for user compliance actions.
 */

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  const { action } = req.query

  if (action === 'consent') {
    const { privacy_accepted, terms_accepted, beta_acknowledged } = req.body
    const { error: insertError } = await supabase.from('consent_records').insert({
      auth_user_id:      user.id,
      privacy_accepted:  !!privacy_accepted,
      terms_accepted:    !!terms_accepted,
      beta_acknowledged: !!beta_acknowledged,
      privacy_version:   'v1',
      terms_version:     'v1',
      accepted_at:       new Date().toISOString(),
    })
    if (insertError) return res.status(500).json({ error: insertError.message })
    return res.json({ ok: true })
  }

  if (action === 'request-deletion') {
    const { error: insertError } = await supabase.from('deletion_requests').insert({
      auth_user_id: user.id,
      email:        user.email,
      status:       'pending',
    })
    if (insertError) return res.status(500).json({ error: insertError.message })
    return res.json({ ok: true })
  }

  return res.status(400).json({ error: 'Missing or invalid action' })
}
