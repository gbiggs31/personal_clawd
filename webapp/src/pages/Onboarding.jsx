import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Onboarding.css'

const TOTAL_STEPS = 3

function StepConsent({ consent, onChange }) {
  return (
    <div className="ob-step">
      <h2 className="ob-step-title">Before you start</h2>
      <p className="ob-step-sub">Please review and agree to the following to continue.</p>

      <div className="ob-consent-items">
        <label className="ob-consent-item">
          <input
            type="checkbox"
            checked={consent.privacy}
            onChange={e => onChange('privacy', e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <Link to="/privacy" target="_blank" className="ob-link">Privacy Policy</Link>
          </span>
        </label>

        <label className="ob-consent-item">
          <input
            type="checkbox"
            checked={consent.terms}
            onChange={e => onChange('terms', e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" target="_blank" className="ob-link">Terms of Use</Link>
          </span>
        </label>

        <label className="ob-consent-item">
          <input
            type="checkbox"
            checked={consent.beta}
            onChange={e => onChange('beta', e.target.checked)}
          />
          <span>I understand this is a beta product and not medical advice</span>
        </label>
      </div>
    </div>
  )
}

// ── Step components ───────────────────────────────────────────────────────────

function StepAboutYou({ data, onChange, units, onUnitsChange }) {
  return (
    <div className="ob-step">
      <h2 className="ob-step-title">About you</h2>
      <p className="ob-step-sub">This helps personalise your training plan and today's recommendations.</p>

      <div className="ob-fields">
        <div className="ob-field-row">
          <label className="ob-label">
            Units
          </label>
          <div className="ob-options">
            <button type="button" className={`ob-option ${units === 'metric'   ? 'selected' : ''}`} onClick={() => onUnitsChange('metric')}>Metric</button>
            <button type="button" className={`ob-option ${units === 'imperial' ? 'selected' : ''}`} onClick={() => onUnitsChange('imperial')}>Imperial</button>
          </div>
        </div>

        <div className="ob-field-row">
          <label className="ob-label">Age</label>
          <input
            className="ob-input short"
            type="number"
            min="10" max="100"
            placeholder="e.g. 28"
            value={data.age || ''}
            onChange={e => onChange('age', e.target.value)}
          />
        </div>

        <div className="ob-field-row">
          <label className="ob-label">Sex</label>
          <div className="ob-options">
            {['Male', 'Female', 'Prefer not to say'].map(opt => (
              <button
                key={opt}
                type="button"
                className={`ob-option ${data.sex === opt.toLowerCase() ? 'selected' : ''}`}
                onClick={() => onChange('sex', opt.toLowerCase())}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="ob-field-row">
          <label className="ob-label">Height</label>
          {units === 'metric' ? (
            <div className="ob-input-with-unit">
              <input
                className="ob-input short"
                type="number"
                min="100" max="250"
                placeholder="e.g. 178"
                value={data.height_cm || ''}
                onChange={e => onChange('height_cm', e.target.value)}
              />
              <span className="ob-unit">cm</span>
            </div>
          ) : (
            <div className="ob-ft-in">
              <div className="ob-input-with-unit">
                <input
                  className="ob-input short"
                  type="number"
                  min="3" max="8"
                  placeholder="5"
                  value={data.height_ft || ''}
                  onChange={e => onChange('height_ft', e.target.value)}
                />
                <span className="ob-unit">ft</span>
              </div>
              <div className="ob-input-with-unit">
                <input
                  className="ob-input short"
                  type="number"
                  min="0" max="11"
                  placeholder="10"
                  value={data.height_in || ''}
                  onChange={e => onChange('height_in', e.target.value)}
                />
                <span className="ob-unit">in</span>
              </div>
            </div>
          )}
        </div>

        <div className="ob-field-row">
          <label className="ob-label">Weight</label>
          {units === 'metric' ? (
            <div className="ob-input-with-unit">
              <input
                className="ob-input short"
                type="number"
                min="30" max="300"
                step="0.5"
                placeholder="e.g. 83"
                value={data.weight_kg || ''}
                onChange={e => onChange('weight_kg', e.target.value)}
              />
              <span className="ob-unit">kg</span>
            </div>
          ) : (
            <div className="ob-input-with-unit">
              <input
                className="ob-input short"
                type="number"
                min="66" max="660"
                step="1"
                placeholder="e.g. 183"
                value={data.weight_lbs || ''}
                onChange={e => onChange('weight_lbs', e.target.value)}
              />
              <span className="ob-unit">lbs</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepExperience({ data, onChange }) {
  const levels   = ['Beginner', 'Intermediate', 'Advanced']
  const durations = ['Under 1 year', '1–2 years', '2–5 years', '5+ years']

  return (
    <div className="ob-step">
      <h2 className="ob-step-title">Training background</h2>
      <p className="ob-step-sub">Helps calibrate load suggestions and progression speed.</p>

      <div className="ob-fields">
        <div className="ob-field-row">
          <label className="ob-label">Experience level</label>
          <div className="ob-options">
            {levels.map(l => (
              <button
                key={l}
                type="button"
                className={`ob-option ${data.experience_level === l.toLowerCase() ? 'selected' : ''}`}
                onClick={() => onChange('experience_level', l.toLowerCase())}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="ob-field-row">
          <label className="ob-label">How long have you been training?</label>
          <div className="ob-options wrap">
            {durations.map(d => (
              <button
                key={d}
                type="button"
                className={`ob-option ${data.experience_years === d ? 'selected' : ''}`}
                onClick={() => onChange('experience_years', d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="ob-field-row">
          <label className="ob-label">
            Training style
            <span className="ob-optional">optional</span>
          </label>
          <textarea
            className="ob-textarea"
            placeholder="e.g. PPL 4 days a week, focus on powerlifting compounds"
            value={data.training_notes || ''}
            onChange={e => onChange('training_notes', e.target.value)}
            rows={2}
          />
        </div>
      </div>
    </div>
  )
}

function StepGoals({ data, onChange }) {
  return (
    <div className="ob-step">
      <h2 className="ob-step-title">Goals &amp; constraints</h2>
      <p className="ob-step-sub">The more specific, the better your coaching will be.</p>

      <div className="ob-fields">
        <div className="ob-field-row">
          <label className="ob-label">What are you training for?</label>
          <textarea
            className="ob-textarea"
            placeholder="e.g. Build muscle and hit a 140kg bench press by end of year. I train 4 days a week."
            value={data.goals || ''}
            onChange={e => onChange('goals', e.target.value)}
            rows={3}
          />
        </div>

        <div className="ob-field-row">
          <label className="ob-label">
            Gym &amp; equipment
            <span className="ob-optional">optional</span>
          </label>
          <textarea
            className="ob-textarea"
            placeholder="e.g. Full commercial gym with cable machines, or home gym with barbell and rack"
            value={data.equipment || ''}
            onChange={e => onChange('equipment', e.target.value)}
            rows={2}
          />
        </div>

        <div className="ob-field-row">
          <label className="ob-label">
            Injuries or limitations
            <span className="ob-optional">optional</span>
          </label>
          <textarea
            className="ob-textarea"
            placeholder="e.g. Left shoulder impingement, avoid overhead pressing for now"
            value={data.chronic_injuries || ''}
            onChange={e => onChange('chronic_injuries', e.target.value)}
            rows={2}
          />
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [units, setUnits]   = useState('metric')
  const [consent, setConsent] = useState({ privacy: false, terms: false, beta: false })
  const [data, setData]     = useState({
    age: '', sex: '', height_cm: '', weight_kg: '',
    height_ft: '', height_in: '', weight_lbs: '',
    experience_level: '', experience_years: '', training_notes: '',
    goals: '', equipment: '', chronic_injuries: '',
  })

  function handleChange(key, value) {
    setData(prev => ({ ...prev, [key]: value }))
  }

  function canAdvance() {
    if (step === 0) return consent.privacy && consent.terms && consent.beta
    if (step === 1) return true // all optional on step 1
    if (step === 2) return true // all optional on step 2
    if (step === 3) return data.goals.trim().length > 0
    return false
  }

  async function handleConsentContinue() {
    setSaving(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        await fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            privacy_accepted: consent.privacy,
            terms_accepted: consent.terms,
            beta_acknowledged: consent.beta,
          }),
        })
      }
    } catch { /* non-blocking */ }
    setSaving(false)
    setStep(1)
  }

  async function handleFinish() {
    setSaving(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      // Build metric fields — convert imperial if needed
      const fields = { ...data }
      delete fields.height_ft; delete fields.height_in; delete fields.weight_lbs

      if (units === 'imperial') {
        const ft  = parseFloat(data.height_ft) || 0
        const ins = parseFloat(data.height_in) || 0
        if (ft || ins) fields.height_cm = String(Math.round((ft * 12 + ins) * 2.54))

        const lbs = parseFloat(data.weight_lbs)
        if (lbs) fields.weight_kg = String(Math.round(lbs * 0.453592 * 10) / 10)
      }

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save profile')

      // Mark onboarding complete in sessionStorage so ProfileGate doesn't re-check
      sessionStorage.setItem('avenra-profile-ok', '1')
      navigate('/log', { replace: true })
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function next() {
    if (step === 0) { handleConsentContinue(); return }
    if (step < TOTAL_STEPS) setStep(s => s + 1)
    else handleFinish()
  }

  function back() {
    if (step > 0) setStep(s => s - 1)
  }

  const stepComponents = [
    <StepConsent key={0} consent={consent} onChange={(k, v) => setConsent(p => ({ ...p, [k]: v }))} />,
    <StepAboutYou key={1} data={data} onChange={handleChange} units={units} onUnitsChange={setUnits} />,
    <StepExperience key={2} data={data} onChange={handleChange} />,
    <StepGoals key={3} data={data} onChange={handleChange} />,
  ]

  const isLastStep = step === TOTAL_STEPS

  return (
    <div className="ob-page">
      <div className="ob-card">
        {/* Header */}
        <div className="ob-header">
          <div className="ob-logo">Ave<span>nra</span></div>
          <p className="ob-welcome">Let's set up your profile</p>
        </div>

        {/* Progress bar (only shown for steps 1–3) */}
        {step > 0 && (
          <div className="ob-progress">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`ob-progress-dot ${i + 1 <= step ? 'done' : ''}`}
              />
            ))}
            <div
              className="ob-progress-bar"
              style={{ width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
            />
          </div>
        )}

        {/* Step content */}
        <div className="ob-content">
          {stepComponents[step]}
        </div>

        {error && <p className="ob-error">{error}</p>}

        {/* Navigation */}
        <div className="ob-nav">
          {step > 1 ? (
            <button className="ob-btn secondary" onClick={back} disabled={saving}>
              Back
            </button>
          ) : (
            <div />
          )}
          <button
            className="ob-btn primary"
            onClick={next}
            disabled={saving || !canAdvance()}
          >
            {saving ? 'Saving…' : isLastStep ? 'Start training' : 'Continue'}
          </button>
        </div>

        {/* Skip (not shown on consent step or last step) */}
        {step > 0 && !isLastStep && (
          <button
            className="ob-skip"
            onClick={() => setStep(s => s + 1)}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  )
}
