import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './StravaCard.css'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  return session.access_token
}

function timeAgo(isoDate) {
  if (!isoDate) return 'never'
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const h = Math.round(diffMs / 3_600_000)
  if (h < 1)  return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function StravaCard({ onConnected }) {
  const [status,       setStatus]       = useState(null)   // null = loading
  const [syncing,      setSyncing]       = useState(false)
  const [syncMsg,      setSyncMsg]       = useState('')
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error,        setError]         = useState('')

  useEffect(() => { loadStatus() }, [])

  async function loadStatus() {
    setStatus(null)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/strava?action=status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load status')
      setStatus(await res.json())
    } catch (err) {
      setError(err.message)
      setStatus({ connected: false })
    }
  }

  async function handleConnect() {
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/strava?action=connect', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to start connection')
      const { url } = await res.json()
      window.location.href = url
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/strava?action=sync', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSyncMsg(`Synced ${data.imported} activit${data.imported === 1 ? 'y' : 'ies'}`)
      await loadStatus()
    } catch (err) {
      setError(err.message)
    }
    setSyncing(false)
  }

  async function handleDisconnect(deleteData) {
    setDisconnecting(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/strava?action=disconnect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ deleteData }),
      })
      if (!res.ok) throw new Error('Disconnect failed')
      setConfirmDelete(false)
      setStatus({ connected: false })
    } catch (err) {
      setError(err.message)
    }
    setDisconnecting(false)
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (status === null) {
    return (
      <div className="sc-card">
        <div className="sc-loading">Loading…</div>
      </div>
    )
  }

  // ── Disconnected ─────────────────────────────────────────────────────────
  if (!status.connected) {
    return (
      <div className="sc-card">
        <div className="sc-header">
          <StravaLogo />
          <span className="sc-title">Strava</span>
          <span className="sc-badge disconnected">Not connected</span>
        </div>
        <p className="sc-description">
          Connect Strava to give Avenra more context about your cardio, activity
          volume, and recovery. Your gym logs stay in Avenra.
        </p>
        {error && <p className="sc-error">{error}</p>}
        <button className="sc-btn connect" onClick={handleConnect}>
          Connect Strava
        </button>
      </div>
    )
  }

  // ── Connected ────────────────────────────────────────────────────────────
  const { athlete_name, athlete_avatar, last_sync_at, is_stale } = status

  if (confirmDelete) {
    return (
      <div className="sc-card">
        <p className="sc-confirm-text">
          Remove all imported Strava data and disconnect?
        </p>
        <div className="sc-confirm-actions">
          <button className="sc-btn secondary" onClick={() => setConfirmDelete(false)} disabled={disconnecting}>
            Cancel
          </button>
          <button className="sc-btn danger" onClick={() => handleDisconnect(true)} disabled={disconnecting}>
            {disconnecting ? 'Removing…' : 'Remove and disconnect'}
          </button>
        </div>
        {error && <p className="sc-error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="sc-card">
      <div className="sc-header">
        <StravaLogo />
        <div className="sc-athlete">
          {athlete_avatar && (
            <img className="sc-avatar" src={athlete_avatar} alt="" />
          )}
          <span className="sc-title">{athlete_name}</span>
        </div>
        <span className={`sc-badge ${is_stale ? 'stale' : 'connected'}`}>
          {is_stale ? 'Stale' : 'Connected'}
        </span>
      </div>

      <div className="sc-sync-row">
        <span className="sc-sync-time">
          Last sync: {timeAgo(last_sync_at)}
          {is_stale && ' — sync recommended'}
        </span>
        {syncMsg && <span className="sc-sync-success">{syncMsg}</span>}
      </div>

      {error && <p className="sc-error">{error}</p>}

      <div className="sc-actions">
        <button className="sc-btn secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          className="sc-btn ghost"
          onClick={() => handleDisconnect(false)}
          disabled={disconnecting}
        >
          Disconnect
        </button>
        <button className="sc-btn ghost danger-ghost" onClick={() => setConfirmDelete(true)}>
          Remove data
        </button>
      </div>
    </div>
  )
}

function StravaLogo() {
  return (
    <svg className="sc-strava-logo" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 26l5-10 5 10" fill="none" stroke="#FC4C02" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M22 26l3-6 3 6" fill="none" stroke="#FC4C02" strokeWidth="3" strokeLinejoin="round" opacity="0.6"/>
    </svg>
  )
}
