import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import { useUnits, formatWeight, unitLabel, toDisplayWeight, fromDisplayWeight } from '../utils/units.js'
import { invalidateCache } from '../utils/page-cache.js'
import './SessionDetail.css'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
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

function compareSet(current, previous, units = 'metric') {
  if (!current || !previous) return null

  const cw = current.weight_kg ?? 0
  const pw = previous.weight_kg ?? 0
  const cr = current.reps ?? 0
  const pr = previous.reps ?? 0

  const asWeight = kg => formatWeight(Math.abs(kg), units)
  if (cw > pw) return { direction: 'up', text: `+${asWeight(cw - pw)}` }
  if (cw < pw) return { direction: 'down', text: `-${asWeight(cw - pw)}` }
  if (cr > pr) return { direction: 'up', text: `+${cr - pr} rep${cr - pr === 1 ? '' : 's'}` }
  if (cr < pr) return { direction: 'down', text: `${cr - pr} rep${pr - cr === 1 ? '' : 's'}` }
  return { direction: 'flat', text: 'same' }
}

function formatWeightRep(set, units) {
  const reps = set?.reps != null ? `x ${set.reps}` : ''
  return `${formatWeight(set?.weight_kg, units)} ${reps}`.trim()
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.5h10M5 3.5V2.5h4v1M5.5 6v5M8.5 6v5M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function SetRow({ set, previousSet, onUpdate, onDelete, onError, units }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({})

  function startEdit() {
    setForm({
      weight_kg: toDisplayWeight(set.weight_kg, units) ?? '',
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
      weight_kg: fromDisplayWeight(form.weight_kg, units),
      reps: form.reps !== '' ? parseInt(form.reps, 10) : null,
      rpe: form.rpe !== '' ? parseFloat(form.rpe) : null,
      rir: form.rir !== '' ? parseInt(form.rir, 10) : null,
      note: form.note || null,
      injury_flag: form.injury_flag,
      injury_body_part: form.injury_flag ? (form.injury_body_part || null) : null,
    }

    try {
      const ok = await onUpdate(set.id, updates)
      if (ok) setEditing(false)
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    try {
      const ok = await onDelete(set.id)
      if (ok) setEditing(false)
    } catch (err) {
      onError(err)
    }
  }

  const rpe = set.rpe != null ? `RPE ${set.rpe}` : null
  const rir = set.rir != null ? `RIR ${set.rir}` : null
  const injury = set.injury_flag
  const delta = compareSet(set, previousSet, units)

  if (editing) {
    return (
      <div className={`set-card editing ${injury ? 'injury' : ''}`}>
        <div className="set-index">Set {set.set_num}</div>

        <div className="edit-grid">
          <label className="edit-field">
            <span>Weight ({unitLabel(units)})</span>
            <input type="number" step="0.5" value={form.weight_kg} onChange={field('weight_kg')} placeholder="BW" />
          </label>
          <label className="edit-field">
            <span>Reps</span>
            <input type="number" step="1" value={form.reps} onChange={field('reps')} placeholder="-" />
          </label>
          <label className="edit-field">
            <span>RPE</span>
            <input type="number" step="0.5" min="0" max="10" value={form.rpe} onChange={field('rpe')} placeholder="-" />
          </label>
          <label className="edit-field">
            <span>RIR</span>
            <input type="number" step="1" min="0" value={form.rir} onChange={field('rir')} placeholder="-" />
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
              {saving ? 'Saving...' : 'Save'}
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
          <div className="set-performance">{formatWeightRep(set, units)}</div>
        </div>

        <div className="set-card-right">
          {delta && (
            <span className={`delta-badge ${delta.direction}`}>
              {delta.direction === 'up' && 'Up '}
              {delta.direction === 'down' && 'Down '}
              {delta.direction === 'flat' && '= '}
              {delta.text}
            </span>
          )}
          <button className="set-edit-btn" onClick={startEdit} aria-label="Edit set">
            <EditIcon />
          </button>
        </div>
      </div>

      <div className="set-meta-row">
        {rpe && <span className="meta-badge">{rpe}</span>}
        {rir && <span className="meta-badge">{rir}</span>}
        {injury && (
          <span className="meta-badge injury-badge">
            ! {set.injury_body_part || 'injury'}
          </span>
        )}
      </div>

      {set.note && <div className="set-note">{set.note}</div>}
    </div>
  )
}

function AddSetForm({ onSave, onCancel, onError, units }) {
  const [form, setForm] = useState({ weight_kg: '', reps: '', note: '' })
  const [saving, setSaving] = useState(false)

  function field(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function save() {
    setSaving(true)
    try {
      await onSave({
        weight_kg: fromDisplayWeight(form.weight_kg, units),
        reps: form.reps !== '' ? parseInt(form.reps, 10) : null,
        note: form.note || null,
      })
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-set-form">
      <div className="add-set-label">New set</div>
      <div className="edit-grid">
        <label className="edit-field">
          <span>Weight ({unitLabel(units)})</span>
          <input type="number" step="0.5" value={form.weight_kg} onChange={field('weight_kg')} placeholder="BW" autoFocus />
        </label>
        <label className="edit-field">
          <span>Reps</span>
          <input type="number" step="1" value={form.reps} onChange={field('reps')} placeholder="-" />
        </label>
      </div>
      <label className="edit-field edit-field-full">
        <span>Note</span>
        <input type="text" value={form.note} onChange={field('note')} placeholder="Optional" />
      </label>
      <div className="edit-actions">
        <div />
        <div className="edit-actions-right">
          <button className="edit-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="edit-btn-save" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Add set'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddExerciseForm({ onSave, onCancel, onError, units }) {
  const [form, setForm] = useState({ exercise: '', weight_kg: '', reps: '' })
  const [saving, setSaving] = useState(false)

  function field(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function save() {
    if (!form.exercise.trim()) return
    setSaving(true)
    try {
      await onSave(form.exercise.trim(), {
        weight_kg: fromDisplayWeight(form.weight_kg, units),
        reps: form.reps !== '' ? parseInt(form.reps, 10) : null,
      })
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-exercise-form">
      <div className="add-set-label">New exercise</div>
      <label className="edit-field edit-field-full" style={{ marginBottom: 10 }}>
        <span>Exercise name</span>
        <input type="text" value={form.exercise} onChange={field('exercise')} placeholder="e.g. Bench Press" autoFocus />
      </label>
      <div className="edit-grid">
        <label className="edit-field">
          <span>Weight ({unitLabel(units)})</span>
          <input type="number" step="0.5" value={form.weight_kg} onChange={field('weight_kg')} placeholder="BW" />
        </label>
        <label className="edit-field">
          <span>Reps</span>
          <input type="number" step="1" value={form.reps} onChange={field('reps')} placeholder="-" />
        </label>
      </div>
      <div className="edit-actions">
        <div />
        <div className="edit-actions-right">
          <button className="edit-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="edit-btn-save" onClick={save} disabled={saving || !form.exercise.trim()}>
            {saving ? 'Saving...' : 'Add exercise'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExerciseBlock({
  exercise,
  sets,
  previousSets,
  onUpdate,
  onDelete,
  onRename,
  onDeleteExercise,
  onAddSet,
  onError,
  units,
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameForm, setNameForm] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDeleteEx, setConfirmDeleteEx] = useState(false)
  const [showAddSet, setShowAddSet] = useState(false)

  const topSet = getTopSet(sets)
  const prevTop = getTopSet(previousSets)
  const topDelta = compareSet(topSet, prevTop, units)

  function startRename() {
    setNameForm(exercise)
    setEditingName(true)
    setConfirmDeleteEx(false)
  }

  async function saveRename() {
    const trimmed = nameForm.trim()
    if (!trimmed || trimmed === exercise) {
      setEditingName(false)
      return
    }

    setSavingName(true)
    try {
      const ok = await onRename(exercise, trimmed)
      if (ok) setEditingName(false)
    } catch (err) {
      onError(err)
    } finally {
      setSavingName(false)
    }
  }

  async function handleDeleteExercise() {
    if (!confirmDeleteEx) {
      setConfirmDeleteEx(true)
      return
    }

    try {
      const ok = await onDeleteExercise(exercise)
      if (ok) setConfirmDeleteEx(false)
    } catch (err) {
      onError(err)
    }
  }

  async function handleAddSet(fields) {
    try {
      const ok = await onAddSet(exercise, fields)
      if (ok) setShowAddSet(false)
    } catch (err) {
      onError(err)
    }
  }

  return (
    <section className="exercise-block">
      <div className="exercise-header">
        <div className="exercise-header-left">
          {editingName ? (
            <div className="exercise-rename-row">
              <input
                className="exercise-rename-input"
                value={nameForm}
                onChange={e => setNameForm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveRename()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                autoFocus
              />
              <button className="edit-btn-cancel" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setEditingName(false)}>Cancel</button>
              <button className="edit-btn-save" style={{ fontSize: 12, padding: '4px 10px' }} onClick={saveRename} disabled={savingName}>
                {savingName ? '...' : 'Save'}
              </button>
            </div>
          ) : (
            <div className="exercise-name-row">
              <h3 className="exercise-name">{exercise}</h3>
              <button className="ex-icon-btn" onClick={startRename} title="Rename exercise">
                <EditIcon />
              </button>
            </div>
          )}
          {prevTop ? (
            <p className="exercise-prev-line">Last time: {formatWeightRep(prevTop, units)}</p>
          ) : (
            <p className="exercise-prev-line">No previous comparison</p>
          )}
        </div>

        <div className="exercise-header-right">
          {topDelta && (
            <span className={`delta-badge ${topDelta.direction}`}>
              {topDelta.direction === 'up' && 'Up '}
              {topDelta.direction === 'down' && 'Down '}
              {topDelta.direction === 'flat' && '= '}
              {topDelta.text}
            </span>
          )}
          <button
            className={`ex-icon-btn ex-delete-btn${confirmDeleteEx ? ' confirming' : ''}`}
            onClick={handleDeleteExercise}
            title={confirmDeleteEx ? 'Click again to confirm deletion' : 'Delete exercise'}
          >
            {confirmDeleteEx ? 'Delete?' : <TrashIcon />}
          </button>
        </div>
      </div>

      <div className="sets-list">
        {sets.map((set, index) => (
          <SetRow
            key={set.id}
            set={set}
            previousSet={previousSets?.[index]}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onError={onError}
            units={units}
          />
        ))}
      </div>

      {showAddSet ? (
        <AddSetForm onSave={handleAddSet} onCancel={() => setShowAddSet(false)} onError={onError} units={units} />
      ) : (
        <button className="add-set-btn" onClick={() => { setShowAddSet(true); setConfirmDeleteEx(false) }}>
          + Add set
        </button>
      )}
    </section>
  )
}

export default function SessionDetail() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const units = useUnits()

  const [session, setSession] = useState(null)
  const [sets, setSets] = useState([])
  const [previousSessionSets, setPreviousSessionSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [editingType, setEditingType] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteForm, setNoteForm] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingDuration, setEditingDuration] = useState(false)
  const [durationForm, setDurationForm] = useState('')
  const [savingDuration, setSavingDuration] = useState(false)
  const [editingCoachNote, setEditingCoachNote] = useState(false)
  const [coachNoteForm, setCoachNoteForm] = useState('')
  const [savingCoachNote, setSavingCoachNote] = useState(false)
  const [showAddExercise, setShowAddExercise] = useState(false)

  const SESSION_TYPES = ['push', 'pull', 'legs', 'upper', 'full_body', 'cardio', 'other']

  function clearActionError() {
    setActionError('')
  }

  function handleActionError(err) {
    setActionError(err instanceof Error ? err.message : 'Something went wrong.')
  }

  async function getToken() {
    const { data: { session: authSession } } = await supabase.auth.getSession()
    return authSession?.access_token || null
  }

  async function readApiError(res, fallback) {
    try {
      const data = await res.json()
      return data.error || fallback
    } catch {
      return fallback
    }
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

  async function patchSession(fields) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const res = await fetch('/api/user-actions?action=update-session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, fields }),
    })

    if (!res.ok) {
      throw new Error(await readApiError(res, 'Failed to update session'))
    }

    invalidateCache()
    return true
  }

  async function handleUpdateSessionType(newType) {
    try {
      if (await patchSession({ session_type: newType })) {
        setSession(prev => ({ ...prev, session_type: newType }))
      }
    } catch (err) {
      handleActionError(err)
    } finally {
      setEditingType(false)
    }
  }

  function startEditNote() {
    clearActionError()
    setNoteForm(session.overall_note || '')
    setEditingNote(true)
  }

  async function saveNote() {
    setSavingNote(true)
    try {
      if (await patchSession({ overall_note: noteForm.trim() || null })) {
        setSession(prev => ({ ...prev, overall_note: noteForm.trim() || null }))
        setEditingNote(false)
      }
    } catch (err) {
      handleActionError(err)
    } finally {
      setSavingNote(false)
    }
  }

  function startEditCoachNote() {
    clearActionError()
    setCoachNoteForm(session.coaching_note || '')
    setEditingCoachNote(true)
  }

  async function saveCoachNote() {
    setSavingCoachNote(true)
    try {
      if (await patchSession({ coaching_note: coachNoteForm.trim() || null })) {
        setSession(prev => ({ ...prev, coaching_note: coachNoteForm.trim() || null }))
        setEditingCoachNote(false)
      }
    } catch (err) {
      handleActionError(err)
    } finally {
      setSavingCoachNote(false)
    }
  }

  function startEditDuration() {
    clearActionError()
    setDurationForm(session.duration_mins ?? '')
    setEditingDuration(true)
  }

  async function saveDuration() {
    const val = durationForm !== '' ? parseInt(durationForm, 10) : null
    setSavingDuration(true)
    try {
      if (await patchSession({ duration_mins: val })) {
        setSession(prev => ({ ...prev, duration_mins: val }))
        setEditingDuration(false)
      }
    } catch (err) {
      handleActionError(err)
    } finally {
      setSavingDuration(false)
    }
  }

  async function handleUpdateSet(setId, fields) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const res = await fetch('/api/sets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ setId, fields }),
    })

    if (!res.ok) {
      throw new Error(await readApiError(res, 'Failed to update set'))
    }

    invalidateCache()
    setSets(prev => prev.map(s => (s.id === setId ? { ...s, ...fields } : s)))
    return true
  }

  async function handleDeleteSet(setId) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const res = await fetch('/api/sets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ setId }),
    })

    if (!res.ok) {
      throw new Error(await readApiError(res, 'Failed to delete set'))
    }

    invalidateCache()
    setSets(prev => prev.filter(s => s.id !== setId))
    return true
  }

  async function handleRenameExercise(oldName, newName) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const setsToRename = sets.filter(s => (s.exercise || '').trim() === oldName)
    const responses = await Promise.all(setsToRename.map(s =>
      fetch('/api/sets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ setId: s.id, fields: { exercise: newName } }),
      })
    ))

    invalidateCache()
    const failed = responses.find(res => !res.ok)
    if (failed) {
      throw new Error(await readApiError(failed, 'Failed to rename exercise'))
    }

    setSets(prev => prev.map(s =>
      ((s.exercise || '').trim() === oldName ? { ...s, exercise: newName } : s)
    ))
    return true
  }

  async function handleDeleteExercise(exerciseName) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const setsToDelete = sets.filter(s => (s.exercise || '').trim() === exerciseName)
    const responses = await Promise.all(setsToDelete.map(s =>
      fetch('/api/sets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ setId: s.id }),
      })
    ))

    invalidateCache()
    const failed = responses.find(res => !res.ok)
    if (failed) {
      throw new Error(await readApiError(failed, 'Failed to delete exercise'))
    }

    setSets(prev => prev.filter(s => (s.exercise || '').trim() !== exerciseName))
    return true
  }

  async function handleAddSet(exerciseName, fields) {
    clearActionError()
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')

    const exerciseSets = sets.filter(s => (s.exercise || '').trim() === exerciseName)
    const nextSetNum = exerciseSets.length > 0
      ? Math.max(...exerciseSets.map(s => s.set_num)) + 1
      : 1

    const res = await fetch('/api/sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, exercise: exerciseName, setNum: nextSetNum, ...fields }),
    })

    if (!res.ok) {
      throw new Error(await readApiError(res, 'Failed to add set'))
    }

    const { set } = await res.json()
    invalidateCache()
    setSets(prev => [...prev, set])
    return true
  }

  async function handleAddExercise(exerciseName, fields) {
    const added = await handleAddSet(exerciseName, fields)
    if (added) setShowAddExercise(false)
    return added
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
      { label: 'Flags', value: injuryCount ? `${injuryCount} issue${injuryCount === 1 ? '' : 's'}` : 'None' },
    ]
  }, [groupedCurrent.order.length, sets])

  if (loading) return <div className="loading-full">Loading...</div>
  if (error) return <div className="loading-full error-text">{error}</div>
  if (!session) return <div className="loading-full">Session not found.</div>

  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="back-btn" onClick={() => navigate('/')}>Back</button>
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
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 5, opacity: 0.6 }}>
                    <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {session.cardio_flag && <span className="tag tag-dim">Cardio</span>}
              {session.abs_flag && <span className="tag tag-dim">Abs</span>}
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

          {actionError && <div className="notice warning">{actionError}</div>}

          {editingNote ? (
            <div className="note-edit-form">
              <textarea
                className="note-edit-textarea"
                value={noteForm}
                onChange={e => setNoteForm(e.target.value)}
                placeholder="Session note..."
                rows={3}
                autoFocus
              />
              <div className="edit-actions" style={{ marginTop: 8 }}>
                <div />
                <div className="edit-actions-right">
                  <button className="edit-btn-cancel" onClick={() => setEditingNote(false)}>Cancel</button>
                  <button className="edit-btn-save" onClick={saveNote} disabled={savingNote}>
                    {savingNote ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : session.overall_note ? (
            <div className="detail-note-row" onClick={startEditNote} title="Edit note">
              <p className="detail-overall-note">{session.overall_note}</p>
              <button className="ex-icon-btn note-edit-btn"><EditIcon /></button>
            </div>
          ) : (
            <button className="add-note-btn" onClick={startEditNote}>+ Add session note</button>
          )}

          <div className="overview-grid">
            {sessionOverview.map(item => (
              <div key={item.label} className="overview-card">
                <div className="overview-value">{item.value}</div>
                <div className="overview-label">{item.label}</div>
              </div>
            ))}
            <div
              className="overview-card overview-card-editable"
              onClick={() => !editingDuration && startEditDuration()}
              title="Edit duration"
            >
              {editingDuration ? (
                <div className="duration-edit">
                  <input
                    className="duration-input"
                    type="number"
                    min="1"
                    value={durationForm}
                    onChange={e => setDurationForm(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveDuration()
                      if (e.key === 'Escape') setEditingDuration(false)
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                  <div className="duration-edit-actions">
                    <button className="edit-btn-cancel" style={{ fontSize: 11, padding: '3px 8px' }} onClick={e => { e.stopPropagation(); setEditingDuration(false) }}>X</button>
                    <button className="edit-btn-save" style={{ fontSize: 11, padding: '3px 8px' }} onClick={e => { e.stopPropagation(); saveDuration() }} disabled={savingDuration}>OK</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="overview-value">
                    {session.duration_mins ? `${session.duration_mins}` : '-'}
                    {session.duration_mins && <span className="overview-unit"> min</span>}
                  </div>
                  <div className="overview-label">Duration</div>
                </>
              )}
            </div>
          </div>
        </section>

        {groupedCurrent.order.length === 0 && !showAddExercise && (
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
            onRename={handleRenameExercise}
            onDeleteExercise={handleDeleteExercise}
            onAddSet={handleAddSet}
            onError={handleActionError}
            units={units}
          />
        ))}

        {showAddExercise ? (
          <AddExerciseForm onSave={handleAddExercise} onCancel={() => setShowAddExercise(false)} onError={handleActionError} units={units} />
        ) : (
          <button className="add-exercise-btn" onClick={() => { clearActionError(); setShowAddExercise(true) }}>
            + Add exercise
          </button>
        )}

        <div className="coaching-note-section">
          <div className="coaching-note-header">
            <span className="coaching-note-label">Note for coach</span>
            <span className="coaching-note-hint">Remembered when planning your next session</span>
          </div>
          {editingCoachNote ? (
            <div className="note-edit-form">
              <textarea
                className="note-edit-textarea coaching-note-textarea"
                value={coachNoteForm}
                onChange={e => setCoachNoteForm(e.target.value)}
                placeholder="e.g. Left knee felt tight on squats, keep weight conservative next leg day..."
                rows={3}
                autoFocus
              />
              <div className="edit-actions" style={{ marginTop: 8 }}>
                <div />
                <div className="edit-actions-right">
                  <button className="edit-btn-cancel" onClick={() => setEditingCoachNote(false)}>Cancel</button>
                  <button className="edit-btn-save" onClick={saveCoachNote} disabled={savingCoachNote}>
                    {savingCoachNote ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : session.coaching_note ? (
            <div className="coaching-note-row" onClick={startEditCoachNote} title="Edit note">
              <p className="coaching-note-text">{session.coaching_note}</p>
              <button className="ex-icon-btn note-edit-btn"><EditIcon /></button>
            </div>
          ) : (
            <button className="add-coaching-note-btn" onClick={startEditCoachNote}>
              + Add note for coach
            </button>
          )}
        </div>

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
