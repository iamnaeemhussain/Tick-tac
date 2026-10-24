/**
 * Heads-up display: player cards (name, mark, score, turn glow, connection
 * status), the session score, round timer, and the turn banner.
 */

import { useEffect, useState } from 'react';
import { Mark as MarkT } from '../../shared/game';
import { RoomSnapshot } from '../../shared/protocol';
import { formatDuration } from '../lib/format';
import { Mark } from './Marks';

export interface HudPlayer {
	name: string;
	mark: MarkT;
	score: number;
	isYou: boolean;
	connected: boolean;
	isTurn: boolean;
}

function RoundTimer({ snapshot }: { snapshot: RoomSnapshot }) {
	const [elapsed, setElapsed] = useState(0);
	const offset = snapshot.serverNow - Date.now();
	const startedAt = snapshot.roundStartedAt + offset;
	const running = snapshot.phase === 'playing';

	useEffect(() => {
		if (!running) {
			setElapsed(Math.max(0, Date.now() - startedAt));
			return;
		}
		const id = setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 1000);
		setElapsed(Math.max(0, Date.now() - startedAt));
		return () => clearInterval(id);
	}, [running, startedAt]);

	return (
		<div className="round-timer" aria-label={`Round time ${formatDuration(elapsed)}`} title="Round time">
			<svg viewBox="0 0 24 24" className="timer-ic" aria-hidden="true">
				<circle cx="12" cy="13" r="8" />
				<polyline points="12 9 12 13 15 15" />
			</svg>
			{formatDuration(elapsed)}
		</div>
	);
}

function PlayerCard({ p, draws, showDraws }: { p: HudPlayer; draws?: number; showDraws?: boolean }) {
	return (
		<div
			className={`player-card pc-${p.mark.toLowerCase()}${p.isTurn ? ' active' : ''}${!p.connected ? ' offline' : ''}`}
			aria-current={p.isTurn ? 'true' : undefined}
		>
			<span className="pc-mark">
				<Mark value={p.mark} />
			</span>
			<span className="pc-info">
				<span className="pc-name" title={p.name}>
					{p.name}
					{p.isYou && <span className="pc-you"> (you)</span>}
				</span>
				<span className="pc-meta">
					<span className="pc-score" aria-label={`${p.name} score`}>
						{p.score}
					</span>
					{showDraws && draws !== undefined && (
						<span className="pc-draws" aria-label="Draws">
							· {draws} draw{draws === 1 ? '' : 's'}
						</span>
					)}
					<span className={`pc-dot${p.connected ? ' on' : ''}`} aria-label={p.connected ? 'online' : 'disconnected'} />
				</span>
			</span>
		</div>
	);
}

export interface HudProps {
	players: [HudPlayer, HudPlayer];
	draws: number;
	snapshot: RoomSnapshot | null;
	/** "Your turn", "Ana's turn", "Thinking…", etc. */
	banner: React.ReactNode;
	bannerTone?: 'you' | 'them' | 'neutral';
}

export function Hud({ players, draws, snapshot, banner, bannerTone = 'neutral' }: HudProps) {
	return (
		<div className="hud">
			<div className="hud-players">
				<PlayerCard p={players[0]} />
				<div className="hud-center">
					<div className="hud-score" aria-label="Session score">
						<strong>{players[0].score}</strong>
						<span className="hud-colon">:</span>
						<strong>{players[1].score}</strong>
					</div>
					<div className="hud-draws">
						{draws} draw{draws === 1 ? '' : 's'}
					</div>
					{snapshot && <RoundTimer snapshot={snapshot} />}
				</div>
				<PlayerCard p={players[1]} draws={draws} showDraws={false} />
			</div>
			<div className={`turn-banner tone-${bannerTone}`} role="status" aria-live="polite">
				{banner}
			</div>
		</div>
	);
}
