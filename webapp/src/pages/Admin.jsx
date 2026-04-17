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

function AddUserForm({ onAdd }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [email, setEmail]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await onAdd({ firstName, lastName, email })
      setFirstName(''); setLastName(''); setEmail('')
    } catch (err) {
      setError(err.message)
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
          {loading ? 'Adding…' : 'Add user'}
        </button>
      </div>
      {error && <p className="admin-form-error">{error}</p>}
    </form>
  )
}

function UserRow({ user, onToggleStatus, onResetOnboarding }) {
  const [loading, setLoading]           = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetDone, setResetDone]       = useState(false)

  async function toggle() {
    setLoading(true)
    await onToggleStatus(user.telegram_user_id, user.status === 'active' ? 'pending' : 'active')
    setLoading(false)
  }

  async function resetOnboarding() {
    setResetLoading(true)
    await onResetOnboarding(user.telegram_user_id)
    setResetDone(true)
    setResetLoading(false)
  }

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—'

  return (
    <tr className="user-row">
      <td className="user-name">{displayName}</td>
      <td className="user-email">{user.email || '—'}</td>
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
          {resetDone ? 'Done ✓' : resetLoading ? '…' : 'Re-onboard'}
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

export default function Admin() {
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [forbidden, setForbidden] = useState(false)

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
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) { setForbidden(true); return }
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load users')
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  async function addUser({ firstName, lastName, email }) {
    const token = await getToken()
    const res = await fetch('/api/admin/users', {
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
    const res = await fetch('/api/admin/reset-onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ telegramUserId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to reset onboarding')
  }

  async function toggleStatus(telegramUserId, newStatus) {
    const token = await getToken()
    const res = await fetch('/api/admin/users', {
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
          <p>You don't have access to this page.</p>
        </div>
      </div>
    )
  }

  const activeCount  = users.filter(u => u.status === 'active').length
  const linkedCount  = users.filter(u => u.web_linked).length

  return (
    <div className="admin-page">
      <div className="admin-inner">
        <div className="admin-header">
          <div>
            <h1 className="admin-title">Users</h1>
            {!loading && (
              <p className="admin-sub">
                {activeCount} active · {linkedCount} web linked · {users.length} total
              </p>
            )}
          </div>
        </div>

        <AddUserForm onAdd={addUser} />

        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <div className="admin-loading">Loading…</div>
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
      </div>
    </div>
  )
}
