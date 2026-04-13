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

  const isChat     = pathname === '/chat'
  const isSessions = pathname === '/'

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-logo">Ave<span>nra</span></div>

        <nav className="header-tabs" aria-label="Main navigation">
          <Link to="/"     className={`header-tab ${isSessions ? 'active' : ''}`}>Sessions</Link>
          <Link to="/chat" className={`header-tab ${isChat     ? 'active' : ''}`}>Chat</Link>
        </nav>

        <button className="layout-signout" onClick={handleSignOut}>Sign out</button>
      </header>

      <div className="layout-body">
        {children}
      </div>

      <nav className="bottom-tabs" aria-label="Mobile navigation">
        <Link to="/" className={`bottom-tab ${isSessions ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="8.75" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="13.5" width="10" height="2.5" rx="1.25" fill="currentColor"/>
          </svg>
          <span>Sessions</span>
        </Link>
        <Link to="/chat" className={`bottom-tab ${isChat ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 2C5.58 2 2 5.13 2 9c0 2.04 1.01 3.87 2.63 5.13L4 18l3.63-1.82C8.36 16.38 9.17 16.5 10 16.5c4.42 0 8-3.13 8-7s-3.58-7-8-7z" fill="currentColor"/>
          </svg>
          <span>Chat</span>
        </Link>
      </nav>
    </div>
  )
}
