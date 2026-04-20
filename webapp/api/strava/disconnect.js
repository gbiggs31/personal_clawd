/**
 * POST /api/strava/disconnect
 *
 * Body: { deleteData?: boolean }
 *
 * Marks the connection inactive and optionally purges activity data.
 * Revokes the access token with Strava (best-effort).
 */

import { createClient } from '@supabase/supabase-js'
import { ensureValidToken, revokeToken } from '../../lib/strava-client.js'

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

  const { deleteData = false } = req.body || {}

  // Fetch connection to get token for revocation
  const { data: conn } = await supabase
    .from('strava_connections')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return res.status(404).json({ error: 'No active Strava connection' })

  // Revoke with Strava (best-effort — don't fail if this errors)
  try {
    const accessToken = await ensureValidToken(conn, supabase)
    await revokeToken(accessToken)
  } catch {
    // Non-fatal — proceed with local disconnect regardless
  }

  // Mark connection inactive
  await supabase
    .from('strava_connections')
    .update({
      is_active:       false,
      disconnected_at: new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq('auth_user_id', user.id)

  // Optionally purge activity data
  if (deleteData) {
    await Promise.all([
      supabase.from('strava_activities_raw').delete().eq('auth_user_id', user.id),
      supabase.from('strava_activities_normalized').delete().eq('auth_user_id', user.id),
    ])
    console.log(`[strava/disconnect] deleted all activity data for ${user.id}`)
  }

  console.log(`[strava/disconnect] disconnected user ${user.id} (deleteData=${deleteData})`)
  return res.status(200).json({ ok: true })
}
