import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import StravaCard from '../components/StravaCard.jsx'
import './ProfilePages.css'

const FIELDS = [
  {
    section: 'Physical',
    rows: [
      { key: 'age',        label: 'Age',    type: 'number', unit: 'years', placeholder: 'e.g. 28' },
      { key: 'sex',        label: 'Sex',    type: 'select', options: ['male', 'female', 'prefer not to say'] },
      { key: 'height_cm',  label: 'Height', type: 'number', unit: 'cm',    placeholder: 'e.g. 178' },
      { key: 'weight_kg',  label: 'Weight', type: 'number', unit: 'kg',    placeholder: 'e.g. 83'  },
    ],
  },
  {
    section: 'Training',
    rows: [
      { key: 'experience_level', label: 'Level',      type: 'select', options: ['beginner', 'intermediate', 'advanced'] },
      { key: 'experience_years', label: 'Experience', type: 'text',   placeholder: 'e.g. 2–5 years' },
      { key: 'training_notes',   label: 'Style',      type: 'textarea', placeholder: 'e.g. PPL, 4 days/week' },
    ],
  },
  {
    section: 'Setup',
    rows: [
      { key: 'equipment',       label: 'Equipment', type: 'textarea', placeholder: 'e.g. Full commercial gym' },
      { key: 'chronic_injuries', label: 'Injuries',  type: 'textarea', placeholder: 'e.g. Left shoulder' },
    ],
  },
]

function cmToFtIn(cm) {
  const totalIn = cm / 2.54
  const ft = Math.floor(totalIn / 12)
  const inches = Math.round(totalIn % 12)
  return { ft, in: inches }
}

function displayValue(key, value, units = 'metric') {
  if (!value) return '—'
  if (key === 'height_cm') {
    if (units === 'imperial') {
      const { ft, in: inches } = cmToFtIn(Number(value))
      return `${ft}'${inches}"`
    }
    return `${value} cm`
  }
  if (key === 'weight_kg') {
    if (units === 'imperial') return `${Math.round(Number(value) * 2.20462)} lbs`
    return `${value} kg`
  }
  if (key === 'age') return `${value}`
  return value
}

function FieldView({ field, value, units }) {
  return (
    <div className="pp-row">
      <span className="pp-label">{field.label}</span>
      <span className="pp-value">{displayValue(field.key, value, units)}</span>
    </div>
  )
}

function FieldEdit({ field, value, onChange, units, draft, onChangeDraft }) {
  // Imperial overrides for height and weight
  if (units === 'imperial' && field.key === 'height_cm') {
    const totalIn = value ? Number(value) / 2.54 : 0
    const ft = draft._height_ft !== undefined ? draft._height_ft : String(Math.floor(totalIn / 12))
    const inches = draft._height_in !== undefined ? draft._height_in : String(Math.round(totalIn % 12))
    return (
      <div className="pp-row">
        <span className="pp-label">Height</span>
        <div className="pp-input-wrap">
          <input className="pp-input" style={{ width: 56 }} type="number" value={ft} placeholder="5"
            onChange={e => {
              onChangeDraft('_height_ft', e.target.value)
              const cm = Math.round((Number(e.target.value) * 12 + Number(inches)) * 2.54)
              if (!isNaN(cm) && cm > 0) onChange('height_cm', cm)
            }} />
          <span className="pp-unit">ft</span>
          <input className="pp-input" style={{ width: 56 }} type="number" value={inches} placeholder="10"
            onChange={e => {
              onChangeDraft('_height_in', e.target.value)
              const cm = Math.round((Number(ft) * 12 + Number(e.target.value)) * 2.54)
              if (!isNaN(cm) && cm > 0) onChange('height_cm', cm)
            }} />
          <span className="pp-unit">in</span>
        </div>
      </div>
    )
  }

  if (units === 'imperial' && field.key === 'weight_kg') {
    const lbsVal = draft._weight_lbs !== undefined
      ? draft._weight_lbs
      : value ? String(Math.round(Number(value) * 2.20462)) : ''
    return (
      <div className="pp-row">
        <span className="pp-label">Weight</span>
        <div className="pp-input-wrap">
          <input className="pp-input" type="number" value={lbsVal} placeholder="e.g. 185"
            onChange={e => {
              onChangeDraft('_weight_lbs', e.target.value)
              const kg = Math.round(Number(e.target.value) * 0.453592 * 10) / 10
              if (!isNaN(kg) && kg > 0) onChange('weight_kg', kg)
            }} />
          <span className="pp-unit">lbs</span>
        </div>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="pp-row">
        <span className="pp-label">{field.label}</span>
        <div className="pp-options">
          {field.options.map(opt => (
            <button
              key={opt}
              type="button"
              className={`pp-option ${value === opt ? 'selected' : ''}`}
              onClick={() => onChange(field.key, opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="pp-row stacked">
        <span className="pp-label">{field.label}</span>
        <textarea
          className="pp-input textarea"
          value={value || ''}
          placeholder={field.placeholder}
          rows={2}
          onChange={e => onChange(field.key, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="pp-row">
      <span className="pp-label">{field.label}</span>
      <div className="pp-input-wrap">
        <input
          className="pp-input"
          type={field.type}
          value={value || ''}
          placeholder={field.placeholder}
          onChange={e => onChange(field.key, e.target.value)}
        />
        {field.unit && <span className="pp-unit">{field.unit}</span>}
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const [profile, setProfile] = useState({})
  const [units,   setUnits]   = useState('metric')
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [toast,   setToast]   = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  // Handle Strava OAuth redirect result
  useEffect(() => {
    const stravaResult = searchParams.get('strava')
    if (!stravaResult) return

    if (stravaResult === 'connected') {
      setToast('Strava connected! Importing your recent activities…')
      // Trigger initial backfill in the background
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.access_token) {
          fetch('/api/strava?action=sync&all=1', {
            method:  'POST',
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          }).catch(() => {})
        }
      })
    } else if (stravaResult === 'denied') {
      setToast('Strava connection cancelled.')
    } else if (stravaResult === 'error') {
      setToast(`Strava connection failed (${searchParams.get('reason') || 'unknown error'}).`)
    }

    // Clean up query params without re-rendering the whole page
    setSearchParams({}, { replace: true })
    const timer = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(timer)
  }, [])

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return session.access_token
  }

  useEffect(() => {
    getToken()
      .then(token => fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } }))
      .then(r => r.json())
      .then(data => {
        const p = data.profile || {}
        setProfile(p)
        setUnits(p.units || 'metric')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function startEdit() {
    setDraft({ ...profile })  // _height_ft/_height_in/_weight_lbs are populated lazily in FieldEdit
    setEditing(true)
    setError('')
  }

  function cancelEdit() {
    setEditing(false)
    setDraft({})
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      // Strip helper keys used only by imperial inputs
      const { _height_ft, _height_in, _weight_lbs, ...fields } = draft
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      setProfile({ ...profile, ...fields })
      setEditing(false)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const hasAnyData = Object.values(profile).some(Boolean)

  return (
    <div className="pp-page">
      {toast && (
        <div className="pp-toast">{toast}</div>
      )}
      <div className="pp-inner">
        <div className="pp-header">
          <h1 className="pp-title">Profile</h1>
          {!editing && !loading && (
            <button className="pp-edit-btn" onClick={startEdit}>Edit</button>
          )}
        </div>

        {loading ? (
          <div className="pp-loading">Loading…</div>
        ) : !hasAnyData && !editing ? (
          <div className="pp-empty">
            No profile data yet.{' '}
            <button className="pp-inline-link" onClick={startEdit}>Add your details</button>
          </div>
        ) : (
          FIELDS.map(({ section, rows }) => (
            <div key={section} className="pp-section">
              <h2 className="pp-section-title">{section}</h2>
              <div className="pp-card">
                {rows.map(field =>
                  editing
                    ? <FieldEdit
                        key={field.key}
                        field={field}
                        value={draft[field.key]}
                        units={units}
                        draft={draft}
                        onChange={(k, v) => setDraft(p => ({ ...p, [k]: v }))}
                        onChangeDraft={(k, v) => setDraft(p => ({ ...p, [k]: v }))}
                      />
                    : <FieldView key={field.key} field={field} value={profile[field.key]} units={units} />
                )}
              </div>
            </div>
          ))
        )}

        {editing && (
          <div className="pp-actions">
            {error && <p className="pp-error">{error}</p>}
            <button className="pp-btn secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button className="pp-btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}

        <div className="pp-section">
          <h2 className="pp-section-title">Connected apps</h2>
          <StravaCard />
        </div>
      </div>
    </div>
  )
}
