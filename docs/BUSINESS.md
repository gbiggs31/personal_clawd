# Avenra — Business Potential, Growth Plan & Cost Report

> Framing: **goal = sustainable indie SaaS income**, **growth budget < £100/mo (organic-first)**.
> Money figures are planning estimates — verify current Anthropic/Supabase/Vercel pricing before
> committing.

## 1. Context — what Avenra is today

An AI strength-training coach with an unusual wedge: **you log workouts in plain language**
("bench 3x5 @ 100kg, last set grindy") and Claude turns it into structured data, then coaches
off the full history. Two front doors (Telegram bot + React PWA), one Supabase database.

Working features: NL logging + parsing, post-session AI debriefs, AI "Today" plans (history +
profile + programme + Strava fatigue + coaching rules), a chat coach with memory, progress
charts + per-exercise recall, Strava load integration, onboarding, GDPR scaffolding (consent,
deletion requests, privacy/terms), PostHog analytics, admin + bug reports.

**Stage:** invite-only private beta with a waitlist landing page. **Monetization today:** none —
only a "Buy me a coffee" donation CTA. No Stripe/paywall/tiers exist yet.

## 2. Verdict (TL;DR)

Credible **indie SaaS**, not an obvious venture play. The conversational-logging + memory +
fatigue-aware coaching combo is a real differentiator for a specific niche, and the unit
economics work at a normal subscription price. Realistic trajectory with consistent
content/community effort: **£1k–5k MRR (~150–800 paying users) over 12–24 months**; £10k+ is
possible but distribution-bound. The two things that decide it: **retention** (fitness apps churn
hard) and **keeping AI cost per user under control**.

## 3. Market & positioning

- **Market:** strength-tracking apps are large and proven — Strong, Hevy, Fitbod, JEFIT,
  Boostcamp, FitNotes. Hevy/Strong/Fitbod count users in the millions; paid tiers run
  ~£4–10/mo or ~£25–80/yr. People already pay to track lifting.
- **The wedge:** manual set-by-set tapping is the #1 friction that makes people quit tracking.
  "Talk to your log" removes it. Add an AI coach that *remembers everything* and adjusts to
  Strava-measured fatigue, and you have something the incumbents don't (yet). The **Telegram-native
  logging** path (log without opening an app) is a second distinct hook.
- **Niche to own first:** *serious intermediate lifters who run their own programme* and want an
  AI training partner — not absolute beginners (they want guided apps) and not the manual-control
  Strong/Hevy purists. Narrow positioning beats "another gym app."
- **Honest risk:** incumbents can bolt on AI. Your moat is execution speed on the wedge + the
  memory/coaching quality + community trust, not the tech itself.

## 4. Unit economics (the part that decides margin)

**AI is the only meaningful variable cost.** Estimate for one *engaged* user (~16 sessions/mo,
logging + debriefs + ~12 plans + ~25 coach chats), all on Claude Sonnet 4.x:

| Driver | ~Input tok/mo | ~Output tok/mo |
|---|---|---|
| Log parsing (`/api/log`) | 96k | 19k |
| Session debrief (`/api/done`) | 38k | 8k |
| Today plans (`/api/today-plan`) | 60k | 10k |
| Coach chat (`/api/chat`) | 125k | 12k |
| **Total** | **~319k** | **~49k** |

At ~$3/M input, ~$15/M output → **≈ $1.70/engaged user/mo** (~£1.40); light users < £1,
heavy chat/plan users **£4–6**. Call the planning range **£1.5–4 per active/mo**.

**Fixed infra (small scale):**

| Item | Cost | Notes |
|---|---|---|
| Supabase | £0 → ~£20/mo (Pro) | Free tier until you outgrow it |
| Vercel | £0 → ~£16/mo (Pro) | Hobby is non-commercial — Pro needed once you charge |
| Telegram bot VPS | ~£4/mo | Hetzner/DO small instance |
| PostHog | £0 | 1M events/mo free |
| Domain / email | ~£1/mo + free tier | |
| **Fixed total** | **~£0–10 early → ~£40/mo** once on Pro tiers | |

**Break-even at a £6/mo sub:** ~£3 gross/user after AI → **~15–20 paying users covers all fixed
costs**. Very reachable. Margin improves sharply with the optimisations in §6.

## 5. Recommended monetization — **freemium subscription**

- **Free tier (the habit hook):** unlimited logging + history + progress charts, *plus a capped
  amount of AI* (e.g. a few AI plans + a handful of coach chats per week). The free tier must keep
  the "talk to your log" magic to build the daily habit — but **cap the expensive AI**, or you pay
  to serve non-payers (the #1 freemium risk here, because AI cost scales with free users too).
- **Avenra Pro — ~£5.99/mo or £49/yr:** unlimited AI plans, unlimited coach chat, Strava coaching
  context, advanced analytics. Priced above the ~£3 AI cost for healthy margin and in line with
  Strong/Fitbod. Annual improves cash flow and retention.
- **Beta "Founders" lifetime/lifetime-discount** (optional): a cheap one-off for early adopters →
  cash + testimonials + goodwill while you finish Pro.
- Keep Buy-me-a-coffee as the no-pressure option until Pro launches.

Why subscription over one-off/donations: costs are **recurring** (every plan/chat costs money), so
revenue should recur too; donations won't cover AI at scale; one-off breaks the cost alignment.

## 6. Cost-optimisation levers (do these *before* growth)

AI is the cost, so protect margin first:
1. **Prompt caching** (Anthropic) for the big repeated context — system prompts + 90-day history in
   `chat`/`today-plan`. Cache hits can cut input cost 50–90%.
2. **Use Haiku for the mechanical steps** — `log` parsing and `done` classification don't need
   Sonnet. Reserve Sonnet for plans/chat/debrief quality. Likely 40–60% cheaper on those calls.
3. **Trim history context** — feed a compact summarised "training state" (the existing
   `program_state` is the seed of this) instead of dumping raw sets into every prompt.
4. Free-tier AI caps + the existing rate limits (already in `log`/`chat`/`today-plan`).

Target: get blended AI cost toward **£1–2 per active/mo**, lifting Pro gross margin above ~70%.

## 7. Staged test/grow plan (lean, organic-first, < £100/mo)

**Stage 0 — Validate the loop (now, 4–8 wks).** 10–30 engaged lifters (your network + 1–2 niche
communities). Prove **activation** (first logged session) and **week-2 retention** with the
PostHog funnels you already have. *Cost ≈ £0–10/mo.* **Gate:** people return in week 2 unprompted,
and logging accuracy is trustworthy.

**Stage 1 — Beta + monetization scaffolding (mo 2–4, 50–150 users).** Open the waitlist in cohorts.
Build Stripe + Pro tier + free-tier AI caps. Soft-launch Pro to beta users at the Founders price.
*Cost ≈ £40–80/mo (Supabase+Vercel Pro + AI×actives).* **Gate:** first ~10–20 payers; D30 logging
retention ≥ ~25–30%; cost/active within plan.

**Stage 2 — Public launch + organic growth (mo 4–9).** Public PWA + ProductHunt; content/SEO
("AI gym coach", "talk to your gym log"); value-first Reddit (r/weightroom, r/fitness,
r/naturalbodybuilding, r/strength_training); short-form video of the conversational-logging demo
(very shareable); micro-creator partnerships (free Pro / affiliate); lean on the Telegram-native
hook. Ship the §6 cost optimisations here. *Cost ≈ £40–80/mo infra+AI + ~£20–40 tools/small ad
tests, inside the £100 budget.* **Gate:** at least one repeatable channel with retention holding.

**Stage 3 — Scale what works (9 mo+).** Double down on the 1–2 channels that work; add referral
("give a month, get a month"); consider a coach/B2B angle (manage clients) or a native wrapper if
PWA limits bite. Costs rise with actives/possible contractor — let revenue lead.

## 8. Key risks

- **Retention** — existential for any subscription; fitness churn is brutal. Watch it above all.
- **Incumbents add AI** — keep the wedge (conversational logging + memory + fatigue) sharp.
- **Margin erosion** — over-generous free tier or growing context inflates AI cost.
- **Logging trust** — one mis-parsed set erodes confidence fast; invest in parse accuracy + easy edit.
- **Solo bandwidth** — support/ops load as users grow.
- **Platform dependence** — Telegram, Strava API terms, Anthropic pricing changes.

## 9. Metrics to watch

- **Activation:** % of signups who log ≥1 session; ≥3 sessions in week 1.
- **Retention (north star):** D7/D30 logging retention; weekly active loggers.
- **Engagement:** sessions/active/week; AI plan + chat usage.
- **Money:** free→paid conversion, MRR, churn, and **gross margin/user = price − AI cost**.

## 10. Immediate next steps

1. Confirm PostHog is capturing activation + week-2 retention; pick 2–3 north-star metrics.
2. Recruit 10–20 engaged beta lifters; watch retention + logging accuracy (Stage 0 gate).
3. Decide free-tier caps + Pro price; build Stripe + caps (Stage 1).
4. Implement prompt caching + Haiku for parse/classify **before** any growth push (margin guard).
5. Cut the shareable conversational-logging demo clip for organic channels.
