export const HISTORY_PAGE_SIZE = 30
export const WORKOUT_TYPES = ['All', 'Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Other']

// Browser queries use the existing owner-read RLS policies. Fetch every set
// page: even 30 sessions can exceed PostgREST's default 1,000-row limit.
export async function fetchHistoryPage(client, { offset = 0, type = 'All', signal } = {}) {
  let query = client.from('sessions').select('*')
  if (type === 'Other') {
    const exclusions = WORKOUT_TYPES.slice(1, -1)
      .map(name => `session_type.not.ilike.${name}`).join(',')
    query = query.or(`session_type.is.null,and(${exclusions})`)
  } else if (type !== 'All') {
    if (!WORKOUT_TYPES.includes(type)) throw new Error('Unknown workout type')
    query = query.ilike('session_type', type)
  }
  query = query.order('date', { ascending: false })
    .order('created_at', { ascending: false }).order('session_id')
    .range(offset, offset + HISTORY_PAGE_SIZE - 1)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw error
  const sessions = data || []
  const sets = []
  if (sessions.length) {
    const ids = sessions.map(session => session.session_id)
    const batchSize = 500
    for (let from = 0; ; from += batchSize) {
      let setQuery = client.from('sets')
        .select('id, session_id, date, exercise, set_num, weight_kg, reps, rpe, rir, note, injury_flag, injury_body_part')
        .in('session_id', ids).order('id').range(from, from + batchSize - 1)
      if (signal) setQuery = setQuery.abortSignal(signal)
      const { data: rows, error: setError } = await setQuery
      if (setError) throw setError
      sets.push(...(rows || []))
      if (!rows || rows.length < batchSize) break
    }
  }
  return { sessions, sets, hasMore: sessions.length === HISTORY_PAGE_SIZE }
}
