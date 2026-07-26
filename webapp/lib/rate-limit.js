/**
 * Shared AI-message rate limit for /api/chat and /api/lift?stage=advice.
 * Both draw on the same hourly budget — they're the same class of spend.
 */

export const CHAT_HOURLY_LIMIT = 30

/**
 * Returns true if the user may send another AI message.
 *
 * Fails **closed**: a query error (including the `chat_messages` table not
 * existing) denies the request rather than silently disabling the limiter.
 * The previous `(count ?? 0) >= 30` form treated a null count as zero, so any
 * error left the endpoint completely unmetered.
 */
export async function withinChatRateLimit(supabase, authUserId, limit = CHAT_HOURLY_LIMIT) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('auth_user_id', authUserId)
    .eq('role', 'user')
    .gte('created_at', oneHourAgo)

  if (error) {
    console.error('[rate-limit] count query failed, denying request:', error.message)
    return false
  }
  if (typeof count !== 'number') {
    console.error('[rate-limit] count missing from response, denying request')
    return false
  }

  return count < limit
}
