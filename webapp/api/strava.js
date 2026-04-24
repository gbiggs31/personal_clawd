/**
 * /api/strava?action=<connect|callback|status|sync|disconnect|webhook>
 *
 * Single consolidated handler for all Strava operations.
 * Replaces the individual files under api/strava/*.
 */

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { encrypt, ensureValidToken, fetchActivities, revokeToken } from '../lib/strava-client.js'
import { normalizeActivity } from '../lib/strava-normalize.js'
import { getStravaContext } from '../lib/strava-context.js'

const SCOPES           = 'read,activity:read_all'
const APP_URL          = process.env.STRAVA_APP_URL || 'https://getavenra.com'
const STALE_THRESHOLD  = 24 * 60 * 60 * 1000
const BACKFILL_DAYS    = 30

export default async function handler(req, res) {
  const action = req.query.action

  // Cron path — method POST with x-cron-secret header, no action required
  if (req.method === 'POST' && !action) {
    if (!process.env.CRON_SECRET) {
      console.error('[strava/cron] CRON_SECRET env var not set')
      return res.status(500).json({ error: 'Cron not configured' })
    }
    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    return runCronSync(res)
  }

  switch (action) {
    case 'connect':    return handleConnect(req, res)
    case 'callback':   return handleCallback(req, res)
    case 'status':     return handleStatus(req, res)
    case 'sync':       return handleSync(req, res)
    case 'disconnect': return handleDisconnect(req, res)
    case 'webhook':    return handleWebhook(req, res)
    case 'activities': return handleActivities(req, res)
    default:           return res.status(400).json({ error: 'Missing or invalid action' })
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeSupabase() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

async function getAuthUser(req, supabase) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabase.auth.getUser(token)
  return error ? null : user
}

// ── connect ───────────────────────────────────────────────────────────────────

async function handleConnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = makeSupabase()
  const user = await getAuthUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const state = crypto.randomBytes(24).toString('hex')
  const { error: insertError } = await supabase
    .from('strava_oauth_states')
    .insert({ state, auth_user_id: user.id })

  if (insertError) {
    console.error('[strava/connect] state insert failed:', insertError.message)
    return res.status(500).json({ error: 'Failed to initiate OAuth' })
  }

  const params = new URLSearchParams({
    client_id:       process.env.STRAVA_CLIENT_ID,
    redirect_uri:    process.env.STRAVA_REDIRECT_URI,
    response_type:   'code',
    approval_prompt: 'auto',
    scope:           SCOPES,
    state,
  })

  return res.status(200).json({ url: `https://www.strava.com/oauth/authorize?${params}` })
}

// ── callback ──────────────────────────────────────────────────────────────────

async function handleCallback(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { code, state, error: stravaError } = req.query

  if (stravaError === 'access_denied') return res.redirect(`${APP_URL}/profile?strava=denied`)
  if (!code || !state) return res.redirect(`${APP_URL}/profile?strava=error&reason=missing_params`)

  const supabase = makeSupabase()

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
  await supabase.from('strava_oauth_states').delete().eq('state', state)

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
  const now       = new Date().toISOString()

  const { error: upsertErr } = await supabase
    .from('strava_connections')
    .upsert({
      auth_user_id:            authUserId,
      strava_athlete_id:       athlete.id,
      athlete_firstname:       athlete.firstname || null,
      athlete_lastname:        athlete.lastname  || null,
      athlete_profile_medium:  athlete.profile_medium || null,
      scopes_granted:          req.query.scope || null,
      access_token_encrypted:  encrypt(tokenData.access_token),
      refresh_token_encrypted: encrypt(tokenData.refresh_token),
      access_token_expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
      is_active:               true,
      connected_at:            now,
      disconnected_at:         null,
      updated_at:              now,
    }, { onConflict: 'auth_user_id' })

  if (upsertErr) {
    console.error('[strava/callback] upsert failed:', upsertErr.message)
    return res.redirect(`${APP_URL}/profile?strava=error&reason=db_error`)
  }

  console.log(`[strava/callback] connected athlete ${athlete.id} for user ${authUserId}`)
  return res.redirect(`${APP_URL}/profile?strava=connected`)
}

// ── status ────────────────────────────────────────────────────────────────────

async function handleStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = makeSupabase()
  const user = await getAuthUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: conn } = await supabase
    .from('strava_connections')
    .select([
      'strava_athlete_id', 'athlete_firstname', 'athlete_lastname',
      'athlete_profile_medium', 'is_active', 'connected_at', 'last_successful_sync_at',
    ].join(','))
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!conn || !conn.is_active) return res.status(200).json({ connected: false })

  const lastSync = conn.last_successful_sync_at
  const isStale  = !lastSync || (Date.now() - new Date(lastSync).getTime()) > STALE_THRESHOLD

  const contextSummary = await buildContextSummary(user.id, supabase)

  return res.status(200).json({
    connected:       true,
    athlete_name:    [conn.athlete_firstname, conn.athlete_lastname].filter(Boolean).join(' ') || 'Athlete',
    athlete_avatar:  conn.athlete_profile_medium || null,
    connected_at:    conn.connected_at,
    last_sync_at:    lastSync || null,
    is_stale:        isStale,
    context_summary: contextSummary,
  })
}

async function buildContextSummary(authUserId, supabase) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: activities } = await supabase
    .from('strava_activities_normalized')
    .select('category, sport_type, start_date, duration_seconds, distance_meters, lower_body_fatigue_score, systemic_fatigue_score, perceived_load_score')
    .eq('auth_user_id', authUserId)
    .gte('start_date', since)
    .order('start_date', { ascending: false })

  if (!activities?.length) return null

  const latest    = activities[0]
  const latestMin = Math.round((latest.duration_seconds || 0) / 60)
  const latestKm  = latest.distance_meters > 100 ? ` · ${(latest.distance_meters / 1000).toFixed(1)} km` : ''
  const diffH     = Math.round((Date.now() - new Date(latest.start_date).getTime()) / 3_600_000)
  const latestWhen = diffH < 24 ? `${diffH}h ago` : diffH < 48 ? 'yesterday' : `${Math.floor(diffH/24)}d ago`

  const maxLB    = Math.max(...activities.map(a => a.lower_body_fatigue_score || 0))
  const maxSys   = Math.max(...activities.map(a => a.systemic_fatigue_score   || 0))
  const totalMin = Math.round(activities.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 60)

  function label(s) {
    if (s >= 55) return 'high'
    if (s >= 25) return 'medium'
    return 'low'
  }

  let note = 'Activity load is low — normal progression fine.'
  if (maxLB >= 55)      note = 'Keep leg work conservative today.'
  else if (maxLB >= 25) note = 'Moderate leg fatigue — reduce leg volume if planned.'
  if (maxSys >= 55)     note = 'Systemic fatigue elevated — prioritise recovery today.'

  return {
    last_activity:    `${latestWhen} · ${latest.sport_type} · ${latestMin} min${latestKm}`,
    week_cardio_load: `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}, ${totalMin} min, lower-body ${label(maxLB)}`,
    coaching_note:    note,
    lower_body_load:  label(maxLB),
    systemic_load:    label(maxSys),
  }
}

// ── sync ──────────────────────────────────────────────────────────────────────

async function handleSync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = makeSupabase()
  const user = await getAuthUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const result = await syncUser(user.id, supabase, req.query.all === '1')
  return res.status(result.ok ? 200 : 500).json(result)
}

async function syncUser(authUserId, supabase, forceBackfill = false) {
  // Atomic advisory lock: only proceed if no sync started in the last 10 minutes.
  // This prevents duplicate work when cron overlaps with manual sync or a prior slow cron run.
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: lockRow } = await supabase
    .from('strava_connections')
    .update({ last_attempted_sync_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .or(`last_attempted_sync_at.is.null,last_attempted_sync_at.lt.${tenMinsAgo}`)
    .select('auth_user_id')
    .maybeSingle()

  if (!lockRow) {
    console.log(`[strava/sync] skipping ${authUserId} — sync already in progress or recently completed`)
    return { ok: true, imported: 0, skipped: true }
  }

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

  const lastSync = conn.last_successful_sync_at
  let afterTs
  if (!lastSync || forceBackfill) {
    afterTs = Math.floor((Date.now() - BACKFILL_DAYS * 86_400_000) / 1000)
    console.log(`[strava/sync] backfill ${BACKFILL_DAYS}d for user ${authUserId}`)
  } else {
    afterTs = Math.floor(new Date(lastSync).getTime() / 1000)
    console.log(`[strava/sync] incremental since ${lastSync} for user ${authUserId}`)
  }

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
      await supabase.from('strava_activities_raw').upsert(
        { auth_user_id: authUserId, strava_activity_id: raw.id, payload_json: raw, last_seen_at: now, updated_at: now },
        { onConflict: 'auth_user_id,strava_activity_id' }
      )
      await supabase.from('strava_activities_normalized').upsert(
        { auth_user_id: authUserId, ...normalized, updated_at: now },
        { onConflict: 'auth_user_id,strava_activity_id' }
      )
      imported++
    }

    if (activities.length < 200) break
    page++
  }

  await supabase
    .from('strava_connections')
    .update({ last_successful_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId)

  console.log(`[strava/sync] imported ${imported} activities for user ${authUserId}`)
  return { ok: true, imported }
}

async function runCronSync(res) {
  const supabase = makeSupabase()
  const { data: connections } = await supabase
    .from('strava_connections')
    .select('auth_user_id')
    .eq('is_active', true)

  if (!connections?.length) return res.status(200).json({ ok: true, synced: 0 })

  const results = await Promise.allSettled(connections.map(c => syncUser(c.auth_user_id, supabase)))
  const synced  = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
  const failed  = results.length - synced
  console.log(`[strava/cron] synced ${synced}/${results.length} (${failed} failed)`)
  return res.status(200).json({ ok: true, synced, failed })
}

// ── disconnect ────────────────────────────────────────────────────────────────

async function handleDisconnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = makeSupabase()
  const user = await getAuthUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { deleteData = false } = req.body || {}

  const { data: conn } = await supabase
    .from('strava_connections')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return res.status(404).json({ error: 'No active Strava connection' })

  try {
    const accessToken = await ensureValidToken(conn, supabase)
    await revokeToken(accessToken)
  } catch { /* non-fatal */ }

  await supabase
    .from('strava_connections')
    .update({ is_active: false, disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('auth_user_id', user.id)

  if (deleteData) {
    await Promise.all([
      supabase.from('strava_activities_raw').delete().eq('auth_user_id', user.id),
      supabase.from('strava_activities_normalized').delete().eq('auth_user_id', user.id),
    ])
    console.log(`[strava/disconnect] deleted activity data for ${user.id}`)
  }

  console.log(`[strava/disconnect] disconnected user ${user.id} (deleteData=${deleteData})`)
  return res.status(200).json({ ok: true })
}

// ── activities ────────────────────────────────────────────────────────────────

async function handleActivities(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = makeSupabase()
  const user = await getAuthUser(req, supabase)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { data: conn } = await supabase
    .from('strava_connections')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return res.status(200).json({ connected: false, activities: [] })

  const { data: activities } = await supabase
    .from('strava_activities_normalized')
    .select([
      'strava_activity_id', 'name', 'sport_type', 'category',
      'start_date', 'duration_seconds', 'distance_meters',
      'elevation_gain_meters', 'average_heartrate', 'perceived_load_score',
    ].join(','))
    .eq('auth_user_id', user.id)
    .order('start_date', { ascending: false })
    .limit(500)

  return res.status(200).json({ connected: true, activities: activities || [] })
}

// ── webhook ───────────────────────────────────────────────────────────────────

async function handleWebhook(req, res) {
  if (req.method === 'GET')  return handleWebhookValidation(req, res)
  if (req.method === 'POST') return handleWebhookEvent(req, res)
  return res.status(405).end()
}

function handleWebhookValidation(req, res) {
  const { 'hub.verify_token': verifyToken, 'hub.challenge': challenge, 'hub.mode': mode } = req.query

  if (mode !== 'subscribe') return res.status(400).json({ error: 'Invalid hub.mode' })
  if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.warn('[strava/webhook] verify_token mismatch')
    return res.status(403).json({ error: 'Forbidden' })
  }
  return res.status(200).json({ 'hub.challenge': challenge })
}

async function handleWebhookEvent(req, res) {
  res.status(200).end()

  const event = req.body
  if (!event?.owner_id || !event.object_type) {
    console.warn('[strava/webhook] malformed event:', JSON.stringify(event))
    return
  }

  if (event.object_type !== 'activity') return

  const supabase = makeSupabase()

  const { data: conn } = await supabase
    .from('strava_connections')
    .select('*')
    .eq('strava_athlete_id', event.owner_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return

  const authUserId = conn.auth_user_id
  const activityId = event.object_id
  const aspectType = event.aspect_type

  console.log(`[strava/webhook] ${aspectType} activity ${activityId} for user ${authUserId}`)

  if (aspectType === 'delete') {
    await Promise.all([
      supabase.from('strava_activities_raw')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('auth_user_id', authUserId).eq('strava_activity_id', activityId),
      supabase.from('strava_activities_normalized')
        .delete().eq('auth_user_id', authUserId).eq('strava_activity_id', activityId),
    ])
    return
  }

  let accessToken
  try {
    accessToken = await ensureValidToken(conn, supabase)
  } catch (err) {
    console.error('[strava/webhook] token error:', err.message)
    return
  }

  const afterTs = Math.floor((Date.now() - 60 * 60 * 1000) / 1000)
  let activities = []
  try {
    activities = await fetchActivities(accessToken, afterTs, 1)
  } catch (err) {
    console.error('[strava/webhook] fetch failed:', err.message)
    return
  }

  const raw = activities.find(a => a.id === activityId)
  if (!raw) {
    console.warn(`[strava/webhook] activity ${activityId} not found in recent fetch`)
    return
  }

  const normalized = normalizeActivity(raw)
  const now        = new Date().toISOString()

  await Promise.all([
    supabase.from('strava_activities_raw').upsert(
      { auth_user_id: authUserId, strava_activity_id: activityId, payload_json: raw, last_seen_at: now, updated_at: now },
      { onConflict: 'auth_user_id,strava_activity_id' }
    ),
    supabase.from('strava_activities_normalized').upsert(
      { auth_user_id: authUserId, ...normalized, updated_at: now },
      { onConflict: 'auth_user_id,strava_activity_id' }
    ),
  ])

  console.log(`[strava/webhook] upserted activity ${activityId} for user ${authUserId}`)
}
