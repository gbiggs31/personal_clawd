import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase.js'
import './Admin.css'

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  )
}

function safeErrorMessage(err, fallback) {
  return err instanceof Error ? err.message : fallback
}

function getReportPath(pageUrl) {
  if (!pageUrl) return '-'

  try {
    return new URL(pageUrl).pathname || '/'
  } catch {
    return pageUrl
  }
}

function AddUserForm({ onAdd }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await onAdd({ firstName, lastName, email })
      setFirstName('')
      setLastName('')
      setEmail('')
    } catch (err) {
      setError(safeErrorMessage(err, 'Failed to add user'))
    }
    setLoading(false)
  }

  return (
    <form className="add-user-form" onSubmit={handleSubmit}>
      <h2 className="add-user-title">Add user</h2>
      <div className="add-user-fields">
        <input
          className="admin-input"
          placeholder="First name"
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          disabled={loading}
        />
        <input
          className="admin-input"
          placeholder="Last name"
          value={lastName}
          onChange={e => setLastName(e.target.value)}
          disabled={loading}
        />
        <input
          className="admin-input email"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          disabled={loading}
        />
        <button
          type="submit"
          className="admin-btn primary"
          disabled={loading || !email.trim()}
        >
          {loading ? 'Adding...' : 'Add user'}
        </button>
      </div>
      {error && <p className="admin-form-error">{error}</p>}
    </form>
  )
}

function UserRow({ user, onToggleStatus, onResetOnboarding }) {
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  async function toggle() {
    setLoading(true)
    try {
      await onToggleStatus(user.telegram_user_id, user.status === 'active' ? 'pending' : 'active')
    } finally {
      setLoading(false)
    }
  }

  async function resetOnboarding() {
    setResetLoading(true)
    try {
      await onResetOnboarding(user.telegram_user_id)
      setResetDone(true)
    } finally {
      setResetLoading(false)
    }
  }

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '-'

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '-'

  return (
    <tr className="user-row">
      <td className="user-name">{displayName}</td>
      <td className="user-email">{user.email || '-'}</td>
      <td><StatusBadge status={user.status} /></td>
      <td className="user-linked">
        {user.web_linked
          ? <span className="linked-yes">Linked</span>
          : <span className="linked-no">Not linked</span>
        }
      </td>
      <td className="user-joined">{joined}</td>
      <td className="user-actions">
        <button
          className="admin-btn small secondary"
          onClick={resetOnboarding}
          disabled={resetLoading || resetDone}
          title="Clears profile data so they see onboarding on next login"
        >
          {resetDone ? 'Done' : resetLoading ? '...' : 'Re-onboard'}
        </button>
        <button
          className={`admin-btn small ${user.status === 'active' ? 'danger' : 'secondary'}`}
          onClick={toggle}
          disabled={loading}
        >
          {user.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  )
}

function CategoryBadge({ category }) {
  const colours = { bug: 'danger', suggestion: 'accent', other: 'muted' }
  const colour = colours[category] || 'muted'
  return <span className={`report-category-badge ${colour}`}>{category}</span>
}

function BugReportRow({ report, onResolve }) {
  const [resolving, setResolving] = useState(false)
  const date = new Date(report.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  async function resolve() {
    setResolving(true)
    try {
      await onResolve(report.id)
    } finally {
      setResolving(false)
    }
  }

  return (
    <tr className="user-row">
      <td className="report-date">{date}</td>
      <td><CategoryBadge category={report.category} /></td>
      <td className="report-desc">{report.description}</td>
      <td className="report-url">
        {report.page_url
          ? <span title={report.page_url}>{getReportPath(report.page_url)}</span>
          : '-'}
      </td>
      <td>
        <span className={`status-badge ${report.status === 'resolved' ? 'active' : 'pending'}`}>
          <span className="status-dot" />
          {report.status}
        </span>
      </td>
      <td className="user-actions">
        {report.status === 'open' && (
          <button
            className="admin-btn small secondary"
            onClick={resolve}
            disabled={resolving}
          >
            {resolving ? '...' : 'Resolve'}
          </button>
        )}
      </td>
    </tr>
  )
}

export default function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)

  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [showAllReports, setShowAllReports] = useState(false)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Not authenticated')
    return session.access_token
  }

  async function fetchUsers() {
    setLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch('/api/admin?resource=users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load users')
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err) {
      setError(safeErrorMessage(err, 'Failed to load users'))
    } finally {
      setLoading(false)
    }
  }

  async function fetchReports() {
    setReportsLoading(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/bug-reports', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setReports(data.reports || [])
      }
    } finally {
      setReportsLoading(false)
    }
  }

  async function resolveReport(id) {
    const token = await getToken()
    const res = await fetch('/api/bug-reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, status: 'resolved' }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to update report')
    }

    setReports(prev => prev.map(r => (r.id === id ? { ...r, status: 'resolved' } : r)))
  }

  useEffect(() => {
    fetchUsers()
    fetchReports()
  }, [])

  async function addUser({ firstName, lastName, email }) {
    const token = await getToken()
    const res = await fetch('/api/admin?resource=users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ firstName, lastName, email }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to add user')
    setUsers(prev => [data.user, ...prev])
  }

  async function resetOnboarding(telegramUserId) {
    const token = await getToken()
    const res = await fetch('/api/admin?action=reset-onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ telegramUserId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to reset onboarding')
  }

  async function toggleStatus(telegramUserId, newStatus) {
    const token = await getToken()
    const res = await fetch('/api/admin?resource=users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ telegramUserId, status: newStatus }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to update user')
    setUsers(prev => prev.map(u =>
      u.telegram_user_id === telegramUserId ? { ...u, status: newStatus } : u
    ))
  }

  if (forbidden) {
    return (
      <div className="admin-page">
        <div className="admin-forbidden">
          <p>You do not have access to this page.</p>
        </div>
      </div>
    )
  }

  const activeCount = users.filter(u => u.status === 'active').length
  const linkedCount = users.filter(u => u.web_linked).length

  return (
    <div className="admin-page">
      <div className="admin-inner">
        <div className="admin-header">
          <div>
            <h1 className="admin-title">Users</h1>
            {!loading && (
              <p className="admin-sub">
                {activeCount} active | {linkedCount} web linked | {users.length} total
              </p>
            )}
          </div>
        </div>

        <AddUserForm onAdd={addUser} />

        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <div className="admin-loading">Loading...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty">No users yet.</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Web</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    onToggleStatus={toggleStatus}
                    onResetOnboarding={resetOnboarding}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-section">
          <div className="admin-header" style={{ marginTop: 32 }}>
            <div>
              <h1 className="admin-title">Bug Reports</h1>
              {!reportsLoading && (
                <p className="admin-sub">
                  {reports.filter(r => r.status === 'open').length} open | {reports.length} total
                </p>
              )}
            </div>
            <button
              className="admin-btn small secondary"
              onClick={() => setShowAllReports(v => !v)}
            >
              {showAllReports ? 'Open only' : 'Show all'}
            </button>
          </div>

          {reportsLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : reports.length === 0 ? (
            <div className="admin-empty">No reports yet.</div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Page</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports
                    .filter(r => showAllReports || r.status === 'open')
                    .map(r => (
                      <BugReportRow key={r.id} report={r} onResolve={resolveReport} />
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
