import { authenticateUser } from '../lib/auth.js'

function isAdmin(user) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL
  return Boolean(adminEmail) && user?.email === adminEmail
}

function normalizePageUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).toString()
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  // POST - any authenticated user can submit a report
  if (req.method === 'POST') {
    const auth = await authenticateUser(req, { requireLink: false })
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase, uid } = auth

    const { description, category, page_url } = req.body || {}
    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' })
    }

    const validCategories = ['bug', 'suggestion', 'other']
    const safeCategory = validCategories.includes(category) ? category : 'bug'
    const safePageUrl = normalizePageUrl(page_url)

    const { error: insertError } = await supabase.from('bug_reports').insert({
      telegram_user_id: uid,
      description: description.trim(),
      category: safeCategory,
      page_url: safePageUrl,
    })

    if (insertError) {
      console.error('Bug report insert error:', insertError)
      return res.status(500).json({ error: 'Failed to save report' })
    }

    return res.status(201).json({ ok: true })
  }

  // GET - admin only, returns all reports
  if (req.method === 'GET') {
    const auth = await authenticateUser(req, { requireLink: false })
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    if (!isAdmin(auth.user)) return res.status(403).json({ error: 'Forbidden' })
    const { supabase } = auth

    let query = supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (req.query?.status) {
      query = query.eq('status', req.query.status)
    }

    const { data, error } = await query
    if (error) {
      console.error('Bug reports fetch error:', error)
      return res.status(500).json({ error: 'Failed to fetch reports' })
    }

    return res.status(200).json({ reports: data || [] })
  }

  // PATCH - admin only, update status
  if (req.method === 'PATCH') {
    const auth = await authenticateUser(req, { requireLink: false })
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    if (!isAdmin(auth.user)) return res.status(403).json({ error: 'Forbidden' })
    const { supabase } = auth

    const { id, status } = req.body || {}
    if (!id || !status) return res.status(400).json({ error: 'id and status required' })

    const validStatuses = ['open', 'resolved']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })

    const { error: updateError } = await supabase
      .from('bug_reports')
      .update({ status })
      .eq('id', id)

    if (updateError) {
      console.error('Bug report update error:', updateError)
      return res.status(500).json({ error: 'Failed to update report' })
    }

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
