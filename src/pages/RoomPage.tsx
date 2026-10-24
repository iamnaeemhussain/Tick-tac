/**
 * RoomPage — /room/:code
 *
 * Handles every entry path:
 *  • invited friend: public info → confirm/edit name → join → live game
 *  • returning creator/player (same tab, refreshed): re-auth from tab-session
 *    credentials and resume the live board from server state
 *  • late/extra visitor: friendly "room full" or "room expired" screens
 *
 * All gameplay is server-authoritative — this page never mutates the board
 * locally; it renders snapshots and sends intents.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mark } from '../../shared/game';
import {
	CloseReason,
	ErrorCode,
	PublicRoomInfo,
	RoomSnapshot,
} from '../../shared/protocol';
import { ConfirmButton } from '../components/ConfirmButton';
import { GameView } from '../components/GameView';
import { ConnectionNotice, OpponentDownBanner } from '../components/Notices';
import { WaitingRoom } from '../components/WaitingRoom';
import { Button, Card, Spinner, TextField } from '../components/ui';
import { APP_NAME, ROOM_DEFAULTS } from '../config';
import { endRoom, getRoomInfo, joinRoom } from '../lib/api';
import { useMeta } from '../lib/meta';
import { navigate } from '../lib/router';
import { ConnState, RoomClient } from '../lib/roomClient';
import { clearRoomCredentials, loadRoomCredentials, saveRoomCredentials } from '../lib/session';
import { playSound, primeAudio } from '../lib/sound';

type Stage =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'join'; info: PublicRoomInfo }
	| { kind: 'full' }
	| { kind: 'gone' }
	| { kind: 'connecting' }
	| { kind: 'live' }
	| { kind: 'closed'; reason: CloseReason | 'connection_lost' };

const ERROR_COPY: Partial<Record<ErrorCode, string>> = {
	not_your_turn: "Hold on — it's not your turn.",
	occupied: 'That cell is already taken.',
	stale_round: 'Too late — the round has moved on.',
	bad_cell: 'Invalid cell.',
	rate_limited: 'A little slower, please.',
	not_started: 'The match has not started yet.',
	round_active: 'A round is already in progress.',
};

export function RoomPage({ code }: { code: string }) {
	useMeta({ title: `Room ${code} — ${APP_NAME}`, robots: 'noindex, nofollow, noarchive' });

	const [stage, setStage] = useState<Stage>({ kind: 'loading' });
	const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
	const [you, setYou] = useState<Mark | null>(null);
	const [connState, setConnState] = useState<ConnState>('idle');
	const [toast, setToast] = useState<string | null>(null);
	const [shakeKey, setShakeKey] = useState(0);

	const clientRef = useRef<RoomClient | null>(null);
	const credsRef = useRef(loadRoomCredentials(code));
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), 2600);
	}, []);

	// ── lifecycle: connect or fetch public info ─────────────────────────────
	const startClient = useCallback(
		(token: string, seat: Mark) => {
			clientRef.current?.destroy();
			const client = new RoomClient(code, token, {
				onReady: (y, state) => {
					setYou(y);
					setSnapshot(state);
					setStage({ kind: 'live' });
					playSound('join');
				},
				onState: (state) => setSnapshot(state),
				onClosed: (reason) => {
					setStage({ kind: 'closed', reason });
					clearRoomCredentials(code);
				},
				onError: (ec) => {
					showToast(ERROR_COPY[ec as ErrorCode] ?? 'That action was rejected.');
					setShakeKey((k) => k + 1);
					playSound('invalid');
				},
				onConnState: (s) => setConnState(s),
			});
			clientRef.current = client;
			setYou(seat);
			setStage({ kind: 'connecting' });
			client.connect();
		},
		[code, showToast],
	);

	useEffect(() => {
		let cancelled = false;
		const creds = credsRef.current;
		if (creds) {
			startClient(creds.token, creds.seat);
			return () => {
				cancelled = true;
				clientRef.current?.destroy();
			};
		}
		getRoomInfo(code)
			.then((info) => {
				if (cancelled) return;
				if (info.status === 'waiting') setStage({ kind: 'join', info });
				else if (info.status === 'active') setStage({ kind: 'full' });
				else setStage({ kind: 'gone' });
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setStage({
					kind: 'error',
					message: err instanceof Error ? err.message : 'Could not load this room.',
				});
			});
		return () => {
			cancelled = true;
			clientRef.current?.destroy();
		};
	}, [code, startClient]);

	// ── actions ─────────────────────────────────────────────────────────────
	const sendMove = useCallback(
		(cell: number) => {
			if (!snapshot || !clientRef.current) return;
			const ok = clientRef.current.send({ type: 'move', cell, round: snapshot.round });
			if (!ok) showToast('Connection is not ready — one moment…');
		},
		[snapshot, showToast],
	);

	const sendRematch = useCallback(() => {
		if (!snapshot || !clientRef.current) return;
		clientRef.current.send({ type: 'rematch', round: snapshot.round });
		playSound('click');
	}, [snapshot]);

	const updateNames = useCallback(
		(p1: string, p2: string) => {
			if (!clientRef.current) return;
			clientRef.current.send({ type: 'updateNames', p1, ...(p2 ? { p2 } : {}) });
		},
		[],
	);

	const doEnd = useCallback(() => {
		const creds = credsRef.current;
		if (clientRef.current?.state === 'open') {
			clientRef.current.send({ type: 'leave' });
		}
		if (creds) void endRoom(code, creds.token).catch(() => undefined);
		clearRoomCredentials(code);
		setStage({ kind: 'closed', reason: 'ended' });
		playSound('click');
	}, [code]);

	// ── derived ─────────────────────────────────────────────────────────────
	const opp: Mark | null = you ? (you === 'X' ? 'O' : 'X') : null;
	const oppName = useMemo(() => {
		if (!snapshot || !opp) return 'Your friend';
		return snapshot.names[opp] ?? snapshot.p2Suggested ?? 'Your friend';
	}, [snapshot, opp]);

	// ── render ─────────────────────────────────────────────────────────────
	if (stage.kind === 'loading' || stage.kind === 'connecting') {
		return (
			<main className="page-center">
				<Card className="status-card pop-in">
					<Spinner className="big-spinner" />
					<h2>{stage.kind === 'connecting' ? 'Joining the room…' : 'Loading room…'}</h2>
					<p className="muted">Room {code}</p>
				</Card>
			</main>
		);
	}

	if (stage.kind === 'error') {
		return (
			<main className="page-center">
				<Card className="status-card pop-in">
					<h2>Couldn't reach the room</h2>
					<p className="muted">{stage.message}</p>
					<Button onClick={() => window.location.reload()}>Try again</Button>
				</Card>
			</main>
		);
	}

	if (stage.kind === 'join') {
		return (
			<JoinScreen
				code={code}
				info={stage.info}
				onJoined={(token, name) => {
					credsRef.current = { code, seat: 'O', token, name };
					saveRoomCredentials(credsRef.current);
					startClient(token, 'O');
				}}
			/>
		);
	}

	if (stage.kind === 'full') {
		return (
			<main className="page-center">
				<Card className="status-card pop-in">
					<span className="status-emoji" aria-hidden="true">🔒</span>
					<h2>This room is full</h2>
					<p className="muted">
						Two players are already in a match here. Rooms are private — only the invited player can
						join.
					</p>
					<div className="status-actions">
						<Button onClick={() => navigate('/')}>Create your own room</Button>
					</div>
				</Card>
			</main>
		);
	}

	if (stage.kind === 'gone') {
		return (
			<main className="page-center">
				<Card className="status-card pop-in">
					<span className="status-emoji" aria-hidden="true">⌛</span>
					<h2>This room has expired</h2>
					<p className="muted">
						Rooms disappear automatically after {ROOM_DEFAULTS.ttlSeconds / 60} minutes of inactivity —
						and nothing was stored. Start a fresh one; it takes seconds.
					</p>
					<div className="status-actions">
						<Button onClick={() => navigate('/')}>Create a new room</Button>
					</div>
				</Card>
			</main>
		);
	}

	if (stage.kind === 'closed') {
		const copy = closedCopy(stage.reason, oppName);
		return (
			<main className="page-center">
				<Card className="status-card pop-in">
					<span className="status-emoji" aria-hidden="true">{copy.emoji}</span>
					<h2>{copy.title}</h2>
					<p className="muted">{copy.body}</p>
					<div className="status-actions">
						<Button onClick={() => navigate('/')}>Back to home</Button>
						<Button variant="soft" onClick={() => navigate('/', { replace: true })}>
							New room
						</Button>
					</div>
				</Card>
			</main>
		);
	}

	// ── live ─────────────────────────────────────────────────────────────
	if (!snapshot || !you) {
		return (
			<main className="page-center">
				<Card className="status-card">
					<Spinner className="big-spinner" />
					<h2>Syncing with the room…</h2>
				</Card>
			</main>
		);
	}

	if (snapshot.phase === 'waiting') {
		return (
			<main className="page-center">
				<ConnectionNotice state={connState} />
				<WaitingRoom
					code={code}
					snapshot={snapshot}
					yourName={snapshot.names[you] ?? 'You'}
					onUpdateNames={updateNames}
					onEnd={doEnd}
					ttlMinutes={ROOM_DEFAULTS.ttlSeconds / 60}
				/>
			</main>
		);
	}

	const canPlay = connState === 'open' && snapshot.phase === 'playing' && snapshot.turn === you;

	return (
		<main className="game-page">
			{toast && (
				<div className="toast" role="alert">
					{toast}
				</div>
			)}
			<GameView
				snapshot={snapshot}
				you={you}
				isSolo={false}
				canPlay={canPlay}
				onCell={sendMove}
				onRematch={sendRematch}
				rematchYou={snapshot.rematch[you] ?? false}
				onEnd={doEnd}
				endLabel="End session"
				shakeKey={shakeKey}
				notice={
					<>
						<ConnectionNotice state={connState} />
						{opp && !snapshot.connected[opp] && snapshot.phase === 'playing' && (
							<OpponentDownBanner
								snapshot={snapshot}
								you={you}
								oppName={oppName}
								graceSeconds={ROOM_DEFAULTS.graceSeconds}
							/>
						)}
						{opp && snapshot.rematch[opp] && !snapshot.rematch[you] && (
							<div className="notice notice-good" role="status">
								🎮 {oppName} wants a rematch!
							</div>
						)}
					</>
				}
				sidePanel={
					<div className="side-block">
						<div className="side-title">Private room</div>
						<dl className="side-list">
							<div>
								<dt>Room</dt>
								<dd className="mono">{code}</dd>
							</div>
							<div>
								<dt>Round</dt>
								<dd>{snapshot.round}</dd>
							</div>
							<div>
								<dt>You play</dt>
								<dd>{you}</dd>
							</div>
						</dl>
						<ConfirmButton
							label="End session"
							confirmLabel="End for both players?"
							className="btn btn-ghost btn-sm side-restart"
							onConfirm={doEnd}
						/>
						<p className="side-note">
							Score &amp; board exist only while this room is alive (max {ROOM_DEFAULTS.ttlSeconds / 60}{' '}
							min idle). Nothing is stored after it closes.
						</p>
					</div>
				}
			/>
		</main>
	);
}

// ── Join screen (invited friend) ─────────────────────────────────────────────

function JoinScreen({
	code,
	info,
	onJoined,
}: {
	code: string;
	info: PublicRoomInfo;
	onJoined: (token: string, name: string) => void;
}) {
	const suggested = info.p2IsSuggestion ? info.p2Name ?? '' : '';
	const [name, setName] = useState(suggested);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		primeAudio();
	}, []);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (busy) return;
		if (name.trim().length === 0) {
			setError('Please enter your name so your friend knows it’s you.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const res = await joinRoom(code, name);
			playSound('join');
			onJoined(res.token, name.trim());
		} catch (err) {
			setBusy(false);
			setError(err instanceof Error ? err.message : 'Could not join this room.');
		}
	}

	return (
		<main className="page-center">
			<Card className="setup-card join-card pop-in">
				<span className="invite-badge">🎮 You've been invited!</span>
				<h2 className="setup-title">
					<strong>{info.p1Name ?? 'A friend'}</strong> wants to play Tic-Tac-Toe
				</h2>
				<p className="setup-sub">
					Room <span className="mono">{code}</span> · you'll play as <strong>O</strong> · the match starts
					as soon as you join.
				</p>
				<form onSubmit={(e) => void submit(e)} noValidate>
					<TextField
						label="Your display name"
						placeholder={suggested || 'e.g. Sam'}
						value={name}
						maxLength={20}
						autoFocus
						hint={
							suggested
								? `${info.p1Name ?? 'Your friend'} suggested this name — change it if you like.`
								: 'A temporary label for this match only.'
						}
						error={error}
						onChange={(e) => setName(e.target.value)}
					/>
					<Button type="submit" size="lg" className="setup-cta" loading={busy}>
						{busy ? 'Joining…' : 'Join the game'}
					</Button>
				</form>
				<p className="setup-note">No account, no email — names vanish with the room.</p>
			</Card>
		</main>
	);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function closedCopy(reason: CloseReason | 'connection_lost', oppName: string) {
	switch (reason) {
		case 'ended':
			return {
				emoji: '👋',
				title: 'Session ended',
				body: 'The room and its score were discarded. Nothing was stored — see you next round!',
			};
		case 'abandoned':
			return {
				emoji: '🚪',
				title: `${oppName} left the session`,
				body: 'They didn’t return within the reconnection window, so the room was closed and discarded.',
			};
		case 'expired':
			return {
				emoji: '⌛',
				title: 'Room expired',
				body: `Rooms vanish after ${ROOM_DEFAULTS.ttlSeconds / 60} minutes of inactivity. Create a new one to keep playing.`,
			};
		case 'replaced':
			return {
				emoji: '🔁',
				title: 'Opened elsewhere',
				body: 'This room is now active in another tab or device session.',
			};
		case 'connection_lost':
		default:
			return {
				emoji: '📡',
				title: 'Connection lost',
				body: 'We couldn’t reach the room in time. If your friend is still there, ask them to share the link again.',
			};
	}
}
