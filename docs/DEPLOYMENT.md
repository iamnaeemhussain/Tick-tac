# Deployment guide (beginner-friendly)

Deploying Tick-Tac Arena = **one Worker** (static assets + API + Durable
Objects). No databases, no extra services, no build servers.

## 0. Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (Free works for
  launch-scale; see docs/CAPACITY.md for when to upgrade).
- Node.js ≥ 20 and npm.
- ~10 minutes.

## 1. Get the code and log in

```bash
git clone https://github.com/iamnaeemhussain/Tick-tac.git
cd Tick-tac
npm install
npx wrangler login        # opens a browser OAuth flow; approve
npx wrangler whoami       # sanity check: prints your account id
```

## 2. Configure (optional but recommended)

Edit `wrangler.jsonc`:

- `name`: your Worker name (becomes `<name>.<subdomain>.workers.dev`).
- `vars`: room TTL, grace period, rate limits (defaults are sensible).
- `compatibility_date`: leave as-is unless you know why you're changing it.

Nothing else is required — **no database IDs, no secrets**. The app has no
server-side secrets by design.

## 3. Build and deploy

```bash
npm run build       # SPA → dist/
npx wrangler deploy # uploads Worker + assets + DO classes (applies migration v1)
```

First deploy output ends with something like:

```
https://tick-tac-arena.<your-subdomain>.workers.dev
```

Open it. Play solo immediately. Create a room, open the invite URL in a
private window (second "device"), join, play, rematch. ✅

> The deploy automatically registers the two Durable Object classes via the
> `migrations` block (`v1`, SQLite-backed — Free-plan compatible). Never edit
> or delete an applied migration tag; add new tags for future changes.

## 4. Custom domain (recommended for sharing & SEO)

1. In Cloudflare dashboard: **Workers & Pages → your Worker → Settings →
   Domains & Routes → Add Custom Domain** (e.g. `play.example.com`).
2. Update `index.html`: set `<link rel="canonical">` and the OG `og:url`
   values to your real domain; regenerate `public/og.png` if you rebrand
   (`python3 scripts/generate_og.py`).
3. Redeploy (`npm run deploy`). Cloudflare provisions SSL automatically.

Without a custom domain the `workers.dev` URL still works fully, including
WebSockets (`wss://` is automatic).

## 5. Launch-hardening checklist (dashboard)

These are **dashboard** settings, not code:

1. **Rate limiting rule** (Security → WAF → Rate limiting rules):
   e.g. `(http.request.uri.path matches "^/api/rooms")` limit 60 req/10 s per
   IP — complements the in-app LimiterDO.
2. **Bot Fight Mode**: enabled for launch; switch to Super Bot Fight Mode
   (Paid) if scraped.
3. **Observability**: already on via `observability.enabled` — check Workers
   → Metrics weekly; set an alert on error rate > 1%.
4. **Log hygiene (privacy)**: Workers Logs is off by default; if you enable
   it, keep sampling low and confirm no request bodies are logged (we never
   log names/boards/tokens; see docs/PRIVACY.md). Do **not** enable request
   body logging or full-URL log export for `/api/rooms/*/ws` traffic.
5. **Analytics Engine (optional)**: aggregate counters only (rooms created,
   rounds played) if you want growth metrics without storing games.
6. **Backups/retention**: nothing to configure — there is no persistent data.

## 6. Enabling ads later (phase 2)

See docs/ADS.md. Summary: put your AdSense client id + slot ids in
`src/config.ts`, set `ADS_CONFIG.enabled = true`, redeploy. Containers are
already reserved in the layout — zero layout shift, zero gameplay impact, and
the game still works if the ad script fails or is blocked.

## 7. Updating the app

```bash
git pull
npm install         # if package.json changed
npm run build
npx wrangler deploy
```

Static assets are content-hashed and edge-cached; `index.html` is served
`no-cache`, so users pick up new versions on next load. Live rooms survive
deploys in most cases (DO classes unchanged); if a deploy changes DO code,
in-flight rooms are dropped at next message — players see the reconnect flow
and can resume inside the grace window when the object restarts… **except**
that in-memory state is gone after a code deploy (expected for a
zero-persistence design): document "rooms may reset on deploy" in your
release notes.

## 8. Rollback

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

## 9. Local preview / CI

- `npm run cf-dev` — full local stack (DOs run in-memory).
- `npm run smoke` — 35-assertion end-to-end suite vs any running instance.
- `.github/workflows/ci.yml` — typecheck + unit tests + build + smoke on
  every push/PR.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error 1027` / 429 from Cloudflare | Free-plan daily cap reached → upgrade plan |
| WS connects but stalls | Check proxy/CDN in front isn't buffering upgrades; workers.dev & custom domains on CF handle upgrades natively |
| Room "expired" instantly | Compare client/server clocks? No — check `GRACE_SECONDS` wasn't overridden tiny in `vars` |
| `Durable Object migration` error on deploy | Don't rename classes; add a new migration tag instead |
| Invite link 404 on deep link | Ensure you deploy via wrangler (SPA fallback lives in the Worker) — plain static hosts won't route `/room/*` |
