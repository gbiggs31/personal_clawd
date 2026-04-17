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
  const isLog      = pathname === '/'
  const isChat     = pathname === '/chat'
  const isProgress = pathname === '/progress'

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">Ave<span>nra</span></div>

        <nav className="header-tabs" aria-label="Main navigation">
          <Link to="/today"     className={`header-tab ${isToday    ? 'active' : ''}`}>Today</Link>
          <Link to="/"         className={`header-tab ${isLog      ? 'active' : ''}`}>Log</Link>
          <Link to="/progress" className={`header-tab ${isProgress ? 'active' : ''}`}>Progress</Link>
          <Link to="/chat"     className={`header-tab ${isChat     ? 'active' : ''}`}>Chat</Link>
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

        <Link to="/" className={`bottom-tab ${isLog ? 'active' : ''}`}>
          {/* List icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="8.75" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="13.5" width="10" height="2.5" rx="1.25" fill="currentColor"/>
          </svg>
          <span>Log</span>
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

        <Link to="/chat" className={`bottom-tab ${isChat ? 'active' : ''}`}>
          {/* Chat bubble icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 2C5.58 2 2 5.13 2 9c0 2.04 1.01 3.87 2.63 5.13L4 18l3.63-1.82C8.36 16.38 9.17 16.5 10 16.5c4.42 0 8-3.13 8-7s-3.58-7-8-7z" fill="currentColor"/>
          </svg>
          <span>Chat</span>
        </Link>
      </nav>
    </div>
  )
}
