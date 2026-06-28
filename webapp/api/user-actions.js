/**
 * /api/user-actions?action=<consent|request-deletion|update-session>
 *
 * Consolidated handler for user compliance actions.
 */

import { authenticateUser } from '../lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateUser(req, { requireLink: false })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, user, uid } = auth

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

  if (action === 'update-session') {
    if (!uid) return res.status(403).json({ error: 'Not linked' })

    const { sessionId, fields } = req.body || {}
    if (!sessionId || !fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'sessionId and fields required' })
    }

    const allowed = ['session_type', 'overall_note', 'duration_mins', 'coaching_note']
    const safe = Object.fromEntries(
      Object.entries(fields).filter(([k]) => allowed.includes(k))
    )
    if (!Object.keys(safe).length) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const { error: updateError } = await supabase
      .from('sessions')
      .update(safe)
      .eq('session_id', sessionId)
      .eq('telegram_user_id', uid)

    if (updateError) return res.status(500).json({ error: updateError.message })
    return res.json({ ok: true })
  }

  return res.status(400).json({ error: 'Missing or invalid action' })
}
