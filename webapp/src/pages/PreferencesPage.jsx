import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './ProfilePages.css'

const UNIT_OPTIONS = [
  { value: 'metric',   label: 'Metric',   hint: 'kg · cm' },
  { value: 'imperial', label: 'Imperial', hint: 'lbs · ft/in' },
]

const LOG_UNIT_OPTIONS = [
  { value: 'kg',  label: 'kg',  hint: 'e.g. bench 100 → 100 kg' },
  { value: 'lbs', label: 'lbs', hint: 'e.g. bench 225 → 225 lbs' },
]

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

export default function PreferencesPage() {
  const [saved,          setSaved]          = useState(false)
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')
  const [prefs,          setPrefs]          = useState({ units: 'metric', log_units: 'kg' })
  const [draft,          setDraft]          = useState({ units: 'metric', log_units: 'kg' })
  const [deleteState,    setDeleteState]    = useState('idle') // 'idle' | 'confirm' | 'done' | 'error'

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        const p = {
          units:     data.profile?.units     || 'metric',
          log_units: data.profile?.log_units || 'kg',
        }
        setPrefs(p)
        setDraft(p)
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
        body: JSON.stringify({ fields: draft }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      setPrefs(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function requestDeletion() {
    try {
      const token = await getToken()
      const res = await fetch('/api/request-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Request failed')
      setDeleteState('done')
    } catch {
      setDeleteState('error')
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(prefs)

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
              <h2 className="pp-section-title">Display units</h2>
              <div className="pp-card">
                <div className="pp-row">
                  <span className="pp-label">Weight &amp; height</span>
                  <div className="pp-options">
                    {UNIT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pp-option ${draft.units === opt.value ? 'selected' : ''}`}
                        onClick={() => { setDraft(d => ({ ...d, units: opt.value })); setSaved(false) }}
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
                Applies to your profile display and all coach responses.
              </p>
            </div>

            <div className="pp-section">
              <h2 className="pp-section-title">Logging unit</h2>
              <div className="pp-card">
                <div className="pp-row">
                  <span className="pp-label">When no unit is given</span>
                  <div className="pp-options">
                    {LOG_UNIT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pp-option ${draft.log_units === opt.value ? 'selected' : ''}`}
                        onClick={() => { setDraft(d => ({ ...d, log_units: opt.value })); setSaved(false) }}
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
                e.g. typing "bench 100" assumes 100 {draft.log_units}. Explicit units like "100kg" or "225lbs" always override this.
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

            <div className="pp-section">
              <h2 className="pp-section-title">Legal</h2>
              <div className="pp-card">
                <div className="pp-row">
                  <span className="pp-label">Privacy Policy</span>
                  <Link to="/privacy" className="pp-inline-link" style={{ fontSize: 13 }}>View →</Link>
                </div>
                <div className="pp-row">
                  <span className="pp-label">Terms of Use</span>
                  <Link to="/terms" className="pp-inline-link" style={{ fontSize: 13 }}>View →</Link>
                </div>
              </div>
            </div>

            <div className="pp-section">
              <h2 className="pp-section-title">Account</h2>
              <div className="pp-card">
                <div className="pp-row">
                  <span className="pp-label">Request account deletion</span>
                  <div>
                    {deleteState === 'idle' && (
                      <button className="pp-btn secondary" onClick={() => setDeleteState('confirm')}>
                        Request deletion
                      </button>
                    )}
                    {deleteState === 'confirm' && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Are you sure?</span>
                        <button className="pp-btn secondary" onClick={() => setDeleteState('idle')}>Cancel</button>
                        <button className="pp-btn primary" onClick={requestDeletion}>Confirm</button>
                      </div>
                    )}
                    {deleteState === 'done' && (
                      <span style={{ fontSize: 13, color: 'var(--accent)' }}>Request submitted. We'll respond within 30 days.</span>
                    )}
                    {deleteState === 'error' && (
                      <span style={{ fontSize: 13, color: 'var(--danger)' }}>Something went wrong. Email georgebiggs1@hotmail.com.</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="pp-pref-note">We will delete your data within 30 days of your request.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
