import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
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

function displayValue(key, value) {
  if (!value) return '—'
  if (key === 'height_cm') return `${value} cm`
  if (key === 'weight_kg') return `${value} kg`
  if (key === 'age')       return `${value}`
  return value
}

function FieldView({ field, value }) {
  return (
    <div className="pp-row">
      <span className="pp-label">{field.label}</span>
      <span className="pp-value">{displayValue(field.key, value)}</span>
    </div>
  )
}

function FieldEdit({ field, value, onChange }) {
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
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return session.access_token
  }

  useEffect(() => {
    getToken()
      .then(token => fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } }))
      .then(r => r.json())
      .then(data => { setProfile(data.profile || {}); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function startEdit() {
    setDraft({ ...profile })
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
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: draft }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      setProfile({ ...profile, ...draft })
      setEditing(false)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const hasAnyData = Object.values(profile).some(Boolean)

  return (
    <div className="pp-page">
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
                    ? <FieldEdit key={field.key} field={field} value={draft[field.key]} onChange={(k, v) => setDraft(p => ({ ...p, [k]: v }))} />
                    : <FieldView key={field.key} field={field} value={profile[field.key]} />
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
      </div>
    </div>
  )
}
