# Avenra

Talk to your gym log. Avenra turns natural-language workout messages into
structured training data, then uses that history to answer questions, spot
trends, and generate training plans.

> This repo started life as a personal Claude Telegram bot ("The Claw") and grew
> into Avenra. The git history still reflects that origin.

---

## Components

The project is three pieces that share one Supabase database:

| Path | What it is | Runtime / hosting |
|---|---|---|
| `webapp/` | The Avenra app — React + Vite frontend and serverless API | Vercel (root dir = `webapp/`) |
| `bot.py` + `gym_*.py`, `coaching_pipeline.py` | Telegram bot that ingests natural-language gym logs and runs the coaching pipeline | Python, runs on a VM |
| `index.html`, `landing.html`, `signup.html` | Marketing / landing site | GitHub Pages (`CNAME` → avenra.biggsdata.com) |

The webapp is self-contained — its `api/` and `lib/` import nothing outside
`webapp/`. The bot and webapp are coupled only through the shared Supabase
database (`telegram_user_id`, and tables like `sets`, `sessions`, `profile`).

---

## Webapp (`webapp/`)

Vite + React frontend with Vercel serverless functions under `webapp/api/`.

```bash
cd webapp
npm install
cp .env.example .env   # fill in Supabase + PostHog keys
npm run dev            # local dev server
npm run build          # production build
```

Server-side env vars (set in Vercel, not committed): `VITE_SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_EMAIL`, plus the Strava and
cron secrets used by `api/strava.js`. A daily Strava sync runs via the cron
defined in `webapp/vercel.json`.

Request auth for every endpoint is centralised in `webapp/lib/auth.js`
(`authenticateUser`): it validates the Supabase Bearer token and maps the
account to its `telegram_user_id`.

---

## Telegram bot (`bot.py`)

Ingests gym logs sent over Telegram, extracts structured sets with Claude
(`gym_extractor.py`), persists to Supabase (`gym_db.py`), and runs the coaching
pipeline (`coaching_pipeline.py`).

```bash
pip install -r requirements.txt
cp .env.example .env   # TELEGRAM_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY,
                       # SUPABASE_URL, SUPABASE_SERVICE_KEY, ...
python bot.py
```

Database schema lives in `schema.sql`, `coaching_schema.sql`, and
`webapp_schema.sql`. To run the bot 24/7, deploy to a cheap VPS
(Hetzner, DigitalOcean) or a free tier on Railway/Render.

---

## Landing site

Static HTML at the repo root, served by GitHub Pages. The custom domain is set
by the root `CNAME` file (avenra.biggsdata.com).

---

## Analytics (PostHog)

PostHog is split across the two runtimes:

- `webapp/` frontend on Vercel: set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST`
  in the Vercel project environment variables (browser-visible by design).
- Python bot / coaching worker on the VM: set `POSTHOG_PROJECT_TOKEN` and
  `POSTHOG_HOST` in the VM's environment (server-only).
