/**
 * Tests for strava-context.js
 *
 * We mock the supabase client to avoid network calls.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getStravaContext } from '../../webapp/lib/strava-context.js'

function makeSupabase({ connected = true, activities = [] } = {}) {
  return {
    from(table) {
      return {
        select() { return this },
        eq()     { return this },
        gte()    { return this },
        order()  { return this },

        async maybeSingle() {
          if (table === 'strava_connections') {
            return { data: connected ? { id: 1 } : null }
          }
          return { data: null }
        },

        // Used for activities query (not maybeSingle)
        then(resolve) {
          if (table === 'strava_activities_normalized') {
            return resolve({ data: activities, error: null })
          }
          return resolve({ data: null, error: null })
        },
      }
    },
  }
}

// Add Promise-like behaviour to the query builder
function makeSupabaseAsync({ connected = true, activities = [] } = {}) {
  const self = {
    from(table) {
      const builder = {
        _table: table,
        select() { return this },
        eq()     { return this },
        gte()    { return this },
        order()  { return this },
        maybeSingle() {
          if (table === 'strava_connections') {
            return Promise.resolve({ data: connected ? { id: 1 } : null })
          }
          return Promise.resolve({ data: null })
        },
        // Activities query is awaited directly
        [Symbol.toPrimitive]() { return '' },
      }
      // Make the builder itself awaitable (for the activities query)
      builder[Symbol.asyncIterator] = undefined
      Object.defineProperty(builder, 'then', {
        get() {
          return (resolve) => {
            if (table === 'strava_activities_normalized') {
              return Promise.resolve({ data: activities, error: null }).then(resolve)
            }
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
        },
      })
      return builder
    },
  }
  return self
}

describe('getStravaContext', () => {
  it('returns null when user is not connected', async () => {
    const supabase = makeSupabaseAsync({ connected: false })
    const result = await getStravaContext('user-123', supabase)
    assert.equal(result, null)
  })

  it('returns no-activity message when connected but no recent data', async () => {
    const supabase = makeSupabaseAsync({ connected: true, activities: [] })
    const result = await getStravaContext('user-123', supabase)
    assert.ok(result.includes('STRAVA CONTEXT'))
    assert.ok(result.includes('no activities'))
  })

  it('includes last activity line', async () => {
    const supabase = makeSupabaseAsync({
      connected: true,
      activities: [{
        category: 'run',
        sport_type: 'Run',
        name: 'Morning run',
        start_date: new Date(Date.now() - 2 * 3600_000).toISOString(),
        duration_seconds: 3600,
        distance_meters: 10000,
        perceived_load_score: 70,
        lower_body_fatigue_score: 65,
        systemic_fatigue_score: 60,
      }],
    })
    const result = await getStravaContext('user-123', supabase)
    assert.ok(result.includes('Last activity'))
    assert.ok(result.includes('Run'))
    assert.ok(result.includes('STRAVA CONTEXT'))
  })

  it('includes interpretation section', async () => {
    const supabase = makeSupabaseAsync({
      connected: true,
      activities: [{
        category: 'run',
        sport_type: 'Run',
        start_date: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
        duration_seconds: 3600,
        distance_meters: 12000,
        perceived_load_score: 80,
        lower_body_fatigue_score: 75,
        systemic_fatigue_score: 70,
      }],
    })
    const result = await getStravaContext('user-123', supabase)
    assert.ok(result.includes('Interpretation'))
    assert.ok(result.includes('lower-body'))
  })

  it('output is a string', async () => {
    const supabase = makeSupabaseAsync({ connected: true, activities: [] })
    const result = await getStravaContext('user-123', supabase)
    assert.equal(typeof result, 'string')
  })
})
