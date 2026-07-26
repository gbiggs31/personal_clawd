import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../utils/supabase.js'
import {
  normalizeExercise, displayExercise, getTopSet,
  buildExerciseHistory, compareTopSets, formatWeightRep,
} from '../utils/training.js'
import { useUnits, unitLabel, toDisplayWeight } from '../utils/units.js'
import { getCached, setCached, CACHE_KEYS } from '../utils/page-cache.js'
import './Progress.css'

// ── Metric definitions ────────────────────────────────────────────────────────
//
// getValue always returns kilograms for `kind: 'weight'` metrics; conversion to
// the user's display unit happens once, when the chart data is built.

const METRICS = [
  {
    key: 'top_weight',
    label: 'Top weight',
    kind: 'weight',
    getValue(sets) {
      return getTopSet(sets)?.weight_kg ?? null
    },
  },
  {
    key: 's1_weight',
    label: 'Set 1 weight',
    kind: 'weight',
    getValue(sets) {
      const s = [...sets].sort((a, b) => (a.set_num ?? 99) - (b.set_num ?? 99))[0]
      return s?.weight_kg ?? null
    },
  },
  {
    key: 'top_reps',
    label: 'Top reps',
    kind: 'reps',
    getValue(sets) {
      const max = Math.max(...sets.map(s => s.reps ?? 0))
      return max > 0 ? max : null
    },
  },
  {
    key: 's1_reps',
    label: 'Set 1 reps',
    kind: 'reps',
    getValue(sets) {
      const s = [...sets].sort((a, b) => (a.set_num ?? 99) - (b.set_num ?? 99))[0]
      return s?.reps ?? null
    },
  },
  {
    key: 'volume',
    label: 'Volume',
    kind: 'weight',
    getValue(sets) {
      const v = sets.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0)
      return v > 0 ? Math.round(v) : null
    },
  },
  {
    key: 'est_1rm',
    label: 'Est. 1RM',
    kind: 'weight',
    getValue(sets) {
      const s = getTopSet(sets)
      if (!s?.weight_kg || !s?.reps) return null
      return Math.round(s.weight_kg * (1 + s.reps / 30) * 10) / 10
    },
  },
]

const RANGES = [
  { key: '30d', label: '30d', days: 30  },
  { key: '90d', label: '90d', days: 90  },
  { key: '6m',  label: '6m',  days: 180 },
  { key: 'all', label: 'All', days: null },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{fmtLong(label)}</div>
      <div className="chart-tooltip-value">
        {payload[0].value} <span className="chart-tooltip-unit">{unit}</span>
      </div>
    </div>
  )
}

// ── Exercise search ───────────────────────────────────────────────────────────

function ExerciseSearch({ exercises, selected, onSelect }) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const containerRef        = useRef(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return exercises.filter(e => e.includes(q)).slice(0, 40)
  }, [exercises, query])

  useEffect(() => {
    function onOutsideClick(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  function pick(ex) {
    onSelect(ex)
    setQuery('')
    setOpen(false)
  }

  function clear(e) {
    e.stopPropagation()
    onSelect('')
    setQuery('')
  }

  return (
    <div className="ex-picker" ref={containerRef}>
      <div className="ex-picker-box" onClick={() => { if (!open) setOpen(true) }}>
        {selected && !open
          ? <>
              <span className="ex-picker-selected">{displayExercise(selected)}</span>
              <button className="ex-picker-clear" onClick={clear} aria-label="Clear">×</button>
            </>
          : <input
              className="ex-picker-input"
              type="text"
              autoComplete="off"
              value={query}
              placeholder={selected ? displayExercise(selected) : 'Search exercise…'}
              onChange={e => { setQuery(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
            />
        }
      </div>

      {open && filtered.length > 0 && (
        <ul className="ex-dropdown">
          {filtered.map(ex => (
            <li key={ex}>
              <button
                className={`ex-option ${ex === selected ? 'active' : ''}`}
                onMouseDown={() => pick(ex)}
              >
                {displayExercise(ex)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Recent sessions (read-only) ───────────────────────────────────────────────

function DeltaBadge({ delta }) {
  if (!delta) return null
  return (
    <span className={`prog-delta ${delta.direction}`}>
      {delta.direction === 'up' && '↑ '}
      {delta.direction === 'down' && '↓ '}
      {delta.direction === 'flat' && '= '}
      {delta.text}
    </span>
  )
}

function SetLine({ set, units }) {
  return (
    <div className="rs-set">
      <span className="rs-set-main">{formatWeightRep(set, units) || '—'}</span>
      {set.rpe != null && <span className="rs-badge">RPE {set.rpe}</span>}
      {set.rir != null && <span className="rs-badge">RIR {set.rir}</span>}
      {set.injury_flag && <span className="rs-badge injury">⚠ {set.injury_body_part || 'injury'}</span>}
      {set.note && <span className="rs-note">{set.note}{set.note_type && set.note_type !== 'set' ? ` (${set.note_type})` : ''}</span>}
    </div>
  )
}

function RecentSessionCard({ sess, delta, expanded, onToggle, onOpen, units }) {
  const meta = sess.meta
  const header = [
    fmtLong(sess.date),
    meta?.session_type,
    meta?.duration_mins ? `${meta.duration_mins} min` : null,
  ].filter(Boolean).join(' · ')
  const coaching = [meta?.overall_note, meta?.summary].filter(Boolean).join('\n\n')

  return (
    <div className="rs-card">
      <div className="rs-card-head">
        <button className="rs-date-btn" onClick={onOpen} title="Open session">{header}</button>
        <DeltaBadge delta={delta} />
      </div>
      <div className="rs-sets">
        {sess.sets.map(s => <SetLine key={s.id ?? `${s.set_num}-${s.weight_kg}-${s.reps}`} set={s} units={units} />)}
      </div>
      {coaching && (
        <div className="rs-coaching">
          <button className="rs-coaching-toggle" onClick={onToggle}>
            {expanded ? '▾ coaching notes' : '▸ coaching notes'}
          </button>
          {expanded && <p className="rs-coaching-text">{coaching}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const RECENT_DEFAULT = 5

export default function Progress() {
  const navigate = useNavigate()
  const units = useUnits()
  // This list comes from scanning every set the user has logged, so it is the
  // most expensive thing on the page. Seed from cache; refresh in background.
  const exSeed = getCached(CACHE_KEYS.progressExercises)

  const [exercises, setExercises]   = useState(() => exSeed?.exercises ?? [])
  // normalized name → the raw `exercise` strings that normalise to it. Needed
  // because the stored values may differ in case or spacing from the
  // normalised key we show in the picker.
  const [rawNames, setRawNames]     = useState(() => exSeed?.rawNames ?? {})
  const [selectedEx, setSelectedEx] = useState('')
  const [exSets, setExSets]         = useState([])
  const [loadingInit, setLoadingInit] = useState(() => !exSeed)
  const [loadingEx, setLoadingEx]   = useState(false)
  const [metricKey, setMetricKey]   = useState('top_weight')
  const [rangeKey, setRangeKey]     = useState('90d')
  const [sessionMeta, setSessionMeta] = useState({})   // session_id → { date, session_type, summary, ... }
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [expandedRecent, setExpandedRecent] = useState(() => new Set())

  // Load distinct exercise names once, keeping the raw spellings alongside
  useEffect(() => {
    supabase.from('sets').select('exercise').then(({ data }) => {
      if (data) {
        const byNorm = {}
        for (const row of data) {
          const norm = normalizeExercise(row.exercise)
          if (!norm) continue
          if (!byNorm[norm]) byNorm[norm] = new Set()
          byNorm[norm].add(row.exercise)
        }
        const nextRawNames = Object.fromEntries(
          Object.entries(byNorm).map(([k, v]) => [k, [...v]])
        )
        const nextExercises = Object.keys(byNorm).sort()
        setRawNames(nextRawNames)
        setExercises(nextExercises)
        setCached(CACHE_KEYS.progressExercises, {
          exercises: nextExercises,
          rawNames: nextRawNames,
        })
      }
      setLoadingInit(false)
    })
  }, [])

  // Load sets when exercise changes.
  // Matching on the exact raw strings rather than `ilike(normalizedName)`:
  // ilike would miss a stored "bench  press" (double space) and would treat
  // any % or _ in an exercise name as a wildcard.
  useEffect(() => {
    setShowAllRecent(false)
    setExpandedRecent(new Set())
    if (!selectedEx) { setExSets([]); return }

    const variants = rawNames[selectedEx] || [selectedEx]
    setLoadingEx(true)
    supabase
      .from('sets')
      .select('*')
      .in('exercise', variants)
      .order('date')
      .then(({ data }) => {
        setExSets(data || [])
        setLoadingEx(false)
      })
  }, [selectedEx, rawNames])

  // Load session metadata (type, summary, notes) for the loaded sets' sessions
  useEffect(() => {
    const ids = [...new Set(exSets.map(s => s.session_id).filter(Boolean))]
    if (!ids.length) { setSessionMeta({}); return }
    supabase
      .from('sessions')
      .select('session_id, date, session_type, summary, overall_note, duration_mins')
      .in('session_id', ids)
      .then(({ data }) => {
        const map = {}
        for (const row of data || []) map[row.session_id] = row
        setSessionMeta(map)
      })
  }, [exSets])

  // Recent sessions for the selected exercise (newest first, range-independent)
  const recentSessions = useMemo(() => {
    if (!exSets.length) return []
    const hist = buildExerciseHistory(exSets)[normalizeExercise(selectedEx)] || []
    return hist.map(s => ({ ...s, meta: sessionMeta[s.session_id] || null }))
  }, [exSets, sessionMeta, selectedEx])

  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0]
  const range  = RANGES.find(r => r.key === rangeKey)   ?? RANGES[1]
  const metricUnit = metric.kind === 'weight' ? unitLabel(units) : 'reps'

  // Build chart data: group by session, apply range, compute metric
  const chartData = useMemo(() => {
    if (!exSets.length) return []

    const cutoff = range.days
      ? new Date(Date.now() - range.days * 86_400_000).toISOString().slice(0, 10)
      : null

    const sessions = {}
    for (const s of exSets) {
      if (cutoff && s.date < cutoff) continue
      if (!sessions[s.session_id]) sessions[s.session_id] = { date: s.date, sets: [] }
      sessions[s.session_id].sets.push(s)
    }

    return Object.values(sessions)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ date, sets }) => {
        const raw = metric.getValue(sets)
        if (raw == null) return null
        // Weight metrics come back in kg — convert once, here.
        const value = metric.kind === 'weight' ? toDisplayWeight(raw, units) : raw
        return { date, value, sets }
      })
      .filter(Boolean)
  }, [exSets, metric, range, units])

  // Summary strip
  const summary = useMemo(() => {
    if (chartData.length < 2) return null
    const vals  = chartData.map(d => d.value)
    const first = vals[0]
    const last  = vals[vals.length - 1]
    const best  = Math.max(...vals)
    const diff  = Math.round((last - first) * 10) / 10
    return { sessions: chartData.length, best, last, diff }
  }, [chartData])

  function toggleRecent(sessionId) {
    setExpandedRecent(prev => {
      const next = new Set(prev)
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId)
      return next
    })
  }

  if (loadingInit) return <div className="loading-full">Loading…</div>

  return (
    <div className="progress-page">
      <main className="progress-main">
        <h1 className="progress-title">Progress</h1>

        <ExerciseSearch
          exercises={exercises}
          selected={selectedEx}
          onSelect={ex => { setSelectedEx(ex); setMetricKey('top_weight') }}
        />

        {!selectedEx && (
          <div className="progress-empty">
            <div className="progress-empty-icon">↗</div>
            <p>Select an exercise to see how it's trending over time.</p>
          </div>
        )}

        {selectedEx && loadingEx && (
          <p className="progress-loading">Loading…</p>
        )}

        {selectedEx && !loadingEx && (
          <>
            {/* Metric + range selectors */}
            <div className="selectors">
              <div className="pill-row">
                {METRICS.map(m => (
                  <button
                    key={m.key}
                    className={`pill ${m.key === metricKey ? 'active' : ''}`}
                    onClick={() => setMetricKey(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="pill-row range-row">
                {RANGES.map(r => (
                  <button
                    key={r.key}
                    className={`pill ${r.key === rangeKey ? 'active' : ''}`}
                    onClick={() => setRangeKey(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length === 0 && (
              <div className="progress-empty">
                <p>No {metric.label.toLowerCase()} data in this period.</p>
              </div>
            )}

            {chartData.length > 0 && (
              <>
                {/* Summary stats */}
                {summary && (
                  <div className="prog-summary">
                    <div className="prog-stat">
                      <div className="prog-stat-value">{summary.sessions}</div>
                      <div className="prog-stat-label">Sessions</div>
                    </div>
                    <div className="prog-stat">
                      <div className="prog-stat-value">{summary.best}<span className="prog-stat-unit"> {metricUnit}</span></div>
                      <div className="prog-stat-label">Best</div>
                    </div>
                    <div className="prog-stat">
                      <div className="prog-stat-value">{summary.last}<span className="prog-stat-unit"> {metricUnit}</span></div>
                      <div className="prog-stat-label">Latest</div>
                    </div>
                    <div className={`prog-stat ${summary.diff > 0 ? 'up' : summary.diff < 0 ? 'down' : ''}`}>
                      <div className="prog-stat-value">
                        {summary.diff > 0 ? '+' : ''}{summary.diff}<span className="prog-stat-unit"> {metricUnit}</span>
                      </div>
                      <div className="prog-stat-label">Change</div>
                    </div>
                  </div>
                )}

                {/* Chart */}
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={fmtShort}
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fill: '#6b7280', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        content={props => <ChartTooltip {...props} unit={metricUnit} />}
                        cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#8df7c0"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#8df7c0', strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: '#8df7c0', strokeWidth: 0 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}

            {/* Recent sessions — actual sets + coaching notes (range-independent) */}
            {recentSessions.length > 0 && (
              <div className="recent-sessions">
                <div className="recent-head">Recent sessions</div>
                {(showAllRecent ? recentSessions : recentSessions.slice(0, RECENT_DEFAULT)).map((sess, i) => (
                  <RecentSessionCard
                    key={sess.session_id}
                    sess={sess}
                    delta={compareTopSets(sess.topSet, recentSessions[i + 1]?.topSet, units)}
                    expanded={expandedRecent.has(sess.session_id)}
                    onToggle={() => toggleRecent(sess.session_id)}
                    onOpen={() => navigate(`/session/${sess.session_id}`)}
                    units={units}
                  />
                ))}
                {recentSessions.length > RECENT_DEFAULT && (
                  <button className="recent-more" onClick={() => setShowAllRecent(v => !v)}>
                    {showAllRecent ? 'Show less' : `Show ${recentSessions.length - RECENT_DEFAULT} more`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
