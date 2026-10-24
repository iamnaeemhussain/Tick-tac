/**
 * WaitingRoom — shown to the creator (and briefly to the joiner) until both
 * players are connected. Includes the share panel, editable names, and a
 * session-end control.
 */

import { useState } from 'react';
import { RoomSnapshot } from '../../shared/protocol';
import { sanitizeName } from '../../shared/protocol';
import { playSound } from '../lib/sound';
import { ConfirmButton } from './ConfirmButton';
import { SharePanel } from './SharePanel';
import { Button, Card, TextField } from './ui';

export interface WaitingRoomProps {
	code: string;
	snapshot: RoomSnapshot | null;
	yourName: string;
	onUpdateNames: (p1: string, p2: string) => void;
	onEnd: () => void;
	ttlMinutes: number;
}

export function WaitingRoom({ code, snapshot, yourName, onUpdateNames, onEnd, ttlMinutes }: WaitingRoomProps) {
	const [editing, setEditing] = useState(false);
	const [p1, setP1] = useState(yourName);
	const [p2, setP2] = useState(snapshot?.p2Suggested ?? '');
	const [err, setErr] = useState<string | null>(null);

	const suggested = snapshot?.p2Suggested ?? null;

	function save() {
		const n1 = sanitizeName(p1);
		const n2 = p2.trim() === '' ? null : sanitizeName(p2);
		if (!n1) {
			setErr('Your name must be 1–20 characters.');
			return;
		}
		if (p2.trim() !== '' && !n2) {
			setErr("Your friend's name must be 1–20 characters.");
			return;
		}
		setErr(null);
		onUpdateNames(n1, n2 ?? '');
		setEditing(false);
		playSound('click');
	}

	return (
		<Card className="waiting-card pop-in">
			<div className="waiting-avatar-row">
				<span className="seat-badge seat-x">X · You ({yourName})</span>
				<span className="waiting-vs">vs</span>
				<span className={`seat-badge seat-o${suggested ? '' : ' seat-tbd'}`}>
					O · {suggested ?? 'Your friend'}
				</span>
			</div>

			<h2 className="waiting-title">
				Waiting for your friend<span className="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
			</h2>
			<p className="waiting-sub">
				Share the link below — the game starts automatically when they join. The suggested name is just a
				label; your friend confirms or changes it when they open the link.
			</p>

			<SharePanel code={code} inviterName={yourName} />

			<div className="waiting-actions">
				{editing ? (
					<div className="waiting-edit pop-in">
						<TextField label="Your name" value={p1} maxLength={20} onChange={(e) => setP1(e.target.value)} />
						<TextField
							label="Friend's name (optional)"
							value={p2}
							maxLength={20}
							hint="Used as their suggested name — they can change it before joining."
							onChange={(e) => setP2(e.target.value)}
						/>
						{err && <div className="field-error" role="alert">{err}</div>}
						<div className="waiting-edit-actions">
							<Button onClick={save}>Save names</Button>
							<Button variant="ghost" onClick={() => { setEditing(false); setErr(null); }}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<>
						<Button variant="soft" onClick={() => setEditing(true)}>
							Edit names
						</Button>
						<ConfirmButton label="End session" confirmLabel="End for everyone?" onConfirm={onEnd} />
					</>
				)}
			</div>

			<p className="waiting-note">
				🔒 Private room · expires after {ttlMinutes} min of inactivity · nothing is stored
			</p>
		</Card>
	);
}
