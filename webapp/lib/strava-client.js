/**
 * Strava API client — token encryption, refresh, and HTTP helpers.
 *
 * Token storage format: "ivHex:authTagHex:ciphertextHex"
 * Requires env: STRAVA_ENCRYPTION_KEY (64-char hex = 32 bytes)
 *               STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

// ── Encryption ────────────────────────────────────────────────────────────────

function getKey() {
  const hex = process.env.STRAVA_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('STRAVA_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext) {
  const key = getKey()
  const iv  = crypto.randomBytes(12) // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag   = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(stored) {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')
  const [ivHex, authTagHex, encryptedHex] = parts
  const iv        = Buffer.from(ivHex, 'hex')
  const authTag   = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher  = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// ── Token management ──────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry

/**
 * Returns a valid access token, refreshing if needed.
 * Updates strava_connections in-place when a refresh occurs.
 * Throws (and marks connection inactive) if refresh permanently fails.
 */
export async function ensureValidToken(connection, supabase) {
  const expiresAt = new Date(connection.access_token_expires_at).getTime()
  const now       = Date.now()

  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return decrypt(connection.access_token_encrypted)
  }

  // Need to refresh
  console.log(`[strava] refreshing token for connection ${connection.id}`)

  const refreshToken = decrypt(connection.refresh_token_encrypted)

  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[strava] token refresh failed ${res.status}: ${body}`)
    // Mark connection unhealthy so the UI can prompt reconnect
    await supabase
      .from('strava_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', connection.id)
    throw new Error(`Strava token refresh failed (${res.status}) — please reconnect`)
  }

  const data = await res.json()

  const update = {
    access_token_encrypted:  encrypt(data.access_token),
    refresh_token_encrypted: encrypt(data.refresh_token),
    access_token_expires_at: new Date(data.expires_at * 1000).toISOString(),
    updated_at:              new Date().toISOString(),
  }

  await supabase.from('strava_connections').update(update).eq('id', connection.id)
  console.log(`[strava] token refreshed for connection ${connection.id}`)

  return data.access_token
}

// ── Strava HTTP helpers ───────────────────────────────────────────────────────

async function stravaGet(path, accessToken) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 429) throw new Error('Strava rate limit reached — try again later')
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Strava API error ${res.status}: ${body}`)
  }
  return res.json()
}

/**
 * Fetch a page of athlete activities.
 * afterUnixTs: only return activities after this epoch timestamp.
 * Returns an array (empty when no more pages).
 */
export async function fetchActivities(accessToken, afterUnixTs, page = 1) {
  const params = new URLSearchParams({
    after:    String(afterUnixTs),
    per_page: '200',
    page:     String(page),
  })
  return stravaGet(`/athlete/activities?${params}`, accessToken)
}

export async function fetchAthlete(accessToken) {
  return stravaGet('/athlete', accessToken)
}

/**
 * Revoke this app's access (best-effort — never throws).
 */
export async function revokeToken(accessToken) {
  try {
    await fetch('https://www.strava.com/oauth/deauthorize', {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    console.warn('[strava] revoke failed (non-fatal):', err.message)
  }
}
