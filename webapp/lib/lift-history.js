/**
 * Exercise resolution + history shaping for /api/lift.
 *
 * Kept free of Supabase and Anthropic imports so it can be unit-tested and
 * reused by both stages of the endpoint (data card and coaching advice).
 */

// ── Units ─────────────────────────────────────────────────────────────────────

export function kgToLbs(kg) { return Math.round(kg * 2.20462) }

export function formatWeight(weightKg, units) {
  if (weightKg == null) return 'BW'
  return units === 'imperial' ? `${kgToLbs(weightKg)}lbs` : `${weightKg}kg`
}

// ── Name normalisation and matching ───────────────────────────────────────────

export function normalize(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function displayName(name) {
  return normalize(name).replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Gym shorthand → the canonical phrase people actually log.
 * Only unambiguous abbreviations belong here; anything that could plausibly
 * mean two different lifts is left out so it falls through to the
 * candidate-listing path instead of silently picking one.
 */
const ALIASES = {
  bp: 'bench press',
  ohp: 'overhead press',
  rdl: 'romanian deadlift',
  sldl: 'stiff leg deadlift',
  dl: 'deadlift',
  bb: 'barbell',
  db: 'dumbbell',
  'cg bench': 'close grip bench press',
  'flat bench': 'bench press',
  'back squat': 'squat',
  pullup: 'pull-up',
  pullups: 'pull-up',
  'pull ups': 'pull-up',
  chinup: 'chin-up',
  chinups: 'chin-up',
  'lat pulldown': 'lat pulldown',
  'leg ext': 'leg extension',
  'ham curl': 'leg curl',
  'calf raises': 'calf raise',
  'face pulls': 'face pull',
  'hip thrusts': 'hip thrust',
}

export function expandAlias(query) {
  const q = normalize(query)
  if (ALIASES[q]) return ALIASES[q]
  // Also expand a leading db/bb token: "db press" → "dumbbell press"
  const words = q.split(' ')
  if (words.length > 1 && ALIASES[words[0]] && words[0].length <= 2) {
    return [ALIASES[words[0]], ...words.slice(1)].join(' ')
  }
  return null
}

/** Escape the PostgREST `ilike` wildcards so a user query is matched literally. */
export function escapeLike(value) {
  return String(value).replace(/[\\%_*]/g, m => `\\${m}`)
}

/**
 * Score how well a known exercise name matches a query. Higher is better,
 * 0 means no match at all.
 */
function scoreMatch(query, candidate) {
  const q = normalize(query)
  const c = normalize(candidate)
  if (!q || !c) return 0
  if (q === c) return 100
  if (c.startsWith(q)) return 80
  if (c.includes(q)) return 60
  if (q.includes(c)) return 50

  const qTokens = new Set(q.split(' ').filter(Boolean))
  const cTokens = c.split(' ').filter(Boolean)
  const overlap = cTokens.filter(t => qTokens.has(t)).length
  if (!overlap) return 0
  // Reward covering the query, penalise long unrelated names
  return Math.round((overlap / Math.max(qTokens.size, cTokens.length)) * 40)
}

/**
 * Resolve a free-text query against the user's known exercise names.
 *
 * Returns { match, candidates } where `match` is set only when exactly one
 * name wins outright at the top score. Otherwise `candidates` holds the
 * plausible options (best first) for the caller to disambiguate with.
 */
export function resolveExercise(query, knownNames, { limit = 5 } = {}) {
  const names = [...new Set((knownNames || []).map(normalize).filter(Boolean))]
  if (!names.length) return { match: null, candidates: [] }

  const attempts = [query, expandAlias(query)].filter(Boolean)

  for (const attempt of attempts) {
    const scored = names
      .map(name => ({ name, score: scoreMatch(attempt, name) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)

    if (!scored.length) continue

    // Auto-resolve only when there is no real choice to make: either the query
    // names the exercise exactly, or exactly one known name matches at all.
    // A strong-but-not-exact winner ("bench" over "Bench Press" when incline
    // and close-grip also exist) is still a guess, so it goes to the user.
    if (scored[0].score === 100) return { match: scored[0].name, candidates: [] }
    if (scored.length === 1)     return { match: scored[0].name, candidates: [] }

    return { match: null, candidates: scored.slice(0, limit).map(s => s.name) }
  }

  return { match: null, candidates: [] }
}

// ── History shaping ───────────────────────────────────────────────────────────

/** Epley estimated 1RM. Returns null when the set isn't a loaded working set. */
export function est1RM(weightKg, reps) {
  if (weightKg == null || !reps || reps <= 0) return null
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

function topSetOf(sets) {
  const loaded = sets.filter(s => s.reps != null)
  if (!loaded.length) return null
  return [...loaded].sort((a, b) => {
    const aw = a.weight_kg ?? 0, bw = b.weight_kg ?? 0
    if (bw !== aw) return bw - aw
    return (b.reps ?? 0) - (a.reps ?? 0)
  })[0]
}

function mean(values) {
  const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (!nums.length) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}

/**
 * Group raw set rows into per-session entries, newest first.
 *
 * @param {Array}  rows       set rows for a single exercise
 * @param {Object} sessionMeta session_id → { session_type, duration_mins, ... }
 */
export function buildSessions(rows, sessionMeta = {}) {
  const bySession = {}
  for (const row of rows || []) {
    const sid = String(row.session_id || `__${row.date}`)
    if (!bySession[sid]) bySession[sid] = []
    bySession[sid].push(row)
  }

  return Object.entries(bySession)
    .map(([sessionId, sets]) => {
      const ordered = [...sets].sort((a, b) => (a.set_num ?? 0) - (b.set_num ?? 0))
      const top = topSetOf(ordered)
      const volume = ordered.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0)
      return {
        sessionId,
        date: ordered[0]?.date || '',
        sessionType: sessionMeta[sessionId]?.session_type || null,
        sets: ordered.map(s => ({
          setNum: s.set_num,
          weightKg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
          rir: s.rir,
          note: s.note,
          injuryFlag: !!s.injury_flag,
          injuryBodyPart: s.injury_body_part,
        })),
        topSet: top ? { weightKg: top.weight_kg, reps: top.reps, rpe: top.rpe } : null,
        volumeKg: Math.round(volume),
        est1rm: top ? est1RM(top.weight_kg, top.reps) : null,
        avgRpe: mean(ordered.map(s => s.rpe)),
      }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

function daysSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(`${dateStr}T00:00:00`).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

/** Roll per-session entries up into the headline numbers shown on the card. */
export function buildStats(sessions) {
  if (!sessions.length) {
    return { totalSessions: 0, totalSets: 0, lastPerformed: null, daysSince: null,
             pr: null, latest: null, delta30: null, avgRpe: null, trend: null, injuries: [] }
  }

  const withEst = sessions.filter(s => s.est1rm != null)
  const pr = withEst.length
    ? withEst.reduce((best, s) => (s.est1rm > best.est1rm ? s : best), withEst[0])
    : null

  const latest = sessions[0]
  const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const older = withEst.find(s => s.date < cutoff30)
  const delta30 = latest.est1rm != null && older?.est1rm != null
    ? Math.round((latest.est1rm - older.est1rm) * 10) / 10
    : null

  const injuries = []
  for (const s of sessions.slice(0, 10)) {
    for (const set of s.sets) {
      if (set.injuryFlag) injuries.push({ date: s.date, bodyPart: set.injuryBodyPart, note: set.note })
    }
  }

  return {
    totalSessions: sessions.length,
    totalSets: sessions.reduce((n, s) => n + s.sets.length, 0),
    lastPerformed: latest.date,
    daysSince: daysSince(latest.date),
    pr: pr ? { weightKg: pr.topSet?.weightKg ?? null, reps: pr.topSet?.reps ?? null, date: pr.date, est1rm: pr.est1rm } : null,
    latest: { est1rm: latest.est1rm, topSet: latest.topSet, date: latest.date },
    delta30,
    avgRpe: mean(sessions.slice(0, 3).flatMap(s => s.sets.map(x => x.rpe))),
    trend: delta30 == null ? null : delta30 > 0.5 ? 'up' : delta30 < -0.5 ? 'down' : 'flat',
    injuries: injuries.slice(0, 3),
  }
}

const LOWER_BODY = /squat|deadlift|lunge|leg press|hip thrust|rdl|romanian|good morning/i

/**
 * Deterministic next-load suggestion. This is the floor the card shows even if
 * the AI advice call fails, so it must never depend on the model.
 */
export function suggestNextLoad(sessions, exerciseName) {
  const last = sessions[0]
  if (!last?.topSet?.weightKg || !last.topSet.reps) return null

  const { weightKg, reps } = last.topSet
  const step = LOWER_BODY.test(exerciseName) ? 5 : 2.5

  const effort = last.avgRpe ?? last.topSet.rpe
  const minRir = Math.min(...last.sets.map(s => (s.rir == null ? Infinity : s.rir)))
  const prev = sessions[1]
  const repsDropped = prev?.topSet?.reps != null && reps < prev.topSet.reps
                      && (prev.topSet.weightKg ?? 0) >= weightKg

  let nextWeight = weightKg
  let rationale

  if (effort != null && effort >= 9) {
    rationale = `Last session topped out at RPE ${effort} — repeat ${formatWeight(weightKg, 'metric')} and win the reps before adding load.`
  } else if (repsDropped) {
    rationale = `Reps fell from ${prev.topSet.reps} to ${reps} at the same load — hold ${formatWeight(weightKg, 'metric')} until all sets are clean.`
  } else if ((effort != null && effort <= 7.5) || (minRir !== Infinity && minRir >= 2)) {
    nextWeight = weightKg + step * 2
    rationale = `Last session left reps in reserve, so a double jump of ${step * 2}kg is justified.`
  } else {
    nextWeight = weightKg + step
    rationale = `Standard progression: ${step}kg on last session's ${formatWeight(weightKg, 'metric')}.`
  }

  return {
    weightKg: Math.round(nextWeight * 2) / 2,
    reps,
    sets: last.sets.length,
    rationale,
  }
}

// ── Prompt rendering ──────────────────────────────────────────────────────────

/** Render the resolved history as compact text for the coaching prompt. */
export function renderHistoryForPrompt(exercise, sessions, stats, units) {
  const lines = [`=== ${displayName(exercise).toUpperCase()} — LAST ${sessions.length} SESSIONS ===`]

  for (const s of sessions) {
    const setText = s.sets.map(set => {
      const w = formatWeight(set.weightKg, units)
      const r = set.reps ?? '?'
      const rpe = set.rpe != null ? ` @RPE${set.rpe}` : ''
      const rir = set.rir != null ? ` RIR${set.rir}` : ''
      const inj = set.injuryFlag ? ` [INJURY: ${set.injuryBodyPart || 'unspecified'}]` : ''
      return `${w}×${r}${rpe}${rir}${inj}`
    }).join(', ')

    const notes = s.sets.filter(x => x.note).map(x => x.note)
    lines.push(
      `[${s.date}${s.sessionType ? ` | ${s.sessionType}` : ''}] ${setText}` +
      (s.est1rm != null ? ` | est1RM ${formatWeight(s.est1rm, units)}` : '') +
      (notes.length ? ` | notes: ${notes.join('; ')}` : '')
    )
  }

  lines.push('')
  lines.push('=== SUMMARY ===')
  if (stats.pr) {
    lines.push(`Best est. 1RM: ${formatWeight(stats.pr.est1rm, units)} on ${stats.pr.date} ` +
               `(${formatWeight(stats.pr.weightKg, units)} × ${stats.pr.reps})`)
  }
  if (stats.daysSince != null) lines.push(`Last performed: ${stats.daysSince} day(s) ago`)
  if (stats.delta30 != null)   lines.push(`30-day est. 1RM change: ${stats.delta30 > 0 ? '+' : ''}${formatWeight(Math.abs(stats.delta30), units)} (${stats.trend})`)
  if (stats.avgRpe != null)    lines.push(`Average RPE across the last 3 sessions: ${stats.avgRpe}`)
  if (stats.injuries.length) {
    lines.push('Recent injury flags on this lift:')
    for (const i of stats.injuries) lines.push(`  - ${i.date}: ${i.bodyPart || 'unspecified'}${i.note ? ` — ${i.note}` : ''}`)
  }

  return lines.join('\n')
}
