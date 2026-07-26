import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './utils/supabase.js'
import { AuthProvider, useAuth } from './utils/auth-context.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import Dashboard from './pages/Dashboard.jsx'
import LogWorkout from './pages/LogWorkout.jsx'
import Today from './pages/Today.jsx'
import Onboarding from './pages/Onboarding.jsx'

// Split out of the initial bundle. Progress is the only page that needs
// recharts (~400kB), Admin is reached by one account, and SessionDetail is a
// drill-down — none of them should be on the critical path for the tabs the
// user actually opens first.
const loadProgress      = () => import('./pages/Progress.jsx')
const loadAdmin         = () => import('./pages/Admin.jsx')
const loadSessionDetail = () => import('./pages/SessionDetail.jsx')

const Progress      = lazy(loadProgress)
const Admin         = lazy(loadAdmin)
const SessionDetail = lazy(loadSessionDetail)

// Code splitting keeps the first paint small, but it would otherwise make the
// FIRST click on Progress slower than before — a 400kB fetch at click time.
// Warm the chunks once the app is idle so navigation stays instant.
function prefetchRouteChunks() {
  const warm = () => { loadProgress(); loadSessionDetail() }
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3000 })
  else setTimeout(warm, 1500)
}
import ProfilePage from './pages/ProfilePage.jsx'
import GoalsPage from './pages/GoalsPage.jsx'
import PreferencesPage from './pages/PreferencesPage.jsx'
import PrivacyPage from './pages/PrivacyPage.jsx'
import TermsPage from './pages/TermsPage.jsx'
import SupportPage from './pages/SupportPage.jsx'
import LandingPage from './pages/LandingPage.jsx'
import BugReportButton from './components/BugReportButton.jsx'
import { hasPostHogConfig, identifyPostHog, initPostHog, resetPostHog } from './utils/posthog.js'

// Requires a valid session, then checks that onboarding is complete.
// Both come from AuthProvider, so after the first load these are already
// resolved and navigation renders synchronously — no loading flash.
function RequireAuth({ children }) {
  const { session, profileOk } = useAuth()

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

// Root route: landing page for unauthenticated visitors, dashboard when logged in.
function RootRoute() {
  const { session, profileOk } = useAuth()

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
    if (hasPostHogConfig()) {
      initPostHog().catch(() => {})
    }
  }, [])

  useEffect(() => {
    // Identify logged-in users in PostHog; reset on sign-out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        identifyPostHog(session.user.id, { email: session.user.email })
      } else {
        resetPostHog()
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => { prefetchRouteChunks() }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
      <Suspense fallback={<div className="loading-full">Loading…</div>}>
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
      </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
