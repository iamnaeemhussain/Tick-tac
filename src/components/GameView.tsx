/**
 * GameView — the match screen shared by solo and multiplayer:
 * HUD (players, score, timer, turn banner), the board, result overlay,
 * ad placements that never touch the controls, and sound/confetti feedback
 * driven by authoritative snapshot transitions.
 */

import { useEffect, useRef, useState } from 'react';
import { Mark as MarkT } from '../../shared/game';
import { RoomSnapshot } from '../../shared/protocol';
import { playSound } from '../lib/sound';
import { AdSlot } from './AdSlot';
import { Board } from './Board';
import { Confetti, ConfettiHandle } from './Confetti';
import { Hud, HudPlayer } from './Hud';
import { outcomeFor, ResultOverlay } from './ResultOverlay';

export interface GameViewProps {
	snapshot: RoomSnapshot;
	you: MarkT;
	isSolo: boolean;
	/** True when a human move would currently be accepted. */
	canPlay: boolean;
	onCell: (cell: number) => void;
	onRematch: () => void;
	rematchYou: boolean;
	onEnd: () => void;
	endLabel: string;
	/** Extra notice above the board (reconnecting / opponent disconnected). */
	notice?: React.ReactNode;
	/** Increment to shake the board (rejected move feedback). */
	shakeKey?: number;

	/** Side panel extras (room code, restart button, etc.). */
	sidePanel?: React.ReactNode;
}

export function GameView({
	snapshot,
	you,
	isSolo,
	canPlay,
	onCell,
	onRematch,
	rematchYou,
	onEnd,
	endLabel,
	notice,
	shakeKey = 0,
	sidePanel,
}: GameViewProps) {
	const opp: MarkT = you === 'X' ? 'O' : 'X';
	const confettiRef = useRef<ConfettiHandle | null>(null);
	const [shaking, setShaking] = useState(false);

	// Restart the shake animation on every rejection bump.
	useEffect(() => {
		if (!shakeKey) return;
		setShaking(true);
		const t = setTimeout(() => setShaking(false), 380);
		return () => clearTimeout(t);
	}, [shakeKey]);

	const oppName = snapshot.names[opp] ?? 'Opponent';

	// ── feedback on authoritative transitions ─────────────────────────────
	const prev = useRef<{ cells: number; round: number; winner: RoomSnapshot['winner'] }>({
		cells: snapshot.board.filter(Boolean).length,
		round: snapshot.round,
		winner: snapshot.winner,
	});
	useEffect(() => {
		const cells = snapshot.board.filter(Boolean).length;
		const p = prev.current;
		if (snapshot.round !== p.round) {
			// New round started (rematch accepted).
			playSound('rematch');
		} else if (snapshot.winner && snapshot.winner !== p.winner) {
			const outcome = outcomeFor(snapshot.winner, you);
			if (outcome === 'win') {
				playSound('win');
				confettiRef.current?.fire();
			} else if (outcome === 'lose') playSound('lose');
			else playSound('draw');
		} else if (cells > p.cells) {
			playSound('place');
		}
		prev.current = { cells, round: snapshot.round, winner: snapshot.winner };
	}, [snapshot, you]);

	const players: [HudPlayer, HudPlayer] = [
		{
			name: snapshot.names.X ?? 'X',
			mark: 'X',
			score: snapshot.score.X,
			isYou: you === 'X',
			connected: snapshot.connected.X,
			isTurn: snapshot.turn === 'X',
		},
		{
			name: snapshot.names.O ?? 'O',
			mark: 'O',
			score: snapshot.score.O,
			isYou: you === 'O',
			connected: snapshot.connected.O,
			isTurn: snapshot.turn === 'O',
		},
	];

	const outcome = outcomeFor(snapshot.winner, you);
	const banner =
		snapshot.phase === 'playing'
			? snapshot.turn === you
				? 'Your turn — place your mark!'
				: `${oppName}'s turn…`
			: 'Round over';

	return (
		<div className="game-layout">
			<div className="game-main">
				<Hud
					players={players}
					draws={snapshot.score.draws}
					snapshot={snapshot}
					banner={banner}
					bannerTone={snapshot.turn === you ? 'you' : 'them'}
				/>
				{notice}
				<div className="board-area">
					<Board
						board={snapshot.board}
						ghostMark={canPlay ? you : null}
						winLine={snapshot.winLine}
						lastMove={snapshot.lastMove}
						onCell={canPlay ? onCell : null}
						shake={shaking}
					/>
					{snapshot.phase === 'roundOver' && outcome && (
						<ResultOverlay
							outcome={outcome}
							opponentName={oppName}
							isSolo={isSolo}
							rematchYou={rematchYou || (snapshot.rematch[you] ?? false)}
							rematchOther={snapshot.rematch[opp] ?? false}
							onRematch={onRematch}
							onEnd={onEnd}
							endLabel={endLabel}
							round={snapshot.round}
						/>
					)}
				</div>
				<div className="game-mobile-controls">{sidePanel}</div>
				{/* Mobile ad placement — below all controls, never overlapping. */}
				<AdSlot placement="game-mobile" className="only-mobile" />
			</div>
			<aside className="game-side">
				{sidePanel}
				{/* Desktop ad placement — side rail, away from the board. */}
				<AdSlot placement="game-desktop" className="only-desktop" />
			</aside>
			<Confetti handleRef={confettiRef} />
			<span className="sr-only" role="status" aria-live="polite">
				{snapshot.phase === 'playing'
					? snapshot.turn === you
						? 'Your turn.'
						: `${oppName} is playing.`
					: outcome === 'win'
						? 'You won the round.'
						: outcome === 'lose'
							? `${oppName} won the round.`
							: outcome === 'draw'
								? 'The round is a draw.'
								: ''}
			</span>
		</div>
	);
}
