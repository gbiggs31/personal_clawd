/**
 * Returns a short tone modifier paragraph to append to any coaching system prompt.
 * The advice itself should never change — only the delivery.
 *
 * - focused:    direct, holds the user accountable to their stated goals
 * - supportive: warm, empathetic, quick to recognise effort and good work
 * - balanced:   default; neither clipped nor overtly warm (no modifier needed)
 */
export function coachingStyleNote(style) {
  if (style === 'focused') {
    return `Coaching style: Direct and accountable. Keep observations goal-oriented — tie feedback to what the user said they are working towards. Praise genuinely strong performances or PRs when they occur, but keep it brief and move straight to what matters next. Avoid filler encouragement.`
  }
  if (style === 'supportive') {
    return `Coaching style: Warm and encouraging. Acknowledge effort and consistency readily — if the user put in good work, say so clearly before moving on. When things went off track, be empathetic and help them refocus without dwelling on it. Still be specific and grounded in the numbers.`
  }
  // balanced (default) — no modifier; the base prompts already describe standard tone
  return ''
}
