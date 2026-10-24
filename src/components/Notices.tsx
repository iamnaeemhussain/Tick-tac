/** Status notices: opponent-disconnected countdown + connection progress. */

import { useEffect, useState } from 'react';
import { RoomSnapshot } from '../../shared/protocol';
import { ConnState } from '../lib/roomClient';

/** Countdown banner while an opponent is within their reconnection grace. */
export function OpponentDownBanner({
	snapshot,
	you,
	oppName,
	graceSeconds,
}: {
	snapshot: RoomSnapshot;
	you: 'X' | 'O';
	oppName: string;
	graceSeconds: number;
}) {
	const opp: 'X' | 'O' = you === 'X' ? 'O' : 'X';
	const since = snapshot.disconnectedAt[opp];
	// Server clock offset so the countdown matches the server's grace window.
	const offset = snapshot.serverNow - Date.now();
	const deadline = since !== null ? since + offset + graceSeconds * 1000 : null;
	const [left, setLeft] = useState<number | null>(null);

	useEffect(() => {
		if (deadline === null) {
			setLeft(null);
			return;
		}
		const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [deadline]);

	if (snapshot.connected[opp] || left === null) return null;
	return (
		<div className="notice notice-warn" role="status">
			<span className="notice-pulse" aria-hidden="true" />
			{oppName} disconnected — waiting {left}s for them to return…
		</div>
	);
}

/** Thin animated progress bar while (re)connecting. */
export function ConnectionNotice({ state, label }: { state: ConnState; label?: string }) {
	if (state === 'open' || state === 'idle' || state === 'gone') return null;
	return (
		<div className="conn-notice" role="status" aria-live="polite">
			<div className="conn-bar" aria-hidden="true" />
			<span>{label ?? (state === 'reconnecting' ? 'Connection lost — reconnecting…' : 'Connecting…')}</span>
		</div>
	);
}
