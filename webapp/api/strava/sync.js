/**
 * POST /api/strava/sync
 *
 * Syncs Strava activities for the authenticated user.
 * - First sync (no last_successful_sync_at): imports last BACKFILL_DAYS days.
 * - Subsequent syncs: imports activities since last successful sync.
 *
 * Also callable by the Vercel daily cron (with CRON_SECRET header).
 *
 * Query param: ?all=1 to trigger a full backfill (re-import BACKFILL_DAYS days).
 */

import { createClient } from '@supabase/supabase-js'
import { ensureValidToken, fetchActivities } from '../../lib/strava-client.js'
import { normalizeActivity } from '../../lib/strava-normalize.js'

const BACKFILL_DAYS = 30 // configurable window for initial import

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Allow Vercel cron to call this with a server-side secret instead of a user token
  const isCron = req.headers['x-cron-secret'] === process.env.CRON_SECRET && process.env.CRON_SECRET

  let authUserId

  if (isCron) {
    // Cron path: sync all active connections
    return runCronSync(res)
  }

  // User-triggered path
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  authUserId = user.id

  const result = await syncUser(authUserId, supabase, req.query.all === '1')
  return res.status(result.ok ? 200 : 500).json(result)
}

// ── Per-user sync ─────────────────────────────────────────────────────────────

async function syncUser(authUserId, supabase, forceBackfill = false) {
  // Mark attempt
  await supabase
    .from('strava_connections')
    .update({ last_attempted_sync_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)

  const { data: conn } = await supabase
    .from('strava_connections')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return { ok: false, error: 'No active Strava connection' }

  let accessToken
  try {
    accessToken = await ensureValidToken(conn, supabase)
  } catch (err) {
    console.error(`[strava/sync] token error for ${authUserId}:`, err.message)
    return { ok: false, error: err.message, needs_reconnect: true }
  }

  // Determine the "after" timestamp
  const lastSync = conn.last_successful_sync_at
  let afterTs

  if (!lastSync || forceBackfill) {
    afterTs = Math.floor((Date.now() - BACKFILL_DAYS * 86_400_000) / 1000)
    console.log(`[strava/sync] backfill ${BACKFILL_DAYS}d for user ${authUserId}`)
  } else {
    afterTs = Math.floor(new Date(lastSync).getTime() / 1000)
    console.log(`[strava/sync] incremental sync since ${lastSync} for user ${authUserId}`)
  }

  // Paginate through activities
  let imported = 0
  let page = 1

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let activities
    try {
      activities = await fetchActivities(accessToken, afterTs, page)
    } catch (err) {
      console.error(`[strava/sync] fetch page ${page} failed:`, err.message)
      break
    }

    if (!activities.length) break

    const now = new Date().toISOString()

    for (const raw of activities) {
      const normalized = normalizeActivity(raw)

      // Upsert raw payload
      await supabase
        .from('strava_activities_raw')
        .upsert({
          auth_user_id:      authUserId,
          strava_activity_id: raw.id,
          payload_json:      raw,
          last_seen_at:      now,
          updated_at:        now,
        }, { onConflict: 'auth_user_id,strava_activity_id' })

      // Upsert normalized record
      await supabase
        .from('strava_activities_normalized')
        .upsert({
          auth_user_id: authUserId,
          ...normalized,
          updated_at:   now,
        }, { onConflict: 'auth_user_id,strava_activity_id' })

      imported++
    }

    if (activities.length < 200) break // last page
    page++
  }

  // Record successful sync time
  await supabase
    .from('strava_connections')
    .update({ last_successful_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId)

  console.log(`[strava/sync] imported ${imported} activities for user ${authUserId}`)
  return { ok: true, imported }
}

// ── Cron: sync all active connections ─────────────────────────────────────────

async function runCronSync(res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { data: connections } = await supabase
    .from('strava_connections')
    .select('auth_user_id')
    .eq('is_active', true)

  if (!connections?.length) return res.status(200).json({ ok: true, synced: 0 })

  const results = await Promise.allSettled(
    connections.map(c => syncUser(c.auth_user_id, supabase))
  )

  const synced  = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
  const failed  = results.length - synced
  console.log(`[strava/cron] synced ${synced}/${results.length} connections (${failed} failed)`)

  return res.status(200).json({ ok: true, synced, failed })
}
