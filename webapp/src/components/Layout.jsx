import { useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import './Layout.css'

export default function Layout({ children }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const isToday    = pathname === '/today'
  const isLog      = pathname === '/log'
  const isHistory  = pathname === '/'
  const isProgress = pathname === '/progress'

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">Ave<span>nra</span></div>

        <nav className="header-tabs" aria-label="Main navigation">
          <Link to="/today"    className={`header-tab ${isToday    ? 'active' : ''}`}>Today</Link>
          <Link to="/log"      className={`header-tab ${isLog      ? 'active' : ''}`}>Log</Link>
          <Link to="/"         className={`header-tab ${isHistory  ? 'active' : ''}`}>History</Link>
          <Link to="/progress" className={`header-tab ${isProgress ? 'active' : ''}`}>Progress</Link>
        </nav>

        <button className="layout-signout" onClick={handleSignOut}>Sign out</button>
      </header>

      <div className="layout-body">
        {children}
      </div>

      <nav className="bottom-tabs" aria-label="Mobile navigation">
        <Link to="/today" className={`bottom-tab ${isToday ? 'active' : ''}`}>
          {/* Target / bullseye icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/>
            <circle cx="10" cy="10" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
            <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
          </svg>
          <span>Today</span>
        </Link>

        <Link to="/log" className={`bottom-tab ${isLog ? 'active' : ''}`}>
          {/* Plus / add icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="9.1" y="3" width="1.8" height="14" rx="0.9" fill="currentColor"/>
            <rect x="3" y="9.1" width="14" height="1.8" rx="0.9" fill="currentColor"/>
          </svg>
          <span>Log</span>
        </Link>

        <Link to="/" className={`bottom-tab ${isHistory ? 'active' : ''}`}>
          {/* List icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="8.75" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="13.5" width="10" height="2.5" rx="1.25" fill="currentColor"/>
          </svg>
          <span>History</span>
        </Link>

        <Link to="/progress" className={`bottom-tab ${isProgress ? 'active' : ''}`}>
          {/* Trend / chart icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <polyline points="2,15 7,9 11,12 18,5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <circle cx="7" cy="9" r="1.5" fill="currentColor"/>
            <circle cx="11" cy="12" r="1.5" fill="currentColor"/>
            <circle cx="18" cy="5" r="1.5" fill="currentColor"/>
          </svg>
          <span>Progress</span>
        </Link>

      </nav>
    </div>
  )
}
