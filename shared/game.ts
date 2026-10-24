/**
 * Core Tic-Tac-Toe rules — shared between the browser (solo mode, UI) and the
 * Cloudflare Worker / Durable Object (server-authoritative multiplayer).
 *
 * Keeping this logic in one place guarantees both sides agree on wins, draws
 * and legality. It is pure: no I/O, no globals, trivially testable.
 */

export type Mark = 'X' | 'O';
export type Cell = Mark | null;
/** Nine cells, index 0 = top-left … 8 = bottom-right. */
export type Board = Cell[];

export const BOARD_SIZE = 9;

/** All eight winning lines. */
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
	[0, 1, 2],
	[3, 4, 5],
	[6, 7, 8],
	[0, 3, 6],
	[1, 4, 7],
	[2, 5, 8],
	[0, 4, 8],
	[2, 4, 6],
];

export function emptyBoard(): Board {
	return new Array<Cell>(BOARD_SIZE).fill(null);
}

export function otherMark(mark: Mark): Mark {
	return mark === 'X' ? 'O' : 'X';
}

export interface WinInfo {
	winner: Mark;
	line: readonly [number, number, number];
}

/** Returns the winner + winning line, or null if nobody has won (yet). */
export function findWin(board: Board): WinInfo | null {
	for (const line of LINES) {
		const [a, b, c] = line;
		const v = board[a];
		if (v !== null && v === board[b] && v === board[c]) {
			return { winner: v, line };
		}
	}
	return null;
}

export function isBoardFull(board: Board): boolean {
	for (let i = 0; i < BOARD_SIZE; i++) {
		if (board[i] === null) return false;
	}
	return true;
}

export type RoundOutcome =
	| { kind: 'win'; winner: Mark; line: readonly [number, number, number] }
	| { kind: 'draw' }
	| { kind: 'ongoing' };

/** Full evaluation of a board position. */
export function evaluateBoard(board: Board): RoundOutcome {
	const win = findWin(board);
	if (win) return { kind: 'win', winner: win.winner, line: win.line };
	if (isBoardFull(board)) return { kind: 'draw' };
	return { kind: 'ongoing' };
}

/** Is placing `mark` at `cell` legal on `board` (ignoring whose turn it is)? */
export function isLegalCell(board: Board, cell: unknown): cell is number {
	return (
		typeof cell === 'number' &&
		Number.isInteger(cell) &&
		cell >= 0 &&
		cell < BOARD_SIZE &&
		board[cell] === null
	);
}
