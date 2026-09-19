# WeCover free-tier deployment (24/7)

Single free Render web service serves the built UI + API on one origin.
Supabase Cloud free project provides Postgres + Auth + Storage.
Total cost: $0. No card required.

```
visitor -> wecover.onrender.com (Render free, Express serves dist/ + /api)
                -> <ref>.supabase.co (Supabase free)
keepalive: GitHub Actions ping every 6h (prevents Supabase 7-day auto-pause)
optional:  UptimeRobot free 5-min ping (prevents Render 15-min sleep)
```

## 1. Supabase Cloud project (once)

1. supabase.com > New project (free tier). Save: **Project URL**,
   **anon key**, **service_role key**, and the **DB password**.
2. Apply schema — either:
   - CLI: `supabase link --project-ref <ref>` then `supabase db push`, or
   - No-CLI: `node scripts/bundle-migrations.mjs`, then paste
     `artifacts/all-migrations.sql` into the project SQL Editor and run.
3. Seed demo accounts:
   ```
   set SUPABASE_URL=https://<ref>.supabase.co
   set SUPABASE_SERVICE_ROLE_KEY=<service_role>
   set DEMO_MODE=true
   set SEED_ALLOW_REMOTE=1
   node scripts/seed-test-accounts.mjs
   ```
   Creates test1 (operator) / test2 (customer) / test3 (provider), password `testtest`.

## 2. Render web service (once)

1. render.com > New > Blueprint > connect this repo (`render.yaml` is detected).
2. When prompted, set the secret env vars:

   | Key | Value |
   | --- | --- |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `VITE_SUPABASE_URL` | same as `SUPABASE_URL` (baked into the build) |
   | `VITE_SUPABASE_ANON_KEY` | anon key |
   | `GEMINI_API_KEY` | intake AI key |

3. Deploy. The app is live at `https://wecover.onrender.com` —
   health check: `/api/capabilities`.

## 3. Keep it awake

- **Supabase anti-pause**: repo Settings > Variables > Actions — set
  `PUBLIC_APP_URL` and `PUBLIC_SUPABASE_URL`. `.github/workflows/keepalive.yml`
  then pings every 6 hours.
- **Render anti-sleep** (optional): free UptimeRobot monitor hitting
  `https://wecover.onrender.com/api/capabilities` every 5 min. 24/7 awake uses
  ~744 of the 750 free instance-hours/month. Without it, first hit after
  15 idle minutes takes ~1 min to wake — still reachable, just slow once.

## Limits of the free tier

- Render free: 512 MB RAM, sleeps after 15 min idle without a pinger.
- Supabase free: 500 MB DB, 1 GB storage; pauses after 7 days with no API
  activity (the keepalive workflow prevents this).
- Ephemeral disk: uploaded media in Supabase Storage persists; anything
  written to local disk does not.
- Payments stay disabled (`PAYMENTS_ENABLED=false`) — fail-closed by design.
