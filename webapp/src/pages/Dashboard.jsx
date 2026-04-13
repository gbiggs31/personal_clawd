import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Dashboard.css'

const SESSION_TYPES = ['All', 'Push', 'Pull', 'Legs', 'Upper', 'Full Body', 'Other']
const KNOWN_TYPES = ['push', 'pull', 'legs', 'upper', 'full body']
const SORT_OPTIONS = ['Recent', 'PRs', 'Longest', 'Type']

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysBetween(a, b) {
  const ms = Math.abs(new Date(a) - new Date(b))
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function inferNextSessionType(recentSessions) {
  const orderedTypes = ['Push', 'Pull', 'Legs']
  const typed = recentSessions
    .map(s => s.session_type)
    .filter(Boolean)
    .map(s => s.toLowerCase())

  const last = typed[0]
  if (!last) return 'Push'

  const idx = orderedTypes.findIndex(t => t.toLowerCase() === last)
  if (idx === -1) return 'Push'
  return orderedTypes[(idx + 1) % orderedTypes.length]
}

function getReadinessNote(latestSession) {
  if (!latestSession) return 'Start with one main lift and progress conservatively.'
  if (latestSession.injury_flag) return 'Protect anything that feels sketchy today and keep compounds submaximal.'
  if (latestSession.cardio_flag && latestSession.abs_flag) return 'You recently did a lighter mixed day, so a main training session should be fine.'
  return 'Aim to beat one exercise from last time, not everything at once.'
}

function truncateText(text, maxLength = 140) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trim() + '…'
}

function getExerciseTopSet(sets) {
  if (!sets?.length) return null
  const valid = sets.filter(s => s.reps != null)
  if (!valid.length) return null

  return [...valid].sort((a, b) => {
    const aWeight = a.weight_kg ?? 0
    const bWeight = b.weight_kg ?? 0
    if (bWeight !== aWeight) return bWeight - aWeight
    return (b.reps ?? 0) - (a.reps ?? 0)
  })[0]
}

function compareTopSets(currentTop, previousTop) {
  if (!currentTop || !previousTop) return null

  const cw = currentTop.weight_kg ?? 0
  const pw = previousTop.weight_kg ?? 0
  const cr = currentTop.reps ?? 0
  const pr = previousTop.reps ?? 0

  if (cw > pw) return { direction: 'up', text: `+${cw - pw}kg` }
  if (cw < pw) return { direction: 'down', text: `${cw - pw}kg` }
  if (cr > pr) return { direction: 'up', text: `+${cr - pr} rep${cr - pr === 1 ? '' : 's'}` }
  if (cr < pr) return { direction: 'down', text: `${cr - pr} rep${pr - cr === 1 ? '' : 's'}` }
  return { direction: 'flat', text: 'same' }
}

function SessionCard({
  session,
  exercises,
  topHighlights,
  onClick,
  expandedSummaryIds,
  toggleSummary,
  onExerciseClick,
}) {
  const tags = []
  if (session.session_type) tags.push(session.session_type)
  if (session.cardio_flag) tags.push('Cardio')
  if (session.abs_flag) tags.push('Abs')

  const isExpanded = expandedSummaryIds.has(session.session_id)
  const summaryText = session.summary || ''
  const summaryPreview = isExpanded ? summaryText : truncateText(summaryText, 140)
  const summaryNeedsExpand = summaryText.length > 140

  return (
    <button className="session-card" onClick={onClick}>
      <div className="session-card-topline">
        <div>
          <div className="session-date">{formatDate(session.date)}</div>
          <div className="session-subline">
            {session.duration_mins ? `${session.duration_mins} min` : 'Session'}
          </div>
        </div>

        <div className="session-tags">
          {tags.map(t => (
            <span key={t} className={`tag ${t === 'Cardio' || t === 'Abs' ? 'tag-dim' : ''}`}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {session.overall_note && <p className="session-note">{session.overall_note}</p>}

      {topHighlights?.length > 0 && (
        <div className="session-highlights">
          {topHighlights.slice(0, 3).map(item => (
            <div key={item.exercise} className="highlight-row">
              <button
                className="highlight-exercise"
                onClick={e => {
                  e.stopPropagation()
                  onExerciseClick(item.exercise)
                }}
              >
                {item.exercise}
              </button>

              <span className="highlight-value">
                {item.weightText} {item.repText}
              </span>

              {item.delta && (
                <span className={`delta-badge ${item.delta.direction}`}>
                  {item.delta.direction === 'up' && '↑ '}
                  {item.delta.direction === 'down' && '↓ '}
                  {item.delta.direction === 'flat' && '= '}
                  {item.delta.text}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {exercises.length > 0 && (
        <p className="session-exercises">
          {exercises.slice(0, 6).map(ex => (
            <span
              key={ex}
              className="exercise-chip"
              onClick={e => {
                e.stopPropagation()
                onExerciseClick(ex)
              }}
            >
              {ex}
            </span>
          ))}
        </p>
      )}

      {session.summary && (
        <div className="session-summary-wrap">
          <p className="session-summary">{summaryPreview}</p>
          {summaryNeedsExpand && (
            <button
              className="summary-toggle"
              onClick={e => {
                e.stopPropagation()
                toggleSummary(session.session_id)
              }}
            >
              {isExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}
    </button>
  )
}

function TodayPlanCard({ recommendation, currentSession, onStartSession, onResumeSession }) {
  return (
    <section className="today-plan-card">
      <div className="today-plan-header">
        <div>
          <div className="eyebrow">Today</div>
          <h2 className="today-plan-title">
            {currentSession ? 'Current session in progress' : "Today's recommendation"}
          </h2>
        </div>

        {currentSession ? (
          <button className="primary-btn" onClick={onResumeSession}>
            Resume workout
          </button>
        ) : (
          <button className="primary-btn" onClick={onStartSession}>
            Start session
          </button>
        )}
      </div>

      {currentSession ? (
        <div className="today-plan-body">
          <div className="plan-row">
            <span className="plan-label">Type</span>
            <span className="plan-value">{currentSession.sessionType}</span>
          </div>
          <div className="plan-row">
            <span className="plan-label">Started</span>
            <span className="plan-value">{currentSession.startedAtText}</span>
          </div>
          <div className="plan-row">
            <span className="plan-label">Focus</span>
            <span className="plan-value">{currentSession.focus}</span>
          </div>
        </div>
      ) : (
        <div className="today-plan-body">
          <div className="plan-kicker">{recommendation.sessionType} day</div>
          <p className="plan-note">{recommendation.note}</p>

          <div className="plan-targets">
            {recommendation.targets.map(t => (
              <div key={t.exercise} className="plan-target">
                <div className="plan-target-name">{t.exercise}</div>
                <div className="plan-target-detail">{t.target}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function StatsStrip({ sessions }) {
  const last30Cutoff = new Date()
  last30Cutoff.setDate(last30Cutoff.getDate() - 30)

  const recent = sessions.filter(s => new Date(s.date) >= last30Cutoff)
  const totalDuration = recent.reduce((sum, s) => sum + (s.duration_mins || 0), 0)
  const cardioCount = recent.filter(s => s.cardio_flag).length
  const avgGap =
    recent.length >= 2
      ? Math.round(
          recent
            .slice(0, -1)
            .map((s, i) => daysBetween(s.date, recent[i + 1].date))
            .reduce((a, b) => a + b, 0) /
            (recent.length - 1)
        )
      : 0

  const stats = [
    { label: 'Last 30 days', value: `${recent.length} sessions` },
    { label: 'Training time', value: `${totalDuration} min` },
    { label: 'Cardio days', value: `${cardioCount}` },
    { label: 'Avg gap', value: avgGap ? `${avgGap}d` : '—' },
  ]

  return (
    <section className="stats-strip">
      {stats.map(stat => (
        <div key={stat.label} className="stat-card">
          <div className="stat-value">{stat.value}</div>
          <div className="stat-label">{stat.label}</div>
        </div>
      ))}
    </section>
  )
}

function ExerciseHistoryPanel({ exercise, history, onClose, onOpenSession }) {
  if (!exercise) return null

  return (
    <aside className="history-panel">
      <div className="history-panel-header">
        <div>
          <div className="eyebrow">Exercise history</div>
          <h3>{exercise}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {history.length === 0 ? (
        <p className="history-empty">No history found for this exercise.</p>
      ) : (
        <div className="history-list">
          {history.map(item => (
            <button
              key={`${item.session_id}-${item.date}`}
              className="history-item"
              onClick={() => onOpenSession(item.session_id)}
            >
              <div className="history-item-top">
                <span className="history-date">{formatDate(item.date)}</span>
                <span className="history-topset">
                  {item.weightText} {item.repText}
                </span>
              </div>

              <div className="history-subline">
                {item.setCount} set{item.setCount === 1 ? '' : 's'}
                {item.session_type ? ` • ${item.session_type}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()

  const [sessions, setSessions] = useState([])
  const [allSets, setAllSets] = useState([])
  const [exerciseMap, setExerciseMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [exSearch, setExSearch] = useState('')
  const [sortBy, setSortBy] = useState('Recent')
  const [expandedSummaryIds, setExpandedSummaryIds] = useState(new Set())
  const [selectedExercise, setSelectedExercise] = useState('')
  const [currentSession, setCurrentSession] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: sessionData, error: sErr } = await supabase
        .from('sessions')
        .select('*')
        .order('date', { ascending: false })
        .limit(500)

      if (sErr) {
        setError(sErr.message)
        setLoading(false)
        return
      }

      setSessions(sessionData || [])

      if (sessionData?.length) {
        const ids = sessionData.map(s => s.session_id)

        const { data: setData, error: setErr } = await supabase
          .from('sets')
          .select('*')
          .in('session_id', ids)
          .order('set_num')

        if (setErr) {
          setError(setErr.message)
          setLoading(false)
          return
        }

        const map = {}
        for (const row of setData || []) {
          const sid = row.session_id
          if (!map[sid]) map[sid] = []
          const ex = (row.exercise || '').trim()
          if (ex && !map[sid].includes(ex)) map[sid].push(ex)
        }

        setExerciseMap(map)
        setAllSets(setData || [])
      }

      const stored = localStorage.getItem('avenra_current_session')
      if (stored) {
        try {
          setCurrentSession(JSON.parse(stored))
        } catch {
          localStorage.removeItem('avenra_current_session')
        }
      }

      setLoading(false)
    }

    load()
  }, [])

  const setsBySession = useMemo(() => {
    const grouped = {}
    for (const row of allSets) {
      if (!grouped[row.session_id]) grouped[row.session_id] = []
      grouped[row.session_id].push(row)
    }
    return grouped
  }, [allSets])

  const sessionHighlights = useMemo(() => {
    const result = {}
    const exerciseHistory = {}

    for (const session of [...sessions].reverse()) {
      const sets = setsBySession[session.session_id] || []
      const byExercise = {}

      for (const set of sets) {
        const exercise = (set.exercise || '').trim()
        if (!exercise) continue
        if (!byExercise[exercise]) byExercise[exercise] = []
        byExercise[exercise].push(set)
      }

      const highlights = []

      for (const [exercise, exSets] of Object.entries(byExercise)) {
        const top = getExerciseTopSet(exSets)
        const prev = exerciseHistory[exercise]?.length
          ? exerciseHistory[exercise][exerciseHistory[exercise].length - 1]
          : null

        const delta = compareTopSets(top, prev?.topSet)

        highlights.push({
          exercise,
          topSet: top,
          weightText: top?.weight_kg != null ? `${top.weight_kg}kg` : 'BW',
          repText: top?.reps != null ? `× ${top.reps}` : '',
          delta,
        })

        if (!exerciseHistory[exercise]) exerciseHistory[exercise] = []
        exerciseHistory[exercise].push({
          session_id: session.session_id,
          date: session.date,
          session_type: session.session_type,
          topSet: top,
          setCount: exSets.length,
          weightText: top?.weight_kg != null ? `${top.weight_kg}kg` : 'BW',
          repText: top?.reps != null ? `× ${top.reps}` : '',
        })
      }

      result[session.session_id] = highlights.sort((a, b) => {
        const score = item => {
          if (!item.delta) return 0
          if (item.delta.direction === 'up') return 2
          if (item.delta.direction === 'flat') return 1
          return -1
        }
        return score(b) - score(a)
      })
    }

    return result
  }, [sessions, setsBySession])

  const exerciseHistoryLookup = useMemo(() => {
    const lookup = {}
    for (const session of sessions) {
      const sets = setsBySession[session.session_id] || []
      const grouped = {}

      for (const set of sets) {
        const ex = (set.exercise || '').trim()
        if (!ex) continue
        if (!grouped[ex]) grouped[ex] = []
        grouped[ex].push(set)
      }

      for (const [exercise, exSets] of Object.entries(grouped)) {
        const top = getExerciseTopSet(exSets)
        if (!lookup[exercise]) lookup[exercise] = []
        lookup[exercise].push({
          session_id: session.session_id,
          date: session.date,
          session_type: session.session_type,
          setCount: exSets.length,
          topSet: top,
          weightText: top?.weight_kg != null ? `${top.weight_kg}kg` : 'BW',
          repText: top?.reps != null ? `× ${top.reps}` : '',
        })
      }
    }
    return lookup
  }, [sessions, setsBySession])

  const recommendation = useMemo(() => {
    const recent = sessions.slice(0, 8)
    const sessionType = inferNextSessionType(recent)
    const latestSession = sessions[0]

    const preferredExercises =
      sessionType === 'Push'
        ? ['Bench Press', 'Incline Press', 'Overhead Press']
        : sessionType === 'Pull'
        ? ['Lat Pulldown', 'Low Row', 'Cable Curl']
        : ['Leg Press', 'Leg Extension', 'Romanian Deadlift']

    const likelyTargets = []
    for (const exercise of preferredExercises) {
      const history = exerciseHistoryLookup[exercise] || []
      const latest = history[0]
      if (!latest?.topSet) continue

      const nextReps = (latest.topSet.reps ?? 0) + 1
      likelyTargets.push({
        exercise,
        target:
          latest.topSet.weight_kg != null
            ? `${latest.topSet.weight_kg}kg × ${nextReps}`
            : `BW × ${nextReps}`,
      })
    }

    if (!likelyTargets.length) {
      likelyTargets.push(
        { exercise: 'Main lift', target: 'Beat last week by 1 rep' },
        { exercise: 'Secondary lift', target: 'Match or beat last session' },
        { exercise: 'Accessory', target: 'Hard sets with clean form' }
      )
    }

    return {
      sessionType,
      note: getReadinessNote(latestSession),
      targets: likelyTargets.slice(0, 3),
    }
  }, [sessions, exerciseHistoryLookup])

  const filtered = useMemo(() => {
    const query = exSearch.trim().toLowerCase()

    let next = sessions.filter(s => {
      if (typeFilter !== 'All') {
        const type = (s.session_type || '').toLowerCase()
        if (typeFilter === 'Other') {
          if (KNOWN_TYPES.includes(type)) return false
        } else if (type !== typeFilter.toLowerCase()) {
          return false
        }
      }

      if (query) {
        const exes = exerciseMap[s.session_id] || []
        if (!exes.some(e => e.toLowerCase().includes(query))) return false
      }

      return true
    })

    next = [...next].sort((a, b) => {
      if (sortBy === 'Recent') return new Date(b.date) - new Date(a.date)
      if (sortBy === 'Longest') return (b.duration_mins || 0) - (a.duration_mins || 0)
      if (sortBy === 'Type') return (a.session_type || '').localeCompare(b.session_type || '')
      if (sortBy === 'PRs') {
        const aCount = (sessionHighlights[a.session_id] || []).filter(h => h.delta?.direction === 'up').length
        const bCount = (sessionHighlights[b.session_id] || []).filter(h => h.delta?.direction === 'up').length
        if (bCount !== aCount) return bCount - aCount
        return new Date(b.date) - new Date(a.date)
      }
      return 0
    })

    return next
  }, [sessions, exerciseMap, typeFilter, exSearch, sortBy, sessionHighlights])

  const isFiltered = typeFilter !== 'All' || exSearch.trim() || sortBy !== 'Recent'

  function toggleSummary(sessionId) {
    setExpandedSummaryIds(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  function startSession() {
    const payload = {
      sessionType: recommendation.sessionType,
      focus: recommendation.targets[0]?.exercise || 'Main lift',
      startedAt: new Date().toISOString(),
      startedAtText: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }
    localStorage.setItem('avenra_current_session', JSON.stringify(payload))
    setCurrentSession(payload)
  }

  function resumeSession() {
    if (!currentSession) return
    navigate(`/?mode=current&type=${currentSession.sessionType}`)
  }

  if (loading) return <div className="loading-full">Loading sessions…</div>

  return (
    <div className="dashboard">
      <main className="dash-main">
        <div className="dash-header-row">
          <h1 className="dash-title">Training</h1>
          <p className="dash-count">
            {isFiltered
              ? `${filtered.length} of ${sessions.length} sessions`
              : `${sessions.length} sessions`}
          </p>
        </div>

        <TodayPlanCard
          recommendation={recommendation}
          currentSession={currentSession}
          onStartSession={startSession}
          onResumeSession={resumeSession}
        />

        {sessions.length > 0 && <StatsStrip sessions={sessions} />}

        <div className="filters">
          <div className="filter-row">
            <div className="type-pills" role="group" aria-label="Filter by session type">
              {SESSION_TYPES.map(t => (
                <button
                  key={t}
                  className={`type-pill ${typeFilter === t ? 'active' : ''}`}
                  onClick={() => setTypeFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-search-row">
            <div className="ex-search-wrap">
              <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                className="ex-search"
                type="text"
                placeholder="Filter by exercise…"
                value={exSearch}
                onChange={e => setExSearch(e.target.value)}
              />
              {exSearch && (
                <button className="ex-search-clear" onClick={() => setExSearch('')} aria-label="Clear">×</button>
              )}
            </div>

            <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="dash-error">{error}</div>}
        {sessions.length === 0 && !error && (
          <p className="dash-empty">No sessions yet. Log a workout via the bot to see it here.</p>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <p className="dash-empty">No sessions match these filters.</p>
        )}

        <div className="content-layout">
          <div className="session-list">
            {filtered.map(s => (
              <SessionCard
                key={s.session_id}
                session={s}
                exercises={exerciseMap[s.session_id] || []}
                topHighlights={sessionHighlights[s.session_id] || []}
                onClick={() => navigate(`/session/${s.session_id}`)}
                expandedSummaryIds={expandedSummaryIds}
                toggleSummary={toggleSummary}
                onExerciseClick={setSelectedExercise}
              />
            ))}
          </div>

          <ExerciseHistoryPanel
            exercise={selectedExercise}
            history={selectedExercise ? exerciseHistoryLookup[selectedExercise] || [] : []}
            onClose={() => setSelectedExercise('')}
            onOpenSession={sid => navigate(`/session/${sid}`)}
          />
        </div>
      </main>

      {currentSession && (
        <div className="current-session-bar">
          <div className="current-session-copy">
            <strong>{currentSession.sessionType}</strong> in progress
            <span>Focus: {currentSession.focus}</span>
          </div>
          <div className="current-session-actions">
            <button className="ghost-btn" onClick={() => {
              localStorage.removeItem('avenra_current_session')
              setCurrentSession(null)
            }}>End</button>
            <button className="primary-btn" onClick={resumeSession}>Resume</button>
          </div>
        </div>
      )}
    </div>
  )
}
