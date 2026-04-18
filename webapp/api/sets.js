import { createClient } from '@supabase/supabase-js'

const ALLOWED_FIELDS = [
  'weight_kg', 'reps', 'rpe', 'rir',
  'note', 'note_type',
  'injury_flag', 'injury_body_part',
  'exercise', 'set_num',
]

async function authenticate(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return { error: 'Invalid token', status: 401 }

  const { data: authRow } = await supabase
    .from('user_auth')
    .select('telegram_user_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!authRow) return { error: 'Not linked', status: 403 }

  return { supabase, uid: authRow.telegram_user_id }
}

export default async function handler(req, res) {
  if (req.method === 'PATCH') {
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, uid } = auth

    const { setId, fields } = req.body || {}
    if (!setId || !fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'setId and fields required' })
    }

    const safe = Object.fromEntries(
      Object.entries(fields).filter(([k]) => ALLOWED_FIELDS.includes(k))
    )
    if (!Object.keys(safe).length) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const { error: updateError } = await supabase
      .from('sets')
      .update(safe)
      .eq('id', setId)
      .eq('telegram_user_id', uid)   // ownership check

    if (updateError) {
      console.error('Set update error:', updateError)
      return res.status(500).json({ error: 'Failed to update set' })
    }

    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, uid } = auth

    const { setId } = req.body || {}
    if (!setId) return res.status(400).json({ error: 'setId required' })

    const { error: deleteError } = await supabase
      .from('sets')
      .delete()
      .eq('id', setId)
      .eq('telegram_user_id', uid)   // ownership check

    if (deleteError) {
      console.error('Set delete error:', deleteError)
      return res.status(500).json({ error: 'Failed to delete set' })
    }

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
