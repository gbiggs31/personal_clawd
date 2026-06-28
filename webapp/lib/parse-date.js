const MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
}
const MONTH_PAT = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)'

// Format a Date as YYYY-MM-DD using its LOCAL calendar components.
// Going via toISOString() would convert to UTC first, shifting the date back a
// day for any positive-offset timezone (e.g. "April 20" → "...-04-19" in UK summer).
function toLocalISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Extract a past date from free-form text.
 * Recognises: "yesterday", "N days ago", "April 20", "20th April", "20/04".
 * Returns a YYYY-MM-DD string or null if no date found.
 */
export function parseDateFromNote(text) {
  if (!text) return null
  const t = text.toLowerCase()
  const today = new Date()

  if (/\byesterday\b/.test(t)) {
    const d = new Date(today)
    d.setDate(d.getDate() - 1)
    return toLocalISODate(d)
  }

  const daysAgo = t.match(/\b(\d+)\s+days?\s+ago\b/)
  if (daysAgo) {
    const d = new Date(today)
    d.setDate(d.getDate() - parseInt(daysAgo[1]))
    return toLocalISODate(d)
  }

  // "April 20" / "April 20th"
  const m1 = t.match(new RegExp(`\\b${MONTH_PAT}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`))
  if (m1) {
    const d = new Date(today.getFullYear(), MONTHS[m1[1]] - 1, parseInt(m1[2]))
    if (d > today) d.setFullYear(d.getFullYear() - 1)
    return toLocalISODate(d)
  }

  // "20th April" / "20 April"
  const m2 = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PAT}\\b`))
  if (m2) {
    const d = new Date(today.getFullYear(), MONTHS[m2[2]] - 1, parseInt(m2[1]))
    if (d > today) d.setFullYear(d.getFullYear() - 1)
    return toLocalISODate(d)
  }

  // "20/04" or "20/4" (DD/MM). The negative lookbehind/lookahead avoid matching
  // a slash inside a longer sequence such as a set/rep scheme or programme name
  // ("5/3/1", "5/5/5"), which would otherwise be misread as a date.
  const m3 = t.match(/(?<!\d\/)\b(\d{1,2})\/(\d{1,2})\b(?!\/\d)/)
  if (m3) {
    const day = parseInt(m3[1]), month = parseInt(m3[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(today.getFullYear(), month - 1, day)
      if (d > today) d.setFullYear(d.getFullYear() - 1)
      return toLocalISODate(d)
    }
  }

  return null
}
