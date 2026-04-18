import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './SessionDetail.css'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function getTopSet(sets) {
  if (!sets?.length) return null
  return [...sets].sort((a, b) => {
    const aWeight = a.weight_kg ?? 0
    const bWeight = b.weight_kg ?? 0
    if (bWeight !== aWeight) return bWeight - aWeight
    return (b.reps ?? 0) - (a.reps ?? 0)
  })[0]
}

function compareSet(current, previous) {
  if (!current || !previous) return null

  const cw = current.weight_kg ?? 0
  const pw = previous.weight_kg ?? 0
  const cr = current.reps ?? 0
  const pr = previous.reps ?? 0

  if (cw > pw) return { direction: 'up', text: `+${cw - pw}kg` }
  if (cw < pw) return { direction: 'down', text: `${cw - pw}kg` }
  if (cr > pr) return { direction: 'up', text: `+${cr - pr} rep${cr - pr === 1 ? '' : 's'}` }
  if (cr < pr) return { direction: 'down', text: `${cr - pr} rep${pr - cr === 1 ? '' : 's'}` }
  return { direction: 'flat', text: 'same' }
}

function formatWeightRep(set) {
  const weight = set?.weight_kg != null ? `${set.weight_kg}kg` : 'BW'
  const reps = set?.reps != null ? `× ${set.reps}` : ''
  return `${weight} ${reps}`.trim()
}

function SetRow({ set, previousSet, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({})

  function startEdit() {
    setForm({
      weight_kg: set.weight_kg ?? '',
      reps: set.reps ?? '',
      rpe: set.rpe ?? '',
      rir: set.rir ?? '',
      note: set.note ?? '',
      injury_flag: set.injury_flag ?? false,
      injury_body_part: set.injury_body_part ?? '',
    })
    setConfirmDelete(false)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setConfirmDelete(false)
  }

  function field(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  }

  async function save() {
    setSaving(true)
    const updates = {
      weight_kg: form.weight_kg !== '' ? parseFloat(form.weight_kg) : null,
      reps:      form.reps      !== '' ? parseInt(form.reps)        : null,
      rpe:       form.rpe       !== '' ? parseFloat(form.rpe)       : null,
      rir:       form.rir       !== '' ? parseInt(form.rir)         : null,
      note:      form.note || null,
      injury_flag: form.injury_flag,
      injury_body_part: form.injury_flag ? (form.injury_body_part || null) : null,
    }
    await onUpdate(set.id, updates)
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await onDelete(set.id)
  }

  const rpe = set.rpe != null ? `RPE ${set.rpe}` : null
  const rir = set.rir != null ? `RIR ${set.rir}` : null
  const injury = set.injury_flag
  const delta = compareSet(set, previousSet)

  if (editing) {
    return (
      <div className={`set-card editing ${injury ? 'injury' : ''}`}>
        <div className="set-index">Set {set.set_num}</div>

        <div className="edit-grid">
          <label className="edit-field">
            <span>Weight (kg)</span>
            <input type="number" step="0.5" value={form.weight_kg} onChange={field('weight_kg')} placeholder="BW" />
          </label>
          <label className="edit-field">
            <span>Reps</span>
            <input type="number" step="1" value={form.reps} onChange={field('reps')} placeholder="—" />
          </label>
          <label className="edit-field">
            <span>RPE</span>
            <input type="number" step="0.5" min="0" max="10" value={form.rpe} onChange={field('rpe')} placeholder="—" />
          </label>
          <label className="edit-field">
            <span>RIR</span>
            <input type="number" step="1" min="0" value={form.rir} onChange={field('rir')} placeholder="—" />
          </label>
        </div>

        <label className="edit-field edit-field-full">
          <span>Note</span>
          <input type="text" value={form.note} onChange={field('note')} placeholder="Optional note" />
        </label>

        <label className="edit-injury-toggle">
          <input type="checkbox" checked={form.injury_flag} onChange={field('injury_flag')} />
          <span>Injury flag</span>
        </label>

        {form.injury_flag && (
          <label className="edit-field edit-field-full">
            <span>Body part</span>
            <input type="text" value={form.injury_body_part} onChange={field('injury_body_part')} placeholder="e.g. left shoulder" />
          </label>
        )}

        <div className="edit-actions">
          <button className="edit-btn-delete" onClick={handleDelete}>
            {confirmDelete ? 'Confirm delete?' : 'Delete'}
          </button>
          <div className="edit-actions-right">
            <button className="edit-btn-cancel" onClick={cancel}>Cancel</button>
            <button className="edit-btn-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`set-card ${injury ? 'injury' : ''}`}>
      <div className="set-card-main">
        <div className="set-card-left">
          <div className="set-index">Set {set.set_num}</div>
          <div className="set-performance">{formatWeightRep(set)}</div>
        </div>

        <div className="set-card-right">
          {delta && (
            <span className={`delta-badge ${delta.direction}`}>
              {delta.direction === 'up' && '↑ '}
              {delta.direction === 'down' && '↓ '}
              {delta.direction === 'flat' && '= '}
              {delta.text}
            </span>
          )}
          <button className="set-edit-btn" onClick={startEdit} aria-label="Edit set">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="set-meta-row">
        {rpe && <span className="meta-badge">{rpe}</span>}
        {rir && <span className="meta-badge">{rir}</span>}
        {injury && (
          <span className="meta-badge injury-badge">
            ⚠ {set.injury_body_part || 'injury'}
          </span>
        )}
      </div>

      {set.note && <div className="set-note">{set.note}</div>}
    </div>
  )
}

function ExerciseBlock({ exercise, sets, previousSets, onUpdate, onDelete }) {
  const topSet = getTopSet(sets)
  const prevTop = getTopSet(previousSets)
  const topDelta = compareSet(topSet, prevTop)

  return (
    <section className="exercise-block">
      <div className="exercise-header">
        <div>
          <h3 className="exercise-name">{exercise}</h3>
          {prevTop ? (
            <p className="exercise-prev-line">Last time: {formatWeightRep(prevTop)}</p>
          ) : (
            <p className="exercise-prev-line">No previous comparison</p>
          )}
        </div>

        {topDelta && (
          <span className={`delta-badge ${topDelta.direction}`}>
            {topDelta.direction === 'up' && '↑ '}
            {topDelta.direction === 'down' && '↓ '}
            {topDelta.direction === 'flat' && '= '}
            {topDelta.text}
          </span>
        )}
      </div>

      <div className="sets-list">
        {sets.map((set, index) => (
          <SetRow
            key={set.id}
            set={set}
            previousSet={previousSets?.[index]}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  )
}

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(null)
  const [sets, setSets] = useState([])
  const [previousSessionSets, setPreviousSessionSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingType, setEditingType] = useState(false)

  const SESSION_TYPES = ['push', 'pull', 'legs', 'upper', 'full_body', 'cardio', 'other']

  async function handleUpdateSessionType(newType) {
    const { data: { session: authSession } } = await supabase.auth.getSession()
    const token = authSession?.access_token
    if (!token) return

    const res = await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, fields: { session_type: newType } }),
    })
    if (res.ok) {
      setSession(prev => ({ ...prev, session_type: newType }))
    }
    setEditingType(false)
  }

  useEffect(() => {
    async function load() {
      const [{ data: sessData, error: sErr }, { data: setData, error: setErr }] = await Promise.all([
        supabase.from('sessions').select('*').eq('session_id', sessionId).single(),
        supabase.from('sets').select('*').eq('session_id', sessionId).order('set_num'),
      ])

      if (sErr || setErr) {
        setError((sErr || setErr)?.message || 'Failed to load session')
        setLoading(false)
        return
      }

      setSession(sessData)
      setSets(setData || [])

      if (sessData && setData?.length) {
        const exerciseNames = [...new Set(setData.map(s => (s.exercise || '').trim()).filter(Boolean))]

        const { data: priorSessions } = await supabase
          .from('sessions')
          .select('session_id, date')
          .lt('date', sessData.date)
          .order('date', { ascending: false })
          .limit(50)

        if (priorSessions?.length) {
          const priorIds = priorSessions.map(s => s.session_id)
          const { data: priorSets } = await supabase
            .from('sets')
            .select('*')
            .in('session_id', priorIds)
            .order('set_num')

          const earliestUsefulSessionByExercise = {}
          for (const priorSession of priorSessions) {
            for (const set of priorSets || []) {
              if (set.session_id !== priorSession.session_id) continue
              const ex = (set.exercise || '').trim()
              if (!exerciseNames.includes(ex)) continue
              if (!earliestUsefulSessionByExercise[ex]) {
                earliestUsefulSessionByExercise[ex] = priorSession.session_id
              }
            }
          }

          const matchedSessionIds = [...new Set(Object.values(earliestUsefulSessionByExercise))]
          const usefulSets = (priorSets || []).filter(s => matchedSessionIds.includes(s.session_id))
          setPreviousSessionSets(usefulSets)
        }
      }

      setLoading(false)
    }

    load()
  }, [sessionId])

  async function handleUpdateSet(setId, fields) {
    const { error: err } = await supabase.from('sets').update(fields).eq('id', setId)
    if (!err) {
      setSets(prev => prev.map(s => s.id === setId ? { ...s, ...fields } : s))
    }
  }

  async function handleDeleteSet(setId) {
    const { error: err } = await supabase.from('sets').delete().eq('id', setId)
    if (!err) {
      setSets(prev => prev.filter(s => s.id !== setId))
    }
  }

  const groupedCurrent = useMemo(() => {
    const order = []
    const grouped = {}
    for (const s of sets) {
      const ex = (s.exercise || '').trim()
      if (!ex) continue
      if (!grouped[ex]) {
        grouped[ex] = []
        order.push(ex)
      }
      grouped[ex].push(s)
    }
    return { order, grouped }
  }, [sets])

  const groupedPrevious = useMemo(() => {
    const grouped = {}
    for (const s of previousSessionSets) {
      const ex = (s.exercise || '').trim()
      if (!ex) continue
      if (!grouped[ex]) grouped[ex] = []
      grouped[ex].push(s)
    }
    return grouped
  }, [previousSessionSets])

  const sessionOverview = useMemo(() => {
    const exerciseCount = groupedCurrent.order.length
    const setCount = sets.length
    const injuryCount = sets.filter(s => s.injury_flag).length

    return [
      { label: 'Exercises', value: `${exerciseCount}` },
      { label: 'Sets', value: `${setCount}` },
      { label: 'Duration', value: session?.duration_mins ? `${session.duration_mins} min` : '—' },
      { label: 'Flags', value: injuryCount ? `${injuryCount} issue${injuryCount === 1 ? '' : 's'}` : 'None' },
    ]
  }, [groupedCurrent.order.length, sets, session])

  if (loading) return <div className="loading-full">Loading…</div>
  if (error)   return <div className="loading-full error-text">{error}</div>
  if (!session) return <div className="loading-full">Session not found.</div>

  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
        <div className="dash-logo">Ave<span>nra</span></div>
      </header>

      <main className="detail-main">
        <section className="detail-hero">
          <div className="detail-title-row">
            <div>
              <div className="eyebrow">Session</div>
              <h1>{formatDate(session.date)}</h1>
            </div>

            <div className="session-tags">
              {session.session_type && !editingType && (
                <button className="tag tag-editable" onClick={() => setEditingType(true)} title="Edit session type">
                  {session.session_type}
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{marginLeft: 5, opacity: 0.6}}>
                    <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {session.cardio_flag && <span className="tag tag-dim">Cardio</span>}
              {session.abs_flag    && <span className="tag tag-dim">Abs</span>}
            </div>
          </div>

          {editingType && (
            <div className="type-picker">
              {SESSION_TYPES.map(t => (
                <button
                  key={t}
                  className={`type-option ${t === session.session_type ? 'active' : ''}`}
                  onClick={() => handleUpdateSessionType(t)}
                >
                  {t}
                </button>
              ))}
              <button className="type-cancel" onClick={() => setEditingType(false)}>Cancel</button>
            </div>
          )}

          {session.overall_note && (
            <p className="detail-overall-note">{session.overall_note}</p>
          )}

          <div className="overview-grid">
            {sessionOverview.map(item => (
              <div key={item.label} className="overview-card">
                <div className="overview-value">{item.value}</div>
                <div className="overview-label">{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        {groupedCurrent.order.length === 0 && (
          <p className="no-sets">No sets recorded for this session.</p>
        )}

        {groupedCurrent.order.map(exercise => (
          <ExerciseBlock
            key={exercise}
            exercise={exercise}
            sets={groupedCurrent.grouped[exercise]}
            previousSets={groupedPrevious[exercise] || []}
            onUpdate={handleUpdateSet}
            onDelete={handleDeleteSet}
          />
        ))}

        {session.summary && (
          <div className="detail-summary">
            <h3>Coach summary</h3>
            <p>{session.summary}</p>
          </div>
        )}
      </main>
    </div>
  )
}
