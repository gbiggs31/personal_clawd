import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import './Login.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const redirectTo = `${window.location.origin}/auth/callback`
    const { error: err } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-logo">Avenra</div>
        <p className="login-sub">Your training, in one place.</p>

        {sent ? (
          <div className="login-sent">
            <div className="sent-icon">✉</div>
            <p>Check your email — we sent a login link to <strong>{email}</strong>.</p>
            <p className="login-hint">The link expires in 24 hours. You can close this tab.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send me a login link'}
            </button>
            <p className="login-hint">No password needed. We'll email you a one-click link.</p>
          </form>
        )}
      </div>
    </div>
  )
}
