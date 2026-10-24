/**
 * Computer opponent — three difficulty levels.
 *
 * easy   : mostly random (occasionally grabs a win), easy to beat.
 * medium : grabs wins, usually blocks, mixes strong and loose play.
 * hard   : full minimax with depth preference — provably unbeatable; the
 *          best a human can achieve is a draw.
 *
 * The RNG is injectable so tests can be deterministic.
 */

import { Board, Mark, BOARD_SIZE, emptyBoard, evaluateBoard, isBoardFull, otherMark } from './game';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export type Rng = () => number;

export function legalMoves(board: Board): number[] {
	const moves: number[] = [];
	for (let i = 0; i < BOARD_SIZE; i++) {
		if (board[i] === null) moves.push(i);
	}
	return moves;
}

function pick<T>(items: T[], rng: Rng): T {
	return items[Math.floor(rng() * items.length) % items.length];
}

/** A cell where placing `mark` immediately wins, or -1. */
export function immediateWin(board: Board, mark: Mark): number {
	for (const cell of legalMoves(board)) {
		board[cell] = mark;
		const won = evaluateBoard(board).kind === 'win';
		board[cell] = null;
		if (won) return cell;
	}
	return -1;
}

/**
 * Minimax with alpha–beta pruning, scored from `me`'s perspective.
 * Depth adjustment makes the AI prefer faster wins and slower losses.
 */
function minimax(
	board: Board,
	me: Mark,
	turn: Mark,
	depth: number,
	alpha: number,
	beta: number,
): number {
	const outcome = evaluateBoard(board);
	if (outcome.kind === 'win') {
		return outcome.winner === me ? 10 - depth : depth - 10;
	}
	if (outcome.kind === 'draw') return 0;

	if (turn === me) {
		let best = -Infinity;
		for (const cell of legalMoves(board)) {
			board[cell] = turn;
			const score = minimax(board, me, otherMark(turn), depth + 1, alpha, beta);
			board[cell] = null;
			if (score > best) best = score;
			if (best > alpha) alpha = best;
			if (alpha >= beta) break;
		}
		return best;
	} else {
		let best = Infinity;
		for (const cell of legalMoves(board)) {
			board[cell] = turn;
			const score = minimax(board, me, otherMark(turn), depth + 1, alpha, beta);
			board[cell] = null;
			if (score < best) best = score;
			if (best < beta) beta = best;
			if (alpha >= beta) break;
		}
		return best;
	}
}

/** All moves achieving the optimal minimax score. */
export function bestMoves(board: Board, me: Mark): number[] {
	let bestScore = -Infinity;
	let best: number[] = [];
	for (const cell of legalMoves(board)) {
		board[cell] = me;
		const score = minimax(board, me, otherMark(me), 1, -Infinity, Infinity);
		board[cell] = null;
		if (score > bestScore) {
			bestScore = score;
			best = [cell];
		} else if (score === bestScore) {
			best.push(cell);
		}
	}
	return best;
}

const CORNERS = [0, 2, 6, 8];
const CENTER = 4;

/**
 * Choose a move for `me` at the given difficulty.
 * Always returns a legal move (never -1 unless the board is full, which
 * callers must not do — guarded here too).
 */
export function chooseMove(
	boardInput: Board,
	me: Mark,
	difficulty: Difficulty,
	rng: Rng = Math.random,
): number {
	// Work on a copy so we never mutate the caller's board.
	const board = boardInput.slice();

	const legal = legalMoves(board);
	if (legal.length === 0) return -1; // board full — no move exists
	if (legal.length === BOARD_SIZE) {
		// Empty board: center and corners are all provably optimal openings;
		// randomize among them for variety instead of running full minimax.
		return pick([CENTER, ...CORNERS], rng);
	}

	const opp = otherMark(me);

	switch (difficulty) {
		case 'easy': {
			// 25% of the time it notices an immediate win — otherwise random.
			if (rng() < 0.25) {
				const win = immediateWin(board, me);
				if (win !== -1) return win;
			}
			return pick(legal, rng);
		}

		case 'medium': {
			// Always take the win.
			const win = immediateWin(board, me);
			if (win !== -1) return win;
			// Usually block the opponent's win.
			const block = immediateWin(board, opp);
			if (block !== -1 && rng() < 0.85) return block;
			// Half the time play the strong (minimax) move…
			if (rng() < 0.5) {
				const best = bestMoves(board, me);
				if (best.length > 0) return pick(best, rng);
			}
			// …otherwise a reasonable-but-loose heuristic: center > corner > side.
			if (board[CENTER] === null && rng() < 0.7) return CENTER;
			const freeCorners = CORNERS.filter((c) => board[c] === null);
			if (freeCorners.length > 0 && rng() < 0.6) return pick(freeCorners, rng);
			return pick(legal, rng);
		}

		case 'hard': {
			// Perfect play. Take wins / block losses implicitly via minimax.
			const best = bestMoves(board, me);
			if (best.length > 0) return pick(best, rng);
			return pick(legal, rng); // unreachable for non-full boards
		}
	}
}

/** True when the position is already terminal. */
export function isTerminal(board: Board): boolean {
	return evaluateBoard(board).kind !== 'ongoing' || isBoardFull(board);
}

/** Convenience for tests/demos: play a full random game against the AI. */
export function playRandomGameAgainst(
	ai: Mark,
	difficulty: Difficulty,
	rng: Rng = Math.random,
): { board: Board; winner: Mark | 'draw' | null } {
	const board = emptyBoard();
	let turn: Mark = 'X';
	while (true) {
		const outcome = evaluateBoard(board);
		if (outcome.kind === 'win') return { board, winner: outcome.winner };
		if (outcome.kind === 'draw') return { board, winner: 'draw' };
		const cell =
			turn === ai
				? chooseMove(board, turn, difficulty, rng)
				: pick(legalMoves(board), rng);
		board[cell] = turn;
		turn = otherMark(turn);
	}
}
