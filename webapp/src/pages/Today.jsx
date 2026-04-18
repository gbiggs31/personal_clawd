import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Today.css'

const SESSION_KEY = 'avenra-session'
const PLAN_KEY    = 'avenra-active-plan'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

function TodaySessionCard({ plan, loading, onRefresh }) {
  if (loading) {
    return (
      <section className="today-session-card">
        <div className="today-session-skeleton">Generating today's plan…</div>
      </section>
    )
  }

  if (!plan) return null

  return (
    <section className="today-session-card">
      <div className="today-session-header">
        <div>
          <div className="eyebrow">Today</div>
          <h2 className="today-session-title">{plan.workoutType}</h2>
          <div className="today-session-meta">
            {plan.focus && <span>{plan.focus}</span>}
            {plan.estimatedDurationMin && <span> · ~{plan.estimatedDurationMin} min</span>}
          </div>
        </div>
        <button className="today-refresh-btn" onClick={onRefresh} title="Regenerate plan">↻</button>
      </div>

      {plan.exercises?.length > 0 && (
        <div className="today-exercise-list">
          {plan.exercises.map((ex, i) => (
            <div key={`${ex.name}-${i}`} className={`today-exercise-row${ex.isPriority ? ' priority' : ''}`}>
              <div className="today-exercise-name-row">
                <span className="today-exercise-name">{ex.name}</span>
                {ex.isPriority && <span className="today-priority-badge">Priority</span>}
              </div>
              <div className="today-exercise-prescription">
                {ex.weightKg != null
                  ? `${ex.weightKg}${plan.units === 'imperial' ? 'lbs' : 'kg'}`
                  : 'BW'}
                {' · '}
                {ex.sets} sets
                {' · '}
                {ex.repTargets?.join(' / ')}
              </div>
              {ex.note && <div className="today-exercise-note">{ex.note}</div>}
            </div>
          ))}
        </div>
      )}

      {plan.coachingNotes?.length > 0 && (
        <div className="today-coaching-box">
          <div className="today-coaching-title">Coaching notes</div>
          <ul className="today-coaching-list">
            {plan.coachingNotes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

export default function Today() {
  const navigate = useNavigate()
  const [sessionPlan, setSessionPlan]   = useState(null)
  const [planLoading, setPlanLoading]   = useState(true)
  const [showModify,  setShowModify]    = useState(false)
  const [showSuggest, setShowSuggest]   = useState(false)
  const [modifyText,  setModifyText]    = useState('')
  const [suggestText, setSuggestText]   = useState('')
  const [modifying,   setModifying]     = useState(false)
  const [modifyError, setModifyError]   = useState('')

  const today    = new Date().toISOString().split('T')[0]
  const cacheKey = `avenra-plan-${today}`

  async function loadPlan(forceRefresh = false) {
    setPlanLoading(true)
    if (!forceRefresh) {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try { setSessionPlan(JSON.parse(cached)); setPlanLoading(false); return } catch {}
      }
    } else {
      sessionStorage.removeItem(cacheKey)
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setPlanLoading(false); return }
      const res = await fetch('/api/today-plan', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const plan = await res.json()
      setSessionPlan(plan)
      sessionStorage.setItem(cacheKey, JSON.stringify(plan))
    } catch (err) {
      console.error('Today plan:', err)
    } finally {
      setPlanLoading(false)
    }
  }

  useEffect(() => { loadPlan() }, [])

  function beginSession() {
    const sessionId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: sessionId, startedAt }))
    localStorage.setItem(PLAN_KEY, JSON.stringify({
      sessionId,
      startedAt,
      exercises: sessionPlan?.exercises || [],
      loggedSets: {},
    }))
    navigate('/log')
  }

  async function submitModification() {
    if (!modifyText.trim()) return
    setModifying(true)
    setModifyError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/today-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPlan: sessionPlan, modification: modifyText }),
      })
      if (!res.ok) throw new Error('Failed to update plan')
      const updated = await res.json()
      setSessionPlan(updated)
      sessionStorage.setItem(cacheKey, JSON.stringify(updated))
      setModifyText('')
      setShowModify(false)
    } catch (err) {
      setModifyError(err.message)
    }
    setModifying(false)
  }

  function submitSuggestion() {
    const exercises = suggestText.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map((name, i) => ({ name, sets: null, repTargets: null, weightKg: null, isPriority: i === 0 }))
    if (!exercises.length) return
    const sessionId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: sessionId, startedAt }))
    localStorage.setItem(PLAN_KEY, JSON.stringify({ sessionId, startedAt, exercises, loggedSets: {} }))
    navigate('/log')
  }

  return (
    <main className="today-main">
      <TodaySessionCard
        plan={sessionPlan}
        loading={planLoading}
        onRefresh={() => loadPlan(true)}
      />

      {sessionPlan && !planLoading && (
        <div className="today-actions-section">

          {showModify && (
            <div className="today-inline-form">
              <textarea
                className="today-inline-textarea"
                placeholder="e.g. swap squats for leg press, add face pulls at the end"
                value={modifyText}
                onChange={e => setModifyText(e.target.value)}
                rows={3}
                autoFocus
              />
              {modifyError && <p className="today-inline-error">{modifyError}</p>}
              <div className="today-inline-row">
                <button className="today-inline-cancel" onClick={() => { setShowModify(false); setModifyText(''); setModifyError('') }}>
                  Cancel
                </button>
                <button
                  className="today-inline-submit"
                  onClick={submitModification}
                  disabled={modifying || !modifyText.trim()}
                >
                  {modifying ? 'Updating…' : 'Update plan'}
                </button>
              </div>
            </div>
          )}

          {showSuggest && (
            <div className="today-inline-form">
              <p className="today-inline-label">Enter exercises (one per line)</p>
              <textarea
                className="today-inline-textarea"
                placeholder={'Bench Press\nIncline DB Press\nTricep Pushdown\nCable Fly'}
                value={suggestText}
                onChange={e => setSuggestText(e.target.value)}
                rows={5}
                autoFocus
              />
              <div className="today-inline-row">
                <button className="today-inline-cancel" onClick={() => { setShowSuggest(false); setSuggestText('') }}>
                  Cancel
                </button>
                <button
                  className="today-inline-submit"
                  onClick={submitSuggestion}
                  disabled={!suggestText.trim()}
                >
                  Start with this plan
                </button>
              </div>
            </div>
          )}

          {!showModify && !showSuggest && (
            <div className="today-actions">
              <button className="today-action-btn primary" onClick={beginSession}>
                Begin session
              </button>
              <div className="today-actions-row2">
                <button className="today-action-btn secondary" onClick={() => setShowModify(true)}>
                  Modify plan
                </button>
                <button className="today-action-btn secondary" onClick={() => setShowSuggest(true)}>
                  Suggest plan
                </button>
                <button className="today-action-btn ghost" onClick={() => navigate('/log', { state: { mode: 'chat' } })}>
                  Ask coach
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </main>
  )
}
