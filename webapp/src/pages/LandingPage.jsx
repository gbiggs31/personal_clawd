import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './LandingPage.css'

const SUPABASE_URL  = 'https://hluyixpmyomnxsjtqhxb.supabase.co'
const SUPABASE_ANON = 'sb_publishable_xrl5q_lnzUS4bQ5AmHflWQ_b6LEUWej'

export default function LandingPage() {
  const [botStatus, setBotStatus] = useState('neutral') // 'neutral' | 'online' | 'offline'
  const [email, setEmail]         = useState('')
  const [sent, setSent]           = useState(false)
  const [sendError, setSendError] = useState('')
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    async function checkBotStatus() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/heartbeat?id=eq.1&select=updated_at`,
          { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
        )
        const data = await res.json()
        if (data.length && data[0].updated_at) {
          const age = (Date.now() - new Date(data[0].updated_at)) / 1000
          setBotStatus(age < 600 ? 'online' : 'offline')
        }
      } catch {
        // leave as neutral
      }
    }
    checkBotStatus()
    const id = setInterval(checkBotStatus, 60000)
    return () => clearInterval(id)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setSendError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setLoading(false)
    if (err) setSendError(err.message)
    else setSent(true)
  }

  return (
    <div className="landing-root">
      <nav className="l-nav">
        <div className="nav-inner">
          <a href="#top" className="nav-logo">Ave<span>nra</span></a>
          <div className="nav-links">
            <a className="nav-link" href="#why">Why Avenra</a>
            <a className="nav-link" href="#features">Features</a>
            <a className="nav-link" href="#register">Early access</a>
            <div className={`bot-status ${botStatus}`}>
              <span className="bot-status-dot" />
              <span className="bot-status-text">
                {botStatus === 'online' ? 'Online' : botStatus === 'offline' ? 'Offline' : 'Bot'}
              </span>
            </div>
            <a className="nav-cta" href="#register">Register interest</a>
          </div>
          <a href="#register" className="nav-cta mobile-cta">Register interest</a>
        </div>
      </nav>

      <main id="top">
        {/* Hero */}
        <section className="hero">
          <div className="l-container hero-grid">
            <div>
              <div className="eyebrow">Built for serious lifters</div>
              <h1>Talk to your<br />gym log.</h1>
              <p className="hero-subtitle">
                Avenra turns natural-language workout messages into structured training data, then uses that history to answer questions, spot trends, and help you train more intelligently.
              </p>

              <div className="hero-proof">
                <div className="proof-card">
                  <strong>Less logging friction</strong>
                  <span>No tapping through menus mid-session.</span>
                </div>
                <div className="proof-card">
                  <strong>Real structured history</strong>
                  <span>Sets, reps, loads, notes, and trends you can trust.</span>
                </div>
                <div className="proof-card">
                  <strong>Coaching with context</strong>
                  <span>Advice grounded in your actual training, not generic content.</span>
                </div>
              </div>

              <div className="hero-actions">
                <a href="#register" className="btn-primary">Join the early access list</a>
                <a href="#features" className="btn-secondary">See how it works</a>
              </div>
              <p className="hero-note">Private alpha now. Early testers will help shape the product.</p>
            </div>

            <div className="demo-card" aria-label="Avenra demo conversation">
              <div className="demo-top">
                <span>Avenra</span>
                <span>Telegram-based alpha</span>
              </div>
              <div className="chat-bubble chat-user">
                Bench press 42.5kg for 10, 8, 7. Incline dumbbell press 25s for 12, 10, 9 RPE 8. Left shoulder a bit tight.
              </div>
              <div className="chat-bubble chat-ai">
                <strong>Logged.</strong><br />
                Bench press — 42.5kg × 10, 8, 7<br />
                Incline DB press — 25kg × 12, 10, 9 @RPE8<br />
                Injury note saved — left shoulder tight
              </div>
              <div className="chat-bubble chat-user">
                How does that compare to last time?
              </div>
              <div className="chat-bubble chat-ai">
                Bench was flat versus your last session. Incline improved by 1 rep on set one and matched total reps overall. Shoulder notes have come up in 3 of your last 5 push sessions, so I'd keep pressing volume sensible today.
              </div>
            </div>
          </div>
        </section>

        {/* Why */}
        <section className="l-section section-band" id="why">
          <div className="l-container">
            <div className="section-kicker">Why Avenra exists</div>
            <h2 className="section-title">Most gym logs are precise, but painful. Most AI coaches are easy, but forgetful.</h2>
            <p className="section-sub">
              Avenra is built around a simple idea: you should be able to log training the way you naturally think and speak, without giving up the precision and recall that serious lifting actually requires.
            </p>

            <div className="problem-grid">
              <div className="card">
                <h3>Logging is too much work</h3>
                <p>Search exercise. Tap set. Enter reps. Enter weight. Repeat. Good data should not require bad workflow.</p>
              </div>
              <div className="card">
                <h3>Generic AI advice is not enough</h3>
                <p>Most chat tools do not know your prior sessions, your current cycle, your injury notes, or your progression history.</p>
              </div>
              <div className="card">
                <h3>Serious training needs memory</h3>
                <p>You need a system that can remember what you did, compare it properly, and help you make better decisions next time.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="l-section" id="features">
          <div className="l-container">
            <div className="section-kicker">What it does</div>
            <h2 className="section-title">A conversational interface on top of a real training system.</h2>
            <p className="section-sub">
              Avenra is not just a chatbot and not just a logger. It combines natural-language input with structured training history so you can log faster and still get the benefits of proper tracking.
            </p>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-tag">Logging</div>
                <h3>Natural-language workout logging</h3>
                <p>Send messy real-world messages like you actually type them. Avenra parses sets, loads, reps, effort, notes, and injury flags into structured training data.</p>
              </div>
              <div className="feature-card">
                <div className="feature-tag">History</div>
                <h3>Exercise history on demand</h3>
                <p>Ask about bench, RDLs, incline press, rows, or anything else you track and get answers grounded in your actual recent sessions.</p>
              </div>
              <div className="feature-card">
                <div className="feature-tag">Analysis</div>
                <h3>Progress insight with memory</h3>
                <p>See whether performance is moving, where you are stalling, which movements are undertrained, and when pain patterns keep recurring.</p>
              </div>
              <div className="feature-card">
                <div className="feature-tag">Coaching</div>
                <h3>Answers with context</h3>
                <p>Ask what to do today, whether to deload, how a lift is trending, or whether something looks off, and get answers based on your own log.</p>
              </div>
              <div className="feature-card">
                <div className="feature-tag">Corrections</div>
                <h3>Edit by talking, not admin</h3>
                <p>Logged something wrong? Correct it in plain English and keep your data clean without tedious manual cleanup.</p>
              </div>
              <div className="feature-card">
                <div className="feature-tag">Planning</div>
                <h3>Cycle-aware training support</h3>
                <p>Store your active training cycle and use it as context, so recommendations are tied to what you are actually trying to achieve.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Why it stands out */}
        <section className="l-section section-band">
          <div className="l-container">
            <div className="section-kicker">Why it stands out</div>
            <h2 className="section-title">Built for lifters who care about both convenience and correctness.</h2>
            <p className="section-sub">
              The promise is simple: remove the friction of logging without turning your training history into vague chat sludge.
            </p>

            <div className="reason-grid">
              <div className="card">
                <h3>Flexible by Design</h3>
                <p>Log by text, voice, or wearable. Track weight, RPE, injury notes, form cues, and whatever else matters to your training.</p>
              </div>
              <div className="card">
                <h3>Your data still stays structured</h3>
                <p>Avenra is designed to preserve the precision that progression-focused lifters need.</p>
              </div>
              <div className="card">
                <h3>The system gets more useful over time</h3>
                <p>The longer you use it, the more training context it has to work with.</p>
              </div>
            </div>

            <div className="strava-callout">
              <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
                <path d="M17 26l5-10 5 10" stroke="#FC4C02" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 26l3-6 3 6" stroke="#FC4C02" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
              </svg>
              <div className="strava-callout-text">
                <span className="strava-callout-title">Sync with Strava — smarter coaching, more context</span>
                <span className="strava-callout-sub">Connect once and Avenra factors your cardio, activity load, and recovery into every recommendation.</span>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="l-section">
          <div className="l-container">
            <div className="section-kicker">How it works</div>
            <h2 className="section-title">Start in minutes.</h2>
            <p className="section-sub">
              The current alpha is intentionally simple: quick onboarding, fast logging, useful answers, and feedback loops so the product improves with real lifter input.
            </p>

            <div className="steps">
              <div className="step">
                <div className="step-num">1</div>
                <h3>Join the alpha</h3>
                <p>Register interest and get access to the current version.</p>
              </div>
              <div className="step">
                <div className="step-num">2</div>
                <h3>Set your training profile</h3>
                <p>Add goals, experience level, and any recurring injury context so Avenra can respond intelligently.</p>
              </div>
              <div className="step">
                <div className="step-num">3</div>
                <h3>Log workouts naturally</h3>
                <p>Send your sets in plain language as you train. Avenra stores them in a structured way behind the scenes.</p>
              </div>
              <div className="step">
                <div className="step-num">4</div>
                <h3>Ask questions any time</h3>
                <p>Use your training log like a living system, not a dead archive.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Register / CTA */}
        <section className="l-section" id="register">
          <div className="l-container">
            <div className="cta-panel">
              <div>
                <div className="section-kicker">Early access</div>
                <h2 className="section-title">Help shape Avenra from the start.</h2>
                <p>
                  Avenra is in private alpha. If you are a serious lifter who already tracks training, or wants a better way to, enter your email below to get started. No password needed — we'll send you a one-click login link.
                </p>
              </div>

              <div className="form-wrap">
                {sent ? (
                  <div className="form-success">
                    ✉ Check your inbox — link sent to {email}
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <div className="form-group">
                      <input
                        type="email"
                        placeholder="Your email address"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={loading}
                        autoComplete="email"
                      />
                      <button type="submit" className="btn-primary" disabled={loading || !email.trim()}>
                        {loading ? 'Sending…' : 'Send me a login link'}
                      </button>
                    </div>
                    {sendError && <p className="form-error-msg">{sendError}</p>}
                    <p className="form-note">
                      No password needed. We'll email you a one-click link.
                      Already have access?{' '}
                      <Link to="/login" style={{ color: '#8df7c0', textDecoration: 'underline' }}>Log in here</Link>.
                    </p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-container">
          <p>Avenra — Talk to your gym log.</p>
          <p>
            Built by <a href="https://biggsdata.com" target="_blank" rel="noopener noreferrer">George Biggs</a>
            {' · '}
            <Link to="/privacy">Privacy</Link>
            {' · '}
            <Link to="/terms">Terms</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
