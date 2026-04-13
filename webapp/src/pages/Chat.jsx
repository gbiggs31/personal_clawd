import { useEffect, useRef, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './Chat.css'

const SUGGESTIONS = [
  'How has my training been lately?',
  "What's my progress on bench press?",
  'Any injury patterns I should watch?',
  'What did I train last week?',
  'Am I due for a deload?',
]

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="Thinking">
      <span /><span /><span />
    </span>
  )
}

function Message({ msg, isStreaming }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <div className="msg-avatar">A</div>}
      <div className="msg-bubble">
        {msg.content
          ? <span className="msg-text">{msg.content}</span>
          : isStreaming ? <TypingDots /> : null
        }
      </div>
    </div>
  )
}

export default function Chat() {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError]         = useState('')
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  async function send(text) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    setError('')
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg = { role: 'user', content: trimmed }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setStreaming(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: history }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Request failed (${res.status})`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

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
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                updated[updated.length - 1] = { ...last, content: last.content + parsed.text }
                return updated
              })
            }
          } catch (parseErr) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: 'Something went wrong. Please try again.' }
        return updated
      })
      setError(err.message)
    }

    setStreaming(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="chat-page">
      {/* Empty state with suggestions */}
      {isEmpty && (
        <div className="chat-empty">
          <div className="chat-empty-icon">✦</div>
          <h2 className="chat-empty-title">Ask about your training</h2>
          <p className="chat-empty-sub">I have access to your full workout history.</p>
          <div className="suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="suggestion-chip" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message list */}
      {!isEmpty && (
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <Message
              key={i}
              msg={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === 'assistant'}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div className="chat-input-area">
        {error && <p className="chat-error">{error}</p>}
        <form
          className="chat-form"
          onSubmit={e => { e.preventDefault(); send(input) }}
        >
          <textarea
            ref={el => { textareaRef.current = el; inputRef.current = el }}
            className="chat-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); resizeTextarea() }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your training…"
            rows={1}
            disabled={streaming}
          />
          <button
            type="submit"
            className="chat-send"
            disabled={streaming || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
        <p className="chat-hint">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
