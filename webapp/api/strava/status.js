/**
 * GET /api/strava/status
 *
 * Returns the current Strava connection state for the authenticated user,
 * plus a compact context summary for the Today page.
 * Never returns tokens.
 */

import { createClient } from '@supabase/supabase-js'
import { getStravaContext } from '../../lib/strava-context.js'

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 h

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: conn } = await supabase
    .from('strava_connections')
    .select([
      'strava_athlete_id', 'athlete_firstname', 'athlete_lastname',
      'athlete_profile_medium', 'is_active',
      'connected_at', 'last_successful_sync_at',
    ].join(','))
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!conn || !conn.is_active) {
    return res.status(200).json({ connected: false })
  }

  const lastSync  = conn.last_successful_sync_at
  const isStale   = !lastSync || (Date.now() - new Date(lastSync).getTime()) > STALE_THRESHOLD_MS

  // Build compact context summary (used by StravaContextCard on Today page)
  const contextSummary = await buildContextSummary(user.id, supabase)

  return res.status(200).json({
    connected:      true,
    athlete_name:   [conn.athlete_firstname, conn.athlete_lastname].filter(Boolean).join(' ') || 'Athlete',
    athlete_avatar: conn.athlete_profile_medium || null,
    connected_at:   conn.connected_at,
    last_sync_at:   lastSync || null,
    is_stale:       isStale,
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

  const latest     = activities[0]
  const latestMin  = Math.round((latest.duration_seconds || 0) / 60)
  const latestKm   = latest.distance_meters > 100
    ? ` · ${(latest.distance_meters / 1000).toFixed(1)} km`
    : ''
  const diffH      = Math.round((Date.now() - new Date(latest.start_date).getTime()) / 3_600_000)
  const latestWhen = diffH < 24 ? `${diffH}h ago` : diffH < 48 ? 'yesterday' : `${Math.floor(diffH/24)}d ago`

  const maxLB  = Math.max(...activities.map(a => a.lower_body_fatigue_score || 0))
  const maxSys = Math.max(...activities.map(a => a.systemic_fatigue_score   || 0))
  const totalMin = Math.round(activities.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 60)

  function label(s) {
    if (s >= 55) return 'high'
    if (s >= 25) return 'medium'
    return 'low'
  }

  // Single coaching note
  let note = 'Activity load is low — normal progression fine.'
  if (maxLB >= 55)     note = 'Keep leg work conservative today.'
  else if (maxLB >= 25) note = 'Moderate leg fatigue — reduce leg volume if planned.'
  if (maxSys >= 55)    note = 'Systemic fatigue elevated — prioritise recovery today.'

  return {
    last_activity:    `${latestWhen} · ${latest.sport_type} · ${latestMin} min${latestKm}`,
    week_cardio_load: `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}, ${totalMin} min, lower-body ${label(maxLB)}`,
    coaching_note:    note,
    lower_body_load:  label(maxLB),
    systemic_load:    label(maxSys),
  }
}
