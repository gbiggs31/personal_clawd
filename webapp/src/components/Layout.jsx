import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'
import InstallPrompt from './InstallPrompt.jsx'
import './Layout.css'

export default function Layout({ children }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [isAdmin, setIsAdmin]   = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email
      if (email) setIsAdmin(email === import.meta.env.VITE_ADMIN_EMAIL)
    })

    // Register service worker for PWA installability
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false) }, [pathname])

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

        {/* Hamburger menu */}
        <div className="layout-menu" ref={menuRef}>
          <button
            className="layout-hamburger"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="3.5" width="16" height="1.8" rx="0.9" fill="currentColor"/>
              <rect x="1" y="8.1" width="16" height="1.8" rx="0.9" fill="currentColor"/>
              <rect x="1" y="12.7" width="16" height="1.8" rx="0.9" fill="currentColor"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="layout-dropdown">
              <Link to="/profile" className="dropdown-item">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <circle cx="7.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M2 13c0-2.761 2.462-5 5.5-5s5.5 2.239 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Profile
              </Link>
              <Link to="/goals" className="dropdown-item">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                  <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <circle cx="7.5" cy="7.5" r="0.75" fill="currentColor"/>
                </svg>
                Goals
              </Link>
              <Link to="/preferences" className="dropdown-item">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M7.5 1v2M7.5 12v2M1 7.5h2M12 7.5h2M2.9 2.9l1.4 1.4M10.7 10.7l1.4 1.4M2.9 12.1l1.4-1.4M10.7 4.3l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Preferences
              </Link>
              {isAdmin && (
                <Link to="/admin" className="dropdown-item">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <circle cx="7.5" cy="5" r="3" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M2 13c0-3.038 2.462-5.5 5.5-5.5S13 9.962 13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Admin
                </Link>
              )}
              <button className="dropdown-item" onClick={handleSignOut}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M6 2H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10 10l3-3-3-3M13 7.5H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <InstallPrompt />

      <div className="layout-body">
        {children}
      </div>

      <nav className="bottom-tabs" aria-label="Mobile navigation">
        <Link to="/today" className={`bottom-tab ${isToday ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6"/>
            <circle cx="10" cy="10" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
            <circle cx="10" cy="10" r="1.5" fill="currentColor"/>
          </svg>
          <span>Today</span>
        </Link>

        <Link to="/log" className={`bottom-tab ${isLog ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="9.1" y="3" width="1.8" height="14" rx="0.9" fill="currentColor"/>
            <rect x="3" y="9.1" width="14" height="1.8" rx="0.9" fill="currentColor"/>
          </svg>
          <span>Log</span>
        </Link>

        <Link to="/" className={`bottom-tab ${isHistory ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="8.75" width="16" height="2.5" rx="1.25" fill="currentColor"/>
            <rect x="2" y="13.5" width="10" height="2.5" rx="1.25" fill="currentColor"/>
          </svg>
          <span>History</span>
        </Link>

        <Link to="/progress" className={`bottom-tab ${isProgress ? 'active' : ''}`}>
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
