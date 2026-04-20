/**
 * /api/strava/webhook
 *
 * GET  — Strava subscription validation handshake
 * POST — Incoming activity events (create / update / delete)
 *
 * Strava does not HMAC-sign webhook payloads. Security relies on:
 *  1. The verify_token challenge during subscription setup (GET).
 *  2. The callback URL being known only to Strava.
 *  3. Looking up owner_id in our own DB before trusting any event.
 */

import { createClient } from '@supabase/supabase-js'
import { ensureValidToken, fetchActivities } from '../../lib/strava-client.js'
import { normalizeActivity } from '../../lib/strava-normalize.js'

export default async function handler(req, res) {
  if (req.method === 'GET')  return handleValidation(req, res)
  if (req.method === 'POST') return handleEvent(req, res)
  return res.status(405).end()
}

// ── GET: subscription validation ─────────────────────────────────────────────

function handleValidation(req, res) {
  const { 'hub.verify_token': verifyToken, 'hub.challenge': challenge, 'hub.mode': mode } = req.query

  if (mode !== 'subscribe') {
    return res.status(400).json({ error: 'Invalid hub.mode' })
  }

  if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.warn('[strava/webhook] verify_token mismatch')
    return res.status(403).json({ error: 'Forbidden' })
  }

  // Echo challenge — must respond within a few seconds
  return res.status(200).json({ 'hub.challenge': challenge })
}

// ── POST: activity event ──────────────────────────────────────────────────────

async function handleEvent(req, res) {
  // Respond immediately — Strava times out if we don't
  res.status(200).end()

  const event = req.body
  if (!event || !event.owner_id || !event.object_type) {
    console.warn('[strava/webhook] malformed event:', JSON.stringify(event))
    return
  }

  // We only handle activity events
  if (event.object_type !== 'activity') return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Look up which Avenra user owns this athlete ID
  const { data: conn } = await supabase
    .from('strava_connections')
    .select('*')
    .eq('strava_athlete_id', event.owner_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) {
    // Unknown athlete or disconnected — ignore silently
    return
  }

  const authUserId   = conn.auth_user_id
  const activityId   = event.object_id
  const aspectType   = event.aspect_type // 'create' | 'update' | 'delete'

  console.log(`[strava/webhook] ${aspectType} activity ${activityId} for user ${authUserId}`)

  // Handle delete
  if (aspectType === 'delete') {
    await Promise.all([
      supabase
        .from('strava_activities_raw')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('auth_user_id', authUserId)
        .eq('strava_activity_id', activityId),
      supabase
        .from('strava_activities_normalized')
        .delete()
        .eq('auth_user_id', authUserId)
        .eq('strava_activity_id', activityId),
    ])
    return
  }

  // For create/update: fetch fresh activity data via the list endpoint
  // (We use a narrow time window around the activity's update timestamp)
  let accessToken
  try {
    accessToken = await ensureValidToken(conn, supabase)
  } catch (err) {
    console.error('[strava/webhook] token error:', err.message)
    return
  }

  // Fetch activities updated in last 60 min — catches this new/updated one
  const afterTs = Math.floor((Date.now() - 60 * 60 * 1000) / 1000)
  let activities = []
  try {
    activities = await fetchActivities(accessToken, afterTs, 1)
  } catch (err) {
    console.error('[strava/webhook] fetch failed:', err.message)
    return
  }

  // Find the specific activity we were notified about
  const raw = activities.find(a => a.id === activityId)
  if (!raw) {
    // Activity not in recent window (privacy change or delay) — skip
    console.warn(`[strava/webhook] activity ${activityId} not found in recent fetch`)
    return
  }

  const normalized = normalizeActivity(raw)
  const now        = new Date().toISOString()

  await Promise.all([
    supabase
      .from('strava_activities_raw')
      .upsert({
        auth_user_id:      authUserId,
        strava_activity_id: activityId,
        payload_json:      raw,
        last_seen_at:      now,
        updated_at:        now,
      }, { onConflict: 'auth_user_id,strava_activity_id' }),

    supabase
      .from('strava_activities_normalized')
      .upsert({
        auth_user_id: authUserId,
        ...normalized,
        updated_at:   now,
      }, { onConflict: 'auth_user_id,strava_activity_id' }),
  ])

  console.log(`[strava/webhook] upserted activity ${activityId} for user ${authUserId}`)
}
