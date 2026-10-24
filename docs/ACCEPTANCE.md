# Acceptance criteria — verification map

Every requirement from the project brief, and exactly where it is verified.
Legend: **U** = unit test (`npm test`), **S** = smoke/integration
(`npm run smoke`), **L** = load test (`npm run loadtest`), **M** = manual
check in the live preview/deployment.

| # | Criterion | Verified by |
| --- | --- | --- |
| 1 | Start single-player after entering a name | U `ai.test.ts`; M: home → "Play vs Computer" → name → Start |
| 2 | All three difficulties work correctly | U: easy loses often, medium >60% vs random, hard never loses (600 games incl. hard-vs-hard all-draw) |
| 3 | Two users play through a shared link on separate devices | S: create → info → join → both sockets play full round; M: two browser windows/devices |
| 4 | Both players confirm names before match starts | S: game only reaches `playing` after join POST (joiner confirms/edits name); creator confirms at create; U engine.join/updateNames |
| 5 | Both players see synchronized boards | S: after each move both snapshots deep-equal; U state broadcast |
| 6 | Invalid & out-of-turn moves rejected | S: `not_your_turn`, `occupied`, `bad_cell`, `stale_round`, double-click applied once; U engine suite |
| 7 | Wins, losses, draws correctly identified | U all 8 lines both marks + draw board; S live win via column 1-4-7 + winLine + score |
| 8 | Unlimited rematches in same room | U: 25 consecutive rematches, same code, score accumulates; S: rematch handshake → round 2 same room |
| 9 | Session score updates for both players | S: score.X=1 visible in both clients' snapshots; U |
| 10 | Reconnection restores game within grace | S: O closes socket → countdown state broadcast → reconnect with same token → board/round/score intact |
| 11 | Expired rooms cannot be resumed | S phase 2: after grace expiry, reconnect with valid old token refused (410/4004); info → expired |
| 12 | Room state & score discarded after expiry | S phase 2: info flips to `expired`; DO memory empty (fresh object); U `discard()` |
| 13 | No permanent DB / browser storage for game state | Code: zero `storage.put/get`; browser storage inventory in PRIVACY.md (prefs + tab creds only); M: DevTools storage shows no game data after refresh |
| 14 | Multiple rooms operate independently | S: move in room A leaves room B untouched; U two-engine isolation |
| 15 | Usable on mobile and desktop | M: responsive layouts (360 px → 1440 px), touch targets ≥ 48 px, safe-area padding; CSS media queries |
| 16 | Ad placeholders don't obstruct gameplay | M: reserved boxes sit below controls / in side rail; board & Share/Rematch/Restart never overlapped; CSS `.ad-slot` |
| 17 | Game works with ad scripts unavailable | Code: `ADS_CONFIG.enabled=false` path renders placeholders with no network; AdSlot degrades on script error; M: offline-block test |
| 18 | Load tests with increasing rooms/sockets | L: 150 & 400 concurrent rooms (300/800 sockets) green locally; docs/CAPACITY.md staging ladder |
| 19 | Rate limiting & room access restrictions work | S: third join 409; bad token 4001; U LimiterDO window logic; M: >10 creates/10 min from one IP → 429 |
| 20 | Deployment & Cloudflare config documented | docs/DEPLOYMENT.md (steps, vars, migrations, domain, rollback) + wrangler.jsonc comments |

## Additional brief requirements → where they live

- **Share UX**: WhatsApp deep link, one-click copy with "Copied!" feedback,
  native share sheet — `src/components/SharePanel.tsx` (M).
- **Waiting room + opponent-disconnected status + grace countdown** —
  `WaitingRoom.tsx`, `Notices.tsx` (S for state, M for UI).
- **No new room per rematch** — engine.rematch reuses room code (U+S).
- **Restart confirmation for active matches** — `ConfirmButton` two-step
  (solo restart, end-session) (M).
- **Win/draw animations, turn indicator, timer, mute, reduced motion,
  themes** — styles.css + GameView/Hud/ResultOverlay/Confetti/sound.ts (M).
- **SEO/OG/favicon/noindex room pages/robots** — index.html, worker headers,
  public/robots.txt; verified via curl in this session (`x-robots-tag:
  noindex, nofollow, noarchive` on `/room/*`).
- **Security list (turn validation, unpredictable ids, membership, payload
  guards, idempotency, no secrets in frontend, safe errors)** — worker/
  engine.ts + room.ts + protocol.ts; S assertions cover each code path.
- **Honest scaling claims** — docs/CAPACITY.md (limits, cost tables,
  validation checklist); README never claims unlimited scale.
