// ── Exercise name helpers ─────────────────────────────────────────────────────

/**
 * Normalize exercise name for grouping/comparison.
 * "Bench Press", "bench press", "  bench  press  " all → "bench press"
 */
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
  const valid = sets.filter(s => s.reps != null)
  if (!valid.length) return null
  return [...valid].sort((a, b) => {
    const aw = a.weight_kg ?? 0, bw = b.weight_kg ?? 0
    if (bw !== aw) return bw - aw
    return (b.reps ?? 0) - (a.reps ?? 0)
  })[0]
}

/**
 * Group a flat array of set rows by normalized exercise, then by session.
 *
 * Returns { normEx: [{ session_id, date, sets, topSet }, ...] } where each
 * exercise's session list is ordered most-recent-first and `sets` is ordered by
 * set_num. Used to surface "recent sessions for this exercise" views.
 */
export function buildExerciseHistory(sets) {
  const byExercise = {}

  for (const row of sets || []) {
    const norm = normalizeExercise(row.exercise)
    if (!norm) continue
    const sid = row.session_id || ''
    if (!byExercise[norm]) byExercise[norm] = {}
    if (!byExercise[norm][sid]) byExercise[norm][sid] = []
    byExercise[norm][sid].push(row)
  }

  const result = {}
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
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }

  return result
}

/**
 * Compare two top sets and return a direction + text delta.
 */
export function compareTopSets(current, previous) {
  if (!current || !previous) return null
  const cw = current.weight_kg ?? 0, pw = previous.weight_kg ?? 0
  const cr = current.reps ?? 0,      pr = previous.reps ?? 0

  const round = n => Math.round(n * 10) / 10

  if (cw > pw) return { direction: 'up',   text: `+${round(cw - pw)}kg` }
  if (cw < pw) return { direction: 'down', text: `${round(cw - pw)}kg` }
  if (cr > pr) return { direction: 'up',   text: `+${cr - pr} rep${cr - pr === 1 ? '' : 's'}` }
  if (cr < pr) return { direction: 'down', text: `${cr - pr} rep${pr - cr === 1 ? '' : 's'}` }
  return { direction: 'flat', text: 'same' }
}

/**
 * Format a set's weight and reps for one-line display.
 */
export function formatWeightRep(set) {
  if (!set) return ''
  const weight = set.weight_kg != null ? `${set.weight_kg}kg` : 'BW'
  const reps   = set.reps       != null ? `× ${set.reps}`    : ''
  return `${weight} ${reps}`.trim()
}

// ── Session / coaching helpers ────────────────────────────────────────────────

const PPL_CYCLE = ['Push', 'Pull', 'Legs']

/**
 * Infer what session type should come next based on recent history.
 * Falls back gracefully if the user doesn't follow a strict PPL split.
 */
export function inferNextSessionType(recentSessions) {
  const typed = recentSessions
    .map(s => (s.session_type || '').trim())
    .filter(Boolean)
    .map(s => PPL_CYCLE.find(t => t.toLowerCase() === s.toLowerCase()) || null)
    .filter(Boolean)

  const last = typed[0]
  if (!last) return 'Push'
  const idx = PPL_CYCLE.indexOf(last)
  return PPL_CYCLE[(idx + 1) % PPL_CYCLE.length]
}

/**
 * Return the top exercises the user actually performs for a given session type,
 * ranked by frequency across recent sessions of that type.
 */
export function getTopExercisesForType(sessionType, sessions, setsBySession, limit = 3) {
  const norm = sessionType.toLowerCase()
  const relevant = sessions
    .filter(s => (s.session_type || '').toLowerCase() === norm)
    .slice(0, 10)

  const freq = {}
  for (const sess of relevant) {
    const seen = new Set()
    for (const set of setsBySession[sess.session_id] || []) {
      const ex = normalizeExercise(set.exercise)
      if (!ex || seen.has(ex)) continue
      seen.add(ex)
      freq[ex] = (freq[ex] || 0) + 1
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ex]) => ex)
}

/**
 * Coaching note based on recent session context.
 */
export function getReadinessNote(latestSession, daysSinceLast) {
  if (!latestSession) return 'Start with one main lift and progress conservatively.'
  if (latestSession.injury_flag) return 'Protect anything that feels sketchy — keep compounds submaximal today.'
  if (daysSinceLast != null && daysSinceLast >= 4) return `${daysSinceLast} days since your last session. Ease back in and prioritise feel over numbers.`
  if (latestSession.cardio_flag && latestSession.abs_flag) return 'You did a lighter day recently. A proper training session should be fine.'
  return 'Aim to beat one exercise from last time — not everything at once.'
}

/**
 * Days since a date string (YYYY-MM-DD).
 */
export function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00')) / 86_400_000)
}

export function daysBetween(a, b) {
  return Math.floor(Math.abs(new Date(a) - new Date(b)) / 86_400_000)
}
