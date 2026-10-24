/**
 * Wire protocol + input validation shared by the browser client and the
 * Cloudflare Worker / Durable Object. One source of truth for message shapes,
 * error codes, WebSocket close codes and name sanitization.
 */

import { Board, Mark } from './game';

// ── Rooms & snapshots ────────────────────────────────────────────────────────

export type RoomPhase = 'waiting' | 'playing' | 'roundOver';

export interface RoomSnapshot {
	phase: RoomPhase;
	round: number;
	board: Board;
	turn: Mark | null;
	winner: Mark | 'draw' | null;
	winLine: [number, number, number] | null;
	names: { X: string; O: string | null };
	/** Name the creator suggested for player 2 (before they join/confirm). */
	p2Suggested: string | null;
	score: { X: number; O: number; draws: number };
	rematch: { X: boolean; O: boolean };
	connected: { X: boolean; O: boolean };
	/** Epoch ms when a seat disconnected (null = connected). For grace UIs. */
	disconnectedAt: { X: number | null; O: number | null };
	/** Cell of the most recent move (null on a fresh board). */
	lastMove: number | null;
	roundStartedAt: number;
	/** Server clock (epoch ms) so clients can sync the round timer. */
	serverNow: number;
}

export type PublicRoomStatus =
	| 'waiting'
	| 'active'
	| 'expired'
	| 'not_found';

/** Public info returned by GET /api/rooms/:code — never contains tokens. */
export interface PublicRoomInfo {
	status: PublicRoomStatus;
	p1Name: string | null;
	p2Name: string | null; // confirmed name, or the creator's suggestion
	p2IsSuggestion: boolean;
	connected: { X: boolean; O: boolean };
}

// ── WebSocket messages ───────────────────────────────────────────────────────

export type ClientMsg =
	| { type: 'auth'; token: string }
	| { type: 'move'; cell: number; round: number }
	| { type: 'rematch'; round: number }
	| { type: 'updateNames'; p1?: string; p2?: string }
	| { type: 'ping'; t: number }
	| { type: 'leave' };

export type ServerMsg =
	| { type: 'ready'; you: Mark; state: RoomSnapshot }
	| { type: 'state'; state: RoomSnapshot }
	| { type: 'pong'; t: number }
	| { type: 'closed'; reason: CloseReason }
	| { type: 'error'; code: ErrorCode };

export type CloseReason = 'ended' | 'expired' | 'abandoned' | 'replaced';

export type ErrorCode =
	| 'bad_payload'
	| 'unauthorized'
	| 'not_started'
	| 'not_your_turn'
	| 'occupied'
	| 'bad_cell'
	| 'stale_round'
	| 'round_active'
	| 'rate_limited'
	| 'room_full'
	| 'name_invalid';

/** Custom WebSocket close codes (4000–4999 are app-defined). */
export const WS_CLOSE = {
	/** Room closed normally (session ended by a player). Do not reconnect. */
	ENDED: 4000,
	/** Bad/missing token. Do not reconnect. */
	UNAUTHORIZED: 4001,
	/** Same seat authenticated elsewhere; this socket was replaced. */
	REPLACED: 4003,
	/** Room expired or never existed. Do not reconnect. */
	GONE: 4004,
	/** Rate limited or protocol violation. May reconnect after backoff. */
	ABUSE: 4008,
	/** Server-side failure. May reconnect after backoff. */
	ERROR: 4011,
} as const;

/** Close codes after which the client should NOT try to reconnect. */
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
	WS_CLOSE.ENDED,
	WS_CLOSE.UNAUTHORIZED,
	WS_CLOSE.REPLACED,
	WS_CLOSE.GONE,
	1000,
]);

// ── REST payloads ────────────────────────────────────────────────────────────

export interface CreateRoomRequest {
	p1Name: string;
	p2Name?: string; // optional suggested name for the invited friend
}
export interface CreateRoomResponse {
	code: string;
	token: string;
	seat: Mark; // creator is always X
	inviteUrl: string;
}
export interface JoinRoomRequest {
	name: string;
}
export interface JoinRoomResponse {
	token: string;
	seat: Mark; // joiner is always O
}
export interface ApiError {
	error: string;
	message?: string;
}

// ── Limits & validation ──────────────────────────────────────────────────────

export const NAME_MAX_LENGTH = 20;
export const MAX_WS_MESSAGE_BYTES = 1024;
export const MAX_HTTP_BODY_BYTES = 2048;
/** Room codes are 8 chars from an unambiguous base-54 alphabet. */
export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_ALPHABET =
	'23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
export const ROOM_CODE_RE = /^[2-9A-HJ-NP-Za-km-z]{8}$/;

/** Strip control chars, zero-width chars and bidi overrides; collapse spaces. */
export function sanitizeName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const cleaned = raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // control chars
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '') // zero-width + bidi
		.replace(/\s+/g, ' ')
		.trim();
	if (cleaned.length === 0 || cleaned.length > NAME_MAX_LENGTH) return null;
	return cleaned;
}

export function isRoomCode(v: unknown): v is string {
	return typeof v === 'string' && ROOM_CODE_RE.test(v);
}

export function isToken(v: unknown): v is string {
	return typeof v === 'string' && v.length >= 16 && v.length <= 64;
}

/** Narrow untrusted JSON into a ClientMsg, or null if malformed. */
export function parseClientMsg(data: unknown): ClientMsg | null {
	if (typeof data !== 'object' || data === null) return null;
	const m = data as Record<string, unknown>;
	switch (m.type) {
		case 'auth':
			return isToken(m.token) ? { type: 'auth', token: m.token } : null;
		case 'move':
			return typeof m.cell === 'number' && typeof m.round === 'number'
				? { type: 'move', cell: m.cell, round: m.round }
				: null;
		case 'rematch':
			return typeof m.round === 'number' ? { type: 'rematch', round: m.round } : null;
		case 'updateNames': {
			const out: { type: 'updateNames'; p1?: string; p2?: string } = { type: 'updateNames' };
			if (typeof m.p1 === 'string') out.p1 = m.p1;
			if (typeof m.p2 === 'string') out.p2 = m.p2;
			return out;
		}
		case 'ping':
			return typeof m.t === 'number' ? { type: 'ping', t: m.t } : null;
		case 'leave':
			return { type: 'leave' };
		default:
			return null;
	}
}
