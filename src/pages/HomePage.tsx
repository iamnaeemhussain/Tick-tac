/**
 * HomePage — landing, mode selection, name entry, and the solo match.
 *
 * Also the SEO surface: semantic headings, crawlable copy explaining the
 * game, and clear calls to action. No fake stats, no dark patterns.
 */

import { FormEvent, useState } from 'react';
import { Difficulty } from '../../shared/ai';
import { Mark, otherMark } from '../../shared/game';
import { sanitizeName } from '../../shared/protocol';
import { AdSlot } from '../components/AdSlot';
import { SoloGameView } from '../components/SoloGameView';
import { Button, Card, Segmented, TextField } from '../components/ui';
import { createRoom as apiCreate } from '../lib/api';
import { HOME_TITLE, useMeta } from '../lib/meta';
import { navigate } from '../lib/router';
import { saveRoomCredentials } from '../lib/session';
import { playSound, primeAudio } from '../lib/sound';

type View = 'home' | 'friend-setup' | 'solo-setup' | 'solo';

export function HomePage() {
	useMeta({ title: HOME_TITLE });
	const [view, setView] = useState<View>('home');
	const [soloOptions, setSoloOptions] = useState<{ playerName: string; difficulty: Difficulty; playerMark: Mark } | null>(null);

	if (view === 'solo' && soloOptions) {
		return <SoloGameView options={soloOptions} onExit={() => setView('solo-setup')} />;
	}

	return (
		<main className="home">
			{view === 'home' && (
				<Landing
					onFriend={() => {
						primeAudio();
						playSound('click');
						setView('friend-setup');
					}}
					onSolo={() => {
						primeAudio();
						playSound('click');
						setView('solo-setup');
					}}
				/>
			)}
			{view === 'friend-setup' && <FriendSetup onBack={() => setView('home')} />}
			{view === 'solo-setup' && (
				<SoloSetup
					initial={soloOptions}
					onBack={() => setView('home')}
					onStart={(opts) => {
						setSoloOptions(opts);
						setView('solo');
						playSound('join');
					}}
				/>
			)}
		</main>
	);
}

// ── Landing ──────────────────────────────────────────────────────────────────

function Landing({ onFriend, onSolo }: { onFriend: () => void; onSolo: () => void }) {
	return (
		<>
			<section className="hero">
				<div className="hero-badges">
					<span className="pill">No sign-up</span>
					<span className="pill">No downloads</span>
					<span className="pill">Unlimited rematches</span>
				</div>
				<h1 className="hero-title">
					Tic-Tac-Toe, <span className="grad-text">instantly</span>.
				</h1>
				<p className="hero-sub">
					Challenge a friend with a single link, or battle the computer at three difficulty levels.
					Games start in seconds and vanish when you're done — nothing is stored, ever.
				</p>
				<div className="mode-cards">
					<button type="button" className="mode-card mode-friend" onClick={onFriend}>
						<span className="mode-ic" aria-hidden="true">
							<svg viewBox="0 0 24 24">
								<path d="M8.5 13.5a3.5 3.5 0 1 0-3.4-4.4A3 3 0 0 0 2 12a3 3 0 0 0 1.6 2.6A4.5 4.5 0 0 0 1 19h7.7a4.4 4.4 0 0 1-.2-5.5z" />
								<path d="M16 4a3.4 3.4 0 0 1 3.4 3.4A3.4 3.4 0 0 1 16 10.8a4.3 4.3 0 0 1 3.3 1.6 4.4 4.4 0 0 0-2.4-1A4.6 4.6 0 0 0 13 16a4.5 4.5 0 0 0 .6 2.3A4.7 4.7 0 0 0 15 19h8a4.5 4.5 0 0 0-3.5-4.4A3 3 0 0 0 21 12a3 3 0 0 0-3-3 3.4 3.4 0 0 0-2-.6z" />
							</svg>
						</span>
						<span className="mode-title">Play with a Friend</span>
						<span className="mode-sub">Create a private room and share the link — they join in one tap.</span>
						<span className="mode-cta">Create room →</span>
					</button>
					<button type="button" className="mode-card mode-solo" onClick={onSolo}>
						<span className="mode-ic" aria-hidden="true">
							<svg viewBox="0 0 24 24">
								<rect x="4" y="7" width="16" height="12" rx="3" />
								<circle cx="9" cy="13" r="1.4" />
								<circle cx="15" cy="13" r="1.4" />
								<path d="M12 3v4M8 4.5 9.5 7M16 4.5 14.5 7" />
							</svg>
						</span>
						<span className="mode-title">Play vs Computer</span>
						<span className="mode-sub">Easy, Medium, or an unbeatable Hard AI. Pick your side: X or O.</span>
						<span className="mode-cta">Start game →</span>
					</button>
				</div>
			</section>

			<AdSlot placement="home-banner" />

			<section className="section how">
				<h2>How to play with a friend</h2>
				<ol className="steps">
					<li>
						<span className="step-n" aria-hidden="true">1</span>
						<div>
							<h3>Enter names</h3>
							<p>Type your name — and optionally your friend's. No email, no account, nothing to install.</p>
						</div>
					</li>
					<li>
						<span className="step-n" aria-hidden="true">2</span>
						<div>
							<h3>Share the link</h3>
							<p>Send the invite on WhatsApp or copy it with one tap. The room is private — only people with the link can join.</p>
						</div>
					</li>
					<li>
						<span className="step-n" aria-hidden="true">3</span>
						<div>
							<h3>Play &amp; rematch</h3>
							<p>The match starts the moment your friend joins. Keep playing unlimited rematches — the score lives only for the session.</p>
						</div>
					</li>
				</ol>
			</section>

			<section className="section features">
				<h2>Built for quick, fun games</h2>
				<div className="feature-grid">
					<div className="feature">
						<span aria-hidden="true">⚡</span>
						<h3>Instant load</h3>
						<p>A lightweight app served from the edge — the board is ready before you finish reading this.</p>
					</div>
					<div className="feature">
						<span aria-hidden="true">🔒</span>
						<h3>Private by design</h3>
						<p>Names exist only while the room is alive. No accounts, no history, no permanent storage.</p>
					</div>
					<div className="feature">
						<span aria-hidden="true">📱</span>
						<h3>Any device</h3>
						<p>Phones, tablets, laptops — big touch targets, dark &amp; light themes, and reduced-motion support.</p>
					</div>
					<div className="feature">
						<span aria-hidden="true">🤖</span>
						<h3>Unbeatable AI</h3>
						<p>Hard mode plays perfect Tic-Tac-Toe. The best you can do is a draw — can you?</p>
					</div>
				</div>
			</section>

			<section className="section about">
				<h2>About Tick-Tac Arena</h2>
				<p>
					Tick-Tac Arena is a modern take on the classic 3×3 strategy game. Two players take turns placing
					X and O; the first to line up three marks — across, down, or diagonally — wins the round. Draws
					happen when the board fills with no line. It takes seconds to learn and a lifetime to perfect.
				</p>
				<p>
					Every multiplayer room is a private, temporary space: it exists while you play and is discarded
					automatically when you leave or go idle. We don't ask for personal information and we don't keep
					game records.
				</p>
			</section>

			<AdSlot placement="home-footer" />
		</>
	);
}

// ── Friend setup ─────────────────────────────────────────────────────────────

function FriendSetup({ onBack }: { onBack: () => void }) {
	const [p1, setP1] = useState('');
	const [p2, setP2] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit(e: FormEvent) {
		e.preventDefault();
		if (busy) return;
		const n1 = sanitizeName(p1);
		if (!n1) {
			setError('Please enter your name (1–20 characters).');
			return;
		}
		const n2 = p2.trim() === '' ? undefined : sanitizeName(p2);
		if (p2.trim() !== '' && !n2) {
			setError("Your friend's name must be 1–20 characters.");
			return;
		}
		setError(null);
		setBusy(true);
		try {
			const res = await apiCreate(n1, n2 ?? undefined);
			saveRoomCredentials({ code: res.code, seat: res.seat, token: res.token, name: n1 });
			playSound('join');
			navigate(`/room/${res.code}`);
		} catch (err) {
			setBusy(false);
			setError(err instanceof Error ? err.message : 'Could not create the room. Please try again.');
		}
	}

	return (
		<section className="setup pop-in">
			<Card className="setup-card">
				<button type="button" className="back-link" onClick={onBack}>
					← Back
				</button>
				<h2 className="setup-title">Play with a Friend</h2>
				<p className="setup-sub">
					Names are temporary labels for this match only. Your friend can change their suggested name
					when they open the invite.
				</p>
				<form onSubmit={(e) => void submit(e)} noValidate>
					<TextField
						label="Your name"
						placeholder="e.g. Ana"
						value={p1}
						maxLength={20}
						autoFocus
						onChange={(e) => setP1(e.target.value)}
					/>
					<TextField
						label="Friend's name (optional)"
						placeholder="e.g. Sam"
						value={p2}
						maxLength={20}
						hint="Just a suggestion — they confirm it after opening your link."
						onChange={(e) => setP2(e.target.value)}
					/>
					{error && (
						<div className="field-error" role="alert">
							{error}
						</div>
					)}
					<Button type="submit" size="lg" className="setup-cta" loading={busy}>
						{busy ? 'Creating room…' : 'Create room & get invite link'}
					</Button>
				</form>
				<p className="setup-note">
					You'll play as <strong>X</strong> and move first. Rooms expire after 30 minutes of inactivity.
				</p>
			</Card>
		</section>
	);
}

// ── Solo setup ───────────────────────────────────────────────────────────────

function SoloSetup({
	initial,
	onBack,
	onStart,
}: {
	initial: { playerName: string; difficulty: Difficulty; playerMark: Mark } | null;
	onBack: () => void;
	onStart: (opts: { playerName: string; difficulty: Difficulty; playerMark: Mark }) => void;
}) {
	const [name, setName] = useState(initial?.playerName ?? '');
	const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'medium');
	const [mark, setMark] = useState<Mark>(initial?.playerMark ?? 'X');
	const [error, setError] = useState<string | null>(null);

	function submit(e: FormEvent) {
		e.preventDefault();
		const n = sanitizeName(name);
		if (!n) {
			setError('Please enter your name (1–20 characters).');
			return;
		}
		onStart({ playerName: n, difficulty, playerMark: mark });
	}

	return (
		<section className="setup pop-in">
			<Card className="setup-card">
				<button type="button" className="back-link" onClick={onBack}>
					← Back
				</button>
				<h2 className="setup-title">Play vs Computer</h2>
				<form onSubmit={submit} noValidate>
					<TextField
						label="Your name"
						placeholder="e.g. Ana"
						value={name}
						maxLength={20}
						autoFocus
						onChange={(e) => setName(e.target.value)}
						error={error}
					/>

					<div className="field">
						<span className="field-label">Difficulty</span>
						<Segmented<Difficulty>
							ariaLabel="Computer difficulty"
							value={difficulty}
							onChange={setDifficulty}
							options={[
								{ value: 'easy', label: 'Easy', sub: 'Relaxed & beatable' },
								{ value: 'medium', label: 'Medium', sub: 'Sharp, not perfect' },
								{ value: 'hard', label: 'Hard', sub: 'Unbeatable AI' },
							]}
						/>
					</div>

					<div className="field">
						<span className="field-label">Play as</span>
						<Segmented<Mark>
							ariaLabel="Your mark"
							value={mark}
							onChange={setMark}
							options={[
								{ value: 'X', label: 'X — you move first' },
								{ value: 'O', label: 'O — computer moves first' },
							]}
						/>
					</div>

					<Button type="submit" size="lg" className="setup-cta">
						Start game as {mark}
					</Button>
				</form>
				<p className="setup-note">
					Hard mode plays a perfect game — a draw is a win. {mark === 'X' ? 'X goes first.' : `Computer (X) goes first; you'll react as ${otherMark('X')}.`}
				</p>
			</Card>
		</section>
	);
}
