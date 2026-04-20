/**
 * Normalizes a raw Strava activity payload into a coaching-friendly record.
 *
 * All score constants are centralised here for easy tuning.
 * Scores are capped to [0, 100].
 */

// ── Sport classification ──────────────────────────────────────────────────────

const SPORT_TO_CATEGORY = {
  // Runs
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  // Rides
  Ride: 'ride', VirtualRide: 'ride', GravelRide: 'ride',
  MountainBikeRide: 'ride', EBikeRide: 'ride', Handcycle: 'ride',
  // Walks
  Walk: 'walk',
  // Hikes
  Hike: 'hike',
  // Swims
  Swim: 'swim', OpenWaterSwim: 'swim',
  // Gym workouts
  WeightTraining: 'workout', Crossfit: 'workout', RockClimbing: 'workout',
  Elliptical: 'workout', StairStepper: 'workout',
  // Everything else
  Yoga: 'other', Stretching: 'other', Rowing: 'other',
  Kayaking: 'other', Surfing: 'other', Soccer: 'other',
  Tennis: 'other', Golf: 'other',
}

/** Map a Strava sport_type string → internal category */
export function categorize(sportType) {
  return SPORT_TO_CATEGORY[sportType] || 'other'
}

// ── Scoring parameters ────────────────────────────────────────────────────────
// load:       base score per minute of activity
// lowerBody:  lower-body fatigue multiplier per minute
// systemic:   systemic fatigue multiplier per minute

const CATEGORY_PARAMS = {
  run:     { load: 1.30, lowerBody: 1.40, systemic: 1.30 },
  ride:    { load: 1.00, lowerBody: 0.80, systemic: 1.00 },
  walk:    { load: 0.50, lowerBody: 0.50, systemic: 0.40 },
  hike:    { load: 0.90, lowerBody: 1.00, systemic: 0.80 },
  swim:    { load: 0.80, lowerBody: 0.30, systemic: 1.10 },
  workout: { load: 0.70, lowerBody: 0.50, systemic: 0.60 },
  other:   { load: 0.60, lowerBody: 0.40, systemic: 0.50 },
}

function clamp(val, min = 0, max = 100) {
  return Math.min(max, Math.max(min, val))
}

// ── Main normalizer ───────────────────────────────────────────────────────────

/**
 * Takes a raw Strava activity object (from list or detail endpoint)
 * and returns a normalized record ready for DB insertion.
 */
export function normalizeActivity(raw) {
  const sportType  = raw.sport_type || raw.type || 'Other'
  const category   = categorize(sportType)
  const params     = CATEGORY_PARAMS[category]

  const durationMins  = (raw.moving_time || raw.elapsed_time || 0) / 60
  const distanceKm    = (raw.distance || 0) / 1000
  const elevationM    = raw.total_elevation_gain || 0
  const avgHR         = raw.average_heartrate || null
  const maxHR         = raw.max_heartrate     || null

  // ── Perceived load score ──────────────────────────────────────
  let loadScore = durationMins * params.load

  // Long distance bonus (kicks in beyond 10 km)
  if (distanceKm > 10) {
    loadScore += (distanceKm - 10) * 0.4
  }

  // Heart-rate multiplier (elevates load when HR is high)
  if (avgHR) {
    if      (avgHR > 170) loadScore *= 1.30
    else if (avgHR > 155) loadScore *= 1.15
    else if (avgHR > 140) loadScore *= 1.05
  }

  // ── Lower-body fatigue score ──────────────────────────────────
  let lbScore = durationMins * params.lowerBody

  // Elevation adds quad/glute stress for runs and hikes
  if (elevationM > 50 && (category === 'run' || category === 'hike')) {
    lbScore += (elevationM / 100) * 3
  }

  // Long run/hike multiplier
  if (distanceKm > 10 && (category === 'run' || category === 'hike')) {
    lbScore += (distanceKm - 10) * 1.2
  }

  // ── Systemic fatigue score ────────────────────────────────────
  let sysScore = durationMins * params.systemic

  // Elevated HR increases systemic demand
  if (avgHR && avgHR > 155) sysScore *= 1.20
  if (avgHR && avgHR > 170) sysScore *= 1.10 // stacks: ~1.32× total

  return {
    strava_activity_id:       raw.id,
    category,
    sport_type:               sportType,
    name:                     raw.name || null,
    start_date:               raw.start_date || null,
    duration_seconds:         raw.moving_time  || raw.elapsed_time || 0,
    moving_time_seconds:      raw.moving_time  || 0,
    distance_meters:          raw.distance     || 0,
    elevation_gain_meters:    elevationM,
    average_heartrate:        avgHR,
    max_heartrate:            maxHR,
    kilojoules:               raw.kilojoules   || null,
    calories:                 raw.calories     || null,
    trainer:                  !!raw.trainer,
    commute:                  !!raw.commute,
    manual:                   !!raw.manual,
    perceived_load_score:     clamp(Math.round(loadScore)),
    lower_body_fatigue_score: clamp(Math.round(lbScore)),
    systemic_fatigue_score:   clamp(Math.round(sysScore)),
  }
}
