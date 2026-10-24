/** App shell: prefs (theme/sound), header, and route switching. */

import { Component, ReactNode, useCallback, useState } from 'react';
import { Logo, SoundToggle, ThemeToggle } from './components/Toggles';
import { APP_NAME } from './config';
import { useMeta } from './lib/meta';
import { matchRoomCode, usePath } from './lib/router';
import { loadPrefs, Prefs, savePrefs } from './lib/settings';
import { primeAudio } from './lib/sound';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		if (this.state.failed) {
			return (
				<main className="page-center">
					<div className="card status-card">
						<h2>Something went sideways</h2>
						<p className="muted">The app hit an unexpected error. A quick reload usually fixes it.</p>
						<button className="btn btn-primary" onClick={() => window.location.reload()}>
							Reload
						</button>
					</div>
				</main>
			);
		}
		return this.props.children;
	}
}

function NotFound() {
	useMeta({ title: `Page not found — ${APP_NAME}`, robots: 'noindex' });
	return (
		<main className="page-center">
			<div className="card status-card pop-in">
				<span className="status-emoji" aria-hidden="true">🧭</span>
				<h2>Page not found</h2>
				<p className="muted">That link doesn't lead anywhere — but a game is one click away.</p>
				<a className="btn btn-primary" href="/">
					Play Tic-Tac-Toe
				</a>
			</div>
		</main>
	);
}

export default function App() {
	const path = usePath();
	const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

	const toggleTheme = useCallback(() => {
		setPrefs((p) => {
			const next = { ...p, theme: p.theme === 'dark' ? ('light' as const) : ('dark' as const) };
			savePrefs(next);
			return next;
		});
	}, []);

	const toggleSound = useCallback(() => {
		primeAudio();
		setPrefs((p) => {
			const next = { ...p, sound: !p.sound };
			savePrefs(next);
			return next;
		});
	}, []);

	const roomCode = matchRoomCode(path);

	return (
		<div className="app">
			<div className="bg-glow" aria-hidden="true" />
			<header className="app-header">
				<Logo />
				<div className="header-toggles">
					<SoundToggle prefs={prefs} onToggle={toggleSound} />
					<ThemeToggle prefs={prefs} onToggle={toggleTheme} />
				</div>
			</header>
			<ErrorBoundary>
				{roomCode ? <RoomPage key={roomCode} code={roomCode} /> : path === '/' ? <HomePage /> : <NotFound />}
			</ErrorBoundary>
			{!roomCode && path === '/' && (
				<footer className="app-footer">
					<p>
						<strong>{APP_NAME}</strong> — free instant Tic-Tac-Toe. No accounts, no tracking, no stored
						games. Rooms and names evaporate when the session ends.
					</p>
					<p className="footer-dim">
						Private rooms use temporary, invite-only links. Play responsibly — be kind to friends who
						lose. 🙂
					</p>
				</footer>
			)}
		</div>
	);
}
