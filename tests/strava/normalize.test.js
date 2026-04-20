import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { categorize, normalizeActivity } from '../../webapp/lib/strava-normalize.js'

// ── categorize ────────────────────────────────────────────────────────────────

describe('categorize', () => {
  it('maps known sport types to categories', () => {
    assert.equal(categorize('Run'),              'run')
    assert.equal(categorize('TrailRun'),         'run')
    assert.equal(categorize('VirtualRun'),       'run')
    assert.equal(categorize('Ride'),             'ride')
    assert.equal(categorize('VirtualRide'),      'ride')
    assert.equal(categorize('GravelRide'),       'ride')
    assert.equal(categorize('Walk'),             'walk')
    assert.equal(categorize('Hike'),             'hike')
    assert.equal(categorize('Swim'),             'swim')
    assert.equal(categorize('OpenWaterSwim'),    'swim')
    assert.equal(categorize('WeightTraining'),   'workout')
    assert.equal(categorize('Crossfit'),         'workout')
    assert.equal(categorize('Yoga'),             'other')
  })

  it('falls back to other for unknown types', () => {
    assert.equal(categorize('UnknownSport'), 'other')
    assert.equal(categorize(''),             'other')
    assert.equal(categorize(undefined),      'other')
  })
})

// ── normalizeActivity ─────────────────────────────────────────────────────────

describe('normalizeActivity', () => {
  function makeActivity(overrides = {}) {
    return {
      id:                   123,
      sport_type:           'Run',
      name:                 'Morning run',
      start_date:           '2026-04-20T08:00:00Z',
      moving_time:          3600,  // 60 min
      elapsed_time:         3700,
      distance:             10000, // 10 km
      total_elevation_gain: 0,
      average_heartrate:    null,
      max_heartrate:        null,
      kilojoules:           null,
      calories:             null,
      trainer:              false,
      commute:              false,
      manual:               false,
      ...overrides,
    }
  }

  it('sets correct category', () => {
    const result = normalizeActivity(makeActivity({ sport_type: 'Run' }))
    assert.equal(result.category, 'run')
  })

  it('maps all scalar fields correctly', () => {
    const raw    = makeActivity()
    const result = normalizeActivity(raw)
    assert.equal(result.strava_activity_id,  123)
    assert.equal(result.sport_type,          'Run')
    assert.equal(result.name,                'Morning run')
    assert.equal(result.duration_seconds,    3600)
    assert.equal(result.moving_time_seconds, 3600)
    assert.equal(result.distance_meters,     10000)
    assert.equal(result.trainer,             false)
  })

  it('all scores are clamped to [0, 100]', () => {
    // Extreme input: 4-hour hard run with high HR
    const result = normalizeActivity(makeActivity({
      moving_time:          14400,  // 240 min
      distance:             50000,  // 50 km
      total_elevation_gain: 2000,
      average_heartrate:    180,
    }))
    assert.ok(result.perceived_load_score     <= 100)
    assert.ok(result.lower_body_fatigue_score <= 100)
    assert.ok(result.systemic_fatigue_score   <= 100)
    assert.ok(result.perceived_load_score     >= 0)
    assert.ok(result.lower_body_fatigue_score >= 0)
    assert.ok(result.systemic_fatigue_score   >= 0)
  })

  it('short easy walk produces low scores', () => {
    const result = normalizeActivity(makeActivity({
      sport_type:  'Walk',
      moving_time: 1800,  // 30 min
      distance:    2000,  // 2 km
    }))
    assert.ok(result.perceived_load_score     < 30, `load=${result.perceived_load_score}`)
    assert.ok(result.lower_body_fatigue_score < 20, `lb=${result.lower_body_fatigue_score}`)
    assert.ok(result.systemic_fatigue_score   < 20, `sys=${result.systemic_fatigue_score}`)
  })

  it('hard 10k run produces higher scores than walk', () => {
    const walk = normalizeActivity(makeActivity({ sport_type: 'Walk', moving_time: 3600, average_heartrate: 110 }))
    const run  = normalizeActivity(makeActivity({ sport_type: 'Run',  moving_time: 3600, average_heartrate: 165 }))
    assert.ok(run.perceived_load_score     > walk.perceived_load_score,     'run load > walk load')
    assert.ok(run.lower_body_fatigue_score > walk.lower_body_fatigue_score, 'run lb > walk lb')
    assert.ok(run.systemic_fatigue_score   > walk.systemic_fatigue_score,   'run sys > walk sys')
  })

  it('handles null/missing fields without throwing', () => {
    const minimal = { id: 1, sport_type: 'Run' }
    assert.doesNotThrow(() => normalizeActivity(minimal))
    const result = normalizeActivity(minimal)
    assert.equal(result.distance_meters,   0)
    assert.equal(result.duration_seconds,  0)
    assert.equal(result.average_heartrate, null)
  })

  it('elevation increases lower-body score for runs', () => {
    const flat = normalizeActivity(makeActivity({ total_elevation_gain: 0 }))
    const hilly = normalizeActivity(makeActivity({ total_elevation_gain: 500 }))
    assert.ok(hilly.lower_body_fatigue_score > flat.lower_body_fatigue_score,
      `hilly lb=${hilly.lower_body_fatigue_score} should > flat lb=${flat.lower_body_fatigue_score}`)
  })

  it('uses sport_type fallback to type field', () => {
    const result = normalizeActivity({ id: 1, type: 'Ride', moving_time: 3600 })
    assert.equal(result.category, 'ride')
  })
})
