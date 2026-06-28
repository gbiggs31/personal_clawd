import { authenticateUser } from '../lib/auth.js'

const ALLOWED_FIELDS = [
  'weight_kg', 'reps', 'rpe', 'rir',
  'note', 'note_type',
  'injury_flag', 'injury_body_part',
  'exercise', 'set_num',
]

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const auth = await authenticateUser(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, uid } = auth

    const { sessionId, exercise, setNum, ...rest } = req.body || {}
    if (!sessionId || !exercise || setNum == null) {
      return res.status(400).json({ error: 'sessionId, exercise, and setNum required' })
    }

    // Verify session ownership and get its date
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('session_id, date')
      .eq('session_id', sessionId)
      .eq('telegram_user_id', uid)
      .single()
    if (!sessionRow) return res.status(403).json({ error: 'Session not found' })

    const ALLOWED_INSERT = ['weight_kg', 'reps', 'rpe', 'rir', 'note', 'note_type', 'injury_flag', 'injury_body_part']
    const safe = Object.fromEntries(
      Object.entries(rest).filter(([k]) => ALLOWED_INSERT.includes(k))
    )

    const { data, error: insertError } = await supabase
      .from('sets')
      .insert({
        session_id: sessionId,
        telegram_user_id: uid,
        exercise,
        set_num: setNum,
        date: sessionRow.date,
        ...safe,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Set insert error:', insertError)
      return res.status(500).json({ error: 'Failed to insert set' })
    }

    return res.status(201).json({ set: data })
  }

  if (req.method === 'PATCH') {
    const auth = await authenticateUser(req)
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
    const auth = await authenticateUser(req)
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
