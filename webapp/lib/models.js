// Centralised model selection so the cost/quality tradeoff lives in one place.
//
//   SONNET — where coaching quality is the product: the chat coach, the daily
//            plan generation, and the post-session debrief.
//   HAIKU  — mechanical, structured, low-stakes work: parsing a free-text log
//            into JSON, and classifying a session as push/pull/legs/etc.
//
// To dial quality vs cost, change these two constants (and nothing else).
export const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_HAIKU  = 'claude-haiku-4-5-20251001'

/**
 * Wrap a long, static system prompt as a cacheable content block so Anthropic
 * prompt caching can serve it at ~10% of the input cost on repeat calls within
 * the 5-minute ephemeral TTL (e.g. logging several sets in one session, or the
 * back-and-forth turns of a single coach chat).
 *
 * Pass any per-request/per-user text as `dynamicText`: it goes in a separate
 * trailing block so the cached prefix stays byte-identical across calls.
 * Returns the array shape that `system` accepts on messages.create / .stream.
 */
export function cachedSystem(staticText, dynamicText = '') {
  const blocks = [{ type: 'text', text: staticText, cache_control: { type: 'ephemeral' } }]
  if (dynamicText) blocks.push({ type: 'text', text: dynamicText })
  return blocks
}
