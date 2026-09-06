import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExerciseHistory, getTopSet, normalizeExercise } from '../src/utils/exercise-history.js'

test('groups spelling case and whitespace, keeps variations separate, orders workouts and sets', () => {
  const sets = [
    { id: 1, exercise: ' Bench   Press ', session_id: 'old', date: '2026-08-01', set_num: 1, weight_kg: 80, reps: 8 },
    { id: 2, exercise: 'bench press', session_id: 'new', date: '2026-09-01', set_num: 2, weight_kg: 85, reps: 6, rpe: 8, note: 'Controlled' },
    { id: 3, exercise: 'BENCH PRESS', session_id: 'new', date: '2026-09-01', set_num: 1, weight_kg: 60, reps: 10 },
    { id: 4, exercise: 'Incline Bench Press', session_id: 'new', date: '2026-09-01', weight_kg: 60, reps: 8 },
    { id: 5, exercise: ' ', session_id: 'new' },
  ]
  const history = buildExerciseHistory(sets)
  assert.deepEqual(Object.keys(history), ['bench press', 'incline bench press'])
  assert.deepEqual(history['bench press'].map(row => row.session_id), ['new', 'old'])
  assert.deepEqual(history['bench press'][0].sets.map(row => row.id), [3, 2])
  assert.equal(history['bench press'][0].topSet.rpe, 8)
  assert.equal(history['bench press'][0].topSet.note, 'Controlled')
  assert.equal(sets[1].id, 2, 'input order is not mutated')
  assert.equal(normalizeExercise(' BENCH   press '), 'bench press')
})

test('same-day workouts follow session recency, not set insertion order', () => {
  const rows = ['morning', 'evening'].map(session_id => ({ session_id, exercise: 'squat', date: '2026-09-01', reps: 5 }))
  const result = buildExerciseHistory(rows, [{ session_id: 'evening' }, { session_id: 'morning' }])
  assert.deepEqual(result.squat.map(row => row.session_id), ['evening', 'morning'])
})

test('top set picks weight then reps, preserves bodyweight and skips note-only rows', () => {
  const top = { weight_kg: 80, reps: 8 }
  assert.equal(getTopSet([{ weight_kg: 100, reps: null }, { weight_kg: 80, reps: 5 }, top]), top)
  assert.equal(getTopSet([{ weight_kg: null, reps: 8 }, { weight_kg: null, reps: 10 }]).reps, 10)
  assert.equal(getTopSet([{ reps: null }]), null)
  assert.equal(getTopSet([]), null)
})

test('free-text exercise and session names cannot collide with object properties', () => {
  const history = buildExerciseHistory([{ exercise: '__proto__', session_id: 'constructor', reps: 5 }])
  assert.equal(history.__proto__[0].sets.length, 1)
  assert.deepEqual(Object.keys(buildExerciseHistory(null)), [])
})
