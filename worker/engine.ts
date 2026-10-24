/**
 * RoomEngine — the authoritative, pure game-state machine for a single room.
 *
 * It has NO knowledge of WebSockets, Durable Objects or time sources: every
 * method takes `now` and returns events/errors. That makes the full ruleset
 * (turn validation, membership, wins, draws, rematches, expiry, grace
 * periods) unit-testable, while RoomDO (worker/room.ts) only wires it to
 * sockets and alarms.
 *
 * All state lives in memory. Nothing here is ever persisted.
 */

import {
	Board,
	Mark,
	emptyBoard,
	evaluateBoard,
	otherMark,
	isLegalCell,
} from '../shared/game';
import {
	CloseReason,
	ErrorCode,
	RoomPhase,
	RoomSnapshot,
	ServerMsg,
	PublicRoomInfo,
	sanitizeName,
} from '../shared/protocol';

export interface SeatPlayer {
	name: string;
	token: string;
	connected: boolean;
	/** When the seat went offline (or was created and never connected). */
	disconnectedAt: number | null;
}

export interface RoomRecord {
	code: string;
	x: SeatPlayer;
	o: SeatPlayer | null;
	p2Suggested: string | null;
	phase: RoomPhase;
	board: Board;
	turn: Mark | null;
	round: number;
	winner: Mark | 'draw' | null;
	winLine: [number, number, number] | null;
	lastMove: number | null;
	score: { X: number; O: number; draws: number };
	rematch: { X: boolean; O: boolean };
	createdAt: number;
	lastActivityAt: number;
	roundStartedAt: number;
	closed: CloseReason | null;
}

export type Target = Mark | 'all';
export interface OutEvent {
	to: Target;
	msg: ServerMsg;
}
export type EngineError = { ok: false; error: ErrorCode };
export type EngineOk = { ok: true; events: OutEvent[] };
export type EngineResult = EngineOk | EngineError;

export interface EngineConfig {
	/** Room dies after this much inactivity (ms). */
	ttlMs: number;
	/** Disconnected player is dropped after this (ms). */
	graceMs: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
	ttlMs: 30 * 60 * 1000,
	graceMs: 60 * 1000,
};

export class RoomEngine {
	room: RoomRecord | null = null;

	constructor(private cfg: EngineConfig = DEFAULT_CONFIG) {}

	// ── lifecycle ────────────────────────────────────────────────────────────

	create(opts: {
		code: string;
		p1Name: string;
		p2Suggested: string | null;
		tokenX: string;
		now: number;
	}): EngineResult {
		if (this.room) return { ok: false, error: 'room_full' };
		this.room = {
			code: opts.code,
			x: { name: opts.p1Name, token: opts.tokenX, connected: false, disconnectedAt: opts.now },
			o: null,
			p2Suggested: opts.p2Suggested,
			phase: 'waiting',
			board: emptyBoard(),
			turn: null,
			round: 0,
			winner: null,
			winLine: null,
			lastMove: null,
			score: { X: 0, O: 0, draws: 0 },
			rematch: { X: false, O: false },
			createdAt: opts.now,
			lastActivityAt: opts.now,
			roundStartedAt: opts.now,
			closed: null,
		};
		return { ok: true, events: [] };
	}

	/** Public, token-free view used by GET /api/rooms/:code. */
	info(): PublicRoomInfo {
		const r = this.room;
		if (!r || r.closed) {
			return {
				status: 'expired',
				p1Name: null,
				p2Name: null,
				p2IsSuggestion: false,
				connected: { X: false, O: false },
			};
		}
		const started = r.phase !== 'waiting';
		return {
			status: started ? 'active' : 'waiting',
			p1Name: r.x.name,
			p2Name: r.o ? r.o.name : r.p2Suggested,
			p2IsSuggestion: !r.o,
			connected: { X: r.x.connected, O: r.o?.connected ?? false },
		};
	}

	/** Validate a seat token → seat mark, or null. */
	seatForToken(token: string): Mark | null {
		const r = this.room;
		if (!r || r.closed) return null;
		if (r.x.token === token) return 'X';
		if (r.o && r.o.token === token) return 'O';
		return null;
	}

	snapshot(now: number): RoomSnapshot | null {
		const r = this.room;
		if (!r) return null;
		return {
			phase: r.phase,
			round: r.round,
			board: r.board.slice(),
			turn: r.phase === 'playing' ? r.turn : null,
			winner: r.winner,
			winLine: r.winLine ? [r.winLine[0], r.winLine[1], r.winLine[2]] : null,
			lastMove: r.lastMove,
			names: { X: r.x.name, O: r.o?.name ?? null },
			p2Suggested: r.p2Suggested,
			score: { ...r.score },
			rematch: { ...r.rematch },
			connected: { X: r.x.connected, O: r.o?.connected ?? false },
			disconnectedAt: { X: r.x.disconnectedAt, O: r.o?.disconnectedAt ?? null },
			roundStartedAt: r.roundStartedAt,
			serverNow: now,
		};
	}

	/**
	 * Authoritative snapshot broadcast. Both players receive the same state
	 * (tokens are never included) so their boards can never diverge.
	 */
	private stateEvents(now: number): OutEvent[] {
		const snap = this.snapshot(now);
		if (!snap) return [];
		return [{ to: 'all', msg: { type: 'state', state: snap } }];
	}

	// ── joining ──────────────────────────────────────────────────────────────

	join(opts: { name: string; tokenO: string; now: number }): EngineResult {
		const r = this.room;
		if (!r || r.closed) return { ok: false, error: 'unauthorized' };
		if (r.phase !== 'waiting') return { ok: false, error: 'room_full' };
		if (r.o !== null) return { ok: false, error: 'room_full' };
		const name = sanitizeName(opts.name);
		if (!name) return { ok: false, error: 'name_invalid' };

		r.o = { name, token: opts.tokenO, connected: false, disconnectedAt: opts.now };
		r.p2Suggested = null;
		r.lastActivityAt = opts.now;

		// Both players confirmed → start round 1. X (the creator) moves first.
		r.phase = 'playing';
		r.round = 1;
		r.board = emptyBoard();
		r.turn = 'X';
		r.lastMove = null;
		r.roundStartedAt = opts.now;

		return { ok: true, events: this.stateEvents(opts.now) };
	}

	/** Creator may edit either display name while the room is still waiting. */
	updateNames(
		seat: Mark,
		names: { p1?: string; p2?: string },
		now: number,
	): EngineResult {
		const r = this.room;
		if (!r || r.closed) return { ok: false, error: 'unauthorized' };
		if (r.phase !== 'waiting') return { ok: false, error: 'round_active' };
		if (seat !== 'X') return { ok: false, error: 'unauthorized' };
		if (names.p1 !== undefined) {
			const n = sanitizeName(names.p1);
			if (!n) return { ok: false, error: 'name_invalid' };
			r.x.name = n;
		}
		if (names.p2 !== undefined) {
			const n = sanitizeName(names.p2);
			if (!n) return { ok: false, error: 'name_invalid' };
			if (r.o) r.o.name = n;
			else r.p2Suggested = n;
		}
		r.lastActivityAt = now;
		return { ok: true, events: this.stateEvents(now) };
	}

	// ── gameplay ─────────────────────────────────────────────────────────────

	move(seat: Mark, cell: unknown, round: unknown, now: number): EngineResult {
		const r = this.room;
		if (!r || r.closed) return { ok: false, error: 'unauthorized' };
		if (r.phase === 'waiting') return { ok: false, error: 'not_started' };
		if (r.phase === 'roundOver') return { ok: false, error: 'stale_round' };
		// Stale/duplicate messages from laggy clients are rejected by round id —
		// this also makes double-clicks and replayed packets idempotent.
		if (typeof round !== 'number' || round !== r.round) {
			return { ok: false, error: 'stale_round' };
		}
		if (seat !== r.turn) return { ok: false, error: 'not_your_turn' };
		if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) {
			return { ok: false, error: 'bad_cell' };
		}
		if (!isLegalCell(r.board, cell)) return { ok: false, error: 'occupied' };

		r.board[cell] = seat;
		r.lastMove = cell;
		r.lastActivityAt = now;

		const outcome = evaluateBoard(r.board);
		if (outcome.kind === 'win') {
			r.phase = 'roundOver';
			r.winner = outcome.winner;
			r.winLine = [outcome.line[0], outcome.line[1], outcome.line[2]];
			r.turn = null;
			r.score[outcome.winner] += 1;
			r.rematch = { X: false, O: false };
		} else if (outcome.kind === 'draw') {
			r.phase = 'roundOver';
			r.winner = 'draw';
			r.winLine = null;
			r.turn = null;
			r.score.draws += 1;
			r.rematch = { X: false, O: false };
		} else {
			r.turn = otherMark(seat);
		}

		return { ok: true, events: this.stateEvents(now) };
	}

	rematch(seat: Mark, round: unknown, now: number): EngineResult {
		const r = this.room;
		if (!r || r.closed) return { ok: false, error: 'unauthorized' };
		if (!r.o) return { ok: false, error: 'not_started' };
		if (r.phase === 'waiting') return { ok: false, error: 'not_started' };
		if (r.phase === 'playing') return { ok: false, error: 'round_active' };
		// Idempotent: duplicates for the finished round are accepted as no-ops,
		// stale requests referencing older rounds are rejected.
		if (typeof round !== 'number' || round < r.round) {
			return { ok: false, error: 'stale_round' };
		}

		r.rematch[seat] = true;
		r.lastActivityAt = now;

		if (r.rematch.X && r.rematch.O) {
			// Both accepted → next round IN THE SAME ROOM (no new room per rematch).
			r.round += 1;
			r.board = emptyBoard();
			r.phase = 'playing';
			r.turn = 'X';
			r.winner = null;
			r.winLine = null;
			r.lastMove = null;
			r.rematch = { X: false, O: false };
			r.roundStartedAt = now;
		}
		return { ok: true, events: this.stateEvents(now) };
	}

	// ── presence & expiry ────────────────────────────────────────────────────

	setConnected(seat: Mark, connected: boolean, now: number): EngineOk {
		const r = this.room;
		if (!r || r.closed) return { ok: true, events: [] };
		const p = seat === 'X' ? r.x : r.o;
		if (!p) return { ok: true, events: [] };
		if (p.connected === connected && (connected || p.disconnectedAt !== null)) {
			return { ok: true, events: [] };
		}
		p.connected = connected;
		p.disconnectedAt = connected ? null : now;
		if (connected) r.lastActivityAt = now; // reconnecting counts as activity
		return { ok: true, events: this.stateEvents(now) };
	}

	/**
	 * Periodic expiry check (driven by an in-DO sweep timer + a storage alarm
	 * as the guaranteed fallback). Outcomes:
	 *  - 'alive'  → also returns when to check next
	 *  - 'closed' → room over; the DO discards all state and closes sockets
	 *    reasons: 'abandoned' = a player walked out past the grace period;
	 *             'expired'   = idle beyond the room TTL / never came alive.
	 */
	checkExpiry(
		now: number,
	): { status: 'alive'; nextCheckAt: number } | { status: 'closed'; reason: CloseReason; events: OutEvent[] } {
		const r = this.room;
		if (!r) return this.closeResult('expired');
		if (r.closed) return { status: 'closed', reason: r.closed, events: [] };

		const grace = this.cfg.graceMs;
		const gx = r.x.connected ? Infinity : (r.x.disconnectedAt ?? r.createdAt) + grace;
		const go = r.o ? (r.o.connected ? Infinity : (r.o.disconnectedAt ?? r.createdAt) + grace) : Infinity;
		const ttl = r.lastActivityAt + this.cfg.ttlMs;
		const xHere = r.x.connected;
		const oHere = r.o?.connected ?? false;
		const started = r.phase !== 'waiting' || r.o !== null;

		if (!xHere && !oHere) {
			// Nobody connected — discard at the earliest applicable deadline.
			const deadline = Math.min(gx, go, ttl);
			if (deadline <= now) {
				return this.closeResult(started ? 'abandoned' : 'expired');
			}
			return { status: 'alive', nextCheckAt: deadline };
		}

		if (gx <= now || go <= now) {
			// The other player is still here, but this one blew the grace period.
			return this.closeResult('abandoned');
		}
		if (ttl <= now) {
			return this.closeResult('expired');
		}
		return { status: 'alive', nextCheckAt: Math.min(gx, go, ttl) };
	}

	private closeResult(reason: CloseReason): { status: 'closed'; reason: CloseReason; events: OutEvent[] } {
		const r = this.room;
		const events: OutEvent[] = r && !r.closed ? [{ to: 'all', msg: { type: 'closed', reason } }] : [];
		if (r) {
			r.closed = reason;
		}
		return { status: 'closed', reason, events };
	}

	/** A player explicitly ends the session (both are told, state discarded). */
	end(now: number): EngineOk {
		const r = this.room;
		if (!r || r.closed) return { ok: true, events: [] };
		r.lastActivityAt = now;
		r.closed = 'ended';
		return { ok: true, events: [{ to: 'all', msg: { type: 'closed', reason: 'ended' } }] };
	}

	/** Hard-discard all in-memory state (called by the DO on close/expiry). */
	discard(): void {
		this.room = null;
	}

	/** Deadline info the DO uses to schedule its alarm/sweep. */
	deadlines(now: number): { ttlDeadline: number; graceDeadline: number } {
		const r = this.room;
		if (!r) return { ttlDeadline: now, graceDeadline: now };
		const grace = this.cfg.graceMs;
		const g = (p: SeatPlayer | null): number =>
			p && !p.connected ? (p.disconnectedAt ?? r.createdAt) + grace : Infinity;
		return {
			ttlDeadline: r.lastActivityAt + this.cfg.ttlMs,
			graceDeadline: Math.min(g(r.x), g(r.o)),
		};
	}

	get record(): RoomRecord | null {
		return this.room;
	}
}
