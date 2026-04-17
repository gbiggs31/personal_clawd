import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../utils/supabase.js'
import './LogWorkout.css'

const SESSION_KEY = 'avenra-session'

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

function elapsed(startedAt) {
  const mins = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// ── Feed items ────────────────────────────────────────────────────────────────

function CommandItem({ text }) {
  return (
    <div className="feed-row command">
      <span className="feed-prompt">›</span>
      <span className="feed-command-text">{text}</span>
    </div>
  )
}

function ResponseItem({ msg }) {
  if (msg.type === 'error') {
    return <div className="feed-response error">{msg.content}</div>
  }
  if (msg.type === 'clarification') {
    return (
      <div className="feed-response clarification">
        <span className="feed-label">Clarification needed</span>
        {msg.content}
      </div>
    )
  }
  if (msg.type === 'summary') {
    return (
      <div className="feed-response summary">
        <div className="feed-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (msg.type === 'stats') {
    return (
      <div className="feed-response stats">
        <div className="feed-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
    )
  }
  // success / info
  return (
    <div className={`feed-response ${msg.type || 'info'}`}>
      <pre className="feed-pre">{msg.content}</pre>
    </div>
  )
}

// ── Session banner ────────────────────────────────────────────────────────────

function SessionBanner({ session, onDiscard }) {
  const [elapsed_, setElapsed] = useState(elapsed(session.startedAt))

  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsed(session.startedAt)), 30000)
    return () => clearInterval(t)
  }, [session.startedAt])

  return (
    <div className="session-banner">
      <div className="session-banner-left">
        <span className="session-dot" />
        <span className="session-label">Session active</span>
        <span className="session-elapsed">{elapsed_}</span>
      </div>
      <button className="session-discard" onClick={onDiscard} title="Discard session">
        Discard
      </button>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onExample }) {
  const examples = [
    'bench press 3x5 @ 100kg',
    'squat 4x3 @ 140kg RPE 8',
    'rdl 3x8 @ 90kg, felt solid',
    'run 5km easy pace',
  ]

  return (
    <div className="log-empty">
      <div className="log-empty-icon">+</div>
      <h2 className="log-empty-title">Log your workout</h2>
      <p className="log-empty-sub">
        Type exercises below. Use <code>/done</code> to close the session.
      </p>
      <div className="log-examples">
        {examples.map(ex => (
          <button key={ex} className="log-example" onClick={() => onExample(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <div className="log-commands-hint">
        <span><code>/done [note]</code> — finish &amp; summarise</span>
        <span><code>/stats</code> — 90-day summary</span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LogWorkout() {
  const [feed, setFeed]                       = useState([])
  const [input, setInput]                     = useState('')
  const [loading, setLoading]                 = useState(false)
  const [session, setSession]                 = useState(null)
  const [pendingClarification, setPending]    = useState(null) // { originalText, partialParse, sessionId }
  const bottomRef   = useRef(null)
  const textareaRef = useRef(null)

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = loadSession()
    if (saved) setSession(saved)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  function addFeed(items) {
    setFeed(prev => [...prev, ...(Array.isArray(items) ? items : [items])])
  }

  async function getToken() {
    const { data: { session: authSession } } = await supabase.auth.getSession()
    const token = authSession?.access_token
    if (!token) throw new Error('Not authenticated')
    return token
  }

  async function handleLog(text) {
    const token = await getToken()
    const body = { text, sessionId: session?.id }

    if (pendingClarification) {
      body.clarification = text
      body.partialParse = pendingClarification.partialParse
      body.text = pendingClarification.originalText
      body.sessionId = pendingClarification.sessionId
      setPending(null)
    }

    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) {
      addFeed({ type: 'error', content: data.error || 'Something went wrong.' })
      return
    }

    if (!data.ok && data.clarificationNeeded) {
      setPending({
        originalText: pendingClarification?.originalText || text,
        partialParse: data.partialParse,
        sessionId: data.sessionId,
      })
      // Start session if needed
      if (!session) {
        const newSession = { id: data.sessionId, startedAt: new Date().toISOString() }
        setSession(newSession)
        saveSession(newSession)
      }
      addFeed({ type: 'clarification', content: data.clarificationQuestion || 'Please clarify your input.' })
      return
    }

    if (!data.ok) {
      addFeed({ type: 'error', content: data.message || 'Could not log workout.' })
      return
    }

    // Success — start or continue session
    if (!session || session.id !== data.sessionId) {
      const newSession = { id: data.sessionId, startedAt: new Date().toISOString() }
      setSession(newSession)
      saveSession(newSession)
    }
    addFeed({ type: 'success', content: data.reply })
  }

  async function handleDone(note) {
    if (!session) {
      addFeed({ type: 'error', content: 'No active session. Log something first.' })
      return
    }

    const token = await getToken()
    const res = await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ sessionId: session.id, note: note || undefined, startedAt: session.startedAt }),
    })
    const data = await res.json()

    if (!res.ok) {
      addFeed({ type: 'error', content: data.error || 'Failed to close session.' })
      return
    }

    clearSession()
    setSession(null)
    setPending(null)

    const header = `Session closed — ${data.sessionType}${data.durationMins ? ` (${data.durationMins} mins)` : ''}\n\n`
    addFeed({ type: 'summary', content: header + data.summary })
  }

  async function handleStats() {
    const token = await getToken()
    const res = await fetch('/api/stats', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const data = await res.json()

    if (!res.ok) {
      addFeed({ type: 'error', content: data.error || 'Failed to fetch stats.' })
      return
    }

    const typeLines = Object.entries(data.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `  ${t}: ${n}`)
      .join('\n')

    const topEx = (data.topExercises || [])
      .map(e => `  ${e.name} (${e.count} sets)`)
      .join('\n')

    const lines = [
      `**Last 90 days**`,
      ``,
      `Sessions: ${data.sessions90d}`,
      typeLines ? `\nBy type:\n${typeLines}` : '',
      topEx ? `\nTop exercises:\n${topEx}` : '',
      data.lastSessionDate ? `\nLast session: ${data.lastSessionDate} (${data.lastSessionType || 'other'})` : '',
      data.totalVolume ? `\nTotal volume: ${data.totalVolume.toLocaleString()} kg` : '',
    ].filter(l => l !== '').join('\n')

    addFeed({ type: 'stats', content: lines })
  }

  async function send(raw) {
    const trimmed = raw.trim()
    if (!trimmed || loading) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    addFeed({ type: 'command', content: trimmed })
    setLoading(true)

    try {
      const lower = trimmed.toLowerCase()
      if (lower === '/done' || lower.startsWith('/done ')) {
        await handleDone(trimmed.slice(5).trim() || undefined)
      } else if (lower === '/stats') {
        await handleStats()
      } else {
        const logText = lower.startsWith('/log ') ? trimmed.slice(5) : trimmed
        await handleLog(logText)
      }
    } catch (err) {
      addFeed({ type: 'error', content: err.message || 'Something went wrong.' })
    }

    setLoading(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  function discardSession() {
    clearSession()
    setSession(null)
    setPending(null)
    addFeed({ type: 'info', content: 'Session discarded.' })
  }

  const isEmpty = feed.length === 0

  const placeholder = pendingClarification
    ? 'Type your answer…'
    : session
    ? 'Log more sets, or /done to finish…'
    : 'bench press 3x5 @ 100kg'

  return (
    <div className="log-page">
      {session && <SessionBanner session={session} onDiscard={discardSession} />}

      {isEmpty && !session && (
        <EmptyState onExample={ex => { setInput(ex); textareaRef.current?.focus() }} />
      )}

      {!isEmpty && (
        <div className="log-feed">
          {feed.map((item, i) =>
            item.type === 'command'
              ? <CommandItem key={i} text={item.content} />
              : <ResponseItem key={i} msg={item} />
          )}
          {loading && (
            <div className="feed-response info">
              <span className="typing-dots"><span /><span /><span /></span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="log-input-area">
        <form
          className="log-form"
          onSubmit={e => { e.preventDefault(); send(input) }}
        >
          <textarea
            ref={textareaRef}
            className="log-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); resizeTextarea() }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={loading}
          />
          <button
            type="submit"
            className="log-send"
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
        <p className="log-hint">Enter to send · /done to finish session · /stats for summary</p>
      </div>
    </div>
  )
}
