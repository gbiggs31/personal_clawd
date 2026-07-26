import { authenticateUser } from '../lib/auth.js'

// Underscore-prefixed keys are internal server state stored in the same KV
// table (plan cache, rate-limit stamps). They must never be returned to the
// client, and must not count towards `hasProfile` — otherwise merely hitting
// /api/today-plan would make an un-onboarded user look onboarded and skip
// the onboarding flow.
const isInternalKey = key => typeof key === 'string' && key.startsWith('_')

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, uid } = auth

  // ── GET: return profile as { key: value } ──────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('profile')
      .select('key, value')
      .eq('telegram_user_id', uid)

    if (error) return res.status(500).json({ error: error.message })

    const profile = {}
    for (const row of data || []) {
      if (row.key && !isInternalKey(row.key)) profile[row.key] = row.value
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
      .filter(([k]) => !isInternalKey(k))   // clients cannot write internal keys
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
