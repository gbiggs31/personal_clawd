import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './utils/supabase.js'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LogWorkout from './pages/LogWorkout.jsx'
import Today from './pages/Today.jsx'
import SessionDetail from './pages/SessionDetail.jsx'
import Progress from './pages/Progress.jsx'
import Admin from './pages/Admin.jsx'
import Onboarding from './pages/Onboarding.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import GoalsPage from './pages/GoalsPage.jsx'
import PreferencesPage from './pages/PreferencesPage.jsx'
import PrivacyPage from './pages/PrivacyPage.jsx'
import TermsPage from './pages/TermsPage.jsx'
import SupportPage from './pages/SupportPage.jsx'
import LandingPage from './pages/LandingPage.jsx'
import BugReportButton from './components/BugReportButton.jsx'

// Requires a valid session, then checks if onboarding is complete.
// Caches the result in sessionStorage so the profile check only happens once per session.
function RequireAuth({ children }) {
  const [session, setSession]       = useState(undefined)
  const [profileOk, setProfileOk]   = useState(undefined)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    // Already checked this session — skip the API round-trip
    if (sessionStorage.getItem('avenra-profile-ok')) {
      setProfileOk(true)
      return
    }

    // First load after login: check whether the user has a profile
    session.access_token && fetch('/api/profile', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.hasProfile) {
          sessionStorage.setItem('avenra-profile-ok', '1')
          setProfileOk(true)
        } else {
          setProfileOk(false)
        }
      })
      .catch(() => setProfileOk(true)) // fail open — don't block the app
  }, [session, navigate])

  if (session === undefined || (session && profileOk === undefined)) {
    return <div className="loading-full">Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  if (profileOk === false) return <Navigate to="/onboarding" replace />
  return (
    <>
      {children}
      <BugReportButton />
    </>
  )
}

// Root route: shows landing page for unauthenticated visitors, dashboard for logged-in users.
function RootRoute() {
  const [session, setSession]     = useState(undefined)
  const [profileOk, setProfileOk] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    if (sessionStorage.getItem('avenra-profile-ok')) { setProfileOk(true); return }
    session.access_token && fetch('/api/profile', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.hasProfile) {
          sessionStorage.setItem('avenra-profile-ok', '1')
          setProfileOk(true)
        } else {
          setProfileOk(false)
        }
      })
      .catch(() => setProfileOk(true))
  }, [session])

  if (session === undefined) return <div className="loading-full">Loading…</div>
  if (!session) return <LandingPage />
  if (profileOk === undefined) return <div className="loading-full">Loading…</div>
  if (profileOk === false) return <Navigate to="/onboarding" replace />
  return (
    <>
      <Layout><Dashboard /></Layout>
      <BugReportButton />
    </>
  )
}

export default function App() {
  useEffect(() => {
    // Identify logged-in users in PostHog; reset on sign-out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        window.posthog?.identify(session.user.id, { email: session.user.email })
      } else {
        window.posthog?.reset()
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/support" element={<SupportPage />} />

        <Route path="/" element={<RootRoute />} />
        <Route path="/log" element={
          <RequireAuth><Layout><LogWorkout /></Layout></RequireAuth>
        } />
        <Route path="/today" element={
          <RequireAuth><Layout><Today /></Layout></RequireAuth>
        } />
        <Route path="/chat" element={<Navigate to="/log" replace />} />
        <Route path="/progress" element={
          <RequireAuth><Layout><Progress /></Layout></RequireAuth>
        } />
        <Route path="/session/:sessionId" element={
          <RequireAuth><SessionDetail /></RequireAuth>
        } />
        <Route path="/admin" element={
          <RequireAuth><Layout><Admin /></Layout></RequireAuth>
        } />
        <Route path="/profile" element={
          <RequireAuth><Layout><ProfilePage /></Layout></RequireAuth>
        } />
        <Route path="/goals" element={
          <RequireAuth><Layout><GoalsPage /></Layout></RequireAuth>
        } />
        <Route path="/preferences" element={
          <RequireAuth><Layout><PreferencesPage /></Layout></RequireAuth>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
