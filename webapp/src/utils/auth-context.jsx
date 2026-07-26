import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

/**
 * App-wide auth state, resolved once.
 *
 * Previously RequireAuth and RootRoute each held their own session state. They
 * are route elements, so React Router remounted them on every navigation —
 * `session` reset to undefined, the component returned a full-screen
 * "Loading…", and `supabase.auth.getSession()` had to resolve again before any
 * page could even begin fetching. That blank flash on every tab switch was the
 * single biggest contributor to the app feeling slow.
 *
 * Hoisting the state above <Routes> means it survives navigation: after the
 * first load, `session` is already resolved and pages render immediately.
 */

const PROFILE_OK_KEY = 'avenra-profile-ok'

const AuthContext = createContext({ session: undefined, profileOk: undefined })

export function AuthProvider({ children }) {
  const [session, setSession]     = useState(undefined)
  const [profileOk, setProfileOk] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(PROFILE_OK_KEY)
        setProfileOk(undefined)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.access_token) return
    if (sessionStorage.getItem(PROFILE_OK_KEY)) { setProfileOk(true); return }

    let cancelled = false
    fetch('/api/profile', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.hasProfile) {
          sessionStorage.setItem(PROFILE_OK_KEY, '1')
          setProfileOk(true)
        } else {
          setProfileOk(false)
        }
      })
      .catch(() => { if (!cancelled) setProfileOk(true) })  // fail open
    return () => { cancelled = true }
  }, [session])

  // Memoised so a token refresh doesn't re-render every consumer for nothing.
  const value = useMemo(() => ({ session, profileOk }), [session, profileOk])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** { session, profileOk } — `undefined` means "still resolving". */
export function useAuth() {
  return useContext(AuthContext)
}
