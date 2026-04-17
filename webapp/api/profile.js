import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: authRow } = await supabase
    .from('user_auth')
    .select('telegram_user_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!authRow) return res.status(403).json({ error: 'Account not linked' })

  const uid = authRow.telegram_user_id

  // ── GET: return profile as { key: value } ──────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('profile')
      .select('key, value')
      .eq('telegram_user_id', uid)

    if (error) return res.status(500).json({ error: error.message })

    const profile = {}
    for (const row of data || []) {
      if (row.key) profile[row.key] = row.value
    }

    return res.status(200).json({ profile, hasProfile: Object.keys(profile).length > 0 })
  }

  // ── POST: upsert profile fields ────────────────────────────────────────────
  if (req.method === 'POST') {
    const { fields } = req.body // { age: '28', weight_kg: '85', ... }
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'fields object required' })
    }

    const rows = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([key, value]) => ({
        telegram_user_id: uid,
        key,
        value: String(value).trim(),
        updated_at: new Date().toISOString(),
      }))

    if (!rows.length) return res.status(400).json({ error: 'No valid fields provided' })

    const { error } = await supabase
      .from('profile')
      .upsert(rows, { onConflict: 'telegram_user_id,key' })

    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ ok: true, saved: rows.length })
  }
}
