export function normalizeExercise(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Title-case a normalized exercise name for display.
 * "bench press" → "Bench Press"
 */
export function displayExercise(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Set helpers ───────────────────────────────────────────────────────────────

/**
 * Return the heaviest/best set from a list (highest weight, then most reps).
 */
export function getTopSet(sets) {
  if (!sets?.length) return null
  let top = null
  for (const set of sets) {
    if (set.reps == null) continue
    if (!top || (set.weight_kg ?? 0) > (top.weight_kg ?? 0) ||
        ((set.weight_kg ?? 0) === (top.weight_kg ?? 0) && set.reps > top.reps)) top = set
  }
  return top
}

/**
 * Group a flat array of set rows by normalized exercise, then by session.
 *
 * Returns { normEx: [{ session_id, date, sets, topSet }, ...] } where each
 * exercise's session list is ordered most-recent-first and `sets` is ordered by
 * set_num. Used to surface "recent sessions for this exercise" views.
 */
export function buildExerciseHistory(sets, sessionsNewestFirst = []) {
  const byExercise = Object.create(null)
  const sessionOrder = new Map(sessionsNewestFirst.map((session, index) => [session.session_id, index]))

  for (const row of sets || []) {
    const norm = normalizeExercise(row.exercise)
    if (!norm) continue
    const sid = row.session_id || ''
    if (!byExercise[norm]) byExercise[norm] = Object.create(null)
    if (!byExercise[norm][sid]) byExercise[norm][sid] = []
    byExercise[norm][sid].push(row)
  }

  const result = Object.create(null)
  for (const [norm, sessions] of Object.entries(byExercise)) {
    result[norm] = Object.entries(sessions)
      .map(([session_id, exSets]) => {
        const ordered = [...exSets].sort((a, b) => (a.set_num ?? 0) - (b.set_num ?? 0))
        return {
          session_id,
          date: ordered[0]?.date || '',
          sets: ordered,
          topSet: getTopSet(ordered),
        }
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) ||
        (sessionOrder.get(a.session_id) ?? 0) - (sessionOrder.get(b.session_id) ?? 0))
  }

  return result
}
