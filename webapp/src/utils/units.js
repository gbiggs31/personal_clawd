import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/**
 * Weight display units.
 *
 * Weights are ALWAYS stored in kilograms (`sets.weight_kg`). Conversion to lbs
 * happens here, at the display layer, and nowhere else. Before this existed,
 * Progress / Dashboard / SessionDetail each hard-coded "kg" while chat, plans
 * and log confirmations honoured the preference — so imperial users saw both.
 */

const CACHE_KEY = 'avenra-units'
const VALID = new Set(['metric', 'imperial'])

export function kgToLbs(kg) { return Math.round(kg * 2.20462) }

/** Short label for the active unit: "kg" or "lbs". */
export function unitLabel(units) { return units === 'imperial' ? 'lbs' : 'kg' }

/** Convert a stored kg value to the display unit (still a number). */
export function toDisplayWeight(kg, units) {
  if (kg == null) return null
  return units === 'imperial' ? kgToLbs(kg) : kg
}

/**
 * Inverse of toDisplayWeight: take a number the user typed into a field
 * labelled with the active unit and convert it back to kilograms for storage.
 * Rounds to 1dp, matching the lbs handling in api/log.js.
 */
export function fromDisplayWeight(value, units) {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(n)) return null
  return units === 'imperial' ? Math.round(n * 0.453592 * 10) / 10 : n
}

/** Format a stored kg value for display, e.g. "100kg" / "220lbs" / "BW". */
export function formatWeight(kg, units, bodyweightLabel = 'BW') {
  if (kg == null) return bodyweightLabel
  return `${toDisplayWeight(kg, units)}${unitLabel(units)}`
}

/** Format a set's weight and reps on one line, e.g. "100kg × 5". */
export function formatWeightReps(set, units) {
  if (!set) return ''
  const reps = set.reps != null ? `× ${set.reps}` : ''
  return `${formatWeight(set.weight_kg, units)} ${reps}`.trim()
}

let inflight = null

async function fetchUnits() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return 'metric'
  const res = await fetch('/api/profile', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) return 'metric'
  const data = await res.json()
  const value = data?.profile?.units
  return VALID.has(value) ? value : 'metric'
}

/**
 * The user's unit preference. Reads once per browser session and caches in
 * sessionStorage, so mounting this in several components costs one request.
 * Defaults to metric while loading and on any failure.
 */
export function useUnits() {
  const [units, setUnits] = useState(() => sessionStorage.getItem(CACHE_KEY) || 'metric')

  useEffect(() => {
    if (sessionStorage.getItem(CACHE_KEY)) return
    let cancelled = false
    inflight = inflight || fetchUnits()
    inflight
      .then(value => {
        sessionStorage.setItem(CACHE_KEY, value)
        if (!cancelled) setUnits(value)
      })
      .catch(() => {})
      .finally(() => { inflight = null })
    return () => { cancelled = true }
  }, [])

  return units
}
