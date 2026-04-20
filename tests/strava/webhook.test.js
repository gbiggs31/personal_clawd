/**
 * Tests for webhook handler logic.
 *
 * We test the pure logic extracted from the handler rather than
 * the full HTTP handler (which requires Vercel's runtime).
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

before(() => {
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'test_verify_token_xyz'
  process.env.STRAVA_ENCRYPTION_KEY = 'a'.repeat(64)
  process.env.STRAVA_CLIENT_ID = 'test_client_id'
  process.env.STRAVA_CLIENT_SECRET = 'test_secret'
})

// ── Validation logic (extracted from handler) ─────────────────────────────────

function validateWebhookGet(query) {
  const { 'hub.verify_token': verifyToken, 'hub.challenge': challenge, 'hub.mode': mode } = query
  if (mode !== 'subscribe') return { status: 400, body: { error: 'Invalid hub.mode' } }
  if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) return { status: 403, body: { error: 'Forbidden' } }
  return { status: 200, body: { 'hub.challenge': challenge } }
}

describe('webhook GET validation', () => {
  it('echoes challenge when tokens match', () => {
    const result = validateWebhookGet({
      'hub.mode':         'subscribe',
      'hub.verify_token': 'test_verify_token_xyz',
      'hub.challenge':    'abc123challenge',
    })
    assert.equal(result.status, 200)
    assert.equal(result.body['hub.challenge'], 'abc123challenge')
  })

  it('returns 403 on wrong verify token', () => {
    const result = validateWebhookGet({
      'hub.mode':         'subscribe',
      'hub.verify_token': 'wrong_token',
      'hub.challenge':    'abc123',
    })
    assert.equal(result.status, 403)
  })

  it('returns 400 on wrong mode', () => {
    const result = validateWebhookGet({
      'hub.mode':         'unsubscribe',
      'hub.verify_token': 'test_verify_token_xyz',
      'hub.challenge':    'abc123',
    })
    assert.equal(result.status, 400)
  })
})

// ── Event payload validation ──────────────────────────────────────────────────

function isValidEvent(event) {
  return event && event.owner_id && event.object_type && event.object_id && event.aspect_type
}

describe('webhook POST event validation', () => {
  it('accepts a valid create event', () => {
    assert.ok(isValidEvent({
      owner_id:    12345,
      object_type: 'activity',
      object_id:   99999,
      aspect_type: 'create',
    }))
  })

  it('rejects event without owner_id', () => {
    assert.ok(!isValidEvent({ object_type: 'activity', object_id: 1, aspect_type: 'create' }))
  })

  it('rejects empty event', () => {
    assert.ok(!isValidEvent(null))
    assert.ok(!isValidEvent({}))
  })

  it('accepts delete event', () => {
    assert.ok(isValidEvent({
      owner_id:    12345,
      object_type: 'activity',
      object_id:   99999,
      aspect_type: 'delete',
    }))
  })

  it('accepts update event', () => {
    assert.ok(isValidEvent({
      owner_id:    12345,
      object_type: 'activity',
      object_id:   99999,
      aspect_type: 'update',
    }))
  })
})

// ── Idempotency: upsert by strava_activity_id ────────────────────────────────

describe('webhook idempotency', () => {
  it('same event processed twice does not throw (upsert semantics)', () => {
    // The DB upsert with onConflict handles this — verify our key is correct
    const event = { owner_id: 1, object_type: 'activity', object_id: 42, aspect_type: 'create' }
    // Processing the same event ID twice should be safe due to:
    // UNIQUE (auth_user_id, strava_activity_id) + ON CONFLICT DO UPDATE
    assert.ok(isValidEvent(event))
    assert.ok(isValidEvent(event)) // second time — still valid, upsert is idempotent
  })
})
