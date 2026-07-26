/**
 * /api/lift — the `/lift <exercise>` command.
 *
 * Two stages so the UI can paint instantly and stream the coaching on top:
 *
 *   POST /api/lift              { query }            → JSON history card (no LLM)
 *   POST /api/lift?stage=advice { exercise }         → SSE coaching advice (Sonnet)
 *
 * Stage 1 never calls a model, so the card lands in ~200ms. Stage 2 re-reads
 * the history server-side rather than trusting the client's copy.
 */

import Anthropic from '@anthropic-ai/sdk'
import { authenticateUser } from '../lib/auth.js'
import { MODEL_SONNET, THINKING, cachedSystem } from '../lib/models.js'
import { coachingStyleNote } from '../lib/coaching-style.js'
import { getStravaContext } from '../lib/strava-context.js'
import { withinChatRateLimit } from '../lib/rate-limit.js'
import {
  normalize, displayName, expandAlias, escapeLike, resolveExercise,
  buildSessions, buildStats, suggestNextLoad, renderHistoryForPrompt, formatWeight,
} from '../lib/lift-history.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SESSION_WINDOW = 8      // sessions rendered on the card
const SET_ROW_LIMIT  = 400    // rows pulled per exercise (plenty for 8 sessions)
const CANDIDATE_LIMIT = 5

const ADVICE_SYSTEM = `You are Avenra, an AI strength coach. The user is about to train one specific exercise and has asked what to do today.

You are given their full recent history for that lift. Answer in three short labelled sections, in this exact order:

**Load** — the specific weight and set/rep scheme to hit today, as a single concrete prescription. Commit to a number; do not offer a range of options. Justify it in one clause referencing their actual last session.

**Effort** — what the sets should feel like (target RPE or RIR), and the rule for when to stop or back off.

**Form** — one technique cue. Prefer a cue that addresses something in their own logged notes (a form breakdown, a sticking point, an injury flag). Only fall back to a generic cue for the lift if their notes contain nothing relevant.

## Rules
- Total response under 120 words. This is read standing at the rack.
- Every number must trace back to the history you were given. Never invent a session.
- If there is an injury flag on this lift in the last few sessions, address it in Form and cap the load accordingly.
- If they have not trained this lift in over 3 weeks, prescribe a conservative re-entry load and say why.
- No preamble, no sign-off, no restating the history back at them.`

// ── Shared data loading ───────────────────────────────────────────────────────

/**
 * Find the user's matching exercise name(s) for a free-text query.
 *
 * Ordered cheapest-first: an exact case-insensitive hit avoids scanning the
 * user's whole exercise vocabulary, which is the common case for the chips the
 * UI sends back after a disambiguation prompt.
 */
async function resolveAgainstUser(supabase, uid, query, { exact = false } = {}) {
  const exactHit = await supabase
    .from('sets')
    .select('exercise')
    .eq('telegram_user_id', uid)
    .ilike('exercise', escapeLike(query))
    .limit(1)

  if (exactHit.data?.length) return { match: normalize(exactHit.data[0].exercise), candidates: [] }
  if (exact) return { match: null, candidates: [] }

  // Substring pass — narrow, and covers "bench" → "Bench Press".
  const probes = [query, expandAlias(query)].filter(Boolean)
  for (const probe of probes) {
    const { data } = await supabase
      .from('sets')
      .select('exercise')
      .eq('telegram_user_id', uid)
      .ilike('exercise', `%${escapeLike(probe)}%`)
      .limit(500)

    const names = [...new Set((data || []).map(r => normalize(r.exercise)).filter(Boolean))]
    if (names.length === 1) return { match: names[0], candidates: [] }
    if (names.length > 1) {
      const resolved = resolveExercise(probe, names, { limit: CANDIDATE_LIMIT })
      if (resolved.match) return resolved
      return { match: null, candidates: resolved.candidates.length ? resolved.candidates : names.slice(0, CANDIDATE_LIMIT) }
    }
  }

  // Last resort: score against the full vocabulary (typos, reordered words).
  const { data: all } = await supabase
    .from('sets')
    .select('exercise')
    .eq('telegram_user_id', uid)
    .not('exercise', 'is', null)
    .limit(2000)

  const names = [...new Set((all || []).map(r => normalize(r.exercise)).filter(Boolean))]
  return resolveExercise(query, names, { limit: CANDIDATE_LIMIT })
}

/** Pull the resolved exercise's sets plus the session metadata they belong to. */
async function loadHistory(supabase, uid, exercise) {
  const { data: rows } = await supabase
    .from('sets')
    .select('session_id, date, set_num, weight_kg, reps, rpe, rir, note, injury_flag, injury_body_part')
    .eq('telegram_user_id', uid)
    .ilike('exercise', escapeLike(exercise))
    .order('date', { ascending: false })
    .limit(SET_ROW_LIMIT)

  if (!rows?.length) return { sessions: [], stats: buildStats([]) }

  const sessionIds = [...new Set(rows.map(r => r.session_id).filter(Boolean))].slice(0, 40)
  const { data: meta } = await supabase
    .from('sessions')
    .select('session_id, session_type, duration_mins')
    .eq('telegram_user_id', uid)
    .in('session_id', sessionIds)

  const metaMap = Object.fromEntries((meta || []).map(m => [String(m.session_id), m]))

  const allSessions = buildSessions(rows, metaMap)
  return { sessions: allSessions.slice(0, SESSION_WINDOW), stats: buildStats(allSessions) }
}

async function loadProfile(supabase, uid, keys) {
  const { data } = await supabase
    .from('profile').select('key,value').eq('telegram_user_id', uid).in('key', keys)
  return Object.fromEntries((data || []).map(r => [r.key, r.value]))
}

// ── Stage 1: history card ─────────────────────────────────────────────────────

async function handleCard(req, res, { supabase, uid }) {
  const { query, exact } = req.body || {}
  if (!query?.trim()) return res.status(400).json({ error: 'Usage: /lift <exercise>' })
  if (query.length > 100) return res.status(400).json({ error: 'Exercise name too long.' })

  const [{ match, candidates }, profile] = await Promise.all([
    resolveAgainstUser(supabase, uid, query.trim(), { exact: !!exact }),
    loadProfile(supabase, uid, ['units']),
  ])

  const units = profile.units || 'metric'

  if (!match) {
    if (candidates.length) {
      return res.status(200).json({
        ok: false,
        ambiguous: true,
        query: query.trim(),
        candidates: candidates.map(displayName),
      })
    }
    return res.status(200).json({
      ok: false,
      notFound: true,
      query: query.trim(),
      message: `No history for "${query.trim()}". Log it once and /lift will pick it up.`,
    })
  }

  const { sessions, stats } = await loadHistory(supabase, uid, match)
  if (!sessions.length) {
    return res.status(200).json({
      ok: false, notFound: true, query: query.trim(),
      message: `No sets recorded for ${displayName(match)}.`,
    })
  }

  return res.status(200).json({
    ok: true,
    exercise: displayName(match),
    units,
    sessions,
    stats,
    suggestion: suggestNextLoad(sessions, match),
  })
}

// ── Stage 2: streamed coaching advice ─────────────────────────────────────────

async function handleAdvice(req, res, { supabase, user, uid }) {
  const { exercise } = req.body || {}
  if (!exercise?.trim()) return res.status(400).json({ error: 'exercise required' })

  // Shares the chat budget — /lift advice is the same class of spend.
  const allowed = await withinChatRateLimit(supabase, user.id)
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests. Please wait before asking for more advice.' })
  }

  const { match } = await resolveAgainstUser(supabase, uid, exercise.trim(), { exact: true })
  if (!match) return res.status(404).json({ error: 'Exercise not found in your history.' })

  const [{ sessions, stats }, profile, stravaContext] = await Promise.all([
    loadHistory(supabase, uid, match),
    loadProfile(supabase, uid, ['units', 'coaching_style', 'chronic_injuries', 'experience_level', 'training_notes']),
    getStravaContext(user.id, supabase).catch(err => {
      console.warn('[lift] strava context error (non-fatal):', err.message)
      return null
    }),
  ])

  if (!sessions.length) return res.status(404).json({ error: 'No history for that exercise.' })

  const units = profile.units || 'metric'
  const styleNote = coachingStyleNote(profile.coaching_style || 'balanced')
  const unitsNote = units === 'imperial'
    ? 'Express every weight in lbs.'
    : 'Express every weight in kg.'

  const athlete = [
    profile.experience_level ? `Experience: ${profile.experience_level}` : null,
    profile.training_notes   ? `Programme: ${profile.training_notes}` : null,
    profile.chronic_injuries ? `Chronic injuries: ${profile.chronic_injuries}` : null,
  ].filter(Boolean)

  const fallback = suggestNextLoad(sessions, match)

  const context = [
    unitsNote,
    styleNote,
    athlete.length ? `=== ATHLETE ===\n${athlete.join('\n')}` : '',
    stravaContext || '',
    renderHistoryForPrompt(match, sessions, stats, units),
    fallback
      ? `=== RULE-BASED BASELINE ===\nA deterministic progression rule suggests ${formatWeight(fallback.weightKg, units)} × ${fallback.reps} for ${fallback.sets} sets. Use this unless the history gives you a specific reason to deviate — if you do deviate, say why in one clause.`
      : '',
  ].filter(Boolean).join('\n\n')

  let text = ''
  let started = false

  try {
    const stream = anthropic.messages.stream(
      {
        model: MODEL_SONNET,
        // Thinking on: working out the right load from RPE/RIR trends and
        // injury notes is exactly the reasoning this is for, and the history
        // card is already on screen so a couple of seconds of pause is free.
        // max_tokens must cover thinking *and* the ~120-word answer.
        max_tokens: 2500,
        thinking: THINKING,
        system: cachedSystem(ADVICE_SYSTEM, `\n\n${context}`),
        messages: [{ role: 'user', content: `What should I do on ${displayName(match)} today?` }],
      },
      { signal: AbortSignal.timeout(40_000) }
    )

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        if (!started) {
          started = true
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.flushHeaders()
        }
        text += chunk.delta.text
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
      }
    }

    if (!started) return res.status(500).json({ error: 'No response from AI. Please try again.' })
  } catch (err) {
    console.error('[lift] advice stream error:', err.message)
    if (!started) return res.status(500).json({ error: 'AI service error. Please try again.' })
    res.write(`data: ${JSON.stringify({ error: 'AI service error. Please try again.' })}\n\n`)
  }

  if (text) {
    supabase.from('chat_messages').insert([
      { telegram_user_id: uid, auth_user_id: user.id, role: 'user',      message_length: exercise.length },
      { telegram_user_id: uid, auth_user_id: user.id, role: 'assistant', message_length: text.length },
    ]).then(({ error }) => {
      if (error) console.error('[lift] message log failed:', error.message)
    })
  }

  res.write('data: [DONE]\n\n')
  res.end()
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('[lift] Missing required env vars')
    return res.status(500).json({ error: 'Service misconfigured' })
  }

  const auth = await authenticateUser(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.query.stage === 'advice') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[lift] ANTHROPIC_API_KEY not set')
      return res.status(500).json({ error: 'Service misconfigured' })
    }
    return handleAdvice(req, res, auth)
  }

  return handleCard(req, res, auth)
}
