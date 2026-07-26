import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import { getCached, setCached } from '../utils/page-cache.js'
import './StravaContextCard.css'

const DISMISS_KEY_PREFIX = 'avenra-strava-ctx-dismissed-'
const CACHE_KEY = 'today:strava-status'

export default function StravaContextCard() {
  // Cached: this component mounts with every visit to Today, and the summary
  // only changes when Strava syncs (daily).
  const [summary,   setSummary]   = useState(() => getCached(CACHE_KEY) ?? null)
  const [dismissed, setDismissed] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    // Respect per-day dismissal
    if (localStorage.getItem(`${DISMISS_KEY_PREFIX}${today}`)) {
      setDismissed(true)
      return
    }
    if (getCached(CACHE_KEY) !== undefined) return

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        const res = await fetch('/api/strava?action=status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        const next = (data.connected && data.context_summary) ? data.context_summary : null
        setSummary(next)
        // Cache the "not connected" answer too — otherwise users without
        // Strava re-request it on every single visit.
        setCached(CACHE_KEY, next, 30 * 60 * 1000)
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
