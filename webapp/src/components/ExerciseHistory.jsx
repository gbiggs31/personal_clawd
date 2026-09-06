import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import { buildExerciseHistory, displayExercise, normalizeExercise } from '../utils/exercise-history.js'
import { formatWeightReps } from '../utils/units.js'
import { fetchHistoryPage, WORKOUT_TYPES } from '../utils/history-data.js'
import { getCached, setCached } from '../utils/page-cache.js'
import './ExerciseHistory.css'

const dateLabel = date => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
})

function ExerciseCard({ name, history, sessions, units }) {
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(3)
  const latest = history[0]
  return (
    <article className="exercise-history-card">
      <button className="exercise-history-heading" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>
          <span className="exercise-history-name">{displayExercise(name)}</span>
          <span className="exercise-history-meta">Last trained {dateLabel(latest.date)} · {history.length} workout{history.length === 1 ? '' : 's'} loaded</span>
        </span>
        <span className="exercise-history-last">
          <span className="exercise-history-meta">Latest top set</span>
          <strong>{latest.topSet ? formatWeightReps(latest.topSet, units) : 'No reps recorded'}</strong>
          <span className="exercise-history-meta">{open ? 'Hide sets −' : 'View sets +'}</span>
        </span>
      </button>
      {open && (
        <div className="exercise-history-workouts">
          {history.slice(0, visibleCount).map(workout => (
            <section key={workout.session_id} className="exercise-history-workout">
              <div className="exercise-history-date">
                <Link to={`/session/${workout.session_id}`}>{dateLabel(workout.date)}</Link>
                <span className="tag">{sessions.get(workout.session_id)?.session_type || 'Other'}</span>
              </div>
              <ol className="exercise-history-sets">
                {workout.sets.map((set, index) => (
                  <li key={set.id}>
                    <span className="exercise-history-meta">Set {set.set_num ?? index + 1}</span>
                    <strong>{formatWeightReps(set, units)}</strong>
                    <span className="exercise-history-effort">
                      {[set.rpe != null ? `RPE ${set.rpe}` : '', set.rir != null ? `RIR ${set.rir}` : ''].filter(Boolean).join(' · ')}
                    </span>
                    {set.note && <p className="exercise-history-note">{set.note}</p>}
                    {set.injury_flag && <p className="exercise-history-injury">Injury noted{set.injury_body_part ? `: ${set.injury_body_part}` : ''}</p>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {history.length > visibleCount && <button className="load-more-btn" onClick={() => setVisibleCount(count => count + 5)}>Show earlier {displayExercise(name)} workouts</button>}
        </div>
      )}
    </article>
  )
}

// Keyed by type so a slow previous request cannot overwrite the next filter.
function WorkoutExercises({ type, query, units }) {
  const cacheKey = `dashboard:exercises:${type}`
  const [data, setData] = useState(() => getCached(cacheKey) || { sessions: [], sets: [], hasMore: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const controller = useRef(null)
  const busy = useRef(false)
  const offset = useRef(0)

  async function load(append = false) {
    if (busy.current) return
    busy.current = true
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError('')
    try {
      const page = await fetchHistoryPage(supabase, { type, offset: append ? offset.current : 0, signal: request.signal })
      if (request.signal.aborted) return
      offset.current = (append ? offset.current : 0) + page.sessions.length
      setData(previous => append ? {
        sessions: [...previous.sessions, ...page.sessions],
        sets: [...previous.sets, ...page.sets],
        hasMore: page.hasMore,
      } : page)
      if (!append) setCached(cacheKey, page)
    } catch (err) {
      if (!request.signal.aborted) setError(err.message || 'Could not load exercise history. Please try again.')
    } finally {
      if (controller.current === request) {
        busy.current = false
        if (!request.signal.aborted) setLoading(false)
      }
    }
  }

  useEffect(() => {
    load()
    return () => { controller.current?.abort(); busy.current = false }
  }, [])

  const history = useMemo(() => buildExerciseHistory(data.sets, data.sessions), [data.sets, data.sessions])
  const sessions = useMemo(() => new Map(data.sessions.map(session => [session.session_id, session])), [data.sessions])
  const exercises = Object.keys(history).filter(name => name.includes(normalizeExercise(query))).sort()

  return (
    <div aria-busy={loading}>
      <p className="exercise-history-help">Choose a workout type, then open an exercise to compare weights, reps and effort. History shows completed workouts, newest first.</p>
      <p className="exercise-history-meta" role="status">
        {loading ? 'Loading workout history…' : `${exercises.length} exercises from ${data.sessions.length} ${type === 'All' ? '' : `${type.toLowerCase()} `}workouts loaded${data.hasMore ? ' · Older workouts available below' : ''}`}
      </p>
      {error && <div className="dash-error" role="alert">{error} <button className="type-pill" disabled={loading} onClick={() => load(offset.current > 0)}>Retry</button></div>}
      {!loading && !error && exercises.length === 0 && <p className="dash-empty">{query ? 'No exercises match your search in the loaded workouts.' : 'No exercises found for this workout type.'}{data.hasMore ? ' Load older workouts to keep looking.' : ''}</p>}
      <div className="exercise-history-list">
        {exercises.map(name => <ExerciseCard key={name} name={name} history={history[name]} sessions={sessions} units={units} />)}
      </div>
      {data.hasMore && <button className="load-more-btn" disabled={loading} onClick={() => load(true)}>{loading ? 'Loading…' : `Load older ${type === 'All' ? '' : `${type.toLowerCase()} `}workouts`}</button>}
    </div>
  )
}

export default function ExerciseHistory({ units, type, onTypeChange, query, onQueryChange }) {
  return (
    <section aria-label="History grouped by exercise">
      <div className="filters">
        <div className="filter-row">
          <div className="type-pills" role="group" aria-label="Workout type">
            {WORKOUT_TYPES.map(value => <button key={value} className={`type-pill ${type === value ? 'active' : ''}`} aria-pressed={type === value} onClick={() => onTypeChange(value)}>{value}</button>)}
          </div>
        </div>
        <input className="ex-search" type="search" aria-label="Find an exercise" placeholder="Find an exercise, e.g. bench press" value={query} onChange={event => onQueryChange(event.target.value)} />
      </div>
      <WorkoutExercises key={type} type={type} query={query} units={units} />
    </section>
  )
}
