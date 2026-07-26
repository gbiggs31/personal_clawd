import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import {
  normalizeExercise,
  displayExercise,
  getTopSet,
  compareTopSets,
  formatWeightRep,
  daysBetween,
} from '../utils/training.js'
import { useUnits, formatWeight } from '../utils/units.js'
import { getCached, setCached, CACHE_KEYS } from '../utils/page-cache.js'
import './Dashboard.css'

// Sessions are paged in rather than loaded whole: the old query pulled up to
// 500 sessions and then every set belonging to them, which grew linearly with
// account age and hit PostgREST's 1000-row cap on the sets side.
const PAGE_SIZE = 30

const GYM_TYPES   = ['All', 'Push', 'Pull', 'Legs', 'Upper', 'Full Body', 'Other']
const KNOWN_TYPES = ['push', 'pull', 'legs', 'upper', 'full body']
const SORT_OPTIONS = ['Recent', 'PRs', 'Longest', 'Type']

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatIsoDate(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function truncateText(text, max = 140) {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max).trim() + '…'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DeltaBadge({ delta }) {
  if (!delta) return null
  return (
    <span className={`delta-badge ${delta.direction}`}>
      {delta.direction === 'up'   && '↑ '}
      {delta.direction === 'down' && '↓ '}
      {delta.direction === 'flat' && '= '}
      {delta.text}
    </span>
  )
}

function StravaLogo() {
  return (
    <svg className="strava-logo-sm" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 26l5-10 5 10" fill="none" stroke="#FC4C02" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M22 26l3-6 3 6" fill="none" stroke="#FC4C02" strokeWidth="3" strokeLinejoin="round" opacity="0.6"/>
    </svg>
  )
}

function StravaSessionCard({ activity }) {
  const durationMin = Math.round((activity.duration_seconds || 0) / 60)
  const distanceKm  = activity.distance_meters > 100
    ? `${(activity.distance_meters / 1000).toFixed(1)} km`
    : null
  const elevationM  = activity.elevation_gain_meters > 5
    ? `↑ ${Math.round(activity.elevation_gain_meters)} m`
    : null
  const heartRate   = activity.average_heartrate
    ? `${Math.round(activity.average_heartrate)} bpm`
    : null

  const subline = [durationMin ? `${durationMin} min` : null, distanceKm].filter(Boolean).join(' · ')
  const stats   = [heartRate, elevationM].filter(Boolean)

  return (
    <div className="session-card strava-card">
      <div className="session-card-topline">
        <div>
          <div className="session-date">{formatIsoDate(activity.start_date)}</div>
          <div className="session-subline">{subline}</div>
        </div>
        <div className="session-tags">
          <StravaLogo />
          <span className="tag tag-strava">{activity.sport_type}</span>
        </div>
      </div>
      {activity.name && <p className="session-note">{activity.name}</p>}
      {stats.length > 0 && (
        <div className="strava-stats-row">
          {stats.map(s => <span key={s} className="strava-stat">{s}</span>)}
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, exercises, topHighlights, expandedSummaryIds, toggleSummary, onExerciseClick }) {
  const navigate = useNavigate()
  const tags = []
  if (session.session_type) tags.push(session.session_type)
  if (session.cardio_flag)  tags.push('Cardio')
  if (session.abs_flag)     tags.push('Abs')

  const isExpanded       = expandedSummaryIds.has(session.session_id)
  const summaryText      = session.summary || ''
  const summaryPreview   = isExpanded ? summaryText : truncateText(summaryText)
  const summaryNeedsMore = summaryText.length > 140

  return (
    <button className="session-card" onClick={() => navigate(`/session/${session.session_id}`)}>
      <div className="session-card-topline">
        <div>
          <div className="session-date">{formatDate(session.date)}</div>
          <div className="session-subline">{session.duration_mins ? `${session.duration_mins} min` : 'Session'}</div>
        </div>
        <div className="session-tags">
          {tags.map(t => (
            <span key={t} className={`tag ${t === 'Cardio' || t === 'Abs' ? 'tag-dim' : ''}`}>{t}</span>
          ))}
        </div>
      </div>

      {session.overall_note && <p className="session-note">{session.overall_note}</p>}

      {topHighlights?.length > 0 && (
        <div className="session-highlights">
          {topHighlights.slice(0, 3).map(item => (
            <div key={item.normEx} className="highlight-row">
              <button
                className="highlight-exercise"
                onClick={e => { e.stopPropagation(); onExerciseClick(item.normEx) }}
              >
                {item.displayEx}
              </button>
              <span className="highlight-value">{item.weightText} {item.repText}</span>
              <DeltaBadge delta={item.delta} />
            </div>
          ))}
        </div>
      )}

      {exercises.length > 0 && (
        <div className="session-exercises">
          {exercises.slice(0, 6).map(normEx => (
            <span
              key={normEx}
              className="exercise-chip"
              onClick={e => { e.stopPropagation(); onExerciseClick(normEx) }}
            >
              {displayExercise(normEx)}
            </span>
          ))}
        </div>
      )}

      {summaryText && (
        <div className="session-summary-wrap">
          <p className="session-summary">{summaryPreview}</p>
          {summaryNeedsMore && (
            <button
              className="summary-toggle"
              onClick={e => { e.stopPropagation(); toggleSummary(session.session_id) }}
            >
              {isExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}
    </button>
  )
}

function StatsStrip({ sessions }) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const recent = sessions.filter(s => new Date(s.date) >= cutoff)

  const totalMins  = recent.reduce((n, s) => n + (s.duration_mins || 0), 0)
  const cardioN    = recent.filter(s => s.cardio_flag).length
  const avgGap     = recent.length >= 2
    ? Math.round(recent.slice(0, -1).map((s, i) => daysBetween(s.date, recent[i + 1].date)).reduce((a, b) => a + b, 0) / (recent.length - 1))
    : null

  const stats = [
    { label: 'Last 30 days', value: `${recent.length} sessions` },
    { label: 'Training time', value: totalMins ? `${totalMins} min` : '—' },
    { label: 'Cardio days',   value: `${cardioN}` },
    { label: 'Avg rest gap',  value: avgGap != null ? `${avgGap}d` : '—' },
  ]

  return (
    <section className="stats-strip">
      {stats.map(s => (
        <div key={s.label} className="stat-card">
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
        </div>
      ))}
    </section>
  )
}

function ExerciseHistoryPanel({ normEx, history, onClose, onOpenSession }) {
  if (!normEx) return null

  return (
    <>
      <div className="history-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="history-panel">
        <div className="history-panel-header">
          <div>
            <div className="eyebrow">Exercise history</div>
            <h3>{displayExercise(normEx)}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {history.length === 0 ? (
          <p className="history-empty">No history found.</p>
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
                  <span className="history-topset">{item.weightText} {item.repText}</span>
                </div>
                <div className="history-subline">
                  {item.setCount} set{item.setCount === 1 ? '' : 's'}
                  {item.session_type ? ` · ${item.session_type}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()

  const units = useUnits()

  // Seed from cache so returning to this tab paints immediately; the effect
  // below still refetches in the background to pick up anything new.
  const seed       = getCached(CACHE_KEYS.dashboardPage0)
  const stravaSeed = getCached(CACHE_KEYS.dashboardStrava)

  const [sessions, setSessions]               = useState(() => seed?.sessions ?? [])
  const [allSets, setAllSets]                 = useState(() => seed?.sets ?? [])
  const [stravaActivities, setStravaActivities] = useState(() => stravaSeed?.activities ?? [])
  const [stravaConnected, setStravaConnected] = useState(() => stravaSeed?.connected ?? false)
  const [loading, setLoading]                 = useState(() => !seed)
  const [loadingMore, setLoadingMore]         = useState(false)
  const [hasMore, setHasMore]                 = useState(() => seed?.hasMore ?? false)
  const [error, setError]                     = useState('')
  const [typeFilter, setTypeFilter]           = useState('All')
  const [exSearch, setExSearch]               = useState('')
  const [sortBy, setSortBy]                   = useState('Recent')
  const [expandedIds, setExpandedIds]         = useState(new Set())
  const [selectedExercise, setSelected]       = useState('')  // normalized key

  // Fetch one page of sessions plus the sets belonging to just those sessions.
  async function loadPage(pageIndex, { append }) {
    const from = pageIndex * PAGE_SIZE
    const { data: sessionData, error: sErr } = await supabase
      .from('sessions')
      .select('*')
      .order('date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (sErr) { setError(sErr.message); return }

    const page = sessionData || []
    setHasMore(page.length === PAGE_SIZE)

    let pageSets = []
    if (page.length) {
      const ids = page.map(s => s.session_id)
      const { data: setData, error: setErr } = await supabase
        .from('sets').select('*').in('session_id', ids).order('set_num')
      if (setErr) { setError(setErr.message); return }
      pageSets = setData || []
    }

    setSessions(prev => (append ? [...prev, ...page] : page))
    setAllSets(prev => (append ? [...prev, ...pageSets] : pageSets))

    // Only the first page is cached — later pages are cheap to re-fetch and
    // caching them would make the entry unbounded.
    if (!append) {
      setCached(CACHE_KEYS.dashboardPage0, {
        sessions: page,
        sets: pageSets,
        hasMore: page.length === PAGE_SIZE,
      })
    }
  }

  useEffect(() => {
    async function load() {
      await loadPage(0, { append: false })

      // Fetch Strava activities (non-blocking)
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession()
        if (authSession?.access_token) {
          const res = await fetch('/api/strava?action=activities', {
            headers: { Authorization: `Bearer ${authSession.access_token}` },
          })
          if (res.ok) {
            const data = await res.json()
            setStravaConnected(data.connected || false)
            setStravaActivities(data.activities || [])
            setCached(CACHE_KEYS.dashboardStrava, {
              connected: data.connected || false,
              activities: data.activities || [],
            })
          }
        }
      } catch { /* non-fatal */ }

      setLoading(false)
    }
    load()
  }, [])

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    await loadPage(Math.ceil(sessions.length / PAGE_SIZE), { append: true })
    setLoadingMore(false)
  }

  // sessionId → [normEx, ...], derived rather than stored so it can't drift
  // out of sync with allSets as pages are appended.
  const exerciseMap = useMemo(() => {
    const map = {}
    for (const row of allSets) {
      const norm = normalizeExercise(row.exercise)
      if (!norm) continue
      const sid = row.session_id
      if (!map[sid]) map[sid] = []
      if (!map[sid].includes(norm)) map[sid].push(norm)
    }
    return map
  }, [allSets])

  // Group sets by session
  const setsBySession = useMemo(() => {
    const g = {}
    for (const row of allSets) {
      if (!g[row.session_id]) g[row.session_id] = []
      g[row.session_id].push(row)
    }
    return g
  }, [allSets])

  // Per-session highlights with delta vs previous session for same exercise
  const sessionHighlights = useMemo(() => {
    const result = {}
    const exerciseHistory = {}  // normEx → [{topSet, ...}]

    for (const session of [...sessions].reverse()) {
      const byExercise = {}
      for (const set of setsBySession[session.session_id] || []) {
        const norm = normalizeExercise(set.exercise)
        if (!norm) continue
        if (!byExercise[norm]) byExercise[norm] = []
        byExercise[norm].push(set)
      }

      const highlights = []
      for (const [normEx, exSets] of Object.entries(byExercise)) {
        const top  = getTopSet(exSets)
        const prev = exerciseHistory[normEx]?.at(-1)
        const delta = compareTopSets(top, prev?.topSet, units)

        highlights.push({
          normEx,
          displayEx: displayExercise(normEx),
          topSet: top,
          weightText: formatWeight(top?.weight_kg, units),
          repText: top?.reps != null ? `× ${top.reps}` : '',
          delta,
        })

        if (!exerciseHistory[normEx]) exerciseHistory[normEx] = []
        exerciseHistory[normEx].push({
          session_id: session.session_id,
          date: session.date,
          session_type: session.session_type,
          topSet: top,
          setCount: exSets.length,
          weightText: formatWeight(top?.weight_kg, units),
          repText: top?.reps != null ? `× ${top.reps}` : '',
        })
      }

      // Sort: improvements first, then flat, then regressions
      result[session.session_id] = highlights.sort((a, b) => {
        const score = h => h.delta?.direction === 'up' ? 2 : h.delta?.direction === 'flat' ? 1 : 0
        return score(b) - score(a)
      })
    }
    return result
  }, [sessions, setsBySession, units])

  // Exercise history lookup (for the side panel)
  const exerciseHistoryLookup = useMemo(() => {
    const lookup = {}
    for (const session of sessions) {
      const byExercise = {}
      for (const set of setsBySession[session.session_id] || []) {
        const norm = normalizeExercise(set.exercise)
        if (!norm) continue
        if (!byExercise[norm]) byExercise[norm] = []
        byExercise[norm].push(set)
      }
      for (const [normEx, exSets] of Object.entries(byExercise)) {
        const top = getTopSet(exSets)
        if (!lookup[normEx]) lookup[normEx] = []
        lookup[normEx].push({
          session_id: session.session_id,
          date: session.date,
          session_type: session.session_type,
          setCount: exSets.length,
          topSet: top,
          weightText: formatWeight(top?.weight_kg, units),
          repText: top?.reps != null ? `× ${top.reps}` : '',
        })
      }
    }
    return lookup
  }, [sessions, setsBySession, units])

  // Filtered + sorted combined list (gym sessions + Strava activities)
  const filtered = useMemo(() => {
    const query      = exSearch.trim().toLowerCase()
    const showStrava = !query && (typeFilter === 'All' || typeFilter === 'Strava')
    const showGym    = typeFilter !== 'Strava'

    const gymItems = showGym ? sessions.filter(s => {
      if (typeFilter !== 'All' && typeFilter !== 'Strava') {
        const type = (s.session_type || '').toLowerCase()
        if (typeFilter === 'Other') {
          if (KNOWN_TYPES.includes(type)) return false
        } else if (type !== typeFilter.toLowerCase()) {
          return false
        }
      }
      if (query) {
        const exes = exerciseMap[s.session_id] || []
        if (!exes.some(e => e.includes(query))) return false
      }
      return true
    }).map(s => ({ ...s, _type: 'gym' })) : []

    const stravaItems = showStrava
      ? stravaActivities.map(a => ({ ...a, _type: 'strava' }))
      : []

    return [...gymItems, ...stravaItems].sort((a, b) => {
      const dateA = a._type === 'gym' ? new Date(a.date) : new Date(a.start_date)
      const dateB = b._type === 'gym' ? new Date(b.date) : new Date(b.start_date)

      if (sortBy === 'Recent')  return dateB - dateA
      if (sortBy === 'Longest') {
        const durA = a._type === 'gym' ? (a.duration_mins || 0) : Math.round((a.duration_seconds || 0) / 60)
        const durB = b._type === 'gym' ? (b.duration_mins || 0) : Math.round((b.duration_seconds || 0) / 60)
        return durB !== durA ? durB - durA : dateB - dateA
      }
      if (sortBy === 'Type') {
        const tA = a._type === 'gym' ? (a.session_type || '') : 'Strava'
        const tB = b._type === 'gym' ? (b.session_type || '') : 'Strava'
        return tA.localeCompare(tB)
      }
      if (sortBy === 'PRs') {
        if (a._type !== b._type) return a._type === 'strava' ? 1 : -1
        if (a._type === 'gym') {
          const aUp = (sessionHighlights[a.session_id] || []).filter(h => h.delta?.direction === 'up').length
          const bUp = (sessionHighlights[b.session_id] || []).filter(h => h.delta?.direction === 'up').length
          return bUp !== aUp ? bUp - aUp : dateB - dateA
        }
        return dateB - dateA
      }
      return 0
    })
  }, [sessions, stravaActivities, exerciseMap, typeFilter, exSearch, sortBy, sessionHighlights])

  const isFiltered   = typeFilter !== 'All' || exSearch.trim() || sortBy !== 'Recent'
  const totalEntries = sessions.length + stravaActivities.length
  const SESSION_TYPES = stravaConnected ? [...GYM_TYPES, 'Strava'] : GYM_TYPES

  function toggleSummary(sessionId) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId)
      return next
    })
  }

  if (loading) return <div className="loading-full">Loading sessions…</div>

  return (
    <div className="dashboard">
      <main className="dash-main">
        <div className="dash-header-row">
          <div>
            <h1 className="dash-title">Training log</h1>
            <p className="dash-count">
              {isFiltered
                ? `${filtered.length} of ${totalEntries} loaded`
                : sessions.length > 0 && stravaActivities.length > 0
                  ? `${sessions.length}${hasMore ? '+' : ''} sessions · ${stravaActivities.length} activities`
                  : `${sessions.length}${hasMore ? '+' : ''} sessions`}
            </p>
          </div>
          <Link to="/log" state={{ mode: 'chat' }} className="log-chat-btn">Ask Avenra</Link>
        </div>

        {sessions.length > 0 && <StatsStrip sessions={sessions} />}

        {/* Filters */}
        <div className="filters">
          <div className="filter-row">
            <div className="type-pills" role="group" aria-label="Filter by session type">
              {SESSION_TYPES.map(t => (
                <button
                  key={t}
                  className={`type-pill ${typeFilter === t ? 'active' : ''} ${t === 'Strava' ? 'strava-pill' : ''}`}
                  onClick={() => setTypeFilter(t)}
                >
                  {t === 'Strava' ? <><StravaLogo />{' Strava'}</> : t}
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
        {totalEntries > 0 && filtered.length === 0 && (
          <p className="dash-empty">No entries match these filters.</p>
        )}

        <div className="content-layout">
          <div className="session-list">
            {filtered.map(item =>
              item._type === 'strava' ? (
                <StravaSessionCard
                  key={`strava-${item.strava_activity_id}`}
                  activity={item}
                />
              ) : (
                <SessionCard
                  key={item.session_id}
                  session={item}
                  exercises={exerciseMap[item.session_id] || []}
                  topHighlights={sessionHighlights[item.session_id] || []}
                  expandedSummaryIds={expandedIds}
                  toggleSummary={toggleSummary}
                  onExerciseClick={setSelected}
                />
              )
            )}

            {hasMore && !exSearch.trim() && (
              <button className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more sessions`}
              </button>
            )}
          </div>

          <ExerciseHistoryPanel
            normEx={selectedExercise}
            history={selectedExercise ? exerciseHistoryLookup[selectedExercise] || [] : []}
            onClose={() => setSelected('')}
            onOpenSession={sid => navigate(`/session/${sid}`)}
          />
        </div>
      </main>
    </div>
  )
}
