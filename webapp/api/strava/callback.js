/**
 * GET /api/strava/callback
 *
 * Strava redirects here after the user grants (or denies) access.
 * Validates state, exchanges code for tokens, stores connection,
 * then redirects to /profile?strava=connected (or ?strava=error).
 */

import { createClient } from '@supabase/supabase-js'
import { encrypt } from '../../lib/strava-client.js'
import { fetchAthlete } from '../../lib/strava-client.js'

const APP_URL = process.env.STRAVA_APP_URL || 'https://getavenra.com'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { code, state, error: stravaError } = req.query

  // User denied access
  if (stravaError === 'access_denied') {
    return res.redirect(`${APP_URL}/profile?strava=denied`)
  }

  if (!code || !state) {
    return res.redirect(`${APP_URL}/profile?strava=error&reason=missing_params`)
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Validate state and look up the user
  const { data: stateRow, error: stateErr } = await supabase
    .from('strava_oauth_states')
    .select('auth_user_id, expires_at')
    .eq('state', state)
    .maybeSingle()

  if (stateErr || !stateRow) {
    console.error('[strava/callback] invalid state:', state)
    return res.redirect(`${APP_URL}/profile?strava=error&reason=invalid_state`)
  }

  if (new Date(stateRow.expires_at) < new Date()) {
    await supabase.from('strava_oauth_states').delete().eq('state', state)
    return res.redirect(`${APP_URL}/profile?strava=error&reason=state_expired`)
  }

  const authUserId = stateRow.auth_user_id

  // Consume the state immediately (prevent replay)
  await supabase.from('strava_oauth_states').delete().eq('state', state)

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    console.error('[strava/callback] token exchange failed:', tokenRes.status, body)
    return res.redirect(`${APP_URL}/profile?strava=error&reason=token_exchange`)
  }

  const tokenData = await tokenRes.json()
  const athlete   = tokenData.athlete

  // Upsert connection record
  const now = new Date().toISOString()
  const { error: upsertErr } = await supabase
    .from('strava_connections')
    .upsert({
      auth_user_id:               authUserId,
      strava_athlete_id:          athlete.id,
      athlete_firstname:          athlete.firstname || null,
      athlete_lastname:           athlete.lastname  || null,
      athlete_profile_medium:     athlete.profile_medium || null,
      scopes_granted:             req.query.scope || null,
      access_token_encrypted:     encrypt(tokenData.access_token),
      refresh_token_encrypted:    encrypt(tokenData.refresh_token),
      access_token_expires_at:    new Date(tokenData.expires_at * 1000).toISOString(),
      is_active:                  true,
      connected_at:               now,
      disconnected_at:            null,
      updated_at:                 now,
    }, { onConflict: 'auth_user_id' })

  if (upsertErr) {
    console.error('[strava/callback] upsert failed:', upsertErr.message)
    return res.redirect(`${APP_URL}/profile?strava=error&reason=db_error`)
  }

  console.log(`[strava/callback] connected athlete ${athlete.id} for user ${authUserId}`)

  // Redirect to profile — frontend will trigger initial sync
  return res.redirect(`${APP_URL}/profile?strava=connected`)
}
