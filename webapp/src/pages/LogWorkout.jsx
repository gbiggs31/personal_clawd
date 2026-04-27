import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../utils/supabase.js'
import './LogWorkout.css'

const SESSION_KEY      = 'avenra-session'
const PLAN_KEY         = 'avenra-active-plan'
const FEED_KEY         = 'avenra-feed'
const DRAFT_KEY        = 'avenra-log-draft'
const FEED_EXPIRY_MINS = 120

function loadSession() {
  try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) }
function clearSession()  { localStorage.removeItem(SESSION_KEY) }

function loadActivePlan() {
  try { const r = localStorage.getItem(PLAN_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
function saveActivePlan(p) { localStorage.setItem(PLAN_KEY, JSON.stringify(p)) }
function clearActivePlan() { localStorage.removeItem(PLAN_KEY) }

function loadPersistedFeed() {
  try {
    const raw = localStorage.getItem(FEED_KEY)
    if (!raw) return { feed: [], chatHistory: [] }
    const { feed, chatHistory, savedAt } = JSON.parse(raw)
    if ((Date.now() - savedAt) / 60000 > FEED_EXPIRY_MINS) return { feed: [], chatHistory: [] }
    return { feed: feed || [], chatHistory: chatHistory || [] }
  } catch { return { feed: [], chatHistory: [] } }
}

function persistFeed(feed, chatHistory) {
  try { localStorage.setItem(FEED_KEY, JSON.stringify({ feed, chatHistory, savedAt: Date.now() })) } catch {}
}

function elapsed(startedAt) {
  const mins = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// Case-insensitive fuzzy match between two exercise names
function exerciseMatch(a, b) {
  const la = a.toLowerCase(), lb = b.toLowerCase()
  return la === lb || la.includes(lb) || lb.includes(la)
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

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="Thinking">
      <span /><span /><span />
    </span>
  )
}

function ChatUserItem({ text }) {
  return (
    <div className="feed-row chat-user">
      <div className="chat-bubble user">{text}</div>
    </div>
  )
}

function ChatAssistantItem({ text, isStreaming }) {
  return (
    <div className="feed-row chat-assistant">
      <div className="chat-avatar">A</div>
      <div className="chat-bubble assistant">
        {text
          ? <div className="feed-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
          : isStreaming ? <TypingDots /> : null
        }
      </div>
    </div>
  )
}

function ResponseItem({ msg, isStreaming }) {
  if (msg.type === 'chat-user')      return <ChatUserItem text={msg.content} />
  if (msg.type === 'chat-assistant') return <ChatAssistantItem text={msg.content} isStreaming={isStreaming} />

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
  if (msg.type === 'summary' || msg.type === 'stats') {
    return (
      <div className="feed-response summary">
        <div className="feed-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
    )
  }
  return (
    <div className={`feed-response ${msg.type || 'info'}`}>
      <pre className="feed-pre">{msg.content}</pre>
    </div>
  )
}

// ── Session card (expandable) ─────────────────────────────────────────────────

function SessionCard({ session, activePlan, onDiscard }) {
  const [expanded, setExpanded] = useState(false)
  const [el, setEl] = useState(elapsed(session.startedAt))

  useEffect(() => {
    const t = setInterval(() => setEl(elapsed(session.startedAt)), 30000)
    return () => clearInterval(t)
  }, [session.startedAt])

  // Plan-based mode: exercises come from the plan with target set counts
  // Free-log mode: exercises come from session.loggedSets (no targets)
  const hasPlan    = !!activePlan?.exercises?.length
  const loggedSets = activePlan?.loggedSets || session.loggedSets || {}

  const exercises = hasPlan
    ? activePlan.exercises
    : Object.entries(loggedSets).map(([name, count]) => ({ name, sets: null, logged: count }))

  function getStatus(ex) {
    if (!hasPlan) return ex.logged > 0 ? 'in-progress' : 'pending'
    let logged = 0
    for (const [name, count] of Object.entries(loggedSets)) {
      if (exerciseMatch(name, ex.name)) logged += count
    }
    const planned = ex.sets || 1
    if (logged >= planned) return 'complete'
    if (logged > 0)        return 'in-progress'
    return 'pending'
  }

  function getLogged(ex) {
    if (!hasPlan) return ex.logged || 0
    let logged = 0
    for (const [name, count] of Object.entries(loggedSets)) {
      if (exerciseMatch(name, ex.name)) logged += count
    }
    return logged
  }

  const completedCount = hasPlan ? exercises.filter(ex => getStatus(ex) === 'complete').length : null
  const total          = exercises.length
  const hasExercises   = total > 0

  const summaryLine = hasPlan && completedCount !== null
    ? `${completedCount}/${total} exercises · ${el}`
    : hasExercises
    ? `${total} exercise${total !== 1 ? 's' : ''} · ${el}`
    : el

  return (
    <div className={`session-card${expanded ? ' expanded' : ''}`}>
      <div
        className="session-card-header"
        onClick={() => hasExercises && setExpanded(e => !e)}
        style={{ cursor: hasExercises ? 'pointer' : 'default' }}
      >
        <div className="session-card-left">
          <span className="session-dot" />
          <span className="session-label">Session active</span>
          <span className="session-elapsed">{summaryLine}</span>
        </div>
        <div className="session-card-right">
          {hasExercises && (
            <span className="session-chevron">{expanded ? '▲' : '▼'}</span>
          )}
          <button className="session-discard" onClick={e => { e.stopPropagation(); onDiscard() }}>
            Discard
          </button>
        </div>
      </div>

      {expanded && hasExercises && (
        <div className="session-exercise-list">
          {exercises.map(ex => {
            const status = getStatus(ex)
            const logged = getLogged(ex)
            return (
              <div key={ex.name} className={`session-ex-item ${status}`}>
                <span className="session-ex-icon">
                  {status === 'complete' ? '✓' : '◑'}
                </span>
                <span className="session-ex-name">{ex.name}</span>
                <span className="session-ex-meta">
                  {hasPlan && ex.sets ? `${logged}/${ex.sets} sets` : `${logged} set${logged !== 1 ? 's' : ''}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

const LOG_EXAMPLES = [
  'bench press 3x5 @ 100kg',
  'squat 4x3 @ 140kg RPE 8',
  'rdl 3x8 @ 90kg, felt solid',
  'ohp 4x6 @ 60kg',
  'run 5km easy pace',
  'pull-ups 3x8 bodyweight',
]

const LOG_COMMANDS = [
  { cmd: '/done',  label: 'Finish session', hint: 'Closes & generates summary', send: true  },
  { cmd: '/done ', label: '/done [note]',   hint: 'Add a session note',          send: false },
  { cmd: '/stats', label: 'Stats',          hint: '90-day training summary',     send: true  },
]

function LogEmptyState({ onExample, onSend }) {
  return (
    <div className="log-empty">
      <div className="log-empty-icon">+</div>
      <h2 className="log-empty-title">Log your workout</h2>
      <p className="log-empty-sub">Type exercises naturally — just describe what you did.</p>

      <div className="log-section-label">Examples</div>
      <div className="log-examples">
        {LOG_EXAMPLES.map(ex => (
          <button key={ex} className="log-example" onClick={() => onExample(ex)}>{ex}</button>
        ))}
      </div>

      <div className="log-section-label">Commands</div>
      <div className="log-commands-grid">
        {LOG_COMMANDS.map(({ cmd, label, hint, send }) => (
          <button
            key={cmd}
            className="log-command-card"
            onClick={() => send ? onSend(cmd) : onExample(cmd)}
            title={hint}
          >
            <span className="log-command-name">{label}</span>
            <span className="log-command-hint">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ChatEmptyState({ onSuggestion }) {
  const suggestions = [
    'How has my training been lately?',
    "What's my progress on bench press?",
    'Any injury patterns I should watch?',
    'Am I due for a deload?',
  ]
  return (
    <div className="log-empty">
      <div className="log-empty-icon">✦</div>
      <h2 className="log-empty-title">Ask about your training</h2>
      <p className="log-empty-sub">I have access to your full workout history.</p>
      <div className="log-examples">
        {suggestions.map(s => (
          <button key={s} className="log-example suggestion" onClick={() => onSuggestion(s)}>{s}</button>
        ))}
      </div>
    </div>
  )
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Input mode">
      <button
        type="button"
        className={`mode-btn ${mode === 'log' ? 'active' : ''}`}
        onClick={() => onChange('log')}
      >
        Log
      </button>
      <button
        type="button"
        className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
        onClick={() => onChange('chat')}
      >
        Chat
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LogWorkout() {
  const location = useLocation()

  const [feed, setFeed]                    = useState(() => loadPersistedFeed().feed)
  const [chatHistory, setChatHistory]      = useState(() => loadPersistedFeed().chatHistory)
  const [input, setInput]                  = useState(() => sessionStorage.getItem(DRAFT_KEY) || '')
  const [loading, setLoading]              = useState(false)
  const [mode, setMode]                    = useState(() => location.state?.mode === 'chat' ? 'chat' : 'log')
  const [session, setSession]              = useState(null)
  const [activePlan, setActivePlan]        = useState(null)
  const [pendingClarification, setPending] = useState(null)
  const [endingSession, setEndingSession]  = useState(false)
  const [endNote, setEndNote]              = useState('')
  const [actionsOpen, setActionsOpen]      = useState(false)
  const actionsRef                         = useRef(null)

  const chatHistoryRef = useRef(null)
  if (chatHistoryRef.current === null) chatHistoryRef.current = loadPersistedFeed().chatHistory
  const bottomRef   = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    const saved = loadSession()
    if (saved) setSession(saved)
    const plan = loadActivePlan()
    if (plan) setActivePlan(plan)
  }, [])

  useEffect(() => {
    if (!actionsOpen) return
    function handleClick(e) {
      if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [actionsOpen])

  useEffect(() => {
    if (feed.length > 0 || chatHistory.length > 0) {
      persistFeed(feed, chatHistory)
    }
  }, [feed, chatHistory])

  function updateChatHistory(msgs) {
    chatHistoryRef.current = msgs
    setChatHistory(msgs)
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    })
  }, [feed])

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'instant' })
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  // Set correct single-row height on mount (rows={1} can render taller in some browsers)
  useEffect(() => { resizeTextarea() }, [])

  function addFeed(items) {
    setFeed(prev => [...prev, ...(Array.isArray(items) ? items : [items])])
  }

  async function getToken() {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (!s?.access_token) throw new Error('Not authenticated')
    return s.access_token
  }

  // ── Log mode handlers ───────────────────────────────────────────────────────

  async function handleLog(text) {
    const token = await getToken()
    const body = { text, sessionId: session?.id }

    if (pendingClarification) {
      body.clarification = text
      body.partialParse  = pendingClarification.partialParse
      body.text          = pendingClarification.originalText
      body.sessionId     = pendingClarification.sessionId
      setPending(null)
    }

    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (!res.ok) { addFeed({ type: 'error', content: data.error || 'Something went wrong.' }); return }

    if (!data.ok && data.clarificationNeeded) {
      setPending({ originalText: pendingClarification?.originalText || text, partialParse: data.partialParse, sessionId: data.sessionId })
      if (!session) {
        const ns = { id: data.sessionId, startedAt: new Date().toISOString() }
        setSession(ns); saveSession(ns)
      }
      addFeed({ type: 'clarification', content: data.clarificationQuestion || 'Please clarify your input.' })
      return
    }

    if (!data.ok) { addFeed({ type: 'error', content: data.message || 'Could not log workout.' }); return }

    if (!session || session.id !== data.sessionId) {
      const ns = { id: data.sessionId, startedAt: new Date().toISOString() }
      setSession(ns); saveSession(ns)
    }

    // Update logged set counts — on the plan if one exists, otherwise on the session itself
    if (data.setsPerExercise) {
      const plan = loadActivePlan()
      if (plan) {
        setActivePlan(prev => {
          const base = prev || plan
          const updated = { ...base, loggedSets: { ...(base.loggedSets || {}) } }
          for (const [name, count] of Object.entries(data.setsPerExercise)) {
            updated.loggedSets[name] = (updated.loggedSets[name] || 0) + count
          }
          saveActivePlan(updated)
          return updated
        })
      } else {
        setSession(prev => {
          const updated = { ...prev, loggedSets: { ...(prev.loggedSets || {}) } }
          for (const [name, count] of Object.entries(data.setsPerExercise)) {
            updated.loggedSets[name] = (updated.loggedSets[name] || 0) + count
          }
          saveSession(updated)
          return updated
        })
      }
    }

    addFeed({ type: 'success', content: data.reply })
  }

  async function handleDone(note) {
    if (!session) { addFeed({ type: 'error', content: 'No active session. Log something first.' }); return }

    const token = await getToken()
    const res = await fetch('/api/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ sessionId: session.id, note: note || undefined, startedAt: session.startedAt }),
    })
    const data = await res.json()

    if (!res.ok) { addFeed({ type: 'error', content: data.error || 'Failed to close session.' }); return }

    clearSession(); clearActivePlan()
    setSession(null); setActivePlan(null); setPending(null)
    const today = new Date().toISOString().split('T')[0]
    const dateLabel = data.sessionDate && data.sessionDate !== today
      ? ` · ${new Date(data.sessionDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      : ''
    addFeed({
      type: 'summary',
      content: `Session closed — ${data.sessionType}${data.durationMins ? ` (${data.durationMins} mins)` : ''}${dateLabel}\n\n${data.summary}`,
    })
  }

  async function handleStats() {
    const token = await getToken()
    const res = await fetch('/api/stats', { headers: { 'Authorization': `Bearer ${token}` } })
    const data = await res.json()

    if (!res.ok) { addFeed({ type: 'error', content: data.error || 'Failed to fetch stats.' }); return }

    const typeLines = Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `  ${t}: ${n}`).join('\n')
    const topEx     = (data.topExercises || []).map(e => `  ${e.name} (${e.count} sets)`).join('\n')
    const volUnit   = data.units === 'imperial' ? 'lbs' : 'kg'

    addFeed({ type: 'stats', content: [
      `**Last 90 days**`, ``,
      `Sessions: ${data.sessions90d}`,
      typeLines ? `\nBy type:\n${typeLines}` : '',
      topEx     ? `\nTop exercises:\n${topEx}` : '',
      data.lastSessionDate ? `\nLast session: ${data.lastSessionDate} (${data.lastSessionType || 'other'})` : '',
      data.totalVolume ? `\nTotal volume: ${data.totalVolume.toLocaleString()} ${volUnit}` : '',
    ].filter(Boolean).join('\n') })
  }

  // ── Chat mode handler ───────────────────────────────────────────────────────

  async function handleChat(text) {
    const token = await getToken()
    updateChatHistory([...chatHistoryRef.current, { role: 'user', content: text }])

    addFeed([
      { type: 'chat-user',      content: text },
      { type: 'chat-assistant', content: '' },
    ])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages: chatHistoryRef.current }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setFeed(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { type: 'chat-assistant', content: 'Something went wrong. Please try again.' }
        return updated
      })
      throw new Error(err.error || `Request failed (${res.status})`)
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', fullResponse = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') break
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) throw new Error(parsed.error)
          if (parsed.text) {
            fullResponse += parsed.text
            setFeed(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { type: 'chat-assistant', content: fullResponse }
              return updated
            })
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr
        }
      }
    }

    updateChatHistory([...chatHistoryRef.current, { role: 'assistant', content: fullResponse }])
  }

  // ── Send dispatcher ─────────────────────────────────────────────────────────

  async function send(raw) {
    const trimmed = raw.trim()
    if (!trimmed || loading) return

    setInput('')
    sessionStorage.removeItem(DRAFT_KEY)
    requestAnimationFrame(resizeTextarea)
    setLoading(true)

    try {
      if (mode === 'chat') {
        await handleChat(trimmed)
      } else {
        addFeed({ type: 'command', content: trimmed })
        const lower = trimmed.toLowerCase()
        if (lower === '/done' || lower.startsWith('/done ')) {
          await handleDone(trimmed.slice(5).trim() || undefined)
        } else if (lower === '/stats') {
          await handleStats()
        } else {
          await handleLog(lower.startsWith('/log ') ? trimmed.slice(5) : trimmed)
        }
      }
    } catch (err) {
      if (mode === 'log') addFeed({ type: 'error', content: err.message || 'Something went wrong.' })
    }

    setLoading(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  function discardSession() {
    clearSession(); clearActivePlan()
    setSession(null); setActivePlan(null); setPending(null)
    addFeed({ type: 'info', content: 'Session discarded.' })
  }

  function startFreshSession() {
    const id = crypto.randomUUID()
    const ns = { id, startedAt: new Date().toISOString() }
    setSession(ns); saveSession(ns)
    setMode('log')
    textareaRef.current?.focus()
  }

  async function confirmEndSession() {
    setLoading(true)
    try {
      await handleDone(endNote.trim() || undefined)
    } catch (err) {
      addFeed({ type: 'error', content: err.message || 'Failed to close session.' })
    }
    setLoading(false)
    setEndingSession(false)
    setEndNote('')
  }

  const isEmpty = feed.length === 0

  const placeholder = mode === 'chat'
    ? 'Ask about your training…'
    : pendingClarification
    ? 'Type your answer…'
    : session
    ? 'Log more sets, or /done to finish…'
    : 'bench press 3x5 @ 100kg'

  const hint = mode === 'chat'
    ? 'Enter to send · Shift+Enter for new line'
    : 'Enter to send · /done to finish · /stats for summary'

  return (
    <div className="log-page">
      {session && (
        <SessionCard
          session={session}
          activePlan={activePlan}
          onDiscard={discardSession}
        />
      )}

      {isEmpty && (
        mode === 'log'
          ? <LogEmptyState
              onExample={ex => { setInput(ex); textareaRef.current?.focus() }}
              onSend={cmd => send(cmd)}
            />
          : <ChatEmptyState onSuggestion={s => send(s)} />
      )}

      {!isEmpty && (
        <div className="log-feed">
          {feed.map((item, i) =>
            item.type === 'command'
              ? <CommandItem key={i} text={item.content} />
              : <ResponseItem
                  key={i}
                  msg={item}
                  isStreaming={loading && i === feed.length - 1 && item.type === 'chat-assistant'}
                />
          )}
          {loading && mode === 'log' && (
            <div className="feed-response info">
              <TypingDots />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="log-input-area">
        {/* Contextual pill CTA */}
        <div className="log-cta-row">
          {endingSession ? (
            <div className="log-end-prompt">
              <input
                className="log-end-note"
                placeholder="Session note (optional)…"
                value={endNote}
                onChange={e => setEndNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmEndSession() }}
                autoFocus
              />
              <button className="log-cta-pill session" onClick={confirmEndSession} disabled={loading}>
                {loading ? '…' : 'Confirm'}
              </button>
              <button className="log-cta-cancel" onClick={() => { setEndingSession(false); setEndNote('') }}>
                ✕
              </button>
            </div>
          ) : (
            <>
              {session ? (
                <button className="log-cta-pill session" onClick={() => setEndingSession(true)} disabled={loading}>
                  End session
                </button>
              ) : (
                <button className="log-cta-pill start" onClick={startFreshSession} disabled={loading}>
                  Start workout
                </button>
              )}

              {/* + actions menu */}
              <div className="log-actions-wrap" ref={actionsRef}>
                <button
                  className={`log-actions-btn${actionsOpen ? ' open' : ''}`}
                  onClick={() => setActionsOpen(o => !o)}
                  aria-label="More actions"
                >
                  +
                </button>
                {actionsOpen && (
                  <div className="log-actions-menu">
                    {session && (
                      <button className="log-action-item" onClick={() => {
                        setActionsOpen(false)
                        setEndingSession(true)
                      }}>
                        ✓ End session
                      </button>
                    )}
                    {!session && (
                      <button className="log-action-item" onClick={() => {
                        setActionsOpen(false)
                        startFreshSession()
                      }}>
                        ▶ Start workout
                      </button>
                    )}
                    <button className="log-action-item" onClick={() => {
                      setActionsOpen(false)
                      setMode('log')
                      setInput('session note: ')
                      sessionStorage.setItem(DRAFT_KEY, 'session note: ')
                      setTimeout(resizeTextarea, 0)
                      textareaRef.current?.focus()
                    }}>
                      ✎ Add session note
                    </button>
                    <button className="log-action-item" onClick={() => {
                      setActionsOpen(false)
                      setMode('chat')
                      textareaRef.current?.focus()
                    }}>
                      ✦ Ask coach
                    </button>
                    <button className="log-action-item" onClick={() => {
                      setActionsOpen(false)
                      send('/stats')
                    }}>
                      ◎ Stats
                    </button>
                    {session && (
                      <button className="log-action-item danger" onClick={() => {
                        setActionsOpen(false)
                        discardSession()
                      }}>
                        ✕ Discard session
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <form className="log-form" onSubmit={e => { e.preventDefault(); send(input) }}>
          <ModeToggle mode={mode} onChange={m => { setMode(m); textareaRef.current?.focus() }} />
          <textarea
            ref={textareaRef}
            className="log-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); sessionStorage.setItem(DRAFT_KEY, e.target.value); resizeTextarea() }}
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
        <p className="log-hint">{hint}</p>
      </div>
    </div>
  )
}
