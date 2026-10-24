/** Solo (vs computer) match screen — wraps the in-browser engine + GameView. */

import { useState } from 'react';
import { ROOM_DEFAULTS } from '../config';
import { difficultyLabel, SoloOptions, useSoloGame } from '../game/useSoloGame';
import { playSound } from '../lib/sound';
import { ConfirmButton } from './ConfirmButton';
import { GameView } from './GameView';

export function SoloGameView({
	options,
	onExit,
}: {
	options: SoloOptions;
	onExit: () => void;
}) {
	const game = useSoloGame(options);
	const [shakeKey, setShakeKey] = useState(0);

	const onCell = (cell: number) => {
		const ok = game.play(cell);
		if (!ok) {
			playSound('invalid');
			setShakeKey((k) => k + 1);
		}
	};

	const canPlay = game.snapshot.phase === 'playing' && game.snapshot.turn === game.playerMark;

	const banner = game.thinking ? (
		<span className="thinking">
			<span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
			Computer is thinking…
		</span>
	) : undefined;

	return (
		<GameView
			snapshot={game.snapshot}
			you={game.playerMark}
			isSolo
			canPlay={canPlay}
			onCell={onCell}
			onRematch={() => game.playAgain()}
			rematchYou={false}
			onEnd={onExit}
			endLabel="Change setup"
			shakeKey={shakeKey}
			notice={banner}
			sidePanel={
				<div className="side-block">
					<div className="side-title">Solo session</div>
					<dl className="side-list">
						<div>
							<dt>Difficulty</dt>
							<dd>{difficultyLabel(options.difficulty)}</dd>
						</div>
						<div>
							<dt>You play</dt>
							<dd>{game.playerMark}</dd>
						</div>
						<div>
							<dt>Round</dt>
							<dd>{game.snapshot.round}</dd>
						</div>
					</dl>
					<ConfirmButton
						label="Restart match"
						confirmLabel="Reset score too?"
						className="btn btn-ghost btn-sm side-restart"
						onConfirm={() => {
							game.resetSession();
							playSound('click');
						}}
					/>
					<p className="side-note">
						Solo scores live in this tab only and vanish when you leave — room sessions on the server
						expire after {ROOM_DEFAULTS.ttlSeconds / 60} minutes of inactivity.
					</p>
				</div>
			}
		/>
	);
}


