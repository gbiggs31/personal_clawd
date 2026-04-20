import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'

// Set a valid test key before importing the module
const TEST_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes

before(() => {
  process.env.STRAVA_ENCRYPTION_KEY = TEST_KEY
})

after(() => {
  delete process.env.STRAVA_ENCRYPTION_KEY
})

const { encrypt, decrypt } = await import('../../webapp/lib/strava-client.js')

describe('token encryption', () => {
  it('round-trips a token correctly', () => {
    const plaintext = 'test_access_token_abc123'
    const encrypted = encrypt(plaintext)
    const decrypted = decrypt(encrypted)
    assert.equal(decrypted, plaintext)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const plaintext = 'same_token'
    const enc1 = encrypt(plaintext)
    const enc2 = encrypt(plaintext)
    assert.notEqual(enc1, enc2)
  })

  it('encrypted format is iv:authTag:ciphertext (3 colon-separated parts)', () => {
    const encrypted = encrypt('some_token')
    const parts = encrypted.split(':')
    assert.equal(parts.length, 3)
    // IV is 12 bytes = 24 hex chars
    assert.equal(parts[0].length, 24)
    // Auth tag is 16 bytes = 32 hex chars
    assert.equal(parts[1].length, 32)
  })

  it('throws on invalid encrypted format', () => {
    assert.throws(() => decrypt('notvalid'), /Invalid encrypted token format/)
  })

  it('throws if key is wrong length', () => {
    process.env.STRAVA_ENCRYPTION_KEY = 'tooshort'
    assert.throws(() => encrypt('token'), /64-character hex string/)
    process.env.STRAVA_ENCRYPTION_KEY = TEST_KEY // restore
  })

  it('round-trips a long token', () => {
    const long = 'x'.repeat(500)
    assert.equal(decrypt(encrypt(long)), long)
  })
})
