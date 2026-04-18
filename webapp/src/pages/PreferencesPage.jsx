import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './ProfilePages.css'

const UNIT_OPTIONS = [
  { value: 'metric',   label: 'Metric',   hint: 'kg · cm' },
  { value: 'imperial', label: 'Imperial', hint: 'lbs · ft/in' },
]

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

export default function PreferencesPage() {
  const [units,   setUnits]   = useState('metric')
  const [draft,   setDraft]   = useState('metric')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        const u = data.profile?.units || 'metric'
        setUnits(u)
        setDraft(u)
      } catch { /* fail silently */ }
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: { units: draft } }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      setUnits(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const isDirty = draft !== units

  return (
    <div className="pp-page">
      <div className="pp-inner">
        <div className="pp-header">
          <h1 className="pp-title">Preferences</h1>
        </div>

        {loading ? (
          <div className="pp-loading">Loading…</div>
        ) : (
          <>
            <div className="pp-section">
              <h2 className="pp-section-title">Units</h2>
              <div className="pp-card">
                <div className="pp-row">
                  <span className="pp-label">Weight &amp; height</span>
                  <div className="pp-options">
                    {UNIT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pp-option ${draft === opt.value ? 'selected' : ''}`}
                        onClick={() => { setDraft(opt.value); setSaved(false) }}
                      >
                        {opt.label}
                        <span style={{ marginLeft: 5, opacity: 0.6, fontSize: 11 }}>
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="pp-pref-note">
                Applies to your profile display and all responses from the coach.
              </p>
              <div className="pp-actions inline">
                {error && <p className="pp-error">{error}</p>}
                {saved && <span className="pp-saved">Saved ✓</span>}
                <button
                  className="pp-btn primary"
                  onClick={save}
                  disabled={saving || !isDirty}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
