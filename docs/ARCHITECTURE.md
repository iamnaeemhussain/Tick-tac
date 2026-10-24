# Architecture

## Goals this design serves

1. **Instant, cheap gameplay** — tiny bundle, edge-cached assets, no backend
   round-trips for solo play.
2. **Massive room concurrency** — one isolated Durable Object per room; no
   shared mutable state, no central database bottleneck.
3. **Zero permanent storage** — nothing about a game outlives the room.
4. **Server authority** — the browser can never cheat, desync, or hijack a
   seat.
5. **Ad-ready without ads** — reserved, non-intrusive containers that never
   touch the board or the primary controls.

## Topology

| Piece | Technology | Role |
| --- | --- | --- |
| SPA | React 19 + TypeScript, Vite, hand-written CSS | UI, solo AI, WS client |
| Static hosting | Cloudflare Workers **Static Assets** (`dist/`) | Edge-cached app shell & assets |
| API + routing | Cloudflare Worker (`worker/index.ts`) | REST endpoints, SPA fallback, robots headers |
| Rooms | Durable Object class `RoomDO` | Authoritative game server per room |
| Abuse control | Durable Object class `LimiterDO` | Tiny per-IP sliding-window counters (in-memory) |
| Cleanup | DO alarms + in-DO sweep timer | Guaranteed room expiry even after eviction |
| Storage | — none — | By design. `storage.put/get` is never called |

Why one Worker + assets instead of Pages + separate API? Workers static
assets give us SPA + API + WebSockets in a **single deployable**, keep every
request on Cloudflare's edge, and avoid CORS/proxy plumbing. Durable Objects
are the only supported way to hold per-room state with WebSockets without a
database.

## Room lifecycle

```
POST /api/rooms (creator)
   │  LimiterDO(create:ip) check
   │  random 8-char code (54^8 space, retries on live collision)
   ▼
RoomDO.init ── creates in-memory room: phase=waiting, seat X claimed (token)
   │  setAlarm(createdAt + min(grace, ttl))
   │
   ├─ creator opens /room/CODE → WS → auth{tokenX} → ready{you:X, snapshot}
   │        phase=waiting → WaitingRoom UI (share panel, editable names)
   │
   ├─ friend opens /room/CODE → GET info (names + status, NO tokens)
   │        → JoinScreen (suggested name editable) → POST /join
   │        → tokenO issued; phase=playing, round=1, X to move
   │        → friend WS auth → both sockets receive identical snapshots
   │
   ├─ play: {move, cell, round} → engine validation → broadcast {state}
   │        (round id makes replays/double-clicks idempotent)
   │
   ├─ round end → {state: phase=roundOver, winner, winLine, score}
   │        rematch needs BOTH seats → round+1 IN THE SAME ROOM
   │
   ├─ disconnect → {state: connected[seat]=false, disconnectedAt}
   │        opponent sees countdown; grace=GRACE_SECONDS to return
   │        reconnect = new WS + same token (old socket closed 4003)
   │
   └─ expiry paths (whichever hits first):
        • both seats gone > grace            → discard, WS 4000/4004
        • one seat gone > grace              → 'abandoned', other told
        • no activity > ROOM_TTL_SECONDS     → 'expired', both told
        • explicit POST /end or {leave}      → 'ended', both told
        sweep timer (10 s) acts while the DO is awake;
        storage alarm acts as the guaranteed backstop after eviction.
```

### Why the alarm is the only storage use

A Durable Object can be evicted from memory at any time (which also *is* our
discard path). `storage.setAlarm()` survives eviction and wakes the object to
confirm/finish cleanup — the documented mechanism for "expire even when both
browsers are closed". Alarms are set sparingly (a handful per room lifetime:
creation, disconnects, occasional TTL extension) because each `setAlarm` is a
billed row-write; the in-DO sweep handles the prompt cases.

## Wire protocol (WebSocket, JSON ≤ 1 KB)

Client → server: `auth{token}` (first message, 5 s deadline), `move{cell,
round}`, `rematch{round}`, `updateNames{p1?,p2?}`, `ping{t}`, `leave`.

Server → client: `ready{you,state}`, `state{snapshot}`, `pong{t}`,
`closed{reason: ended|expired|abandoned|replaced}`, `error{code}`.

Snapshot fields: `phase, round, board[9], turn, winner, winLine, lastMove,
names{X,O}, p2Suggested, score{X,O,draws}, rematch{X,O}, connected{X,O},
disconnectedAt{X,O}, roundStartedAt, serverNow`.

Tokens are **never** in URLs (no access-log leakage), never in snapshots, and
never in REST responses except the one-time create/join reply.

Close codes: `4000` ended · `4001` unauthorized · `4003` replaced by a newer
session · `4004` room gone/expired · `4008` rate-limited/abuse · `4011` server
error. Codes 4000/4001/4003/4004 and 1000 stop client retries.

## Server-authoritative validation (worker/engine.ts)

Every message passes, in order:

1. payload shape (`parseClientMsg`) + size cap + per-connection rate window;
2. seat authentication (token → seat);
3. phase legality (`waiting` blocks moves; `roundOver` blocks moves; rematch
   only after a round ends);
4. round id equality → stale/duplicate messages rejected (idempotency);
5. turn equality → out-of-turn rejected;
6. cell integrity (`0..8`, integer, unoccupied);
7. outcome recomputed **server-side** from the rules module — the client's
   opinion of wins/draws is never trusted.

The same `shared/game.ts` module powers the solo AI client-side, so browser
and server can never disagree about what a win is.

## Frontend architecture

- **Micro-router** (~40 lines): `/` home+solo, `/room/:code` multiplayer.
- **RoomClient**: auth-first WS, heartbeat (20 s ping / 12 s pong timeout),
  exponential-backoff reconnect inside the server grace window, REST probe to
  detect expired rooms fast, terminal codes stop retrying.
- **Tab-session credentials** (`sessionStorage`): `{code, seat, token}` only,
  so a refresh resumes the *live* room. Dies with the tab. Solo mode stores
  nothing. UI prefs (`localStorage`) hold only theme + sound.
- **Rendering is snapshot-driven**: the UI never mutates the board locally;
  every board pixel comes from the authoritative snapshot, so both players
  always see identical state.
- **Feedback layer**: synthesized WebAudio SFX (no files), canvas confetti,
  stroke-draw X/O marks, win-line overlay — all reduced-motion aware.

## Failure modes & mitigations

| Failure | Behavior |
| --- | --- |
| Flaky network mid-move | Rejected/stale moves ignored; snapshots resync on reconnect |
| Double-click | Round-id + occupancy checks make the second submit a no-op error |
| Browser crash (both) | Alarm/sweep expires the room; memory discarded |
| DO eviction mid-game | Only possible when idle; sockets keep it awake (heartbeats); reconnects inside grace restore state from a fresh… (eviction while sockets open doesn't happen) |
| Ad script blocked | Slot degrades to reserved placeholder; gameplay untouched |
| WS upgrade to dead room | HTTP 410 on handshake; client REST-probes and shows "expired" |
| Impersonation attempt | Seat actions require the one-time token; tokens unguessable (UUIDv4) |
| Third-party join | Seats are exactly two; join only during `waiting`; tokens separate membership from presence |

## Known future optimizations (documented, not built)

- **WebSocket Hibernation API** to cut DO duration billing for long-idle rooms
  (see docs/CAPACITY.md for why and the expected effect).
- **Cloudflare managed rate-limiting rules** in front of `/api/*` for
  account-level abuse guarantees beyond the in-app limiters.
- Optional **analytics via Workers Analytics Engine** (aggregate counters
  only — never names, boards, or room codes).
