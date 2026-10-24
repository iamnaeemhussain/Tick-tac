# Privacy & data-retention statement

Tick-Tac Arena is built around one promise: **nothing about your game
outlives your game.** This document states exactly what is stored where, for
how long, and what you should double-check on the platform side.

## What is NOT stored — anywhere, ever

- Player names (after the room is discarded)
- Accounts, profiles, emails, phone numbers, friend lists — none exist
- Room records, invite graphs, room-code registries
- Board states, moves, game outcomes, match history
- Session scores (volatile room memory only)
- Any game data in browser storage

## Where temporary state lives (and dies)

| Data | Where | Lifetime |
| --- | --- | --- |
| Names, board, score, membership, presence | `RoomDO` memory (one Durable Object per room) | Until session end, `GRACE_SECONDS` after everyone disconnects, or `ROOM_TTL_SECONDS` (default 30 min) of inactivity — whichever first |
| Seat tokens | `RoomDO` memory (+ browser `sessionStorage` copy in the *player's own tab*) | Same as room; sessionStorage dies with the tab |
| Per-IP limiter counters | `LimiterDO` memory | Sliding 10-min window; freed on eviction |
| Cleanup timers | DO storage alarm (the *only* storage call) | Deleted on room teardown |

Both-browsers-closed case: the in-DO sweep expires the room within seconds of
the grace deadline while the object is awake; if the object was evicted
first, the **storage alarm wakes it** to finish discarding. Either way the
names/board/score are unrecoverable afterwards — a fresh object has empty
memory and reports `expired`.

## Browser storage inventory (complete)

| Key | Type | Contents | Why |
| --- | --- | --- | --- |
| `tta.prefs` | localStorage | `{theme, sound}` only | UI preference; no personal data |
| `tta.room.<code>` | sessionStorage | `{code, seat, token}` | Lets a *refresh* rejoin the live room; gone when the tab closes |

No cookies. No analytics scripts. No fingerprinting. No third-party requests
until/unless ads are enabled (see ADS.md), and ads are **off** at launch.

## Search engines & public exposure

- Only the homepage is crawlable (`robots.txt` allows `/`, blocks `/room/`
  and `/api/`).
- `/room/*` responses carry `X-Robots-Tag: noindex, nofollow, noarchive` and
  the SPA injects `<meta name="robots" content="noindex">` on room routes.
- Room pages expose no game content without a valid session token: the
  public `info` endpoint returns only status + display names + connection
  flags of a *live* room (nothing after expiry).
- No public archives, leaderboards, replays or profiles exist.

## Logging & platform metadata — read this part

Application code **never** logs names, boards, tokens or room codes
(`console.*` in worker/ contains none; error paths return generic codes).

However, **infrastructure providers retain operational metadata under their
own policies**, for example:

- Cloudflare edge logs (if enabled in the dashboard) record request
  metadata: IP, UA, TLS version, URL path — which for room URLs includes the
  **room code** (but not names/boards/tokens; tokens are never in URLs).
- DDoS/WAF/security systems keep security telemetry.
- Billing/metrics systems keep aggregate counters (requests, CPU, GB-s).

Mitigations already applied: tokens out of URLs; invite codes are
unpredictable and expire; room paths are noindex; no query-string secrets.
Operator checklist:

1. Keep Workers Logs off or sampled-low; never log request bodies.
2. Don't export full-URL access logs to long-retention sinks.
3. If you add error reporting (e.g. Sentry), scrub `code`, `token`, names.
4. Review Cloudflare's privacy/DPA documentation for your jurisdiction before
   serving regulated markets.

## Deleting "your data"

There is nothing to delete: end the session (or close the tab) and the room
is discarded within the grace window. `End session` in-game discards
immediately for both players.

## Children & sensitive contexts

The game collects no personal data, so it is safe to share in classrooms and
family settings. If you later enable ads, you become responsible for consent
flows (GDPR/ePrivacy/UK PECR, COPPA-adjacent ad policies) — see ADS.md §Compliance.
