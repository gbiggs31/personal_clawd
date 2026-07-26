/**
 * In-memory, per-page-load cache for tab data.
 *
 * Every tab used to refetch from scratch on mount — Dashboard re-queried
 * sessions and sets, Progress re-scanned the whole `sets` table for its
 * exercise list, Today re-pulled 120 days of history. Returning to a tab you
 * were on ten seconds ago paid the full cost again.
 *
 * The pattern is stale-while-revalidate: seed component state from the cache
 * synchronously (so the tab paints immediately), then refresh in the
 * background and update. Deliberately not persisted to localStorage — it dies
 * with the page load, so a hard refresh is always a clean read.
 */

const store = new Map()

const DEFAULT_TTL_MS = 5 * 60 * 1000

/** Cached value, or undefined if absent or expired. */
export function getCached(key) {
  const hit = store.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    store.delete(key)
    return undefined
  }
  return hit.value
}

export function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Drop cache entries whose key starts with `prefix` (all of them if omitted).
 * Call after a mutation that invalidates a view — e.g. closing a session makes
 * the dashboard and progress data stale.
 */
export function invalidateCache(prefix) {
  if (!prefix) { store.clear(); return }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

// Keys, kept together so invalidation call sites don't hard-code strings.
export const CACHE_KEYS = {
  dashboardPage0: 'dashboard:page0',
  dashboardStrava: 'dashboard:strava',
  progressExercises: 'progress:exercises',
  todayPlan: 'today:plan',
  todayHistory: 'today:history',
}
