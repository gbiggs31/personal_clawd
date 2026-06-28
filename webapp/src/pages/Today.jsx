import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import { buildExerciseHistory, compareTopSets, normalizeExercise } from '../utils/training.js'
import StravaContextCard from '../components/StravaContextCard.jsx'
import './Today.css'

const SESSION_KEY   = 'avenra-session'
const PLAN_KEY      = 'avenra-active-plan'
const HISTORY_CACHE = 'avenra-history'
const ONBOARDED_KEY = 'avenra-onboarded'

const QUIZ_STEPS = [
  {
    key: 'split',
    question: 'What kind of sessions do you prefer?',
    options: [
      { value: 'ppl',       label: 'Push / Pull / Legs', hint: 'Classic 3-way split' },
      { value: 'full_body', label: 'Full Body',           hint: 'Each session hits everything' },
      { value: 'upper_lower', label: 'Upper / Lower',    hint: '2-way split' },
    ],
  },
  {
    key: 'duration',
    question: 'How long do you have per session?',
    options: [
      { value: '30-45',  label: '30 – 45 min', hint: 'Efficient, focused' },
      { value: '45-60',  label: '45 – 60 min', hint: 'Standard session' },
      { value: '60-90',  label: '60 – 90 min', hint: 'Full session' },
    ],
  },
  {
    key: 'goal',
    question: "What's your main goal?",
    options: [
      { value: 'strength', label: 'Build Strength',  hint: 'Heavier lifts, lower reps' },
      { value: 'muscle',   label: 'Build Muscle',    hint: 'Hypertrophy, volume focus' },
      { value: 'fitness',  label: 'General Fitness', hint: 'Health & conditioning' },
    ],
  },
]

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

// Shorten long session type labels for the chip
function shortType(type) {
  if (!type) return '—'
  const map = { 'Upper Body': 'Upper', 'Full Body': 'Full', 'Lower Body': 'Lower' }
  return map[type] || type
}

function typeClass(type) {
  if (!type) return ''
  const t = type.toLowerCase()
  if (t.includes('push'))  return 'type-push'
  if (t.includes('pull'))  return 'type-pull'
  if (t.includes('leg'))   return 'type-legs'
  if (t.includes('upper')) return 'type-upper'
  if (t.includes('full'))  return 'type-full'
  if (t.includes('cardio') || t.includes('run')) return 'type-cardio'
  return 'type-other'
}

function WeekStrip() {
  const [days,     setDays]     = useState([])
  const [expanded, setExpanded] = useState(null)
  const [stuck,    setStuck]    = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    async function load() {
      // Cache for the calendar day
      const today = new Date().toISOString().split('T')[0]
      const cacheKey = `${HISTORY_CACHE}-${today}`
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try { buildDays(JSON.parse(cached)); return } catch {}
      }
      try {
        const token = await getToken()
        const res   = await fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json()
        sessionStorage.setItem(cacheKey, JSON.stringify(data.sessions || []))
        buildDays(data.sessions || [])
      } catch {}
    }

    function buildDays(sessions) {
      const map = {}
      for (const s of sessions) map[s.date] = s

      const result = []
      for (let i = 0; i < 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]
        const label   = i === 0 ? 'Today'
          : d.toLocaleDateString('en-US', { weekday: 'short' })
        result.push({ date: dateStr, label, session: map[dateStr] || null })
      }
      setDays(result)
    }

    load()
  }, [])

  // Detect when the strip becomes sticky (sentinel scrolls out of view)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0, rootMargin: `-${Math.round(56)}px 0px 0px 0px` }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!days.length) return null

  const expandedDay = days.find(d => d.date === expanded)

  return (
    <>
      <div ref={sentinelRef} style={{ height: 1, marginBottom: -1 }} aria-hidden="true" />
      <div className={`week-strip${stuck ? ' is-stuck' : ''}`}>
      <div className="week-row">
        {days.map(d => {
          const tClass   = typeClass(d.session?.session_type)
          const isActive = expanded === d.date
          return (
            <button
              key={d.date}
              className={`week-chip ${tClass}${isActive ? ' active' : ''}${!d.session ? ' rest' : ''}`}
              onClick={() => d.session && setExpanded(isActive ? null : d.date)}
              disabled={!d.session}
            >
              <span className="week-chip-day">{d.label}</span>
              <span className="week-chip-type">{shortType(d.session?.session_type)}</span>
            </button>
          )
        })}
      </div>

      {expandedDay?.session && (
        <div className="week-detail">
          <div className="week-detail-top">
            <span className={`week-detail-type ${typeClass(expandedDay.session.session_type)}`}>
              {expandedDay.session.session_type}
            </span>
            {expandedDay.session.duration_mins && (
              <span className="week-detail-meta">{expandedDay.session.duration_mins} min</span>
            )}
          </div>
          {expandedDay.session.overall_note && (
            <p className="week-detail-note">{expandedDay.session.overall_note}</p>
          )}
        </div>
      )}
      </div>
    </>
  )
}

// Format a set's weight × reps in the user's unit. Stored weights are kg;
// the plan card already shows imperial users lbs, so match that here.
function fmtSet(set, units) {
  const reps = set.reps ?? '?'
  if (set.weight_kg == null) return `BW × ${reps}`
  const w = units === 'imperial' ? `${Math.round(set.weight_kg * 2.20462)}lbs` : `${set.weight_kg}kg`
  return `${w} × ${reps}`
}

function fmtShortDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// "last time" recall for a single plan exercise, expandable to recent sessions.
function LastTime({ sessions, units }) {
  const [open, setOpen] = useState(false)
  if (!sessions?.length) return null
  const recent = sessions.slice(0, 3)
  const top = recent[0].topSet
  if (!top) return null
  const delta = compareTopSets(recent[0].topSet, recent[1]?.topSet)

  return (
    <div className="today-lasttime">
      <button
        type="button"
        className="today-lasttime-summary"
        onClick={() => sessions.length > 1 && setOpen(o => !o)}
        style={{ cursor: sessions.length > 1 ? 'pointer' : 'default' }}
      >
        <span className="tlt-label">last time</span>
        <span className="tlt-value">{fmtSet(top, units)}</span>
        {delta && (
          <span className={`tlt-delta ${delta.direction}`}>
            {delta.direction === 'up' && '↑'}
            {delta.direction === 'down' && '↓'}
            {delta.direction === 'flat' && '='}
            {units !== 'imperial' ? ` ${delta.text}` : ''}
          </span>
        )}
        {sessions.length > 1 && <span className="tlt-chev">{open ? '▾' : '▸'}</span>}
      </button>
      {open && (
        <div className="today-lasttime-detail">
          {recent.map(s => (
            <div key={s.session_id} className="tlt-row">
              <span className="tlt-date">{fmtShortDate(s.date)}</span>
              <span className="tlt-sets">{s.sets.map(set => fmtSet(set, units)).join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TodaySessionCard({ plan, loading, onRefresh, history }) {
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
        <button className="today-refresh-btn" onClick={() => onRefresh()} title="Regenerate plan">↻</button>
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
              <LastTime sessions={history?.[normalizeExercise(ex.name)]} units={plan.units} />
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
  const [planLoading, setPlanLoading]   = useState(false)
  const [exHistory, setExHistory]       = useState({})   // normEx → recent sessions
  const [showModify,  setShowModify]    = useState(false)
  const [showSuggest, setShowSuggest]   = useState(false)
  const [modifyText,  setModifyText]    = useState('')
  const [suggestText, setSuggestText]   = useState('')
  const [modifying,   setModifying]     = useState(false)
  const [modifyError, setModifyError]   = useState('')

  // Onboarding flow
  const [onboardStep, setOnboardStep]   = useState(() => localStorage.getItem(ONBOARDED_KEY) ? null : 'welcome')
  const [quizStep,    setQuizStep]      = useState(0)
  const [quizAnswers, setQuizAnswers]   = useState({})
  const [quizLoading, setQuizLoading]   = useState(false)

  async function loadPlan() {
    setPlanLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setPlanLoading(false); return }
      const res = await fetch('/api/today-plan', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const plan = await res.json()
      setSessionPlan(plan)
    } catch (err) {
      console.error('Today plan:', err)
    } finally {
      setPlanLoading(false)
    }
  }

  // Load recent set history (for the "last time" hints) — independent of the plan.
  async function loadHistory() {
    try {
      const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().split('T')[0]
      const { data } = await supabase
        .from('sets')
        .select('exercise, weight_kg, reps, rpe, rir, set_num, date, session_id, note, injury_flag, injury_body_part')
        .gte('date', cutoff)
        .order('date')
      setExHistory(buildExerciseHistory(data || []))
    } catch { /* non-fatal — hints just won't show */ }
  }

  useEffect(() => {
    // Only auto-load for returning users
    if (!onboardStep) {
      loadPlan()
      loadHistory()
    }
  }, [])

  function completeOnboarding() {
    localStorage.setItem(ONBOARDED_KEY, '1')
    setOnboardStep(null)
  }

  function skipToLog() {
    completeOnboarding()
    navigate('/log')
  }

  async function finishQuiz(answers) {
    setQuizLoading(true)
    const splitLabel = { ppl: 'Push/Pull/Legs split', full_body: 'Full body sessions', upper_lower: 'Upper/Lower split' }[answers.split] || ''
    const goalLabel  = { strength: 'building strength (heavier, lower reps)', muscle: 'building muscle (hypertrophy, volume focus)', fitness: 'general fitness and conditioning' }[answers.goal] || ''
    const trainingNotes = `${splitLabel}. Sessions typically ${answers.duration} minutes. Goal: ${goalLabel}.`
    try {
      const token = await getToken()
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: { training_notes: trainingNotes } }),
      })
    } catch {}
    completeOnboarding()
    setOnboardStep('plan')
    await loadPlan()
    loadHistory()
    setOnboardStep(null)
    setQuizLoading(false)
  }

  function selectQuizOption(value) {
    const step  = QUIZ_STEPS[quizStep]
    const next  = { ...quizAnswers, [step.key]: value }
    setQuizAnswers(next)
    if (quizStep < QUIZ_STEPS.length - 1) {
      setQuizStep(q => q + 1)
    } else {
      finishQuiz(next)
    }
  }

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

  // ── Onboarding: welcome screen ──────────────────────────────────
  if (onboardStep === 'welcome') {
    return (
      <main className="today-main">
        <section className="onboard-card">
          <div className="onboard-logo">Ave<span>nra</span></div>
          <h1 className="onboard-title">Welcome to Avenra</h1>
          <p className="onboard-sub">Your AI training coach</p>
          <ul className="onboard-features">
            <li><span className="onboard-check">✓</span> Build today's workout from your history</li>
            <li><span className="onboard-check">✓</span> Log sets in plain English</li>
            <li><span className="onboard-check">✓</span> Adapt based on how you're progressing</li>
          </ul>
          <div className="onboard-actions">
            <button className="today-action-btn primary" onClick={() => setOnboardStep('quiz')}>
              Generate My First Workout
            </button>
            <button className="today-action-btn ghost" onClick={skipToLog}>
              I already have a programme
            </button>
          </div>
        </section>
      </main>
    )
  }

  // ── Onboarding: quiz ────────────────────────────────────────────
  if (onboardStep === 'quiz') {
    const step = QUIZ_STEPS[quizStep]
    return (
      <main className="today-main">
        <section className="onboard-card quiz">
          <div className="onboard-quiz-progress">
            {QUIZ_STEPS.map((_, i) => (
              <div key={i} className={`onboard-quiz-dot${i <= quizStep ? ' active' : ''}`} />
            ))}
          </div>
          <h2 className="onboard-quiz-question">{step.question}</h2>
          <div className="onboard-quiz-options">
            {step.options.map(opt => (
              <button
                key={opt.value}
                className="onboard-quiz-option"
                onClick={() => selectQuizOption(opt.value)}
                disabled={quizLoading}
              >
                <span className="onboard-quiz-label">{opt.label}</span>
                <span className="onboard-quiz-hint">{opt.hint}</span>
              </button>
            ))}
          </div>
          {quizStep > 0 && (
            <button className="onboard-back" onClick={() => setQuizStep(q => q - 1)}>← Back</button>
          )}
        </section>
      </main>
    )
  }

  // ── Onboarding: generating plan ─────────────────────────────────
  if (onboardStep === 'plan') {
    return (
      <main className="today-main">
        <section className="onboard-card">
          <div className="onboard-generating">
            <div className="onboard-spinner" />
            <p>Building your first workout…</p>
          </div>
        </section>
      </main>
    )
  }

  // ── Normal returning-user view ──────────────────────────────────
  return (
    <main className="today-main">
      <WeekStrip />

      <StravaContextCard />

      <TodaySessionCard
        plan={sessionPlan}
        loading={planLoading}
        onRefresh={() => loadPlan()}
        history={exHistory}
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
              <button className="today-action-btn ghost" onClick={() => navigate('/log')}>
                Open log and add an exercise
              </button>
              <div className="today-actions-row2">
                <button className="today-action-btn secondary" onClick={() => setShowModify(true)}>
                  Modify plan
                </button>
                <button className="today-action-btn secondary" onClick={() => setShowSuggest(true)}>
                  Suggest plan
                </button>
                <button className="today-action-btn secondary" onClick={() => navigate('/log', { state: { mode: 'chat' } })}>
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
