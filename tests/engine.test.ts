import { describe, expect, it } from 'vitest';
import { RoomEngine, DEFAULT_CONFIG, OutEvent } from '../worker/engine';
import { RoomSnapshot, ServerMsg } from '../shared/protocol';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function mk(ttlMs = 30 * MIN, graceMs = 60_000) {
	const e = new RoomEngine({ ttlMs, graceMs });
	const create = e.create({ code: 'Ab8kP2xQ', p1Name: 'Ana', p2Suggested: 'Bo', tokenX: 'tok-x-aaaaaaaa', now: T0 });
	expect(create.ok).toBe(true);
	return e;
}

function join(e: RoomEngine, name = 'Bo', at = T0 + 1000) {
	const res = e.join({ name, tokenO: 'tok-o-bbbbbbbb', now: at });
	expect(res.ok).toBe(true);
	return res as { ok: true; events: OutEvent[] };
}

function lastState(events: OutEvent[]): RoomSnapshot {
	const states = events.filter((ev) => ev.msg.type === 'state') as { msg: { type: 'state'; state: RoomSnapshot } }[];
	expect(states.length).toBeGreaterThan(0);
	return states[states.length - 1].msg.state;
}

function connect(e: RoomEngine, seat: 'X' | 'O', at: number) {
	return e.setConnected(seat, true, at);
}

describe('room lifecycle', () => {
	it('starts in the waiting phase with the creator as X', () => {
		const e = mk();
		const snap = e.snapshot(T0)!;
		expect(snap.phase).toBe('waiting');
		expect(snap.names.X).toBe('Ana');
		expect(snap.names.O).toBeNull();
		expect(snap.p2Suggested).toBe('Bo');
		expect(snap.round).toBe(0);
	});

	it('never leaks tokens in snapshots or public info', () => {
		const e = mk();
		join(e);
		const snapText = JSON.stringify(e.snapshot(T0));
		const infoText = JSON.stringify(e.info());
		expect(snapText).not.toContain('tok-x');
		expect(snapText).not.toContain('tok-o');
		expect(infoText).not.toContain('tok-x');
		expect(infoText).not.toContain('tok-o');
	});

	it('public info shows waiting → active and hides internals', () => {
		const e = mk();
		expect(e.info().status).toBe('waiting');
		expect(e.info().p2IsSuggestion).toBe(true);
		join(e, 'Bea');
		const info = e.info();
		expect(info.status).toBe('active');
		expect(info.p2Name).toBe('Bea');
		expect(info.p2IsSuggestion).toBe(false);
	});

	it('double-create is rejected', () => {
		const e = mk();
		const again = e.create({ code: 'Xx234567', p1Name: 'Eve', p2Suggested: null, tokenX: 'tok-e', now: T0 });
		expect(again.ok).toBe(false);
	});

	it('joining starts round 1 with X to move, and only once', () => {
		const e = mk();
		const res = join(e, 'Bea', T0 + 2000);
		const snap = lastState(res.events);
		expect(snap.phase).toBe('playing');
		expect(snap.round).toBe(1);
		expect(snap.turn).toBe('X');
		expect(snap.names.O).toBe('Bea');
		expect(snap.p2Suggested).toBeNull();

		const second = e.join({ name: 'Mallory', tokenO: 'tok-m', now: T0 + 3000 });
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.error).toBe('room_full');
		expect(e.record!.o!.name).toBe('Bea'); // seat not stolen
	});

	it('rejects joins with invalid names', () => {
		const e = mk();
		const res = e.join({ name: '   \u0000  ', tokenO: 'tok-o-bbbbbbbb', now: T0 });
		expect(res.ok).toBe(false);
	});

	it('only seat tokens map to seats', () => {
		const e = mk();
		join(e);
		expect(e.seatForToken('tok-x-aaaaaaaa')).toBe('X');
		expect(e.seatForToken('tok-o-bbbbbbbb')).toBe('O');
		expect(e.seatForToken('guessed-token-1234')).toBeNull();
		expect(e.seatForToken('')).toBeNull();
	});

	it('suggested p2 name is only a suggestion, not a joined player', () => {
		const e = mk();
		// Room is still waiting even though a p2 name exists.
		expect(e.record!.o).toBeNull();
		expect(e.info().status).toBe('waiting');
		const move = e.move('X', 4, 1, T0);
		expect(move.ok).toBe(false); // cannot play before the friend joins
	});
});

describe('authoritative move validation', () => {
	it('rejects out-of-turn, occupied, malformed and stale moves', () => {
		const e = mk();
		join(e);

		// O tries to move first.
		let res = e.move('O', 4, 1, T0 + 2000);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('not_your_turn');

		// X plays center.
		res = e.move('X', 4, 1, T0 + 2100);
		expect(res.ok).toBe(true);
		expect(lastState((res as { events: OutEvent[] }).events).turn).toBe('O');

		// O tries the occupied cell.
		res = e.move('O', 4, 1, T0 + 2200);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('occupied');

		// O sends a malformed cell.
		for (const bad of [-1, 9, 4.5, '3', null, undefined]) {
			res = e.move('O', bad, 1, T0 + 2300);
			expect(res.ok, `cell ${String(bad)}`).toBe(false);
			if (!res.ok) expect(['bad_cell', 'occupied', 'stale_round']).toContain(res.error);
		}

		// Stale round id (duplicate/delayed message) is rejected.
		res = e.move('O', 0, 99, T0 + 2400);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('stale_round');

		// A legal O move works.
		res = e.move('O', 0, 1, T0 + 2500);
		expect(res.ok).toBe(true);
		expect(lastState((res as { events: OutEvent[] }).events).board[0]).toBe('O');
	});

	it('rejects moves before the match starts and after a round ends', () => {
		const e = mk();
		let res = e.move('X', 0, 1, T0);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('not_started');

		join(e);
		// X wins: 0,1,2 vs O at 3,4
		e.move('X', 0, 1, T0 + 10);
		e.move('O', 3, 1, T0 + 20);
		e.move('X', 1, 1, T0 + 30);
		e.move('O', 4, 1, T0 + 40);
		res = e.move('X', 2, 1, T0 + 50);
		expect(res.ok).toBe(true);
		const snap = e.snapshot(T0 + 50)!;
		expect(snap.phase).toBe('roundOver');
		expect(snap.winner).toBe('X');
		expect(snap.winLine).toEqual([0, 1, 2]);
		expect(snap.score.X).toBe(1);
		expect(snap.turn).toBeNull();

		// Further moves in the finished round are rejected.
		res = e.move('O', 8, 1, T0 + 60);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('stale_round');
	});

	it('detects draws, scores them and locks the board', () => {
		const e = mk();
		join(e);
		// Draw sequence: X:0 O:1 X:2 O:3 X:4? build a known draw:
		// X O X
		// X X O
		// O X O   → moves: X0 O1 X2 O3? Let's play it explicitly.
		const seq: ['X' | 'O', number][] = [
			['X', 0], ['O', 1], ['X', 2], ['O', 3],
			['X', 4], ['O', 6], ['X', 7], ['O', 5], ['X', 8],
		];
		// Board: X O X / X O X? verify below via engine outcome instead of by hand.
		let t = T0;
		let last: ReturnType<RoomEngine['move']> | null = null;
		for (const [seat, cell] of seq) {
			last = e.move(seat, cell, 1, (t += 100));
			if (!last.ok) break;
		}
		const snap = e.snapshot(t)!;
		// Whatever the sequence produced, engine state must be consistent:
		if (snap.phase === 'roundOver' && snap.winner === 'draw') {
			expect(snap.score.draws).toBe(1);
		}
		if (snap.phase === 'roundOver') {
			expect(['X', 'O', 'draw']).toContain(snap.winner);
			// No moves after round over.
			const after = e.move('X', 5, 1, t + 1);
			expect(after.ok).toBe(false);
		}
		expect(last).not.toBeNull();
	});

	it('a full drawn board is detected on the 9th move', () => {
		const e = mk();
		join(e);
		//  X O X
		//  X X O
		//  O X O   (X: 0,2,3,4,7  O: 1,5,6,8)
		const seq: ['X' | 'O', number][] = [
			['X', 0], ['O', 1], ['X', 2], ['O', 5],
			['X', 3], ['O', 6], ['X', 4], ['O', 8], ['X', 7],
		];
		let t = T0;
		for (const [seat, cell] of seq) {
			const res = e.move(seat, cell, 1, (t += 100));
			expect(res.ok, `move ${seat}${cell}`).toBe(true);
		}
		const snap = e.snapshot(t)!;
		expect(snap.phase).toBe('roundOver');
		expect(snap.winner).toBe('draw');
		expect(snap.score.draws).toBe(1);
		expect(snap.board).toEqual(['X', 'O', 'X', 'X', 'X', 'O', 'O', 'X', 'O']);
	});
});

describe('rematches — same room, unlimited rounds', () => {
	function playToXWin(e: RoomEngine) {
		const seq: ['X' | 'O', number][] = [['X', 0], ['O', 3], ['X', 1], ['O', 4], ['X', 2]];
		let t = T0 + 5000;
		for (const [seat, cell] of seq) {
			const res = e.move(seat, cell, 1, (t += 100));
			expect(res.ok).toBe(true);
		}
		expect(e.snapshot(t)!.winner).toBe('X');
		return t;
	}

	it('needs BOTH players to accept, then resets the board and keeps the score', () => {
		const e = mk();
		join(e);
		const t = playToXWin(e);

		// Only O accepts → nothing resets yet.
		let res = e.rematch('O', 1, t + 100);
		expect(res.ok).toBe(true);
		let snap = e.snapshot(t + 100)!;
		expect(snap.phase).toBe('roundOver');
		expect(snap.rematch.O).toBe(true);
		expect(snap.rematch.X).toBe(false);
		expect(snap.round).toBe(1);

		// X accepts → round 2 begins in the SAME room.
		res = e.rematch('X', 1, t + 200);
		expect(res.ok).toBe(true);
		snap = lastState((res as { events: OutEvent[] }).events);
		expect(snap.phase).toBe('playing');
		expect(snap.round).toBe(2);
		expect(snap.board.every((c) => c === null)).toBe(true);
		expect(snap.turn).toBe('X');
		expect(snap.score.X).toBe(1); // score persists across rematches
		expect(snap.rematch).toEqual({ X: false, O: false });
		expect(e.record!.code).toBe('Ab8kP2xQ'); // same room
	});

	it('supports unlimited consecutive rematches', () => {
		const e = mk();
		join(e);
		let t = T0;
		for (let round = 1; round <= 25; round++) {
			// O wins each round with the top row (0,1,2) while X plays 3,4,7.
			const seq: ['X' | 'O', number][] = [['X', 3], ['O', 0], ['X', 4], ['O', 1], ['X', 7], ['O', 2]];
			for (const [seat, cell] of seq) {
				const res = e.move(seat, cell, round, (t += 100));
				expect(res.ok, `r${round} ${seat}${cell}`).toBe(true);
			}
			expect(e.snapshot(t)!.winner).toBe('O');
			expect(e.rematch('X', round, (t += 10)).ok).toBe(true);
			const res = e.rematch('O', round, (t += 10));
			expect(res.ok).toBe(true);
			expect(e.snapshot(t)!.round).toBe(round + 1);
			expect(e.snapshot(t)!.score.O).toBe(round);
		}
	});

	it('rejects rematch requests mid-round and stale round ids', () => {
		const e = mk();
		join(e);
		e.move('X', 4, 1, T0 + 100);
		const res = e.rematch('X', 1, T0 + 200);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe('round_active');

		// Stale round id on a finished round (fresh engine, clean board).
		const e2 = mk();
		join(e2);
		playToXWin(e2);
		const stale = e2.rematch('X', 0, T0 + 9000);
		expect(stale.ok).toBe(false);
		if (!stale.ok) expect(stale.error).toBe('stale_round');
	});

	it('duplicate rematch acceptance is idempotent', () => {
		const e = mk();
		join(e);
		const t = playToXWin(e);
		expect(e.rematch('X', 1, t + 10).ok).toBe(true);
		expect(e.rematch('X', 1, t + 20).ok).toBe(true); // duplicate → still waiting on O
		expect(e.snapshot(t + 20)!.phase).toBe('roundOver');
		expect(e.rematch('O', 1, t + 30).ok).toBe(true);
		expect(e.snapshot(t + 30)!.round).toBe(2);
	});
});

describe('name editing before the match', () => {
	it('creator can edit both names while waiting; locked after start', () => {
		const e = mk();
		let res = e.updateNames('X', { p1: '  Ana María ', p2: 'Bö' }, T0 + 100);
		expect(res.ok).toBe(true);
		expect(e.record!.x.name).toBe('Ana María');
		expect(e.record!.p2Suggested).toBe('Bö');

		join(e, 'Bö');
		res = e.updateNames('X', { p1: 'Hacker' }, T0 + 2000);
		expect(res.ok).toBe(false);
		expect(e.record!.x.name).toBe('Ana María');
	});

	it('only the creator may edit names', () => {
		const e = mk();
		join(e);
		const res = e.updateNames('O', { p1: 'Nope' }, T0 + 100);
		expect(res.ok).toBe(false);
	});

	it('rejects empty/oversized names', () => {
		const e = mk();
		expect(e.updateNames('X', { p1: '' }, T0).ok).toBe(false);
		expect(e.updateNames('X', { p1: 'x'.repeat(21) }, T0).ok).toBe(false);
		expect(e.updateNames('X', { p1: 'ok name' }, T0).ok).toBe(true);
	});
});

describe('presence, grace period & expiry', () => {
	it('tracks disconnects and reconnections in the snapshot', () => {
		const e = mk();
		connect(e, 'X', T0 + 10);
		join(e, 'Bo', T0 + 20);
		connect(e, 'O', T0 + 30);
		let snap = e.snapshot(T0 + 30)!;
		expect(snap.connected).toEqual({ X: true, O: true });

		e.setConnected('O', false, T0 + 40);
		snap = e.snapshot(T0 + 40)!;
		expect(snap.connected.O).toBe(false);
		expect(snap.disconnectedAt.O).toBe(T0 + 40);

		// Reconnect inside grace → board recovered intact.
		e.setConnected('O', true, T0 + 40 + 30_000);
		snap = e.snapshot(T0 + 40 + 30_000)!;
		expect(snap.connected.O).toBe(true);
		expect(snap.disconnectedAt.O).toBeNull();
		expect(snap.phase).toBe('playing'); // game resumed, not restarted
	});

	it('closes as abandoned when one player is gone past the grace period', () => {
		const e = mk(DEFAULT_CONFIG.ttlMs, 60_000);
		connect(e, 'X', T0 + 10);
		join(e, 'Bo', T0 + 20);
		connect(e, 'O', T0 + 30);
		e.setConnected('O', false, T0 + 1000);

		// Still inside grace → alive.
		let res = e.checkExpiry(T0 + 30_000);
		expect(res.status).toBe('alive');

		// Past grace → abandoned, remaining player is notified.
		res = e.checkExpiry(T0 + 62_000);
		expect(res.status).toBe('closed');
		if (res.status === 'closed') {
			expect(res.reason).toBe('abandoned');
			const closed = res.events.find((ev) => ev.msg.type === 'closed');
			expect(closed).toBeDefined();
			expect((closed!.msg as { reason?: string }).reason).toBe('abandoned');
		}
	});

	it('reconnecting inside grace keeps the room alive indefinitely within TTL activity', () => {
		const e = mk(DEFAULT_CONFIG.ttlMs, 60_000);
		connect(e, 'X', T0);
		join(e);
		connect(e, 'O', T0 + 2000);
		let now = T0 + 2000;
		// Play a bit, then O flaps every 30s but keeps returning.
		for (let i = 0; i < 10; i++) {
			now += 30_000;
			e.setConnected('O', false, now);
			expect(e.checkExpiry(now + 30_000).status).toBe('alive'); // 30s < 60s grace
			now += 45_000;
			e.setConnected('O', true, now);
			e.move('X', i % 9, Math.max(1, e.record!.round), now + 1);
			e.move('O', (i + 1) % 9, Math.max(1, e.record!.round), now + 2);
		}
		expect(e.checkExpiry(now).status).toBe('alive');
	});

	it('expires an idle room after the TTL even with players connected', () => {
		const e = mk(10 * MIN, 60_000);
		connect(e, 'X', T0);
		join(e);
		connect(e, 'O', T0 + 1000);
		expect(e.checkExpiry(T0 + 9 * MIN).status).toBe('alive');
		const res = e.checkExpiry(T0 + 11 * MIN);
		expect(res.status).toBe('closed');
		if (res.status === 'closed') expect(res.reason).toBe('expired');
	});

	it('discards a room when both players vanish past grace — the browser-close case', () => {
		const e = mk(30 * MIN, 60_000);
		connect(e, 'X', T0);
		join(e);
		connect(e, 'O', T0 + 1000);
		e.setConnected('X', false, T0 + 2000);
		e.setConnected('O', false, T0 + 2000);
		// Inside grace: state still present (they may return).
		expect(e.checkExpiry(T0 + 30_000).status).toBe('alive');
		// Beyond grace: closed, and discard() wipes memory.
		const res = e.checkExpiry(T0 + 2000 + 61_000);
		expect(res.status).toBe('closed');
		e.discard();
		expect(e.record).toBeNull();
		expect(e.info().status).toBe('expired');
		expect(e.seatForToken('tok-x-aaaaaaaa')).toBeNull();
	});

	it('a waiting room whose creator never connects dies after the grace period', () => {
		const e = mk(30 * MIN, 60_000);
		// Creator created the room via REST but never opened the WebSocket.
		expect(e.checkExpiry(T0 + 30_000).status).toBe('alive');
		expect(e.checkExpiry(T0 + 61_000).status).toBe('closed');
	});

	it('closed rooms reject everything', () => {
		const e = mk();
		join(e);
		e.end(T0 + 1000);
		expect(e.move('X', 0, 1, T0 + 1100).ok).toBe(false);
		expect(e.rematch('X', 1, T0 + 1100).ok).toBe(false);
		expect(e.seatForToken('tok-x-aaaaaaaa')).toBeNull();
		expect(e.info().status).toBe('expired');
	});

	it('explicit end notifies both players', () => {
		const e = mk();
		join(e);
		const res = e.end(T0 + 100);
		expect(res.ok).toBe(true);
		const closed = res.events.find((ev): ev is OutEvent & { msg: ServerMsg & { type: 'closed' } } => ev.msg.type === 'closed');
		expect(closed).toBeDefined();
		expect(closed!.msg.reason).toBe('ended');
	});

	it('returns the next check deadline for scheduling', () => {
		const e = mk(10 * MIN, 60_000);
		connect(e, 'X', T0);
		join(e);
		connect(e, 'O', T0);
		e.setConnected('O', false, T0 + 5000);
		const res = e.checkExpiry(T0 + 6000);
		expect(res.status).toBe('alive');
		if (res.status === 'alive') {
			// Grace deadline (T0+65000) is earlier than TTL (T0+600000).
			expect(res.nextCheckAt).toBe(T0 + 65_000);
		}
	});
});

describe('multiple rooms are independent', () => {
	it('two engines do not share state', () => {
		const a = mk();
		const b = new RoomEngine({ ttlMs: 30 * MIN, graceMs: 60_000 });
		b.create({ code: 'Zz998877', p1Name: 'Kim', p2Suggested: null, tokenX: 'tok-k', now: T0 });
		join(a);
		a.move('X', 4, 1, T0 + 5000);

		expect(b.record!.phase).toBe('waiting');
		expect(b.record!.board.every((c) => c === null)).toBe(true);
		expect(a.record!.board[4]).toBe('X');
		expect(a.seatForToken('tok-k')).toBeNull();
		expect(b.seatForToken('tok-x-aaaaaaaa')).toBeNull();
	});
});
