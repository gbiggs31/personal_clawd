/**
 * Tests for OAuth state validation logic.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// ── State generation ──────────────────────────────────────────────────────────

function generateState() {
  return crypto.randomBytes(24).toString('hex')
}

describe('OAuth state generation', () => {
  it('generates a 48-character hex string', () => {
    const state = generateState()
    assert.equal(state.length, 48)
    assert.match(state, /^[0-9a-f]+$/)
  })

  it('generates unique states', () => {
    const states = new Set(Array.from({ length: 100 }, generateState))
    assert.equal(states.size, 100)
  })
})

// ── State expiry validation ───────────────────────────────────────────────────

function isStateExpired(expiresAt) {
  return new Date(expiresAt) < new Date()
}

describe('OAuth state expiry', () => {
  it('treats past expiry as expired', () => {
    const past = new Date(Date.now() - 1000).toISOString()
    assert.ok(isStateExpired(past))
  })

  it('treats future expiry as valid', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    assert.ok(!isStateExpired(future))
  })

  it('treats exactly now as expired', () => {
    const now = new Date(Date.now() - 1).toISOString()
    assert.ok(isStateExpired(now))
  })
})

// ── Callback error cases ──────────────────────────────────────────────────────

function classifyCallbackResult(query) {
  if (query.error === 'access_denied') return 'denied'
  if (!query.code || !query.state)    return 'missing_params'
  return 'ok'
}

describe('OAuth callback classification', () => {
  it('detects access_denied', () => {
    assert.equal(classifyCallbackResult({ error: 'access_denied' }), 'denied')
  })

  it('detects missing code', () => {
    assert.equal(classifyCallbackResult({ state: 'abc' }), 'missing_params')
  })

  it('detects missing state', () => {
    assert.equal(classifyCallbackResult({ code: 'xyz' }), 'missing_params')
  })

  it('accepts valid params', () => {
    assert.equal(classifyCallbackResult({ code: 'xyz', state: 'abc' }), 'ok')
  })
})
