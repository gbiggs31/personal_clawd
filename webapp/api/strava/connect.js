/**
 * POST /api/strava/connect
 *
 * Returns the Strava OAuth authorization URL.
 * The frontend calls this with a Bearer token, then redirects
 * window.location.href to the returned URL.
 *
 * Query params → Strava auth page → callback.js
 */

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Minimum scopes for coaching context
const SCOPES = 'read,activity:read_all'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  // Generate a cryptographically random state value for CSRF protection
  const state = crypto.randomBytes(24).toString('hex')

  // Store state → user mapping (expires in 10 min, enforced by DB default)
  const { error: insertError } = await supabase
    .from('strava_oauth_states')
    .insert({ state, auth_user_id: user.id })

  if (insertError) {
    console.error('[strava/connect] state insert failed:', insertError.message)
    return res.status(500).json({ error: 'Failed to initiate OAuth' })
  }

  const params = new URLSearchParams({
    client_id:     process.env.STRAVA_CLIENT_ID,
    redirect_uri:  process.env.STRAVA_REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope:         SCOPES,
    state,
  })

  const url = `https://www.strava.com/oauth/authorize?${params}`
  return res.status(200).json({ url })
}
