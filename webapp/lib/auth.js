import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client using the service-role key (server-side only).
 */
export function serviceClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

// ── Local JWT verification ────────────────────────────────────────────────────
//
// supabase.auth.getUser(token) is a network round trip to GoTrue on every
// request. Supabase signs access tokens with the project's JWT secret, so when
// SUPABASE_JWT_SECRET is set we verify locally instead and skip the hop
// entirely. Without the env var we fall back to getUser(), so this is safe to
// deploy before the secret is configured.

function b64urlDecode(segment) {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function parseJsonSegment(segment) {
  try { return JSON.parse(b64urlDecode(segment).toString('utf8')) } catch { return null }
}

/**
 * Verify an HS256 JWT against the shared secret.
 * Returns the decoded payload, or null if the token is malformed, wrongly
 * signed, expired, or not HS256.
 */
function verifyHs256(token, secret) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerSeg, payloadSeg, signatureSeg] = parts

  const header = parseJsonSegment(headerSeg)
  if (header?.alg !== 'HS256') return null

  const expected = crypto.createHmac('sha256', secret).update(`${headerSeg}.${payloadSeg}`).digest()
  const actual = b64urlDecode(signatureSeg)
  // timingSafeEqual throws on a length mismatch — check first.
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null

  const payload = parseJsonSegment(payloadSeg)
  if (!payload?.sub) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null

  return payload
}

// ── auth_user_id → telegram_user_id cache ─────────────────────────────────────
//
// The mapping is written once at signup and never changes afterwards, so it's
// safe to memoise per warm serverless instance. Only successful links are
// cached: an unlinked account is re-queried every time so that linking takes
// effect immediately rather than after a TTL.

const UID_TTL_MS = 10 * 60 * 1000
const uidCache = new Map()

function cachedUid(authUserId) {
  const hit = uidCache.get(authUserId)
  if (!hit) return null
  if (Date.now() - hit.at > UID_TTL_MS) {
    uidCache.delete(authUserId)
    return null
  }
  return hit.uid
}

/**
 * Authenticate a request from its Bearer token.
 *
 * On success returns { supabase, user, uid } where `uid` is the linked
 * telegram_user_id (null if the account is not linked).
 * On failure returns { error, status } — the caller should
 *   `return res.status(status).json({ error })`.
 *
 * Pass requireLink: false to allow unlinked accounts (uid may be null).
 */
export async function authenticateUser(req, { requireLink = true } = {}) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const supabase = serviceClient()

  let user = null
  const jwtSecret = process.env.SUPABASE_JWT_SECRET
  if (jwtSecret) {
    const payload = verifyHs256(token, jwtSecret)
    if (!payload) return { error: 'Invalid token', status: 401 }
    user = { id: payload.sub, email: payload.email ?? null }
  } else {
    const { data, error: authError } = await supabase.auth.getUser(token)
    if (authError || !data?.user) return { error: 'Invalid token', status: 401 }
    user = data.user
  }

  let uid = cachedUid(user.id)
  if (uid == null) {
    const { data: authRow } = await supabase
      .from('user_auth')
      .select('telegram_user_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    uid = authRow?.telegram_user_id ?? null
    if (uid != null) uidCache.set(user.id, { uid, at: Date.now() })
  }

  if (requireLink && uid == null) return { error: 'Account not linked', status: 403 }

  return { supabase, user, uid }
}
