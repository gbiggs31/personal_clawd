import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './StravaContextCard.css'

const DISMISS_KEY_PREFIX = 'avenra-strava-ctx-dismissed-'

export default function StravaContextCard() {
  const [summary,   setSummary]   = useState(null)   // null = loading / not connected
  const [dismissed, setDismissed] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    // Respect per-day dismissal
    if (localStorage.getItem(`${DISMISS_KEY_PREFIX}${today}`)) {
      setDismissed(true)
      return
    }

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        const res = await fetch('/api/strava?action=status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.connected && data.context_summary) {
          setSummary(data.context_summary)
        }
      } catch {
        // Non-fatal — Today page works fine without this
      }
    }

    load()
  }, [today])

  function dismiss() {
    localStorage.setItem(`${DISMISS_KEY_PREFIX}${today}`, '1')
    setDismissed(true)
  }

  if (dismissed || !summary) return null

  const loadClass = summary.lower_body_load === 'high'   ? 'load-high'
                  : summary.lower_body_load === 'medium' ? 'load-medium'
                  : 'load-low'

  return (
    <div className={`scc-card ${loadClass}`}>
      <div className="scc-header">
        <span className="scc-label">Strava context</span>
        <button className="scc-dismiss" onClick={dismiss} aria-label="Dismiss">×</button>
      </div>

      <div className="scc-rows">
        <div className="scc-row">
          <span className="scc-row-label">Last activity</span>
          <span className="scc-row-value">{summary.last_activity}</span>
        </div>
        <div className="scc-row">
          <span className="scc-row-label">7-day cardio load</span>
          <span className="scc-row-value">{summary.week_cardio_load}</span>
        </div>
      </div>

      <p className="scc-note">{summary.coaching_note}</p>
    </div>
  )
}
