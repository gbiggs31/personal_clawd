// Centralised model selection so the cost/quality tradeoff lives in one place.
//
//   SONNET — where coaching quality is the product: the chat coach, the daily
//            plan generation, the post-session debrief, and /lift advice.
//   HAIKU  — mechanical, structured, low-stakes work: parsing a free-text log
//            into JSON, and classifying a session as push/pull/legs/etc.
//
// To dial quality vs cost, change these two constants (and nothing else).
export const MODEL_SONNET = 'claude-sonnet-5'
export const MODEL_HAIKU  = 'claude-haiku-4-5'

/**
 * ⚠️ Sonnet 5 runs **adaptive thinking by default** when the `thinking`
 * parameter is omitted — unlike Sonnet 4.6, which ran without thinking.
 * Thinking tokens are drawn from `max_tokens`, so an omitted `thinking` on a
 * tightly-sized request truncates the answer mid-sentence.
 *
 * Every Sonnet call site must therefore pass one of these explicitly:
 *
 *   NO_THINKING — latency-sensitive or mechanical work. Keeps time-to-first-
 *                 token low, which matters for the streamed chat.
 *   THINKING    — reasoning-heavy work where a few seconds of pause is
 *                 acceptable. Budget ~1500 extra tokens of headroom.
 */
export const NO_THINKING = { type: 'disabled' }
export const THINKING    = { type: 'adaptive' }

/**
 * Wrap a long, static system prompt as a cacheable content block so Anthropic
 * prompt caching can serve it at ~10% of the input cost on repeat calls within
 * the 5-minute ephemeral TTL.
 *
 * Pass any per-request/per-user text as `dynamicText`: it goes in a separate
 * trailing block so the cached prefix stays byte-identical across calls.
 *
 * ⚠️ Caching only engages above a per-model minimum prefix length — 1024
 * tokens on Sonnet 5, 4096 on Haiku 4.5. Below that the block is silently not
 * cached (no error; `usage.cache_creation_input_tokens` stays 0). Of our call
 * sites only `chat.js` clears the bar, because its system block carries 90
 * days of training history. The markers on the shorter prompts in `log.js`
 * and `done.js` are inert — harmless, and correct if those prompts grow.
 */
export function cachedSystem(staticText, dynamicText = '') {
  const blocks = [{ type: 'text', text: staticText, cache_control: { type: 'ephemeral' } }]
  if (dynamicText) blocks.push({ type: 'text', text: dynamicText })
  return blocks
}

/**
 * Pull the assistant's text out of a non-streaming response.
 *
 * `content[0]` is NOT safe to index: when thinking is enabled the first block
 * is a `thinking` block and the text follows it. Returns null when the
 * response carries no text block at all.
 */
export function firstText(response) {
  const block = response?.content?.find(b => b.type === 'text')
  return typeof block?.text === 'string' ? block.text : null
}

/**
 * Strip markdown code fences from a model response that should be raw JSON.
 * Returns the parsed value, or null if it isn't valid JSON.
 */
export function parseJsonResponse(text) {
  if (!text) return null
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(stripped) } catch { return null }
}
