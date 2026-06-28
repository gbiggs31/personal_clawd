import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client using the service-role key (server-side only).
 */
export function serviceClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
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
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { error: 'Invalid token', status: 401 }

  const { data: authRow } = await supabase
    .from('user_auth')
    .select('telegram_user_id')
    .eq('auth_user_id', user.id)
    .single()

  if (requireLink && !authRow) return { error: 'Account not linked', status: 403 }

  return { supabase, user, uid: authRow?.telegram_user_id ?? null }
}
