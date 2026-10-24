/**
 * RoomDO — one Durable Object per game room. This is the authoritative
 * multiplayer server: it owns the sockets, validates every message through
 * RoomEngine, and keeps ALL state in memory.
 *
 * Zero-persistence design:
 *  • No storage.put/get/delete for game data — ever. Names, board, score and
 *    history live only as class fields and vanish on eviction/expiry.
 *  • storage.setAlarm is used solely as a guaranteed cleanup timer (the
 *    documented mechanism for expiring rooms even when both players close
 *    their browsers). It is set sparingly (a handful of writes per room).
 *  • An in-DO sweep timer provides prompt expiry while the object is awake;
 *    the alarm covers eviction.
 */

import { Mark } from '../shared/game';
import {
	MAX_WS_MESSAGE_BYTES,
	ROOM_CODE_ALPHABET,
	ServerMsg,
	WS_CLOSE,
	parseClientMsg,
	sanitizeName,
} from '../shared/protocol';
import type { Env } from './env';
import { RoomEngine, OutEvent } from './engine';
import { envInt, generateToken, json, readJsonBody } from './util';

interface SocketInfo {
	seat: Mark | null;
	authed: boolean;
	/** Sliding-window timestamps for per-connection rate limiting. */
	msgTimes: number[];
	badPayloads: number;
	authTimer: ReturnType<typeof setTimeout> | null;
}

const AUTH_TIMEOUT_MS = 5_000;
const RATE_WINDOW_MS = 5_000;
const RATE_MAX_MSGS = 25; // generous: ~5 msgs/sec sustained per connection
const SWEEP_INTERVAL_MS = 10_000;
/** Don't rewrite the alarm unless the target moved by more than this. */
const ALARM_SLACK_MS = 30_000;

export class RoomDO {
	private engine: RoomEngine;
	private sockets = new Map<WebSocket, SocketInfo>();
	private seatSocket = new Map<Mark, WebSocket>();
	private sweepTimer: ReturnType<typeof setTimeout> | null = null;
	private alarmTarget = 0;
	private joinHits = new Map<string, number[]>();

	constructor(
		private state: DurableObjectState,
		private env: Env,
	) {
		this.engine = new RoomEngine({
			ttlMs: envInt(env.ROOM_TTL_SECONDS, 1800) * 1000,
			graceMs: envInt(env.GRACE_SECONDS, 60) * 1000,
		});
	}

	// ── HTTP surface (internal calls from the Worker + WS upgrades) ─────────

	async fetch(request: Request): Promise<Response> {
		try {
			if (request.headers.get('Upgrade') === 'websocket') {
				return this.handleUpgrade();
			}
			const url = new URL(request.url);
			if (request.method === 'POST' && url.pathname === '/init') return await this.handleInit(request);
			if (request.method === 'GET' && url.pathname === '/info') return json(this.engine.info());
			if (request.method === 'POST' && url.pathname === '/join') return await this.handleJoin(request);
			if (request.method === 'POST' && url.pathname === '/end') return await this.handleEnd(request);
			return new Response(null, { status: 404 });
		} catch {
			// Never leak internals.
			return json({ error: 'server_error' }, 500);
		}
	}

	private async handleInit(request: Request): Promise<Response> {
		if (this.engine.room) return json({ error: 'exists' }, 409);
		const body = await readJsonBody(request);
		if (!body) return json({ error: 'bad_payload' }, 400);
		const p1Name = sanitizeName(body.p1Name);
		if (!p1Name) return json({ error: 'name_invalid' }, 400);
		const p2Suggested = body.p2Name === undefined ? null : sanitizeName(body.p2Name);
		const code = typeof body.code === 'string' ? body.code : '';
		if (code.length !== 8 || ![...code].every((c) => ROOM_CODE_ALPHABET.includes(c))) {
			return json({ error: 'bad_payload' }, 400);
		}
		const tokenX = generateToken();
		const res = this.engine.create({ code, p1Name, p2Suggested, tokenX, now: Date.now() });
		if (!res.ok) return json({ error: res.error }, 409);
		this.startSweep();
		this.ensureAlarm(true);
		return json({ token: tokenX });
	}

	private async handleJoin(request: Request): Promise<Response> {
		const body = await readJsonBody(request);
		if (!body) return json({ error: 'bad_payload' }, 400);
		const name = sanitizeName(body.name);
		if (!name) return json({ error: 'name_invalid', message: 'Enter a name (1–20 characters).' }, 400);

		// Per-IP join throttle (in-memory; best effort).
		const ip = typeof body.ip === 'string' ? body.ip.slice(0, 64) : 'unknown';
		const now = Date.now();
		const limit = envInt(this.env.JOIN_LIMIT_PER_10MIN, 30);
		const hits = (this.joinHits.get(ip) ?? []).filter((t) => now - t < 600_000);
		if (hits.length >= limit) {
			this.joinHits.set(ip, hits);
			return json({ error: 'rate_limited' }, 429);
		}
		hits.push(now);
		this.joinHits.set(ip, hits);

		if (!this.engine.room || this.engine.room.closed) {
			return json({ error: 'expired', message: 'This room has expired. Create a new one!' }, 410);
		}
		const tokenO = generateToken();
		const res = this.engine.join({ name, tokenO, now });
		if (!res.ok) {
			const status = res.error === 'room_full' ? 409 : res.error === 'name_invalid' ? 400 : 410;
			return json({ error: res.error }, status);
		}
		this.dispatch(res.events);
		this.ensureAlarm(true);
		return json({ token: tokenO, seat: 'O' });
	}

	private async handleEnd(request: Request): Promise<Response> {
		const body = await readJsonBody(request);
		const token = typeof body?.token === 'string' ? body.token : '';
		if (!this.engine.seatForToken(token)) return json({ error: 'unauthorized' }, 403);
		const res = this.engine.end(Date.now());
		this.dispatch(res.events);
		this.teardown(WS_CLOSE.ENDED);
		return json({ ok: true });
	}

	// ── WebSockets ───────────────────────────────────────────────────────────

	private handleUpgrade(): Response {
		if (!this.engine.room || this.engine.room.closed) {
			// Room gone/expired — refuse the upgrade with a plain HTTP status so
			// the client can show "room expired" without a socket dance.
			return json({ error: 'expired' }, 410);
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.state.acceptWebSocket(server);
		const info: SocketInfo = { seat: null, authed: false, msgTimes: [], badPayloads: 0, authTimer: null };
		info.authTimer = setTimeout(() => {
			if (!info.authed) this.safeClose(server, WS_CLOSE.UNAUTHORIZED, 'auth timeout');
		}, AUTH_TIMEOUT_MS);
		this.sockets.set(server, info);
		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
		const info = this.sockets.get(ws);
		if (!info) return;
		const now = Date.now();

		// Payload & rate guards — protect the DO from malformed/spammy clients.
		if (typeof message !== 'string' || message.length > MAX_WS_MESSAGE_BYTES) {
			this.safeClose(ws, WS_CLOSE.ABUSE, 'payload too large');
			return;
		}
		info.msgTimes = info.msgTimes.filter((t) => now - t < RATE_WINDOW_MS);
		if (info.msgTimes.length >= RATE_MAX_MSGS) {
			this.safeClose(ws, WS_CLOSE.ABUSE, 'rate limited');
			return;
		}
		info.msgTimes.push(now);

		let msg: ReturnType<typeof parseClientMsg>;
		try {
			msg = parseClientMsg(JSON.parse(message));
		} catch {
			msg = null;
		}
		if (!msg) {
			info.badPayloads += 1;
			if (info.badPayloads >= 3) this.safeClose(ws, WS_CLOSE.ABUSE, 'protocol error');
			else this.send(ws, { type: 'error', code: 'bad_payload' });
			return;
		}

		if (!info.authed) {
			if (msg.type !== 'auth') {
				this.safeClose(ws, WS_CLOSE.UNAUTHORIZED, 'auth required');
				return;
			}
			this.authenticate(ws, info, msg.token, now);
			return;
		}
		if (msg.type === 'auth') return; // duplicate auth on an authed socket: ignore

		this.handleAuthed(ws, info, msg, now);
	}

	private authenticate(ws: WebSocket, info: SocketInfo, token: string, now: number): void {
		const seat = this.engine.seatForToken(token);
		if (!seat) {
			this.safeClose(ws, WS_CLOSE.UNAUTHORIZED, 'bad token');
			return;
		}
		if (info.authTimer) clearTimeout(info.authTimer);
		info.authTimer = null;
		info.seat = seat;
		info.authed = true;

		// Replace any older socket for the same seat (refresh/reconnect).
		const prev = this.seatSocket.get(seat);
		if (prev && prev !== ws) {
			const prevInfo = this.sockets.get(prev);
			if (prevInfo) prevInfo.seat = null; // don't treat as a disconnect
			this.safeClose(prev, WS_CLOSE.REPLACED, 'replaced');
		}
		this.seatSocket.set(seat, ws);

		const snap = this.engine.snapshot(now);
		if (!snap) {
			this.safeClose(ws, WS_CLOSE.GONE, 'room gone');
			return;
		}
		this.send(ws, { type: 'ready', you: seat, state: snap });
		const res = this.engine.setConnected(seat, true, now);
		this.dispatch(res.events, ws);
		this.startSweep();
		this.ensureAlarm(true);
	}

	private handleAuthed(
		ws: WebSocket,
		info: SocketInfo,
		msg: NonNullable<ReturnType<typeof parseClientMsg>>,
		now: number,
	): void {
		const seat = info.seat!;
		switch (msg.type) {
			case 'ping':
				this.send(ws, { type: 'pong', t: msg.t });
				return;
			case 'move': {
				const res = this.engine.move(seat, msg.cell, msg.round, now);
				if (res.ok) {
					this.dispatch(res.events);
					this.ensureAlarm(false);
				} else {
					this.send(ws, { type: 'error', code: res.error });
				}
				return;
			}
			case 'rematch': {
				const res = this.engine.rematch(seat, msg.round, now);
				if (res.ok) {
					this.dispatch(res.events);
					this.ensureAlarm(false);
				} else {
					this.send(ws, { type: 'error', code: res.error });
				}
				return;
			}
			case 'updateNames': {
				const res = this.engine.updateNames(seat, { p1: msg.p1, p2: msg.p2 }, now);
				if (res.ok) this.dispatch(res.events);
				else this.send(ws, { type: 'error', code: res.error });
				return;
			}
			case 'leave': {
				const res = this.engine.end(now);
				this.dispatch(res.events);
				this.teardown(WS_CLOSE.ENDED);
				return;
			}
			case 'auth':
				return;
		}
	}

	webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
		this.onSocketGone(ws, code);
	}

	webSocketError(ws: WebSocket, _error: unknown): void {
		// workerd also fires close after error; cleanup is idempotent.
		this.onSocketGone(ws, 1006);
	}

	private onSocketGone(ws: WebSocket, _code: number): void {
		const info = this.sockets.get(ws);
		if (!info) return;
		if (info.authTimer) clearTimeout(info.authTimer);
		this.sockets.delete(ws);
		const seat = info.seat;
		if (!seat) return;
		if (this.seatSocket.get(seat) === ws) this.seatSocket.delete(seat);
		const res = this.engine.setConnected(seat, false, Date.now());
		this.dispatch(res.events);
		this.ensureAlarm(true); // shorten the alarm to cover the grace deadline
		this.startSweep();
	}

	// ── Expiry: sweep timer (prompt) + alarm (guaranteed) ───────────────────

	private startSweep(): void {
		if (this.sweepTimer !== null) return;
		const sweep = (): void => {
			this.sweepTimer = null;
			const res = this.engine.checkExpiry(Date.now());
			if (res.status === 'closed') {
				this.dispatch(res.events);
				this.teardown(res.reason === 'abandoned' || res.reason === 'ended' ? WS_CLOSE.ENDED : WS_CLOSE.GONE);
				return;
			}
			if (this.engine.room && !this.engine.room.closed) {
				this.sweepTimer = setTimeout(sweep, SWEEP_INTERVAL_MS);
			}
		};
		this.sweepTimer = setTimeout(sweep, SWEEP_INTERVAL_MS);
	}

	private stopSweep(): void {
		if (this.sweepTimer !== null) {
			clearTimeout(this.sweepTimer);
			this.sweepTimer = null;
		}
	}

	private ensureAlarm(force: boolean): void {
		const now = Date.now();
		let target: number;
		if (!this.engine.room || this.engine.room.closed) {
			return; // nothing to clean up; let any pending alarm lapse
		}
		const d = this.engine.deadlines(now);
		target = Math.min(d.ttlDeadline, d.graceDeadline === Infinity ? d.ttlDeadline : d.graceDeadline) + 1_000;
		if (!force && Math.abs(target - this.alarmTarget) < ALARM_SLACK_MS) return;
		this.alarmTarget = target;
		// Fire-and-forget; alarm writes are billed as row writes, so we throttle.
		this.state.storage.setAlarm(target).catch(() => {});
	}

	async alarm(): Promise<void> {
		const now = Date.now();
		const res = this.engine.checkExpiry(now);
		if (res.status === 'closed') {
			this.dispatch(res.events);
			this.teardown(res.reason === 'abandoned' || res.reason === 'ended' ? WS_CLOSE.ENDED : WS_CLOSE.GONE);
			return;
		}
		// Still alive — re-arm for the next deadline (bounded by TTL sweep cadence).
		this.alarmTarget = 0;
		const next = Math.min(res.nextCheckAt + 1_000, now + 10 * 60_000);
		this.alarmTarget = next;
		await this.state.storage.setAlarm(next).catch(() => {});
	}

	// ── plumbing ─────────────────────────────────────────────────────────────

	private dispatch(events: OutEvent[], exclude?: WebSocket): void {
		for (const ev of events) {
			if (ev.to === 'all') {
				for (const [sock, info] of this.sockets) {
					if (info.authed && sock !== exclude) this.send(sock, ev.msg);
				}
			} else {
				const sock = this.seatSocket.get(ev.to);
				if (sock && sock !== exclude) {
					const info = this.sockets.get(sock);
					if (info?.authed) this.send(sock, ev.msg);
				}
			}
		}
	}

	private send(ws: WebSocket, msg: ServerMsg): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// Socket already gone; close handler will clean up.
		}
	}

	private safeClose(ws: WebSocket, code: number, reason: string): void {
		try {
			ws.close(code, reason);
		} catch {
			try {
				ws.close();
			} catch {
				/* already closed */
			}
		}
		this.onSocketGone(ws, code);
	}

	/** Close all sockets and discard every trace of the room from memory. */
	private teardown(closeCode: number): void {
		for (const [sock, info] of this.sockets) {
			if (info.authTimer) clearTimeout(info.authTimer);
			info.seat = null; // avoid re-entrant disconnect bookkeeping
			this.safeCloseQuiet(sock, closeCode);
		}
		this.sockets.clear();
		this.seatSocket.clear();
		this.joinHits.clear();
		this.stopSweep();
		this.engine.discard();
		this.alarmTarget = 0;
		this.state.storage.deleteAlarm().catch(() => {});
	}

	private safeCloseQuiet(ws: WebSocket, code: number): void {
		try {
			ws.close(code, code === WS_CLOSE.ENDED ? 'session ended' : 'room expired');
		} catch {
			try {
				ws.close();
			} catch {
				/* already closed */
			}
		}
	}
}
