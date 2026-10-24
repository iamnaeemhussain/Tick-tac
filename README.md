# 🎮 Tick-Tac Arena

**Instant Tic-Tac-Toe. Share a link. Win bragging rights.**

A fast, mobile-first, server-authoritative Tic-Tac-Toe web game built for
Cloudflare: **React + TypeScript** frontend, **Cloudflare Workers** backend,
**Durable Objects + WebSockets** for private multiplayer rooms — with **zero
permanent storage** of games, names, scores or history. No accounts, no
emails, no installs. Open a link, type a name, play.

- **Play with a Friend** — create a private room, share one link (WhatsApp /
  copy / native share), both players confirm their names, the match starts,
  unlimited rematches in the same room.
- **Play vs Computer** — Easy, Medium, or a provably unbeatable Hard AI
  (minimax), your choice of X or O. Runs entirely in the browser.

---

## Quick start (local)

```bash
npm install
npm run cf-dev        # starts the whole app (API + DOs + built SPA) on :8787
# in another terminal, build the SPA once (or after any src change):
npm run build
```

Open <http://127.0.0.1:8787> — homepage, solo mode and full multiplayer
(including WebSockets) all work locally.

| Script | Purpose |
| --- | --- |
| `npm run build` | Build the SPA to `dist/` (served by the Worker) |
| `npm run cf-dev` | Full-stack local dev (Worker + DOs + assets) on port 8787 |
| `npm run dev` | Vite HMR dev server (proxies `/api` + WS to `cf-dev` on 8787) |
| `npm test` | Unit tests (game rules, AI, protocol, authoritative engine) |
| `npm run typecheck` | Type-check frontend + worker |
| `npm run smoke` | End-to-end WebSocket integration test vs a running instance |
| `npm run loadtest` | Concurrency/load test (rooms × sockets × rematches) |
| `npm run deploy` | Build + deploy to Cloudflare (after `wrangler login`) |

Optional HMR workflow: run `npm run cf-dev` **and** `npm run dev`, then use
<http://localhost:5173> (API/WebSocket calls are proxied to the Worker).

---

## How it works (30-second version)

```
browser ── HTTPS ──▶ Cloudflare Worker (worker/index.ts)
   │                   ├─ /            → edge-cached static SPA (dist/)
   │                   ├─ /room/:code  → SPA shell, X-Robots-Tag: noindex
   │                   ├─ /api/rooms…  → create / join / end / info (REST)
   │                   └─ /api/rooms/:code/ws ──▶ RoomDO (Durable Object)
   │                                                 • in-memory room state only
   │                                                 • validates every move/turn/rematch
   │                                                 • broadcasts authoritative snapshots
   └── WebSocket ────────────────────────────────────▶ (same DO)
```

- **One Durable Object per room** (`worker/room.ts`) — state is fully isolated;
  no shared database, no global mutable state, no cross-room contention.
- **Nothing is persisted.** Names, boards, scores live only in DO memory and
  are discarded on end/expiry. The only storage call is `setAlarm()`, used
  purely as a guaranteed cleanup timer (plus an in-DO sweep timer).
- **Server-authoritative rules** (`worker/engine.ts`, pure & unit-tested):
  turn order, occupied cells, round ids (duplicate/stale-message idempotency),
  membership tokens, win/draw detection, rematch handshake, expiry.
- **Auto-cleanup**: rooms die after `ROOM_TTL_SECONDS` (default 30 min) of
  inactivity, or `GRACE_SECONDS` (default 60 s) after players disconnect —
  even if both browsers are closed (alarm-based, survives DO eviction).
- **Abuse controls**: per-IP create/join limiters (LimiterDO), per-connection
  message rate limits, payload caps, auth timeouts, unpredictable room codes
  (crypto-random, 8-char unambiguous alphabet ≈ 7.2×10¹³ space).

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/PRIVACY.md](docs/PRIVACY.md) ·
[docs/CAPACITY.md](docs/CAPACITY.md) ·
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ·
[docs/ADS.md](docs/ADS.md) ·
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)

---

## Project layout

```
shared/            pure game rules + AI + wire protocol (used by BOTH sides)
worker/            Cloudflare Worker entry, RoomDO, LimiterDO, helpers
src/               React app (pages, components, hooks, styles)
public/            favicon, OG image, robots.txt
tests/             vitest unit tests (rules, AI, engine, protocol)
scripts/smoke.mjs  end-to-end REST+WebSocket integration test
scripts/generate_og.py  reproducible branding asset generator (Pillow)
loadtest/          concurrency load test + guide
docs/              deployment, architecture, capacity, privacy, ads, acceptance
```

## Configuration (worker vars, in `wrangler.jsonc`)

| Var | Default | Meaning |
| --- | --- | --- |
| `ROOM_TTL_SECONDS` | `1800` | Room lifetime without game activity |
| `GRACE_SECONDS` | `60` | Reconnection window after a disconnect |
| `CREATE_LIMIT_PER_10MIN` | `10` | Max room creations per IP / 10 min |
| `JOIN_LIMIT_PER_10MIN` | `30` | Max join attempts per IP / 10 min |

Ads: see [`src/config.ts`](src/config.ts) — `ADS_CONFIG.enabled` flips the
reserved ad containers on/off (off at launch; layout never shifts).

## Testing status

- **57 unit tests** — rules, Hard-AI unbeatability (600 games), engine
  authority (turns, occupancy, stale rounds, rematches, expiry, isolation).
- **38 integration assertions** (`npm run smoke`) over real WebSockets:
  auth/rejection, synchronized boards, win/draw, rematch-in-same-room,
  disconnect→reconnect restore, third-party rejection, expiry & no-resume.
- **Load test** (`npm run loadtest`) — 400 concurrent rooms / 800 sockets run
  green on a 2-vCPU sandbox; see [docs/CAPACITY.md](docs/CAPACITY.md) for
  methodology and the staging-validation checklist.
- CI runs typecheck + unit tests + build + the smoke suite on every push.

## License & conduct

Free to play, free to fork. Be kind to friends who lose. 🙂
