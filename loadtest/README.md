# Load test

`loadtest/loadtest.mjs` simulates real multiplayer load: N rooms, two
WebSocket players each, complete rounds with rematches, one disconnect/
reconnect per room, and ~12% intentionally illegal move probes (which the
server must reject — proving authority under load).

Zero dependencies — uses Node ≥ 22's built-in `WebSocket` and `fetch`.

## Run locally

```bash
npm run cf-dev                                   # server on :8787 (terminal 1)
node loadtest/loadtest.mjs --rooms 150 --rounds 3
```

Useful flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--rooms` | 100 | concurrent rooms (2 sockets each) |
| --`rounds` | 3 | rounds (rematches) per room |
| `--think-ms` | 400 | avg delay between moves |
| `--churn` | 1 | simulate one reconnect per room |
| `--ramp-ms` | 2000 | spread room creation over this window |
| `--base-url` | http://127.0.0.1:8787 | target instance |

Rate limits: the default instance caps 10 creates/IP/10 min, so for big local
runs start a permissive instance:

```bash
npx wrangler dev --port 8789 --var CREATE_LIMIT_PER_10MIN:100000 --var JOIN_LIMIT_PER_10MIN:100000
node loadtest/loadtest.mjs --rooms 400 --base-url http://127.0.0.1:8789
```

## Reading the output

- `move→state latency` — the round-trip that matters for game feel
  (< 100 ms p95 feels instant; > 250 ms investigate).
- `abnormal closes` — should be 0; nonzero at high room counts usually means
  the *load generator* saturated (it shares CPU with the server locally).
- `rate-limited` — limiter firing; expected only if you forget the permissive
  instance locally, or under abuse-like patterns on staging.

## Baselines observed in-repo

2-vCPU sandbox, client+server co-located (a floor, not a ceiling):

- 150 rooms / 300 sockets: p50 10 ms, p95 127 ms, 0 errors.
- 400 rooms / 800 sockets: p50 75 ms, p95 199 ms, 147 abnormal closes under
  CPU saturation (generator-limited).

For edge-real numbers follow the staged ladder in
[docs/CAPACITY.md](../docs/CAPACITY.md#staging-validation-checklist-do-before-claiming-scale)
against a staging deployment from multiple machines.
