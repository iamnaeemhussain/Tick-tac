/** Win / lose / draw overlay with rematch flow. Friendly, never coercive. */

import { Mark } from '../../shared/game';
import { AdSlot } from './AdSlot';
import { Button, Spinner } from './ui';

export type Outcome = 'win' | 'lose' | 'draw';

export interface ResultOverlayProps {
	outcome: Outcome;
	opponentName: string;
	isSolo: boolean;
	/** Multiplayer rematch handshake state. */
	rematchYou: boolean;
	rematchOther: boolean;
	onRematch: () => void;
	onEnd: () => void;
	endLabel: string;
	round: number;
	showAd?: boolean;
}

function headline(outcome: Outcome, opponentName: string, isSolo: boolean): { title: string; emoji: string; sub: string } {
	switch (outcome) {
		case 'win':
			return { title: 'You win!', emoji: '🎉', sub: 'Brilliant. Ready for another round?' };
		case 'lose':
			return isSolo
				? { title: 'Computer wins', emoji: '🤖', sub: 'Tough one — run it back?' }
				: { title: `${opponentName} won`, emoji: '😅', sub: 'Your friend won this round. Rematch?' };
		case 'draw':
			return { title: "It's a draw", emoji: '🤝', sub: 'Perfectly matched — one more?' };
	}
}

export function ResultOverlay({
	outcome,
	opponentName,
	isSolo,
	rematchYou,
	rematchOther,
	onRematch,
	onEnd,
	endLabel,
	round,
	showAd = true,
}: ResultOverlayProps) {
	const h = headline(outcome, opponentName, isSolo);

	let rematchButton: React.ReactNode;
	if (isSolo) {
		rematchButton = (
			<Button size="lg" onClick={onRematch} autoFocus>
				Play again
			</Button>
		);
	} else if (rematchYou && !rematchOther) {
		rematchButton = (
			<Button size="lg" variant="soft" disabled>
				<Spinner className="btn-spinner" /> Waiting for {opponentName}…
			</Button>
		);
	} else if (!rematchYou && rematchOther) {
		rematchButton = (
			<Button size="lg" onClick={onRematch}>
				{opponentName} wants a rematch — accept!
			</Button>
		);
	} else {
		rematchButton = (
			<Button size="lg" onClick={onRematch}>
				Rematch
			</Button>
		);
	}

	return (
		<div className={`result-overlay outcome-${outcome}`} role="dialog" aria-modal="false" aria-label={`Round ${round} result`}>
			<div className="result-card">
				<div className="result-emoji" aria-hidden="true">
					{h.emoji}
				</div>
				<h2 className="result-title">{h.title}</h2>
				<p className="result-sub">{h.sub}</p>
				<div className="result-actions">
					{rematchButton}
					<button type="button" className="btn btn-ghost btn-sm" onClick={onEnd}>
						{endLabel}
					</button>
				</div>
				<p className="result-round">Round {round} · score kept for this session only</p>
				{showAd && <AdSlot placement="result" className="result-ad" />}
			</div>
		</div>
	);
}

export function outcomeFor(snapshotWinner: Mark | 'draw' | null, you: Mark): Outcome | null {
	if (snapshotWinner === null) return null;
	if (snapshotWinner === 'draw') return 'draw';
	return snapshotWinner === you ? 'win' : 'lose';
}
