# Capacity, cost & load-testing guide

> **Honesty rule:** nothing below is a guarantee. These are engineering
> estimates from published Cloudflare pricing/limits (checked 2026-10) plus
> local load tests. **Validate on a staging deployment before claiming any
> concurrency level in public.** Cloudflare's dashboard (Workers Analytics,
> DO metrics) is the source of truth.

## Plan limits that bind this design

| Resource | Workers Free | Workers Paid ($5/mo) |
| --- | --- | --- |
| Worker requests | 100,000 / day | 10M / mo included, +$0.30/M |
| DO requests (HTTP, **WS messages**, alarms) | 100,000 / day | 1M / mo included, +$0.15/M |
| DO duration | 13,000 GB-s / day | 400,000 GB-s / mo included, +$12.50/M GB-s |
| SQLite row writes (`setAlarm` counts) | 100,000 / day | 50M / mo included, +$1.00/M |
| DO classes / storage | 100 classes, 5 GB | 500 classes |
| Notes | Free only supports SQLite-backed DOs (we are compatible) | — |

Static assets served from the edge do **not** consume Worker requests; only
Worker-invoked routes (`/api/*`, SPA fallback) do.

## Per-room traffic model (assumptions)

- Heartbeat: 1 ping / 20 s per player → 0.10 msg/s per room.
- Moves: ~9 moves/round, ~40 s per round incl. think/rematch time, active
  ≈50% of session → ≈0.11 msg/s per room.
- Misc (rematch clicks, name edits): ≈0.01 msg/s.
- **Total ≈ 0.22 DO requests/s per active room** (each WS message = 1 DO request).
- REST per session: ≈4 Worker requests (create, join, info, WS upgrade) +
  first-visit assets.
- DO memory footprint: a room record + 2 sockets ≈ 1–3 MB of isolate;
  assume 16 MB for billing conservatism (GB-s math below).

## Worked estimates (players → rooms = players/2)

Assume two duty profiles:
- **Realistic**: full activity 4 h/day (evening peak), idle otherwise.
- **Worst case**: 24/7 sustained activity (nobody does this; it bounds cost).

| Concurrent players | Rooms | DO req/s | Realistic DO req/mo | Realistic monthly cost* | Worst-case monthly cost* |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 500 | ~110 | ~48M | **~$13** | ~$60 |
| 5,000 | 2,500 | ~550 | ~238M | **~$48** | ~$280 |
| 10,000 | 5,000 | ~1,100 | ~475M | **~$90** | ~$550 |

\* Paid plan base $5 + DO request overage ($0.15/M) + DO duration overage
($12.50/M GB-s) with **WebSocket Hibernation-style accounting excluded** —
i.e. conservative: duration modeled as 0.5 GB-s per room-second of session
(partially-hibernated isolate), which dominates at ~60–70% of these figures.
Worker request overage is negligible (<$5 at 10k).

Cost-reduction levers already built in: no DB writes, no per-move HTTP, tiny
payloads, throttled alarms. The biggest remaining lever is adopting the
**WebSocket Hibernation API** (idle time stops billing duration), which the
room DO is structured to adopt without protocol changes.

**Free plan reality check:** 100k DO req/day ÷ (0.22 req/s × 86 400 s) ≈
**~5 concurrent rooms sustained 24/7**, or ~30 rooms during a 4 h daily peak.
Fine for launch/hobby traffic; upgrade to Paid the moment daily DO requests
approach ~70k (watch Analytics).

## Local load-test evidence (this repo)

Method: `loadtest/loadtest.mjs` — N rooms × 2 WebSocket players, real matches
with rematches + one reconnect churn per room + 12% intentionally-invalid move
probes. Node's native WebSocket; no test framework overhead.

Observed on a **2-vCPU sandbox, server and load generator co-located** (so
these numbers are a floor, not a ceiling):

| Rooms (sockets) | Created | Rounds | Reconnects ok | Move→state p50/p95 | Abnormal closes |
| --- | --- | --- | --- | --- | --- |
| 150 (300) | 150/150 | 450 | 150/150 | 10 ms / 127 ms | 0 |
| 400 (800) | 400/400 | 800 | 400/400 | 75 ms / 199 ms | 147† |

† at 400 rooms the 2-CPU box was saturating (client bots + workerd share the
same cores); creation p50 rose to 1.6 s. This is a *client/sandbox* limit
signal, not evidence about Cloudflare's edge.

Reproduce:

```bash
npm run cf-dev            # terminal 1 (server on :8787)
node loadtest/loadtest.mjs --rooms 150 --rounds 3
```

## Staging validation checklist (do before claiming scale)

1. `npm run deploy` to a `workers.dev` subdomain (staging name).
2. Run the load test **from 2+ machines/regions** against staging
   (`--base-url https://<staging>`); single-laptop clients bottleneck on
   sockets/CPU first.
3. Watch: DO request rate, p95 WS latency, 429s, abnormal close share,
   CPU time per invocation (<10 ms typical keeps Free-plan CPU safe).
4. Step rooms: 100 → 500 → 1 000 → 5 000 concurrent; stop when p95 > 250 ms
   or error rate > 0.5%; record the plateau.
5. Re-check cost actuals vs. the table above after 24 h; adjust the model's
   duty factor with real Analytics data.
6. Enable Cloudflare managed rate limiting + WAF bot fight mode for `/api/*`
   before public launch (see DEPLOYMENT.md).

Until steps 1–5 are done, describe the project as *"designed and load-tested
locally for hundreds of concurrent rooms; Cloudflare edge capacity to be
confirmed by staged load tests"* — never as "unlimited scale".
