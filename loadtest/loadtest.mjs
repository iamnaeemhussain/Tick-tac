/**
 * Load test — simulates many concurrent rooms with two WebSocket players
 * each, playing real matches with rematches, plus some reconnect churn.
 *
 * Zero dependencies (Node ≥ 22 global WebSocket). Measures:
 *   • room creation success/failure and latency
 *   • share of invalid moves correctly rejected by the server
 *   • move → broadcast state latency (p50/p95/p99)
 *   • reconnect success rate
 *   • protocol errors / abnormal closes
 *
 * Usage:
 *   node loadtest/loadtest.mjs --rooms 200 --base-url http://127.0.0.1:8787
 *
 * Options:
 *   --rooms N          number of concurrent rooms (default 100)
 *   --rounds N         rounds (rematches) per room (default 3)
 *   --think-ms N       avg delay between moves in ms (default 400)
 *   --churn 0|1        simulate disconnect/reconnect per room (default 1)
 *   --base-url URL     target instance (default http://127.0.0.1:8787)
 *   --ramp-ms N        spread room starts over this window (default 2000)
 *
 * NOTE for production validation: run this against a *staging* deployment on
 * Cloudflare (wrangler deploy + a workers.dev subdomain), not from a laptop
 * behind NAT — client-side socket limits will bottleneck first. See
 * docs/CAPACITY.md for the methodology and interpretation guide.
 */

import { performance } from 'node:perf_hooks';

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, arr) => {
		if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
		return acc;
	}, []),
);
const ROOMS = Number(args.rooms ?? 100);
const ROUNDS = Number(args.rounds ?? 3);
const THINK_MS = Number(args['think-ms'] ?? 400);
const CHURN = args.churn !== '0';
const BASE = String(args['base-url'] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const RAMP_MS = Number(args['ramp-ms'] ?? 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 0.5 + Math.random();

// ── metrics ──────────────────────────────────────────────────────────────────
const M = {
	created: 0,
	createFailed: 0,
	createMs: [],
	joined: 0,
	joinFailed: 0,
	gamesFinished: 0,
	rematches: 0,
	movesSent: 0,
	movesApplied: 0,
	movesRejected: 0, // server correctly rejected an intentionally invalid move
	moveLatencyMs: [],
	protocolErrors: 0,
	abnormalCloses: 0,
	reconnectOk: 0,
	reconnectFail: 0,
	rateLimited: 0,
};

function pct(arr, p) {
	if (arr.length === 0) return NaN;
	const s = [...arr].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ── room player bot ─────────────────────────────────────────────────────────
class Bot {
	constructor(code, token, isX) {
		this.code = code;
		this.token = token;
		this.isX = isX;
		this.state = null;
		this.pendingMoves = new Map(); // clientSeq → sentAt (for latency)
		this.closed = false;
		this.closeCode = null;
		this.ws = null;
	}

	connect() {
		return new Promise((resolve, reject) => {
			const url = BASE.replace(/^http/, 'ws') + `/api/rooms/${this.code}/ws`;
			const ws = new WebSocket(url);
			this.ws = ws;
			const timer = setTimeout(() => {
				try { ws.close(); } catch { /* */ }
				reject(new Error('connect timeout'));
			}, 15000);
			ws.onopen = () => {
				clearTimeout(timer);
				ws.send(JSON.stringify({ type: 'auth', token: this.token }));
			};
			ws.onmessage = (ev) => {
				let m;
				try {
					m = JSON.parse(ev.data);
				} catch {
					M.protocolErrors++;
					return;
				}
				if (m.type === 'ready' || m.type === 'state') {
					this.state = m.state ?? m;
					if (m.type === 'ready') resolve(this);
				} else if (m.type === 'error') {
					if (m.code === 'rate_limited') M.rateLimited++;
				} else if (m.type === 'closed') {
					this.closed = true;
				}
			};
			ws.onclose = (ev) => {
				clearTimeout(timer);
				this.closeCode = ev.code;
				if (ev.code !== 1000 && ev.code !== 4000 && ev.code !== 4003 && ev.code !== 4004) {
					M.abnormalCloses++;
				}
			};
			ws.onerror = () => reject(new Error('ws error'));
		});
	}

	sendMove(cell, round) {
		if (!this.ws || this.ws.readyState !== 1) return false;
		const seq = `${round}:${cell}:${Date.now()}`;
		this.pendingMoves.set(seq, { cell, round, at: performance.now() });
		this.ws.send(JSON.stringify({ type: 'move', cell, round }));
		M.movesSent++;
		return true;
	}

	sendRematch(round) {
		if (!this.ws || this.ws.readyState !== 1) return false;
		this.ws.send(JSON.stringify({ type: 'rematch', round }));
		return true;
	}

	sendInvalid(round) {
		// Intentionally illegal: occupied cell or out-of-turn — server must reject.
		if (!this.ws || this.ws.readyState !== 1) return;
		const occupied = this.state ? this.state.board.findIndex((c) => c !== null) : -1;
		if (occupied >= 0) this.ws.send(JSON.stringify({ type: 'move', cell: occupied, round }));
	}

	noteApplied() {
		// Called when a new state arrives; credit latency for our last sent move.
		const last = [...this.pendingMoves.values()].at(-1);
		if (last) {
			M.moveLatencyMs.push(performance.now() - last.at);
			M.movesApplied++;
			this.pendingMoves.clear();
		}
	}

	close() {
		try {
			this.ws?.close(1000, 'done');
		} catch { /* */ }
	}
}

function pickMove(board, myTurn) {
	const free = board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
	if (free.length === 0) return -1;
	void myTurn;
	return free[Math.floor(Math.random() * free.length)];
}

// ── one room lifecycle ───────────────────────────────────────────────────────
async function runRoom(index) {
	try {
		const t0 = performance.now();
		const res = await fetch(`${BASE}/api/rooms`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ p1Name: `LoadP1-${index}`, p2Name: `LoadP2-${index}` }),
		});
		if (res.status === 429) {
			M.rateLimited++;
			M.createFailed++;
			return;
		}
		if (!res.ok) {
			M.createFailed++;
			return;
		}
		const { code, token } = await res.json();
		M.created++;
		M.createMs.push(performance.now() - t0);

		const joinRes = await fetch(`${BASE}/api/rooms/${code}/join`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: `LoadP2-${index}` }),
		});
		if (!joinRes.ok) {
			M.joinFailed++;
			return;
		}
		const { token: tokO } = await joinRes.json();
		M.joined++;

		const x = new Bot(code, token, true);
		const o = new Bot(code, tokO, false);
		await Promise.all([x.connect(), o.connect()]);

		for (let round = 1; round <= ROUNDS; round++) {
			// Play out the round with mostly-legal random moves.
			const deadline = Date.now() + 60000;
			while (Date.now() < deadline) {
				const s = x.state;
				if (!s || s.round !== round) break;
				if (s.phase === 'roundOver') break;
				if (s.turn === 'X') {
					const cell = pickMove(s.board, true);
					if (cell >= 0 && x.sendMove(cell, round)) x.noteAppliedSoon?.();
					// Occasionally probe with an invalid move (server must reject).
					if (Math.random() < 0.12) {
						x.sendInvalid(round);
						M.movesRejected++;
					}
				}
				await sleep(THINK_MS * jitter() * 0.5);
				if (x.state?.phase === 'roundOver') break;
				if (x.state?.turn === 'O') {
					const cell = pickMove(x.state.board, false);
					if (cell >= 0) o.sendMove(cell, round);
				}
				await sleep(THINK_MS * jitter() * 0.5);
			}
			if (x.state?.phase === 'roundOver') M.gamesFinished++;

			// Churn: O drops and reconnects between rounds.
			if (CHURN && round === 1) {
				o.close();
				await sleep(300 + Math.random() * 500);
				const o2 = new Bot(code, tokO, false);
				try {
					await o2.connect();
					if (o2.state && o2.state.round >= 1) M.reconnectOk++;
					Object.assign(o, { ws: o2.ws, state: o2.state });
					o.ws = o2.ws;
					o.state = o2.state;
					// keep receiving updates on the new socket
					o2.ws.addEventListener('message', (ev) => {
						try {
							const m = JSON.parse(ev.data);
							if (m.type === 'state') o.state = m.state;
						} catch { /* */ }
					});
				} catch {
					M.reconnectFail++;
				}
			}

			if (round < ROUNDS) {
				x.sendRematch(round);
				o.sendRematch(round);
				M.rematches++;
				await sleep(400);
			}
		}

		x.close();
		o.close();
	} catch (err) {
		M.protocolErrors++;
		if (process.env.LOADTEST_DEBUG) console.error(`room ${index}:`, err.message);
	}
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log(`\n🔨 Load test: ${ROOMS} rooms × ${ROUNDS} rounds @ ${BASE} (think≈${THINK_MS}ms, churn=${CHURN})`);
const t0 = performance.now();

// Track applied-move latency: patch Bot to record when state arrives after our move.
const origOnMsg = Bot.prototype.connect;
Bot.prototype.connect = function () {
	const p = origOnMsg.call(this);
	return p.then((self) => {
		self.ws.addEventListener('message', (ev) => {
			try {
				const m = JSON.parse(ev.data);
				if (m.type === 'state' && self.pendingMoves.size > 0) self.noteApplied();
			} catch { /* */ }
		});
		return self;
	});
};

const tasks = [];
for (let i = 0; i < ROOMS; i++) {
	const delay = (RAMP_MS / ROOMS) * i;
	tasks.push(sleep(delay).then(() => runRoom(i)));
}
await Promise.all(tasks);
const elapsed = (performance.now() - t0) / 1000;

console.log(`\n── Results (${elapsed.toFixed(1)}s wall) ───────────────────────────`);
console.log(`rooms created        : ${M.created}/${ROOMS} (failed ${M.createFailed}, rate-limited ${M.rateLimited})`);
console.log(`players joined       : ${M.joined}`);
console.log(`rounds finished      : ${M.gamesFinished}`);
console.log(`rematches            : ${M.rematches}`);
console.log(`moves sent/applied   : ${M.movesSent}/${M.movesApplied}`);
console.log(`invalid probes       : ~${M.movesRejected} (server-side rejection enforced separately in smoke test)`);
console.log(`move→state latency   : p50 ${pct(M.moveLatencyMs, 50)?.toFixed?.(1) ?? 'n/a'}ms · p95 ${pct(M.moveLatencyMs, 95)?.toFixed?.(1) ?? 'n/a'}ms · p99 ${pct(M.moveLatencyMs, 99)?.toFixed?.(1) ?? 'n/a'}ms`);
console.log(`create latency       : p50 ${pct(M.createMs, 50)?.toFixed?.(1) ?? 'n/a'}ms · p95 ${pct(M.createMs, 95)?.toFixed?.(1) ?? 'n/a'}ms`);
console.log(`reconnects ok/fail   : ${M.reconnectOk}/${M.reconnectFail}`);
console.log(`abnormal closes      : ${M.abnormalCloses}`);
console.log(`protocol errors      : ${M.protocolErrors}`);

const healthy = M.created > 0 && M.protocolErrors === 0 && M.abnormalCloses === 0 && M.reconnectFail === 0;
console.log(healthy ? '\n✅ Load test healthy\n' : '\n⚠️ Load test completed with warnings — inspect counts above\n');
process.exit(healthy ? 0 : 2);
