import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Today.css'

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
        <div className="today-session-actions">
          <button className="today-refresh-btn" onClick={onRefresh} title="Regenerate plan">↻</button>
          <Link to="/chat" className="today-chat-btn">Ask Avenra</Link>
        </div>
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
                {ex.weightKg != null ? `${ex.weightKg}kg` : 'BW'}
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
  const [sessionPlan, setSessionPlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(true)

  async function loadPlan(forceRefresh = false) {
    setPlanLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const cacheKey = `avenra-plan-${today}`

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

  return (
    <main className="today-main">
      <TodaySessionCard
        plan={sessionPlan}
        loading={planLoading}
        onRefresh={() => loadPlan(true)}
      />
    </main>
  )
}
