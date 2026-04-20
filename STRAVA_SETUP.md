# Strava Integration Setup

## 1. Create a Strava API Application

1. Go to https://www.strava.com/settings/api
2. Click **Create & Manage Your App**
3. Fill in:
   - **Application Name:** Avenra
   - **Category:** Training
   - **Club:** (leave blank)
   - **Website:** https://getavenra.com
   - **Authorization Callback Domain:** `getavenra.com`
4. After creation, note your **Client ID** and **Client Secret**

## 2. Environment Variables

Add these to your Vercel project (Settings → Environment Variables):

| Variable | Value | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | from Strava app settings | |
| `STRAVA_CLIENT_SECRET` | from Strava app settings | Keep secret |
| `STRAVA_REDIRECT_URI` | `https://getavenra.com/api/strava/callback` | Must match exactly |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string | e.g. `openssl rand -hex 20` |
| `STRAVA_ENCRYPTION_KEY` | 64-char hex string | Generate: `openssl rand -hex 32` |
| `STRAVA_APP_URL` | `https://getavenra.com` | Used for post-OAuth redirects |
| `CRON_SECRET` | any random string | Used to authenticate daily cron calls |

> **Important:** `STRAVA_REDIRECT_URI` must be an exact match — Strava rejects mismatches.
> For local development, use a different app or ngrok tunnel with its own redirect URI.

## 3. Register the Webhook Subscription

Run this once after deploying to production (replace values):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://getavenra.com/api/strava/webhook \
  -F verify_token=YOUR_STRAVA_WEBHOOK_VERIFY_TOKEN
```

Expected response:
```json
{"id": 12345}
```

Save the subscription ID — you'll need it to delete or update the subscription later.

**To verify the subscription is active:**
```bash
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET
```

**To delete a subscription:**
```bash
curl -X DELETE https://www.strava.com/api/v3/push_subscriptions/12345 \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET
```

## 4. Vercel Cron (Daily Sync)

The daily catch-up sync runs at 04:00 UTC via `vercel.json`. It requires:
- Vercel Pro plan (cron jobs are a Pro feature)
- `CRON_SECRET` env var set

Vercel calls `POST /api/strava/sync` with `x-cron-secret: YOUR_CRON_SECRET`.

If not on Pro, you can trigger the sync manually or use an external cron service (cron-job.org, etc.) to POST to the endpoint with the header.

## 5. Scopes Requested

Avenra requests:
- `read` — basic athlete info
- `activity:read_all` — all activities including private ones

This gives the coach full context including activities marked "Only Me" in Strava, which is important for accurate fatigue estimation. To reduce scope, change the `SCOPES` constant in `webapp/api/strava/connect.js`.

## 6. Local Development

Strava's OAuth callback must be HTTPS. For local dev:

1. Use [ngrok](https://ngrok.com): `ngrok http 3000`
2. Create a separate Strava app with the ngrok URL as callback domain
3. Set `STRAVA_REDIRECT_URI` to `https://your-ngrok-url.ngrok.io/api/strava/callback`

The webhook endpoint also requires a publicly accessible HTTPS URL — ngrok handles this.
