/**
 * RoomClient — resilient WebSocket client for a live room.
 *
 *  • first message after connect is `auth` (token never appears in the URL,
 *    so it can't end up in server access logs)
 *  • heartbeat ping every 20 s; 12 s without pong → force reconnect
 *  • auto-reconnect with exponential backoff + jitter for drop-outs, until
 *    the server-side grace period has surely elapsed (then we verify room
 *    state over REST and report `gone`)
 *  • terminal close codes (session ended, unauthorized, room gone) stop all
 *    retries — expired rooms cannot be resumed
 */

import {
	ClientMsg,
	CloseReason,
	ServerMsg,
	TERMINAL_CLOSE_CODES,
	RoomSnapshot,
} from '../../shared/protocol';

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'gone';

export interface RoomClientCallbacks {
	onReady?: (you: 'X' | 'O', state: RoomSnapshot) => void;
	onState?: (state: RoomSnapshot) => void;
	onPong?: (t: number) => void;
	onClosed?: (reason: CloseReason | 'connection_lost') => void;
	onError?: (code: string) => void;
	onConnState?: (state: ConnState) => void;
}

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 12_000;
const AUTH_SEND_TIMEOUT_MS = 6_000;
/** Keep trying to reconnect a bit longer than the server grace (60 s). */
const RECONNECT_BUDGET_MS = 90_000;
const MAX_BACKOFF_MS = 8_000;

export class RoomClient {
	private ws: WebSocket | null = null;
	private destroyed = false;
	private connState: ConnState = 'idle';
	private attempt = 0;
	private everReady = false;
	private firstDropAt = 0;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private handshakeFailures = 0;

	constructor(
		private code: string,
		private token: string,
		private cb: RoomClientCallbacks,
	) {}

	get state(): ConnState {
		return this.connState;
	}

	connect(): void {
		if (this.destroyed || this.ws) return;
		this.setConnState(this.attempt === 0 ? 'connecting' : 'reconnecting');

		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${window.location.host}/api/rooms/${this.code}/ws`;
		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.ws = ws;

		const authTimeout = setTimeout(() => {
			// Server didn't accept our auth in time — recycle the socket.
			try {
				ws.close();
			} catch {
				/* noop */
			}
		}, AUTH_SEND_TIMEOUT_MS);

		ws.onopen = () => {
			this.handshakeFailures = 0;
			this.sendRaw({ type: 'auth', token: this.token });
		};

		ws.onmessage = (ev) => {
			let msg: ServerMsg;
			try {
				msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMsg;
			} catch {
				return;
			}
			switch (msg.type) {
				case 'ready':
					clearTimeout(authTimeout);
					this.attempt = 0;
					this.firstDropAt = 0;
					this.everReady = true;
					this.setConnState('open');
					this.startHeartbeat();
					this.cb.onReady?.(msg.you, msg.state);
					break;
				case 'state':
					this.cb.onState?.(msg.state);
					break;
				case 'pong':
					if (this.pongTimer) clearTimeout(this.pongTimer);
					this.cb.onPong?.(msg.t);
					break;
				case 'closed':
					this.stopAll();
					this.setConnState('gone');
					this.cb.onClosed?.(msg.reason);
					break;
				case 'error':
					this.cb.onError?.(msg.code);
					break;
			}
		};

		ws.onclose = (ev) => {
			clearTimeout(authTimeout);
			this.stopHeartbeat();
			this.ws = null;
			if (this.destroyed) return;

			if (TERMINAL_CLOSE_CODES.has(ev.code)) {
				this.stopAll();
				this.setConnState('gone');
				// Map close code → user-facing reason.
				const reason: CloseReason | 'connection_lost' =
					ev.code === 4000 ? 'ended' : ev.code === 4004 ? 'expired' : ev.code === 4003 ? 'replaced' : ev.code === 4001 ? 'expired' : 'connection_lost';
				this.cb.onClosed?.(reason);
				return;
			}

			if (!this.everReady) {
				// Handshake keeps failing — the room may simply be gone. Verify
				// over REST after 2 failed attempts so users aren't left waiting
				// out the full reconnect budget for an expired room.
				this.handshakeFailures += 1;
				if (this.handshakeFailures >= 2) {
					void this.checkRoomAlive();
					return;
				}
			}
			void this.scheduleReconnect();
		};

		ws.onerror = () => {
			// onclose follows; nothing to do here.
		};
	}

	send(msg: ClientMsg): boolean {
		return this.sendRaw(msg);
	}

	private sendRaw(msg: ClientMsg): boolean {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) return false;
		try {
			ws.send(JSON.stringify(msg));
			return true;
		} catch {
			return false;
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.stopAll();
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			try {
				ws.close(1000, 'leaving page');
			} catch {
				/* noop */
			}
		}
	}

	// ── internals ────────────────────────────────────────────────────────────

	private setConnState(s: ConnState): void {
		if (this.connState === s) return;
		this.connState = s;
		this.cb.onConnState?.(s);
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.pingTimer = setInterval(() => {
			if (!this.sendRaw({ type: 'ping', t: Date.now() })) return;
			this.pongTimer = setTimeout(() => {
				// Socket is a zombie — recycle it.
				try {
					this.ws?.close();
				} catch {
					/* noop */
				}
			}, PONG_TIMEOUT_MS);
		}, PING_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.pingTimer) clearInterval(this.pingTimer);
		if (this.pongTimer) clearTimeout(this.pongTimer);
		this.pingTimer = null;
		this.pongTimer = null;
	}

	private scheduleReconnect(): void {
		if (this.destroyed || this.retryTimer) return;
		if (this.firstDropAt === 0) this.firstDropAt = Date.now();

		if (Date.now() - this.firstDropAt > RECONNECT_BUDGET_MS) {
			// The server-side grace period has surely passed — the room is gone.
			this.stopAll();
			this.setConnState('gone');
			this.cb.onClosed?.('connection_lost');
			return;
		}

		this.attempt += 1;
		const base = Math.min(500 * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
		const delay = base / 2 + Math.random() * (base / 2);
		this.setConnState('reconnecting');
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.connect();
		}, delay);
	}

	/** REST probe: if the room no longer exists, stop retrying immediately. */
	private async checkRoomAlive(): Promise<void> {
		if (this.destroyed) return;
		let gone = false;
		try {
			const res = await fetch(`/api/rooms/${this.code}`, { headers: { accept: 'application/json' } });
			if (res.ok) {
				const info = (await res.json()) as { status?: string };
				gone = info.status === 'expired' || info.status === 'not_found';
			} else {
				gone = res.status === 404 || res.status === 410;
			}
		} catch {
			gone = false; // network problem — keep trying the socket path
		}
		if (this.destroyed) return;
		if (gone) {
			this.stopAll();
			this.setConnState('gone');
			this.cb.onClosed?.('expired');
		} else {
			void this.scheduleReconnect();
		}
	}

	private stopAll(): void {
		this.stopHeartbeat();
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}
}

export type { RoomSnapshot };
