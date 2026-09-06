import { formatWeightReps, toDisplayWeight, unitLabel } from './units.js'
import { normalizeExercise } from './exercise-history.js'

// Keep the existing public imports while sharing browser-independent helpers.
export { normalizeExercise, displayExercise, getTopSet, buildExerciseHistory } from './exercise-history.js'

/**
 * Compare two top sets and return a direction + text delta.
 * Pass the user's unit preference so the delta reads in the same unit as the
 * weights it sits next to.
 */
export function compareTopSets(current, previous, units = 'metric') {
  if (!current || !previous) return null
  const cw = current.weight_kg ?? 0, pw = previous.weight_kg ?? 0
  const cr = current.reps ?? 0,      pr = previous.reps ?? 0

  const round = n => Math.round(n * 10) / 10
  const asWeight = kg => `${round(toDisplayWeight(Math.abs(kg), units))}${unitLabel(units)}`

  if (cw > pw) return { direction: 'up',   text: `+${asWeight(cw - pw)}` }
  if (cw < pw) return { direction: 'down', text: `-${asWeight(cw - pw)}` }
  if (cr > pr) return { direction: 'up',   text: `+${cr - pr} rep${cr - pr === 1 ? '' : 's'}` }
  if (cr < pr) return { direction: 'down', text: `${cr - pr} rep${pr - cr === 1 ? '' : 's'}` }
  return { direction: 'flat', text: 'same' }
}

/**
 * Format a set's weight and reps for one-line display.
 * Re-exported from utils/units.js — kept here so existing imports keep working.
 */
export function formatWeightRep(set, units = 'metric') {
  return formatWeightReps(set, units)
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
