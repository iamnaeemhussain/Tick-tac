/**
 * LimiterDO — tiny per-key sliding-window rate limiter (one DO per
 * "<action>:<ip>" bucket). In-memory only: no storage writes at all, so if
 * the object is evicted the counter simply resets (best-effort abuse control;
 * pair with Cloudflare's managed rate-limiting rules for hard guarantees —
 * see docs/DEPLOYMENT.md).
 */

export class LimiterDO {
	private hits: number[] = [];

	// DO constructors receive (state, env); this limiter keeps memory only.
	constructor(_state: DurableObjectState, _env: unknown) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== '/check' || request.method !== 'POST') {
			return new Response(null, { status: 404 });
		}
		let limit = 10;
		let windowMs = 600_000;
		try {
			const body = (await request.json()) as Record<string, unknown>;
			if (typeof body.limit === 'number' && body.limit > 0) limit = Math.min(body.limit, 1000);
			if (typeof body.windowMs === 'number' && body.windowMs > 0) {
				windowMs = Math.min(body.windowMs, 3_600_000);
			}
		} catch {
			// keep defaults
		}
		const now = Date.now();
		this.hits = this.hits.filter((t) => now - t < windowMs);
		if (this.hits.length >= limit) {
			const retryAfter = Math.ceil((windowMs - (now - this.hits[0])) / 1000);
			return new Response(null, { status: 429, headers: { 'retry-after': String(Math.max(retryAfter, 1)) } });
		}
		this.hits.push(now);
		return new Response(null, { status: 204 });
	}
}
