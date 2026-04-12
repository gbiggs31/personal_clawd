import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import './Dashboard.css'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function SessionCard({ session, exercises, onClick }) {
  const tags = []
  if (session.session_type) tags.push(session.session_type)
  if (session.cardio_flag)   tags.push('Cardio')
  if (session.abs_flag)      tags.push('Abs')

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
  const [sessions, setSessions] = useState([])
  const [exerciseMap, setExerciseMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: sessionData, error: sErr } = await supabase
        .from('sessions')
        .select('*')
        .order('date', { ascending: false })
        .limit(200)

      if (sErr) { setError(sErr.message); setLoading(false); return }

      setSessions(sessionData || [])

      // Fetch exercises for all loaded sessions in one query
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

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (loading) return <div className="loading-full">Loading sessions…</div>

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-logo">Avenra</div>
        <button className="signout-btn" onClick={handleSignOut}>Sign out</button>
      </header>

      <main className="dash-main">
        <h1 className="dash-title">Training log</h1>
        <p className="dash-count">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>

        {error && <div className="dash-error">{error}</div>}

        {sessions.length === 0 && !error && (
          <p className="dash-empty">No sessions yet. Log a workout via the bot to see it here.</p>
        )}

        <div className="session-list">
          {sessions.map(s => (
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
