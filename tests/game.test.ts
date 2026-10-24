import { describe, expect, it } from 'vitest';
import {
	LINES,
	emptyBoard,
	evaluateBoard,
	findWin,
	isBoardFull,
	isLegalCell,
	otherMark,
} from '../shared/game';

describe('game rules', () => {
	it('detects every winning line for X and O', () => {
		for (const line of LINES) {
			for (const mark of ['X', 'O'] as const) {
				const board = emptyBoard();
				for (const cell of line) board[cell] = mark;
				const win = findWin(board);
				expect(win, `line ${line.join('')} for ${mark}`).not.toBeNull();
				expect(win!.winner).toBe(mark);
				expect([...win!.line].sort()).toEqual([...line].sort());
				const outcome = evaluateBoard(board);
				expect(outcome.kind).toBe('win');
			}
		}
	});

	it('reports ongoing for an empty and partial board', () => {
		expect(evaluateBoard(emptyBoard()).kind).toBe('ongoing');
		const b = emptyBoard();
		b[0] = 'X';
		b[4] = 'O';
		expect(evaluateBoard(b).kind).toBe('ongoing');
	});

	it('detects draws only when the board is full with no winner', () => {
		// Classic draw:
		// X O X
		// X X O
		// O X O
		const board = ['X', 'O', 'X', 'X', 'X', 'O', 'O', 'X', 'O'];
		expect(isBoardFull(board)).toBe(true);
		expect(findWin(board)).toBeNull();
		expect(evaluateBoard(board)).toEqual({ kind: 'draw' });
	});

	it('does not report a draw on a full board that has a winner', () => {
		const board = ['X', 'X', 'X', 'O', 'O', 'X', 'O', 'X', 'O'];
		expect(isBoardFull(board)).toBe(true);
		const outcome = evaluateBoard(board);
		expect(outcome.kind).toBe('win');
		if (outcome.kind === 'win') expect(outcome.winner).toBe('X');
	});

	it('isLegalCell rejects occupied, out-of-range and non-integer cells', () => {
		const b = emptyBoard();
		b[3] = 'O';
		expect(isLegalCell(b, 0)).toBe(true);
		expect(isLegalCell(b, 3)).toBe(false);
		expect(isLegalCell(b, -1)).toBe(false);
		expect(isLegalCell(b, 9)).toBe(false);
		expect(isLegalCell(b, 4.5)).toBe(false);
		expect(isLegalCell(b, '4')).toBe(false);
		expect(isLegalCell(b, null)).toBe(false);
	});

	it('otherMark flips X/O', () => {
		expect(otherMark('X')).toBe('O');
		expect(otherMark('O')).toBe('X');
	});
});
