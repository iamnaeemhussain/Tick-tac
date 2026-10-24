/**
 * End-to-end smoke test against a running instance (wrangler dev or a real
 * deployment). Exercises the full multiplayer contract over REST + WebSocket:
 *
 *   1.  create → join → both players connect & authenticate
 *   2.  server-authoritative turn enforcement (out-of-turn rejected)
 *   3.  occupied cells, malformed cells, stale-round duplicates rejected
 *   4.  both clients always receive identical board snapshots
 *   5.  win detection + score + winLine broadcast
 *   6.  rematch handshake (needs both) → same room, round++, score kept
 *   7.  disconnect → opponent notified → reconnect restores live board
 *   8.  bad tokens rejected (4001), no third players
 *   9.  leave → session ended for both → room discarded (info: expired)
 *  10.  two rooms operate independently
 *  11.  (optional, needs short-grace instance) grace-period expiry:
 *      both players gone → room discarded → cannot be resumed
 *
 * Usage:
 *   node scripts/smoke.mjs [baseUrl]
 *   SMOKE_EXPIRY_URL=http://127.0.0.1:8788 node scripts/smoke.mjs   # also runs expiry phase
 */

let BASE = (process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const EXPIRY_BASE = process.env.SMOKE_EXPIRY_URL ? process.env.SMOKE_EXPIRY_URL.replace(/\/$/, '') : null;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
	if (cond) {
		passed++;
		console.log(`  ✅ ${name}`);
	} else {
		failed++;
		failures.push(name);
		console.log(`  ❌ ${name} ${extra}`);
	}
}

async function api(path, opts = {}) {
	const res = await fetch(BASE + path, {
		headers: { 'content-type': 'application/json' },
		...opts,
	});
	let body = null;
	try {
		body = await res.json();
	} catch { /* empty */ }
	return { status: res.status, body };
}

function wsUrl(base, code) {
	return base.replace(/^http/, 'ws') + `/api/rooms/${code}/ws`;
}

class Client {
	constructor(code, token, base = BASE) {
		this.code = code;
		this.token = token;
		this.base = base;
		this.msgs = [];
		this.closedWith = null;
		this.errors = [];
		this.ws = null;
	}

	connect() {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(wsUrl(this.base, this.code));
			this.ws = ws;
			const t = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
			ws.onopen = () => {
				clearTimeout(t);
				ws.send(JSON.stringify({ type: 'auth', token: this.token }));
				resolve(this);
			};
			ws.onerror = (e) => {
				clearTimeout(t);
				this.errors.push('error');
				reject(new Error('ws error'));
			};
			ws.onmessage = (ev) => {
				try {
					this.msgs.push(JSON.parse(ev.data));
				} catch { /* ignore */ }
			};
			ws.onclose = (ev) => {
				this.closedWith = { code: ev.code, reason: ev.reason };
			};
		});
	}

	send(msg) {
		this.ws.send(JSON.stringify(msg));
	}

	/** Wait until a received message satisfies pred; returns it. */
	async wait(pred, timeout = 6000, from = 0) {
		const start = Date.now();
		let i = from;
		while (Date.now() - start < timeout) {
			for (; i < this.msgs.length; i++) {
				if (pred(this.msgs[i], i)) return { msg: this.msgs[i], index: i };
			}
			await new Promise((r) => setTimeout(r, 25));
		}
		return null;
	}

	waitState(timeout = 6000) {
		return this.wait((m) => m.type === 'state', timeout);
	}

	waitError(code, timeout = 4000) {
		return this.wait((m) => m.type === 'error' && (code === undefined || m.code === code), timeout);
	}

	close() {
		try {
			this.ws.close(1000, 'bye');
		} catch { /* ignore */ }
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createAndJoin(p1 = 'Ana', p2 = 'Sam') {
	const created = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ p1Name: p1, p2Name: p2 }) });
	if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
	const { code, token: tokX } = created.body;
	const joined = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: p2 }) });
	if (joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
	return { code, tokX, tokO: joined.body.token };
}

// ── Phase 1: full multiplayer flow ──────────────────────────────────────────

async function mainPhase() {
	console.log(`\n▶ Smoke phase 1: multiplayer flow @ ${BASE}`);

	// ── create + waiting state ──
	const created = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ p1Name: '  Ana  ', p2Name: 'Sam' }) });
	ok('create room returns 201 + code + token + seat X', created.status === 201 && created.body.code && created.body.token && created.body.seat === 'X');
	const code = created.body.code;
	ok('room code is 8 chars from the safe alphabet', /^[2-9A-HJ-NP-Za-km-z]{8}$/.test(code), code);
	ok('invite url points at /room/<code>', created.body.inviteUrl === `/room/${code}`);

	let info = await api(`/api/rooms/${code}`);
	ok('public info: waiting, suggested name shown, no token leaked',
		info.body.status === 'waiting' && info.body.p1Name === 'Ana' && info.body.p2Name === 'Sam' &&
		info.body.p2IsSuggestion === true && !JSON.stringify(info.body).includes(created.body.token));

	const x = new Client(code, created.body.token);
	await x.connect();
	let r = await x.wait((m) => m.type === 'ready');
	ok('creator authenticates and receives ready(you=X, phase=waiting)',
		r && r.msg.you === 'X' && r.msg.state.phase === 'waiting');

	// ── bad token rejected ──
	const impostor = new Client(code, 'ffffffff-0000-4000-8000-000000000000');
	await impostor.connect();
	await impostor.wait(() => false, 100); // let close arrive
	await sleep(300);
	ok('bad token → socket closed with 4001', impostor.closedWith && impostor.closedWith.code === 4001,
		JSON.stringify(impostor.closedWith));

	// ── join + both connected → round 1 ──
	const joined = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: ' Sam ' }) });
	ok('join returns token + seat O', joined.status === 200 && joined.body.token && joined.body.seat === 'O');

	const third = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: 'Eve' }) });
	ok('third player rejected (room full → 409)', third.status === 409 && third.body.error === 'room_full');

	const o = new Client(code, joined.body.token);
	await o.connect();
	r = await o.wait((m) => m.type === 'ready');
	ok('joiner authenticates, game already started (phase=playing, round=1, turn=X)',
		r && r.msg.you === 'O' && r.msg.state.phase === 'playing' && r.msg.state.round === 1 && r.msg.state.turn === 'X');
	ok('names confirmed on both seats', r && r.msg.state.names.X === 'Ana' && r.msg.state.names.O === 'Sam');

	const xstart = await x.wait((m) => m.type === 'state' && m.state.phase === 'playing');
	ok('creator notified that match started', Boolean(xstart));

	// ── authoritative validation ──
	const errCount = { x: x.msgs.length, o: o.msgs.length };
	o.send({ type: 'move', cell: 4, round: 1 });
	let e = await o.waitError('not_your_turn', 4000, errCount.o);
	ok('out-of-turn move rejected (not_your_turn)', Boolean(e));

	const fromX1 = x.msgs.length;
	const fromO1 = o.msgs.length;
	x.send({ type: 'move', cell: 4, round: 1 });
	let sx = await x.wait((m) => m.type === 'state' && m.state.board[4] === 'X', 6000, fromX1);
	ok('legal move accepted and broadcast', sx && sx.msg.state.turn === 'O' && sx.msg.state.lastMove === 4);
	let so = await o.wait((m) => m.type === 'state' && m.state.board[4] === 'X', 6000, fromO1);
	ok('opponent received identical snapshot', so && JSON.stringify(so.msg.state.board) === JSON.stringify(sx.msg.state.board) && so.msg.state.round === sx.msg.state.round);

	// duplicate/stale replay of the same move → rejected, board unchanged
	const eo = o.msgs.length;
	o.send({ type: 'move', cell: 4, round: 1 });
	e = await o.waitError('occupied', 4000, eo);
	ok('occupied cell rejected', Boolean(e));

	const ex2 = x.msgs.length;
	x.send({ type: 'move', cell: 0, round: 99 });
	e = await x.waitError('stale_round', 4000, ex2);
	ok('stale round id rejected (duplicate/delayed message defense)', Boolean(e));

	const ex3 = x.msgs.length;
	x.send({ type: 'move', cell: 0, round: 1 }); // X is not on turn now
	e = await x.waitError('not_your_turn', 4000, ex3);
	ok('move on opponent’s turn still rejected after stale attempts', Boolean(e));

	// rapid double-send: O spams cell 0 twice; exactly one must be applied
	o.send({ type: 'move', cell: 0, round: 1 });
	o.send({ type: 'move', cell: 0, round: 1 });
	const sAfterDouble = await x.wait((m) => m.type === 'state' && m.state.board[0] === 'O');
	await sleep(300);
	const lastStateAfterDouble = [...x.msgs].reverse().find((m) => m.type === 'state');
	const markCount = lastStateAfterDouble ? lastStateAfterDouble.state.board.filter(Boolean).length : -1;
	ok('double-click duplicate applied exactly once (2 marks: X@4, O@0)',
		Boolean(sAfterDouble) && markCount === 2, `marks=${markCount}`);

	// ── play to an X win: X 1,2 ; O 3,4 ; X0 already? board: X@4 O@0. X plays 1? plan: X:3? taken. Use X:5,6? Let's complete X line 4-? Simplest: X takes 0? occupied by O. X wins via column 4? 4 + 1 + 7 ──
	x.send({ type: 'move', cell: 1, round: 1 });
	await x.wait((m) => m.type === 'state' && m.state.board[1] === 'X');
	o.send({ type: 'move', cell: 3, round: 1 });
	await x.wait((m) => m.type === 'state' && m.state.board[3] === 'O');
	x.send({ type: 'move', cell: 7, round: 1 }); // X: 4,1,7? not a line — but check win via 1? we aim column 1-4-7 ✓
	const winState = await x.wait((m) => m.type === 'state' && m.state.winner !== null && m.state.winner !== undefined);
	ok('win detected server-side (X via column 1-4-7)',
		winState && winState.msg.state.winner === 'X' && JSON.stringify(winState.msg.state.winLine?.slice().sort()) === JSON.stringify([1, 4, 7]));
	ok('score updated (X=1)', winState && winState.msg.state.score.X === 1 && winState.msg.state.score.O === 0);
	ok('phase → roundOver, turn cleared', winState && winState.msg.state.phase === 'roundOver' && winState.msg.state.turn === null);

	const oWinState = await o.wait((m) => m.type === 'state' && m.state.winner === 'X');
	ok('loser sees the same authoritative result', Boolean(oWinState) &&
		JSON.stringify(oWinState.msg.state.board) === JSON.stringify(winState.msg.state.board));

	// moves after round over are rejected
	const ex4 = x.msgs.length;
	x.send({ type: 'move', cell: 8, round: 1 });
	e = await x.waitError('stale_round', 4000, ex4);
	ok('moves after round end rejected', Boolean(e));

	// ── rematch handshake ──
	const rmCount = x.msgs.length;
	x.send({ type: 'rematch', round: 1 });
	const sRm = await x.wait((m) => m.type === 'state' && m.state.rematch.X === true, 4000, rmCount);
	ok('rematch request registered (waiting for both)', sRm && sRm.msg.state.phase === 'roundOver' && sRm.msg.state.round === 1);

	o.send({ type: 'rematch', round: 1 });
	const sR2 = await x.wait((m) => m.type === 'state' && m.state.round === 2);
	ok('both accepted → round 2 in the SAME room, board reset, score kept',
		sR2 && sR2.msg.state.phase === 'playing' && sR2.msg.state.turn === 'X' &&
		sR2.msg.state.board.every((c) => c === null) && sR2.msg.state.score.X === 1);
	const sR2o = await o.wait((m) => m.type === 'state' && m.state.round === 2);
	ok('opponent also sees round 2', Boolean(sR2o));

	// ── disconnect + reconnect within grace ──
	o.close();
	const sDisc = await x.wait((m) => m.type === 'state' && m.state.connected.O === false);
	ok('opponent disconnect reported to remaining player', Boolean(sDisc) && sDisc.msg.state.disconnectedAt.O !== null);

	await sleep(600);
	const o2 = new Client(code, joined.body.token);
	await o2.connect();
	const rO2 = await o2.wait((m) => m.type === 'ready');
	ok('reconnect with same token restores the LIVE board (round 2 intact)',
		rO2 && rO2.msg.state.round === 2 && rO2.msg.state.score.X === 1 && rO2.msg.state.connected.X === true);
	const sReconn = await x.wait((m) => m.type === 'state' && m.state.connected.O === true);
	ok('remaining player sees opponent back online', Boolean(sReconn));

	// ── end session ──
	x.send({ type: 'leave' });
	const closedX = await x.wait((m) => m.type === 'closed');
	const closedO = await o2.wait((m) => m.type === 'closed');
	ok('leave → both players receive closed(ended)', closedX && closedX.msg.reason === 'ended' && closedO && closedO.msg.reason === 'ended');
	await sleep(300);
	ok('sockets closed with 4000', x.closedWith?.code === 4000 && o2.closedWith?.code === 4000,
		`${JSON.stringify(x.closedWith)} / ${JSON.stringify(o2.closedWith)}`);

	info = await api(`/api/rooms/${code}`);
	ok('after end: room state discarded (info → expired)', info.body.status === 'expired');

	const resume = new Client(code, created.body.token);
	let resumeFailed = false;
	try {
		await resume.connect();
		const res = await resume.wait((m) => m.type === 'ready' || m.type === 'closed', 2500);
		resumeFailed = !res || res.msg.type === 'closed';
		await sleep(400);
		if (resume.closedWith) resumeFailed = resume.closedWith.code === 4001 || resume.closedWith.code === 4004 || resumeFailed;
	} catch {
		resumeFailed = true; // handshake refused (410) — also correct
	}
	ok('ended room cannot be resumed', resumeFailed);

	// ── room isolation ──
	const [a, b] = await Promise.all([createAndJoin('Kim', 'Lee'), createAndJoin('Pat', 'Jo')]);
	const ax = new Client(a.code, a.tokX);
	const bx = new Client(b.code, b.tokX);
	await Promise.all([ax.connect(), bx.connect()]);
	const rax = await ax.wait((m) => m.type === 'ready');
	const rbx = await bx.wait((m) => m.type === 'ready');
	ok('both isolated rooms reached ready', Boolean(rax) && Boolean(rbx));
	const bStatesBefore = bx.msgs.filter((m) => m.type === 'state').length;
	const aFrom = ax.msgs.length;
	ax.send({ type: 'move', cell: 8, round: 1 });
	const sa = await ax.wait((m) => m.type === 'state' && m.state.board[8] === 'X', 6000, aFrom);
	await sleep(400);
	const bStates = bx.msgs.filter((m) => m.type === 'state');
	ok('rooms are isolated: a move in room A does not touch room B',
		Boolean(sa) && rbx.msg.state.board.every((c) => c === null) && bStates.length === bStatesBefore);
	ax.close();
	bx.close();
}

// ── Phase 2: expiry semantics (needs an instance with short grace/TTL) ───────

async function expiryPhase() {
	console.log(`\n▶ Smoke phase 2: expiry & cleanup @ ${EXPIRY_BASE}`);
	const oldBase = BASE;
	BASE = EXPIRY_BASE; // api() helpers now target the short-grace instance

	try {
		const { code, tokX, tokO } = await createAndJoin('Zoe', 'Kai');
		const x = new Client(code, tokX, EXPIRY_BASE);
		const o = new Client(code, tokO, EXPIRY_BASE);
		await Promise.all([x.connect(), o.connect()]);
		await x.wait((m) => m.type === 'ready');
		await o.wait((m) => m.type === 'ready');
		x.send({ type: 'move', cell: 4, round: 1 });
		await x.wait((m) => m.type === 'state' && m.state.board[4] === 'X');

		// Both players slam their browsers shut.
		x.close();
		o.close();

		// Grace period (short on this instance) elapses → room must be gone.
		let info = null;
		for (let i = 0; i < 40; i++) {
			await sleep(500);
			info = await api(`/api/rooms/${code}`);
			if (info.body.status === 'expired') break;
		}
		ok('room discarded after both players vanish past the grace period', info.body.status === 'expired');

		// Reconnecting with a valid old token must NOT resurrect the game.
		const zombie = new Client(code, tokX, EXPIRY_BASE);
		let resurrected = false;
		try {
			await zombie.connect();
			const res = await zombie.wait((m) => m.type === 'ready', 2500);
			resurrected = Boolean(res && res.msg.type === 'ready' && res.msg.state.board[4] === 'X');
		} catch {
			resurrected = false; // handshake refused → correct
		}
		ok('expired room cannot be resumed with a valid old token', !resurrected);

		// A creator who never connects: room self-destructs (TTL/grace hygiene).
		const created = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ p1Name: 'Ghost' }) });
		const ghostCode = created.body.code;
		let gone = false;
		for (let i = 0; i < 40; i++) {
			await sleep(500);
			const gi = await api(`/api/rooms/${ghostCode}`);
			if (gi.body.status === 'expired') {
				gone = true;
				break;
			}
		}
		ok('abandoned-at-creation room self-destructs', gone);
	} finally {
		BASE = oldBase;
	}
}

// ── run ──────────────────────────────────────────────────────────────────────

try {
	await mainPhase();
	if (EXPIRY_BASE) await expiryPhase();
} catch (err) {
	console.error('\n💥 Smoke run crashed:', err);
	failed++;
	failures.push(`crash: ${err.message}`);
}

console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
if (failed > 0) {
	console.log('Failures:', failures.join(' | '));
	process.exit(1);
}
process.exit(0);
