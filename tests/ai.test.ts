import { describe, expect, it } from 'vitest';
import { chooseMove, immediateWin, legalMoves, playRandomGameAgainst, bestMoves } from '../shared/ai';
import { Board, Mark, emptyBoard, evaluateBoard, otherMark } from '../shared/game';

/** Deterministic mulberry32 PRNG so tests are reproducible. */
function rngFrom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('AI legality', () => {
	it('always returns a legal move for every difficulty', () => {
		for (let seed = 0; seed < 300; seed++) {
			const rng = rngFrom(seed);
			for (const diff of ['easy', 'medium', 'hard'] as const) {
				const b = emptyBoard();
				// Build a random partial position.
				const filled = seed % 9;
				let t: Mark = 'X';
				for (let i = 0; i < filled; i++) {
					const moves = legalMoves(b);
					b[moves[Math.floor(rng() * moves.length)]] = t;
					t = otherMark(t);
				}
				if (evaluateBoard(b).kind !== 'ongoing') continue;
				const cell = chooseMove(b, t, diff, rng);
				expect(legalMoves(b), `seed ${seed} diff ${diff}`).toContain(cell);
			}
		}
	});
});

describe('hard AI is unbeatable', () => {
	it('never loses 400 games vs a random opponent (both colors)', () => {
		for (let seed = 1; seed <= 400; seed++) {
			const rng = rngFrom(seed);
			const aiMark: Mark = seed % 2 === 0 ? 'X' : 'O';
			const { winner } = playRandomGameAgainst(aiMark, 'hard', rng);
			expect(winner === aiMark || winner === 'draw', `seed ${seed} winner ${winner}`).toBe(true);
		}
	});

	it('never loses 200 hard-vs-hard games (all draws)', () => {
		for (let seed = 1; seed <= 200; seed++) {
			const rng = rngFrom(seed);
			const board = emptyBoard();
			let turn: Mark = 'X';
			while (true) {
				const outcome = evaluateBoard(board);
				if (outcome.kind !== 'ongoing') {
					expect(outcome.kind, `seed ${seed}`).toBe('draw');
					break;
				}
				board[chooseMove(board, turn, 'hard', rng)] = turn;
				turn = otherMark(turn);
			}
		}
	});

	it('takes an immediate win', () => {
		// X to move, X wins by playing 2 (line 0-1-2).
		const winBoard: Board = ['X', 'X', null, 'O', 'O', null, null, null, null];
		expect(chooseMove(winBoard, 'X', 'hard', rngFrom(7))).toBe(2);
	});

	it('blocks an immediate loss', () => {
		// X at 0,1 → X wins at 2 next move. O must play 2.
		const b: Board = ['X', 'X', null, 'O', null, null, null, null, null];
		expect(chooseMove(b, 'O', 'hard', rngFrom(11))).toBe(2);
	});

	it('prefers winning over blocking', () => {
		// Both sides have an immediate win; O to move must take its own win (5).
		const b: Board = ['X', 'X', null, 'O', 'O', null, null, null, null];
		expect(chooseMove(b, 'O', 'hard', rngFrom(13))).toBe(5);
	});
});

describe('easy AI is beatable and imperfect', () => {
	it('loses at least sometimes against a perfect player', () => {
		let easyLosses = 0;
		for (let seed = 1; seed <= 200; seed++) {
			const rng = rngFrom(seed);
			const board = emptyBoard();
			const easyMark: Mark = seed % 2 === 0 ? 'X' : 'O';
			const smartMark = otherMark(easyMark);
			let turn: Mark = 'X';
			while (true) {
				const outcome = evaluateBoard(board);
				if (outcome.kind === 'win') {
					if (outcome.winner === smartMark) easyLosses++;
					break;
				}
				if (outcome.kind === 'draw') break;
				const cell =
					turn === easyMark
						? chooseMove(board, turn, 'easy', rng)
						: chooseMove(board, turn, 'hard', rng);
				board[cell] = turn;
				turn = otherMark(turn);
			}
		}
		expect(easyLosses).toBeGreaterThan(50);
	});
});

describe('medium AI is sensible but imperfect', () => {
	it('almost always takes an immediate win', () => {
		const b: Board = ['O', 'O', null, 'X', 'X', null, null, null, null];
		// X to move wins at 5.
		expect(chooseMove(b, 'X', 'medium', rngFrom(5))).toBe(5);
		expect(immediateWin(b, 'X')).toBe(5);
	});

	it('beats a random player the majority of the time', () => {
		let wins = 0;
		const games = 150;
		for (let seed = 1; seed <= games; seed++) {
			const rng = rngFrom(seed * 31);
			const aiMark: Mark = seed % 2 === 0 ? 'X' : 'O';
			const { winner } = playRandomGameAgainst(aiMark, 'medium', rng);
			if (winner === aiMark) wins++;
		}
		expect(wins / games).toBeGreaterThan(0.6);
	});
});

describe('bestMoves', () => {
	it('prefers the winning move when one exists', () => {
		const b: Board = ['X', 'X', null, 'O', 'O', null, null, null, null];
		expect(bestMoves(b, 'X')).toEqual([2]);
		expect(bestMoves(b, 'O')).toEqual([5]);
	});
});
