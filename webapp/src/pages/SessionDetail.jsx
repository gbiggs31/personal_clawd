import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './SessionDetail.css'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function SetRow({ set }) {
  const weight = set.weight_kg != null ? `${set.weight_kg} kg` : 'BW'
  const reps   = set.reps != null ? `× ${set.reps}` : ''
  const rpe    = set.rpe  != null ? `RPE ${set.rpe}` : null
  const rir    = set.rir  != null ? `RIR ${set.rir}` : null
  const injury = set.injury_flag

  return (
    <tr className={injury ? 'set-row injury' : 'set-row'}>
      <td className="set-num">#{set.set_num}</td>
      <td className="set-weight">{weight} {reps}</td>
      <td className="set-meta">
        {rpe && <span className="meta-badge">{rpe}</span>}
        {rir && <span className="meta-badge">{rir}</span>}
        {injury && <span className="meta-badge injury-badge">⚠ {set.injury_body_part || 'injury'}</span>}
      </td>
      <td className="set-note">{set.note || ''}</td>
    </tr>
  )
}

function ExerciseBlock({ exercise, sets }) {
  return (
    <div className="exercise-block">
      <h3 className="exercise-name">{exercise}</h3>
      <table className="sets-table">
        <tbody>
          {sets.map(s => <SetRow key={s.id} set={s} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const [{ data: sessData, error: sErr }, { data: setData, error: setErr }] = await Promise.all([
        supabase.from('sessions').select('*').eq('session_id', sessionId).single(),
        supabase.from('sets').select('*').eq('session_id', sessionId).order('set_num'),
      ])
      if (sErr || setErr) {
        setError((sErr || setErr).message)
      } else {
        setSession(sessData)
        setSets(setData || [])
      }
      setLoading(false)
    }
    load()
  }, [sessionId])

  if (loading) return <div className="loading-full">Loading…</div>
  if (error)   return <div className="loading-full error-text">{error}</div>
  if (!session) return <div className="loading-full">Session not found.</div>

  // Group sets by exercise, preserving order of first appearance
  const exerciseOrder = []
  const grouped = {}
  for (const s of sets) {
    const ex = (s.exercise || '').trim()
    if (!grouped[ex]) { grouped[ex] = []; exerciseOrder.push(ex) }
    grouped[ex].push(s)
  }

  const tags = []
  if (session.session_type) tags.push(session.session_type)
  if (session.cardio_flag)  tags.push('Cardio')
  if (session.abs_flag)     tags.push('Abs')

  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
        <div className="dash-logo">Avenra</div>
      </header>

      <main className="detail-main">
        <div className="detail-title-row">
          <h1>{formatDate(session.date)}</h1>
          <div className="session-tags">
            {tags.map(t => <span key={t} className="tag">{t}</span>)}
            {session.duration_mins && (
              <span className="tag tag-dim">{session.duration_mins} min</span>
            )}
          </div>
        </div>

        {session.overall_note && (
          <p className="detail-overall-note">{session.overall_note}</p>
        )}

        {exerciseOrder.length === 0 && (
          <p className="no-sets">No sets recorded for this session.</p>
        )}

        {exerciseOrder.map(ex => (
          <ExerciseBlock key={ex} exercise={ex} sets={grouped[ex]} />
        ))}

        {session.summary && (
          <div className="detail-summary">
            <h3>Session summary</h3>
            <p>{session.summary}</p>
          </div>
        )}
      </main>
    </div>
  )
}
