/**
 * Solo game engine hook — runs entirely in the browser against the shared AI
 * (no backend involved). Produces a RoomSnapshot-shaped state so the exact
 * same Board/HUD/Result UI is reused for solo and multiplayer.
 *
 * Nothing is persisted: scores live in React state and vanish on navigation
 * or refresh, by design.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Difficulty, chooseMove } from '../../shared/ai';
import { Board, Mark, emptyBoard, evaluateBoard, otherMark } from '../../shared/game';
import { RoomSnapshot } from '../../shared/protocol';

export interface SoloOptions {
	playerName: string;
	difficulty: Difficulty;
	playerMark: Mark;
	computerName?: string;
}

interface SoloState {
	board: Board;
	turn: Mark;
	lastMove: number | null;
	phase: 'playing' | 'roundOver';
	winner: Mark | 'draw' | null;
	winLine: [number, number, number] | null;
	score: { X: number; O: number; draws: number };
	round: number;
	roundStartedAt: number;
}

function initialState(): SoloState {
	return {
		board: emptyBoard(),
		turn: 'X', // X always opens
		lastMove: null,
		phase: 'playing',
		winner: null,
		winLine: null,
		score: { X: 0, O: 0, draws: 0 },
		round: 1,
		roundStartedAt: Date.now(),
	};
}

function applyMove(s: SoloState, mark: Mark, cell: number): SoloState {
	const board = s.board.slice();
	board[cell] = mark;
	const outcome = evaluateBoard(board);
	if (outcome.kind === 'win') {
		return {
			...s,
			board,
			lastMove: cell,
			phase: 'roundOver',
			winner: outcome.winner,
			winLine: [outcome.line[0], outcome.line[1], outcome.line[2]],
			turn: mark,
			score: { ...s.score, [outcome.winner]: s.score[outcome.winner] + 1 },
		};
	}
	if (outcome.kind === 'draw') {
		return {
			...s,
			board,
			lastMove: cell,
			phase: 'roundOver',
			winner: 'draw',
			winLine: null,
			turn: mark,
			score: { ...s.score, draws: s.score.draws + 1 },
		};
	}
	return { ...s, board, lastMove: cell, turn: otherMark(mark) };
}

export interface SoloGame {
	snapshot: RoomSnapshot;
	state: SoloState;
	thinking: boolean;
	playerMark: Mark;
	aiMark: Mark;
	/** Human move; returns false if illegal (cell taken / not your turn). */
	play: (cell: number) => boolean;
	/** Next round — same session, score kept. */
	playAgain: () => void;
	/** Fresh session — score reset. */
	resetSession: () => void;
}

export function useSoloGame(opts: SoloOptions): SoloGame {
	const { playerName, difficulty, playerMark } = opts;
	const aiMark = otherMark(playerMark);
	const computerName = opts.computerName ?? `Computer · ${difficultyLabel(difficulty)}`;

	const [s, setS] = useState<SoloState>(() => initialState());
	const [thinking, setThinking] = useState(false);
	const sRef = useRef(s);
	sRef.current = s;

	// Computer's move: short human-like delay, then a guaranteed-legal choice.
	useEffect(() => {
		if (s.phase !== 'playing' || s.turn !== aiMark) {
			setThinking(false);
			return;
		}
		setThinking(true);
		const delay = 350 + Math.random() * 450;
		const id = setTimeout(() => {
			setS((cur) => {
				if (cur.phase !== 'playing' || cur.turn !== aiMark) return cur;
				const cell = chooseMove(cur.board, aiMark, difficulty);
				if (cell < 0) return cur; // board full — cannot happen while phase==='playing'
				return applyMove(cur, aiMark, cell);
			});
			setThinking(false);
		}, delay);
		return () => clearTimeout(id);
	}, [s.phase, s.turn, s.round, aiMark, difficulty]);

	const play = useCallback(
		(cell: number): boolean => {
			const cur = sRef.current;
			if (cur.phase !== 'playing' || cur.turn !== playerMark) return false;
			if (!Number.isInteger(cell) || cell < 0 || cell > 8 || cur.board[cell] !== null) return false;
			setS((prev) => applyMove(prev, playerMark, cell));
			return true;
		},
		[playerMark],
	);

	const playAgain = useCallback(() => {
		setS((prev) => ({
			...initialState(),
			score: prev.score,
			round: prev.round + 1,
		}));
	}, []);

	const resetSession = useCallback(() => {
		setS(initialState());
	}, []);

	const snapshot: RoomSnapshot = useMemo(
		() => ({
			phase: s.phase === 'playing' ? 'playing' : 'roundOver',
			round: s.round,
			board: s.board,
			turn: s.phase === 'playing' ? s.turn : null,
			winner: s.winner,
			winLine: s.winLine,
			lastMove: s.lastMove,
			names: {
				X: playerMark === 'X' ? playerName : computerName,
				O: playerMark === 'O' ? playerName : computerName,
			},
			p2Suggested: null,
			score: s.score,
			rematch: { X: false, O: false },
			connected: { X: true, O: true },
			disconnectedAt: { X: null, O: null },
			roundStartedAt: s.roundStartedAt,
			serverNow: Date.now(),
		}),
		[s, playerName, computerName, playerMark],
	);

	return { snapshot, state: s, thinking, playerMark, aiMark, play, playAgain, resetSession };
}

export function difficultyLabel(d: Difficulty): string {
	return d === 'easy' ? 'Easy' : d === 'medium' ? 'Medium' : 'Hard';
}
