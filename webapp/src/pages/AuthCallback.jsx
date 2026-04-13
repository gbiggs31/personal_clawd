import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase.js'

export default function AuthCallback() {
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    async function finish() {
      // Supabase JS automatically handles the token exchange from the URL hash/query.
      // We just need to wait for the session to be set, then link the account.
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error || !session) {
        navigate('/login')
        return
      }

      // Link auth user ↔ telegram user (idempotent, safe to call every login)
      await supabase.rpc('link_auth_account')

      navigate('/', { replace: true })
    }

    finish()
  }, [navigate])

  return (
    <div className="loading-full">Signing you in…</div>
  )
}
