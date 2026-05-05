import { useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './BugReportButton.css'

export default function BugReportButton() {
  const [open, setOpen]           = useState(false)
  const [category, setCategory]   = useState('bug')
  const [description, setDesc]    = useState('')
  const [sending, setSending]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [error, setError]         = useState('')

  function openModal() {
    setCategory('bug')
    setDesc('')
    setError('')
    setSent(false)
    setOpen(true)
  }

  function closeModal() {
    setOpen(false)
  }

  async function submit(e) {
    e.preventDefault()
    if (!description.trim()) return
    setSending(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: description.trim(), category, page_url: window.location.href }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to send')
      }
      setSent(true)
      setTimeout(() => setOpen(false), 1800)
    } catch (err) {
      setError(err.message)
    }
    setSending(false)
  }

  return (
    <>
      <button
        className="bug-fab"
        onClick={openModal}
        title="Report a bug or give feedback"
        aria-label="Report a bug"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
          <path d="M10 2a4 4 0 0 1 4 4v1h2a1 1 0 1 1 0 2h-2v1.5l1.8 1.8a1 1 0 0 1-1.4 1.4L13 11.4V13a3 3 0 0 1-6 0v-1.6l-1.4 1.3a1 1 0 1 1-1.4-1.4L6 9.5V8H4a1 1 0 0 1 0-2h2V6a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v5a1 1 0 0 0 2 0V6a2 2 0 0 0 0 0zm0 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 6h6M7 9.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="bug-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="bug-modal" role="dialog" aria-modal="true">
            <div className="bug-modal-header">
              <h2 className="bug-modal-title">Report an issue</h2>
              <button className="bug-modal-close" onClick={closeModal} aria-label="Close">✕</button>
            </div>

            {sent ? (
              <div className="bug-sent">
                <span className="bug-sent-icon">✓</span>
                <p>Thanks — we'll look into it!</p>
              </div>
            ) : (
              <form onSubmit={submit}>
                <label className="bug-field">
                  <span className="bug-label">Type</span>
                  <select
                    className="bug-select"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    disabled={sending}
                  >
                    <option value="bug">Bug</option>
                    <option value="suggestion">Suggestion</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="bug-field">
                  <span className="bug-label">Description</span>
                  <textarea
                    className="bug-textarea"
                    value={description}
                    onChange={e => setDesc(e.target.value)}
                    placeholder="What happened? What were you trying to do?"
                    rows={4}
                    disabled={sending}
                    required
                    autoFocus
                  />
                </label>

                {error && <p className="bug-error">{error}</p>}

                <div className="bug-actions">
                  <button type="button" className="bug-btn-cancel" onClick={closeModal} disabled={sending}>
                    Cancel
                  </button>
                  <button type="submit" className="bug-btn-submit" disabled={sending || !description.trim()}>
                    {sending ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
