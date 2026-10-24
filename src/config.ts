/**
 * App-wide configuration.
 *
 * ── Advertising ────────────────────────────────────────────────────────────
 * Ads are OFF at launch. The layout already reserves space for them so that
 * enabling ads later causes ZERO layout shift and never covers the board or
 * the Share / Rematch / Restart controls.
 *
 * To enable (phase 2):
 *   1. Set `enabled: true` below.
 *   2. Fill in your AdSense `client` id (ca-pub-…) and per-slot `id`s.
 *   3. Redeploy. That's it — no other code changes needed.
 *
 * The game never depends on ad scripts: loading is lazy, failures degrade to
 * the reserved placeholder, and every slot is outside the playable area.
 * Remember to configure a consent mechanism (e.g. Google CMP) before serving
 * ads to EEA/UK/Swiss users, per network policy and privacy law.
 */

export type AdPlacement = 'home-banner' | 'home-footer' | 'game-desktop' | 'game-mobile' | 'result';

export interface AdSlotConfig {
	/** AdSense slot id (empty until configured). */
	id: string;
	/** Reserved height in px — prevents layout shift before/without ads. */
	minHeight: number;
}

export interface AdsConfig {
	enabled: boolean;
	provider: 'adsense';
	client: string; // ca-pub-XXXXXXXXXXXXXXXX
	slots: Record<AdPlacement, AdSlotConfig>;
}

export const ADS_CONFIG: AdsConfig = {
	enabled: false,
	provider: 'adsense',
	client: '',
	slots: {
		'home-banner': { id: '', minHeight: 100 },
		'home-footer': { id: '', minHeight: 90 },
		'game-desktop': { id: '', minHeight: 280 },
		'game-mobile': { id: '', minHeight: 100 },
		result: { id: '', minHeight: 120 },
	},
};

/** Room lifetime & grace defaults — must mirror worker vars (documented). */
export const ROOM_DEFAULTS = {
	/** Server-side room TTL (informational; the server is authoritative). */
	ttlSeconds: 1800,
	/** Reconnection grace period shown in disconnect countdowns. */
	graceSeconds: 60,
};

export const APP_NAME = 'Tick-Tac Arena';
export const APP_TAGLINE = 'Instant Tic-Tac-Toe. Share a link. Win bragging rights.';
