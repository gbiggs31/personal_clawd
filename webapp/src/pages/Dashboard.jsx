import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Dashboard.css'

const SESSION_TYPES = ['All', 'Push', 'Pull', 'Legs', 'Upper', 'Full Body', 'Other']
const KNOWN_TYPES   = ['push', 'pull', 'legs', 'upper', 'full body']

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function SessionCard({ session, exercises, onClick }) {
  const tags = []
  if (session.session_type) tags.push(session.session_type)
  if (session.cardio_flag)  tags.push('Cardio')
  if (session.abs_flag)     tags.push('Abs')

  return (
    <button className="session-card" onClick={onClick}>
      <div className="session-card-header">
        <span className="session-date">{formatDate(session.date)}</span>
        <div className="session-tags">
          {tags.map(t => <span key={t} className="tag">{t}</span>)}
          {session.duration_mins && (
            <span className="tag tag-dim">{session.duration_mins} min</span>
          )}
        </div>
      </div>

      {session.overall_note && (
        <p className="session-note">{session.overall_note}</p>
      )}

      {exercises.length > 0 && (
        <p className="session-exercises">{exercises.join(' · ')}</p>
      )}

      {session.summary && (
        <p className="session-summary">{session.summary}</p>
      )}
    </button>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [sessions, setSessions]       = useState([])
  const [exerciseMap, setExerciseMap] = useState({})
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [typeFilter, setTypeFilter]   = useState('All')
  const [exSearch, setExSearch]       = useState('')

  useEffect(() => {
    async function load() {
      const { data: sessionData, error: sErr } = await supabase
        .from('sessions')
        .select('*')
        .order('date', { ascending: false })
        .limit(500)

      if (sErr) { setError(sErr.message); setLoading(false); return }

      setSessions(sessionData || [])

      if (sessionData && sessionData.length > 0) {
        const ids = sessionData.map(s => s.session_id)
        const { data: setData } = await supabase
          .from('sets')
          .select('session_id, exercise, set_num')
          .in('session_id', ids)
          .order('set_num')

        const map = {}
        for (const row of (setData || [])) {
          const sid = row.session_id
          if (!map[sid]) map[sid] = []
          const ex = (row.exercise || '').trim()
          if (ex && !map[sid].includes(ex)) map[sid].push(ex)
        }
        setExerciseMap(map)
      }

      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const query = exSearch.trim().toLowerCase()
    return sessions.filter(s => {
      // Session type filter
      if (typeFilter !== 'All') {
        const type = (s.session_type || '').toLowerCase()
        if (typeFilter === 'Other') {
          if (KNOWN_TYPES.includes(type)) return false
        } else {
          if (type !== typeFilter.toLowerCase()) return false
        }
      }
      // Exercise search
      if (query) {
        const exes = exerciseMap[s.session_id] || []
        if (!exes.some(e => e.toLowerCase().includes(query))) return false
      }
      return true
    })
  }, [sessions, exerciseMap, typeFilter, exSearch])

  const isFiltered = typeFilter !== 'All' || exSearch.trim()

  if (loading) return <div className="loading-full">Loading sessions…</div>

  return (
    <div className="dashboard">
      <main className="dash-main">
        <div className="dash-header-row">
          <div>
            <h1 className="dash-title">Sessions</h1>
            <p className="dash-count">
              {isFiltered
                ? `${filtered.length} of ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
                : `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Filters */}
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
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
          </div>
        </div>

        {error && <div className="dash-error">{error}</div>}

        {sessions.length === 0 && !error && (
          <p className="dash-empty">No sessions yet. Log a workout via the bot to see it here.</p>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="dash-empty">No sessions match these filters.</p>
        )}

        <div className="session-list">
          {filtered.map(s => (
            <SessionCard
              key={s.session_id}
              session={s}
              exercises={exerciseMap[s.session_id] || []}
              onClick={() => navigate(`/session/${s.session_id}`)}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
