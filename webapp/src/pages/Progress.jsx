import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../utils/supabase.js'
import { normalizeExercise, displayExercise, getTopSet } from '../utils/training.js'
import './Progress.css'

// ── Metric definitions ────────────────────────────────────────────────────────

const METRICS = [
  {
    key: 'top_weight',
    label: 'Top weight',
    unit: 'kg',
    getValue(sets) {
      return getTopSet(sets)?.weight_kg ?? null
    },
  },
  {
    key: 's1_weight',
    label: 'Set 1 weight',
    unit: 'kg',
    getValue(sets) {
      const s = [...sets].sort((a, b) => (a.set_num ?? 99) - (b.set_num ?? 99))[0]
      return s?.weight_kg ?? null
    },
  },
  {
    key: 'top_reps',
    label: 'Top reps',
    unit: 'reps',
    getValue(sets) {
      const max = Math.max(...sets.map(s => s.reps ?? 0))
      return max > 0 ? max : null
    },
  },
  {
    key: 's1_reps',
    label: 'Set 1 reps',
    unit: 'reps',
    getValue(sets) {
      const s = [...sets].sort((a, b) => (a.set_num ?? 99) - (b.set_num ?? 99))[0]
      return s?.reps ?? null
    },
  },
  {
    key: 'volume',
    label: 'Volume',
    unit: 'kg',
    getValue(sets) {
      const v = sets.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0)
      return v > 0 ? Math.round(v) : null
    },
  },
  {
    key: 'est_1rm',
    label: 'Est. 1RM',
    unit: 'kg',
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Progress() {
  const [exercises, setExercises]   = useState([])
  const [selectedEx, setSelectedEx] = useState('')
  const [exSets, setExSets]         = useState([])
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadingEx, setLoadingEx]   = useState(false)
  const [metricKey, setMetricKey]   = useState('top_weight')
  const [rangeKey, setRangeKey]     = useState('90d')

  // Load distinct exercise names once
  useEffect(() => {
    supabase.from('sets').select('exercise').then(({ data }) => {
      if (data) {
        const seen = new Set()
        const list = []
        for (const row of data) {
          const norm = normalizeExercise(row.exercise)
          if (norm && !seen.has(norm)) { seen.add(norm); list.push(norm) }
        }
        setExercises(list.sort())
      }
      setLoadingInit(false)
    })
  }, [])

  // Load sets when exercise changes
  useEffect(() => {
    if (!selectedEx) { setExSets([]); return }
    setLoadingEx(true)
    supabase
      .from('sets')
      .select('*')
      .ilike('exercise', selectedEx)
      .order('date')
      .then(({ data }) => {
        setExSets(data || [])
        setLoadingEx(false)
      })
  }, [selectedEx])

  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0]
  const range  = RANGES.find(r => r.key === rangeKey)   ?? RANGES[1]

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
        const value = metric.getValue(sets)
        return value != null ? { date, value, sets } : null
      })
      .filter(Boolean)
  }, [exSets, metric, range])

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
                      <div className="prog-stat-value">{summary.best}<span className="prog-stat-unit"> {metric.unit}</span></div>
                      <div className="prog-stat-label">Best</div>
                    </div>
                    <div className="prog-stat">
                      <div className="prog-stat-value">{summary.last}<span className="prog-stat-unit"> {metric.unit}</span></div>
                      <div className="prog-stat-label">Latest</div>
                    </div>
                    <div className={`prog-stat ${summary.diff > 0 ? 'up' : summary.diff < 0 ? 'down' : ''}`}>
                      <div className="prog-stat-value">
                        {summary.diff > 0 ? '+' : ''}{summary.diff}<span className="prog-stat-unit"> {metric.unit}</span>
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
                        content={props => <ChartTooltip {...props} unit={metric.unit} />}
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

                {/* History table */}
                <div className="history-table">
                  <div className="history-table-head">
                    <span>Date</span>
                    <span>Sets</span>
                    <span>{metric.label}</span>
                  </div>
                  {[...chartData].reverse().map(({ date, value, sets }) => (
                    <div key={date + sets.length} className="history-table-row">
                      <span className="ht-date">{fmtLong(date)}</span>
                      <span className="ht-sets">{sets.length}</span>
                      <span className="ht-value">{value}<span className="ht-unit"> {metric.unit}</span></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
