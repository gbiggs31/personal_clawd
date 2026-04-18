import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../utils/supabase.js'
import './ProfilePages.css'

export default function GoalsPage() {
  const [goals,   setGoals]   = useState('')
  const [draft,   setDraft]   = useState('')
  const [cycle,   setCycle]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return session.access_token
  }

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const [profileRes, { data: cycles }] = await Promise.all([
          fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
          supabase.from('cycles').select('*').eq('status', 'active').limit(1),
        ])
        const g = profileRes.profile?.goals || ''
        setGoals(g)
        setDraft(g)
        setCycle(cycles?.[0] || null)
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
        body: JSON.stringify({ fields: { goals: draft } }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      setGoals(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const cycleEnd    = cycle?.end_date ? new Date(cycle.end_date) : null
  const weeksLeft   = cycleEnd ? Math.max(0, Math.floor((cycleEnd - Date.now()) / (7 * 24 * 60 * 60 * 1000))) : null
  const isDirty     = draft !== goals

  return (
    <div className="pp-page">
      <div className="pp-inner">
        <div className="pp-header">
          <h1 className="pp-title">Goals</h1>
        </div>

        {loading ? (
          <div className="pp-loading">Loading…</div>
        ) : (
          <>
            <div className="pp-section">
              <h2 className="pp-section-title">What you're training for</h2>
              <div className="pp-card">
                <textarea
                  className="pp-goals-textarea"
                  value={draft}
                  onChange={e => { setDraft(e.target.value); setSaved(false) }}
                  placeholder="Describe your training goals — the more specific the better. e.g. Build muscle and hit a 140kg bench press by the end of the year."
                  rows={5}
                />
              </div>
              <div className="pp-actions inline">
                {error  && <p className="pp-error">{error}</p>}
                {saved  && <span className="pp-saved">Saved ✓</span>}
                <button
                  className="pp-btn primary"
                  onClick={save}
                  disabled={saving || !isDirty || !draft.trim()}
                >
                  {saving ? 'Saving…' : 'Save goals'}
                </button>
              </div>
            </div>

            {cycle && (
              <div className="pp-section">
                <h2 className="pp-section-title">
                  Active training cycle
                  {weeksLeft !== null && (
                    <span className="pp-cycle-meta">{weeksLeft} week{weeksLeft !== 1 ? 's' : ''} remaining</span>
                  )}
                </h2>
                <div className="pp-card">
                  <div className="pp-row">
                    <span className="pp-label">Started</span>
                    <span className="pp-value">{cycle.start_date}</span>
                  </div>
                  {cycle.end_date && (
                    <div className="pp-row">
                      <span className="pp-label">Ends</span>
                      <span className="pp-value">{cycle.end_date}</span>
                    </div>
                  )}
                  {cycle.goals && (
                    <div className="pp-row stacked">
                      <span className="pp-label">Cycle goals</span>
                      <span className="pp-value">{cycle.goals}</span>
                    </div>
                  )}
                </div>
                {cycle.workout_plan && (
                  <details className="pp-plan-details">
                    <summary className="pp-plan-summary">View programme</summary>
                    <div className="pp-plan-body">
                      <div className="pp-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{cycle.workout_plan}</ReactMarkdown>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}

            {!cycle && (
              <div className="pp-section">
                <h2 className="pp-section-title">Active training cycle</h2>
                <div className="pp-empty">No active training cycle.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
