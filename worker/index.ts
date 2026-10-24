/**
 * Tick-Tac Arena — Worker entry point.
 *
 * One Worker does everything:
 *   • serves the built React SPA as edge-cached static assets (./dist)
 *   • exposes the JSON + WebSocket API under /api/rooms/…
 *   • routes each room to its own RoomDO Durable Object (isolated state,
 *     no shared database, no global mutable state)
 *
 * Privacy: nothing is logged about players. Responses are JSON or static
 * files only; no game data is ever written to durable storage.
 */

import type { Env } from './env';
import { LimiterDO } from './limiter';
import { RoomDO } from './room';
import { clientIp, envInt, generateRoomCode, json, readJsonBody } from './util';
import { isRoomCode, sanitizeName } from '../shared/protocol';

export { RoomDO, LimiterDO };

const ROOM_PATH_RE = /^\/api\/rooms\/([^/]+)(?:\/(join|end|ws))?$/;

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-frame-options': 'DENY',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		try {
			// ── API ──────────────────────────────────────────────────────────
			if (path === '/api/health') return json({ ok: true });

			if (path === '/api/rooms' && request.method === 'POST') {
				return await createRoom(request, env);
			}

			const m = ROOM_PATH_RE.exec(path);
			if (m) {
				const code = m[1];
				const sub = m[2];
				if (!isRoomCode(code)) return json({ error: 'not_found' }, 404);
				const room = env.ROOMS.get(env.ROOMS.idFromName(code));

				if (!sub && request.method === 'GET') {
					const res = await room.fetch('http://room/info');
					return json(await res.json(), res.status);
				}
				if (sub === 'join' && request.method === 'POST') {
					if (!(await rateLimit(env, 'join', clientIp(request), envInt(env.JOIN_LIMIT_PER_10MIN, 30)))) {
						return json({ error: 'rate_limited', message: 'Too many attempts — try again shortly.' }, 429);
					}
					const body = await readJsonBody(request);
					const res = await room.fetch('http://room/join', {
						method: 'POST',
						body: JSON.stringify({ name: body?.name ?? '', ip: clientIp(request) }),
					});
					return json(await res.json().catch(() => ({})), res.status);
				}
				if (sub === 'end' && request.method === 'POST') {
					const body = await readJsonBody(request);
					const res = await room.fetch('http://room/end', {
						method: 'POST',
						body: JSON.stringify({ token: body?.token ?? '' }),
					});
					return json(await res.json().catch(() => ({})), res.status);
				}
				if (sub === 'ws') {
					if (request.headers.get('Upgrade') !== 'websocket') {
						return json({ error: 'upgrade_required' }, 426);
					}
					// Hand the upgrade to the room DO; it returns 101 or refuses.
					return room.fetch(new Request('http://room/ws', { headers: request.headers }));
				}
				return json({ error: 'not_found' }, 404);
			}

			if (path.startsWith('/api/')) return json({ error: 'not_found' }, 404);

			// ── App shell & static assets ───────────────────────────────────
			if (path === '/room' || path.startsWith('/room/')) {
				// Invite pages must never be indexed or archived.
				return serveApp(request, env, { 'x-robots-tag': 'noindex, nofollow, noarchive' });
			}
			if (path === '/' || path === '/index.html') {
				return serveApp(request, env, {});
			}
			return await env.ASSETS.fetch(request);
		} catch {
			// Safe generic error — no internals leak.
			return json({ error: 'server_error' }, 500);
		}
	},
} satisfies ExportedHandler<Env>;

// ── handlers ──────────────────────────────────────────────────────────────────

async function createRoom(request: Request, env: Env): Promise<Response> {
	const ip = clientIp(request);
	if (!(await rateLimit(env, 'create', ip, envInt(env.CREATE_LIMIT_PER_10MIN, 10)))) {
		return json({ error: 'rate_limited', message: 'Too many rooms created — try again shortly.' }, 429);
	}

	const body = await readJsonBody(request);
	if (!body) return json({ error: 'bad_payload', message: 'Expected JSON body.' }, 400);
	const p1Name = sanitizeName(body.p1Name);
	if (!p1Name) {
		return json({ error: 'name_invalid', message: `Enter a name (1–20 characters).` }, 400);
	}
	const p2Name = body.p2Name === undefined || body.p2Name === '' ? undefined : sanitizeName(body.p2Name);
	if (body.p2Name !== undefined && body.p2Name !== '' && !p2Name) {
		return json({ error: 'name_invalid', message: 'Friend names must be 1–20 characters.' }, 400);
	}

	// Room codes are random; retry a few times on the (astronomically rare)
	// collision with a live room.
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateRoomCode();
		const room = env.ROOMS.get(env.ROOMS.idFromName(code));
		const res = await room.fetch('http://room/init', {
			method: 'POST',
			body: JSON.stringify({ code, p1Name, p2Name }),
		});
		if (res.status === 409) continue; // code already alive — retry
		if (!res.ok) return json({ error: 'server_error' }, 502);
		const data = (await res.json()) as { token: string };
		return json(
			{ code, token: data.token, seat: 'X', inviteUrl: `/room/${code}` },
			201,
		);
	}
	return json({ error: 'server_error', message: 'Could not allocate a room, please retry.' }, 503);
}

async function rateLimit(env: Env, action: string, ip: string, limit: number): Promise<boolean> {
	try {
		const limiter = env.LIMITERS.get(env.LIMITERS.idFromName(`${action}:${ip}`));
		const res = await limiter.fetch('http://limiter/check', {
			method: 'POST',
			body: JSON.stringify({ limit, windowMs: 600_000 }),
		});
		return res.status !== 429;
	} catch {
		// Fail open — rate limiting is abuse control, not a correctness gate.
		return true;
	}
}

async function serveApp(
	request: Request,
	env: Env,
	extraHeaders: Record<string, string>,
): Promise<Response> {
	const url = new URL(request.url);
	url.pathname = '/index.html';
	const assetRes = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
	const headers = new Headers(assetRes.headers);
	headers.set('cache-control', 'no-cache'); // index must revalidate on deploy
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extraHeaders })) headers.set(k, v);
	return new Response(assetRes.body, { status: assetRes.status, headers });
}
