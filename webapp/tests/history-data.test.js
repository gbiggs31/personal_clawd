import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchHistoryPage, HISTORY_PAGE_SIZE } from '../src/utils/history-data.js'

function fakeClient({ sessions = [], sets = [], failTable, failFrom = 0 } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, orders: [] }
      calls.push(call)
      const query = {
        select(columns) { call.columns = columns; return this },
        ilike(column, value) { call.filter = [column, value]; return this },
        or(value) { call.or = value; return this },
        order(column, options) { call.orders.push([column, options]); return this },
        range(from, to) { call.range = [from, to]; return this },
        in(column, values) { call.in = [column, values]; return this },
        abortSignal(signal) { call.signal = signal; return this },
        then(resolve, reject) {
          if (call.signal?.aborted) return Promise.reject(new Error('Aborted')).then(resolve, reject)
          if (table === failTable && call.range[0] >= failFrom) return Promise.resolve({ error: new Error('Database unavailable') }).then(resolve, reject)
          let rows = table === 'sessions' ? sessions : sets
          if (call.filter) rows = rows.filter(row => row.session_type?.toLowerCase() === call.filter[1].toLowerCase())
          if (call.in) rows = rows.filter(row => call.in[1].includes(row.session_id))
          return Promise.resolve({ data: rows.slice(call.range[0], call.range[1] + 1) }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

test('pages all sets beyond the row cap and scopes each batch to the selected sessions', async () => {
  const sessions = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => ({ session_id: `s${i}` }))
  const sets = Array.from({ length: 1205 }, (_, id) => ({ id, session_id: `s${id % HISTORY_PAGE_SIZE}` }))
  sets.push({ id: 9999, session_id: 'unrelated' })
  const client = fakeClient({ sessions, sets })
  const result = await fetchHistoryPage(client)
  assert.equal(result.sets.length, 1205)
  assert.equal(result.hasMore, true)
  assert.deepEqual(client.calls.filter(call => call.table === 'sets').map(call => call.range), [[0, 499], [500, 999], [1000, 1499]])
  assert.deepEqual(client.calls[0].orders.map(([column]) => column), ['date', 'created_at', 'session_id'])
})

test('filters workout type before pagination, including older matching workouts', async () => {
  const sessions = Array.from({ length: 90 }, (_, i) => ({ session_id: `s${i}`, session_type: i < 60 ? 'Pull' : 'pUsH' }))
  const client = fakeClient({ sessions })
  const first = await fetchHistoryPage(client, { type: 'Push' })
  assert.equal(first.sessions.length, 30)
  assert.equal(first.sessions[0].session_id, 's60')
  assert.equal(first.hasMore, true)
  const next = await fetchHistoryPage(client, { type: 'Push', offset: 30 })
  assert.equal(next.sessions.length, 0)
  assert.equal(next.hasMore, false)
})

test('Other includes null types and excludes known workout types case-insensitively', async () => {
  const client = fakeClient()
  await fetchHistoryPage(client, { type: 'Other' })
  assert.match(client.calls[0].or, /^session_type.is.null,and\(/)
  assert.match(client.calls[0].or, /session_type.not.ilike.Push/)
  assert.match(client.calls[0].or, /session_type.not.ilike.Lower/)
  assert.match(client.calls[0].or, /session_type.not.ilike.Full Body/)
})

test('empty history makes no sets request', async () => {
  const client = fakeClient()
  assert.deepEqual(await fetchHistoryPage(client), { sessions: [], sets: [], hasMore: false })
  assert.equal(client.calls.length, 1)
})

test('session and later set-page failures reject rather than return partial history', async () => {
  await assert.rejects(fetchHistoryPage(fakeClient({ failTable: 'sessions' })), /Database unavailable/)
  const client = fakeClient({ sessions: [{ session_id: 's' }], sets: Array.from({ length: 600 }, (_, id) => ({ id, session_id: 's' })), failTable: 'sets', failFrom: 500 })
  await assert.rejects(fetchHistoryPage(client), /Database unavailable/)
})

test('cancellation reaches every query and stops an abandoned request', async () => {
  const controller = new AbortController()
  const client = fakeClient({ sessions: [{ session_id: 's' }] })
  await fetchHistoryPage(client, { signal: controller.signal })
  assert.ok(client.calls.every(call => call.signal === controller.signal))
  controller.abort()
  await assert.rejects(fetchHistoryPage(client, { signal: controller.signal }), /Aborted/)
})
