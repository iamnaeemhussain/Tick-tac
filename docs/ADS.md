# Advertising readiness (phase-2 playbook)

Ads are **disabled at launch** (`ADS_CONFIG.enabled = false`). The layout
already reserves every planned placement with exact heights, so turning ads
on later causes **zero layout shift** and never moves the board or controls.

## Placements

| Slot | Location | Reserved height | Shown on |
| --- | --- | --- | --- |
| `home-banner` | Below hero/mode cards | 100 px | All |
| `home-footer` | Above footer | 90 px | All |
| `game-desktop` | Side rail beside the board | 280 px | ≥ 920 px |
| `game-mobile` | Below gameplay controls | 100 px | < 920 px |
| `result` | Inside round-result card (below buttons) | 120 px | All |

Rules enforced by design:

- Ads are **outside** the board and outside Share/Copy/Rematch/Restart hit
  areas; the result-card ad sits *under* the action buttons.
- Reserved boxes render even when ads are off or fail — no CLS.
- The AdSense loader script is injected **only** when `enabled: true` and a
  slot first mounts; if it errors or is blocked, the placeholder stays and
  the game never notices.
- No third-party ad scripts ship in the bundle at launch.

## Enabling AdSense (10 minutes)

1. Create an AdSense account + site; get `ca-pub-XXXXXXXXXXXXXXXX`.
2. In `src/config.ts` set:

   ```ts
   export const ADS_CONFIG: AdsConfig = {
     enabled: true,
     provider: 'adsense',
     client: 'ca-pub-XXXXXXXXXXXXXXXX',
     slots: {
       'home-banner':  { id: '1111111111', minHeight: 100 },
       'home-footer':  { id: '2222222222', minHeight: 90 },
       'game-desktop': { id: '3333333333', minHeight: 280 },
       'game-mobile':  { id: '4444444444', minHeight: 100 },
       result:         { id: '5555555555', minHeight: 120 },
     },
   };
   ```
3. `npm run build && npm run deploy`. Done — no other code changes.

Swapping providers later: replace `loadAdSense()` + the `<ins>` markup inside
`src/components/AdSlot.tsx`; the reserved-container logic stays.

## Compliance checklist (before enabling)

- [ ] **Consent**: add a CMP (e.g. Google's funding choices or a consent
      manager) gating ad cookies for EEA/UK/CH users; AdSense policy and
      GDPR/ePrivacy require it. Store only the consent flag (that's a
      preference, not game data).
- [ ] **Ad policy UX**: no ads over gameplay, no accidental-click traps
      (our placements keep ≥ 8 px separation from controls; keep it that way
      if you tweak layouts).
- [ ] **Labels**: placeholders already say "Advertisement"; keep some label
      on live slots (AdSense renders its own).
- [ ] **Privacy page**: publish docs/PRIVACY.md publicly and mention ad
      networks as third parties once live.
- [ ] **Kids/regulated markets**: review COPPA/segmented-audience rules;
      consider disabling personalized ads globally if your audience skews young.
- [ ] **Performance**: keep `async` loading (already) and monitor LCP/CLS
      after enabling; reserved heights should keep CLS ≈ 0.

## Philosophy baked in

Retention beats impressions: one tasteful slot per screen, nothing
interstitial, nothing over the board, nothing that interrupts a rematch. If
a future ad format conflicts with "the game must stay playable and calm",
the game wins.
