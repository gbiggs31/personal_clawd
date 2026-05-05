const MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
}
const MONTH_PAT = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)'

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
    return d.toISOString().split('T')[0]
  }

  const daysAgo = t.match(/\b(\d+)\s+days?\s+ago\b/)
  if (daysAgo) {
    const d = new Date(today)
    d.setDate(d.getDate() - parseInt(daysAgo[1]))
    return d.toISOString().split('T')[0]
  }

  // "April 20" / "April 20th"
  const m1 = t.match(new RegExp(`\\b${MONTH_PAT}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`))
  if (m1) {
    const d = new Date(today.getFullYear(), MONTHS[m1[1]] - 1, parseInt(m1[2]))
    if (d > today) d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split('T')[0]
  }

  // "20th April" / "20 April"
  const m2 = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PAT}\\b`))
  if (m2) {
    const d = new Date(today.getFullYear(), MONTHS[m2[2]] - 1, parseInt(m2[1]))
    if (d > today) d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split('T')[0]
  }

  // "20/04" or "20/4"
  const m3 = t.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (m3) {
    const d = new Date(today.getFullYear(), parseInt(m3[2]) - 1, parseInt(m3[1]))
    if (d > today) d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split('T')[0]
  }

  return null
}
