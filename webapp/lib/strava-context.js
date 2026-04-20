/**
 * Builds a compact STRAVA CONTEXT block for LLM system prompts.
 *
 * Returns null if the user has no active Strava connection or no
 * recent activities — callers must degrade gracefully.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreLabel(score) {
  if (score == null) return 'unknown'
  if (score >= 55)   return 'high'
  if (score >= 25)   return 'medium'
  return 'low'
}

function rollup(activities) {
  if (!activities.length) return null
  const totalDurationMins = Math.round(
    activities.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 60
  )
  const totalKm = Math.round(
    activities.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000
  )
  const maxLB  = Math.max(...activities.map(a => a.lower_body_fatigue_score  || 0))
  const maxSys = Math.max(...activities.map(a => a.systemic_fatigue_score    || 0))
  const sumLoad = activities.reduce((s, a) => s + (a.perceived_load_score   || 0), 0)
  const counts  = { run: 0, ride: 0, walk: 0, hike: 0, swim: 0, workout: 0, other: 0 }
  for (const a of activities) counts[a.category] = (counts[a.category] || 0) + 1

  return { count: activities.length, totalDurationMins, totalKm, maxLB, maxSys, sumLoad, counts }
}

function relativeTime(isoDate) {
  const diffH = Math.round((Date.now() - new Date(isoDate).getTime()) / 3_600_000)
  if (diffH < 24)  return `${diffH}h ago`
  if (diffH < 48)  return 'yesterday'
  return `${Math.floor(diffH / 24)}d ago`
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {string} authUserId — Supabase auth.users id
 * @param {object} supabase   — service-role client
 * @returns {string|null}
 */
export async function getStravaContext(authUserId, supabase) {
  // 1. Check for an active connection (fast query)
  const { data: conn } = await supabase
    .from('strava_connections')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (!conn) return null

  // 2. Pull last 14 days of normalized activities
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: activities, error } = await supabase
    .from('strava_activities_normalized')
    .select([
      'category', 'sport_type', 'name', 'start_date',
      'duration_seconds', 'distance_meters',
      'perceived_load_score', 'lower_body_fatigue_score', 'systemic_fatigue_score',
    ].join(','))
    .eq('auth_user_id', authUserId)
    .gte('start_date', since)
    .order('start_date', { ascending: false })

  if (error) {
    console.error('[strava-context] query error:', error.message)
    return null
  }

  if (!activities?.length) {
    return '=== STRAVA CONTEXT ===\nConnected but no activities in the last 14 days.\n'
  }

  // 3. Compute time-window rollups
  const now     = Date.now()
  const ago3d   = new Date(now - 3  * 86_400_000)
  const ago7d   = new Date(now - 7  * 86_400_000)

  const w3  = activities.filter(a => new Date(a.start_date) >= ago3d)
  const w7  = activities.filter(a => new Date(a.start_date) >= ago7d)
  const w14 = activities

  const r3  = rollup(w3)
  const r7  = rollup(w7)
  const r14 = rollup(w14)

  // 4. Latest activity summary
  const latest    = activities[0]
  const latestKm  = latest.distance_meters > 100
    ? `, ${(latest.distance_meters / 1000).toFixed(1)} km`
    : ''
  const latestMin = Math.round((latest.duration_seconds || 0) / 60)
  const latestWhen = relativeTime(latest.start_date)

  // 5. Decision flags
  const ago48h = new Date(now - 48 * 3_600_000)
  const hadRunIn48h  = w3.some(a => a.category === 'run'  && new Date(a.start_date) >= ago48h)
  const hadRideIn48h = w3.some(a => a.category === 'ride' && new Date(a.start_date) >= ago48h)

  // Consecutive active days (count backwards from today)
  const activeDateSet = new Set(activities.map(a => a.start_date.slice(0, 10)))
  let consecutiveDays = 0
  for (let i = 0; i < 14; i++) {
    const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    if (activeDateSet.has(d)) consecutiveDays++
    else break
  }

  // 6. Human-readable interpretation
  const lbLevel  = scoreLabel(r3?.maxLB)
  const sysLevel = scoreLabel(r7?.maxSys)
  const weekLoad = r7?.sumLoad || 0

  const interpretations = []
  if (lbLevel === 'high') {
    interpretations.push('Significant lower-body fatigue from recent activity — avoid aggressive leg progression today')
  } else if (lbLevel === 'medium') {
    interpretations.push('Moderate lower-body fatigue — reduce leg intensity if planned')
  }
  if (sysLevel === 'high') {
    interpretations.push('Systemic fatigue is elevated — prioritise recovery, avoid adding volume')
  } else if (sysLevel === 'medium') {
    interpretations.push('Moderate systemic fatigue — avoid adding extra accessory work')
  }
  if (hadRunIn48h) {
    interpretations.push('Hard run within 48h — lower-body progression not recommended today')
  }
  if (hadRideIn48h && !hadRunIn48h) {
    interpretations.push('Ride within 48h — light lower-body load carried forward')
  }
  if (consecutiveDays >= 4) {
    interpretations.push(`${consecutiveDays} consecutive active days — treat today as maintenance or technique focus`)
  }
  if (weekLoad > 400) {
    interpretations.push('Weekly endurance load above typical baseline — upper body less affected than lower')
  }
  if (!interpretations.length) {
    interpretations.push('Recent activity load is low — normal training progression is appropriate')
  }

  // 7. Build the context block
  const lines = [
    '=== STRAVA CONTEXT ===',
    `Last activity: ${latestWhen}, ${latest.sport_type}${latestKm}, ${latestMin} min, load ${scoreLabel(latest.perceived_load_score)}`,
  ]

  if (r3) {
    lines.push(
      `Last 3 days: ${r3.count} activit${r3.count === 1 ? 'y' : 'ies'}, ` +
      `${r3.totalDurationMins} min total, ` +
      `lower-body load ${scoreLabel(r3.maxLB)}, systemic load ${scoreLabel(r3.maxSys)}`
    )
  }
  if (r7) {
    const sportBreakdown = Object.entries(r7.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')
    lines.push(
      `Last 7 days: ${r7.count} activit${r7.count === 1 ? 'y' : 'ies'}, ` +
      `${r7.totalDurationMins} min, ${r7.totalKm} km` +
      (sportBreakdown ? ` (${sportBreakdown})` : '')
    )
  }
  if (r14 && r14.count > (r7?.count || 0)) {
    lines.push(`Last 14 days: ${r14.count} activities, ${r14.totalDurationMins} min, ${r14.totalKm} km`)
  }

  lines.push('Interpretation:')
  for (const i of interpretations) lines.push(`  - ${i}`)

  return lines.join('\n')
}
