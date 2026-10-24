/** Brand logo + theme/sound toggles. */

import { Prefs } from '../lib/settings';

export function Logo({ compact = false }: { compact?: boolean }) {
	return (
		<a className="logo" href="/" aria-label="Tick-Tac Arena — home">
			<svg className="logo-mark" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
				<rect x="2" y="2" width="40" height="40" rx="12" className="logo-bg" />
				<line x1="12" y1="12" x2="21" y2="21" className="logo-x" />
				<line x1="21" y1="12" x2="12" y2="21" className="logo-x" />
				<circle cx="31" cy="31" r="5.4" className="logo-o" />
			</svg>
			{!compact && (
				<span className="logo-text">
					Tick&#8209;Tac <span className="logo-accent">Arena</span>
				</span>
			)}
		</a>
	);
}

export function ThemeToggle({ prefs, onToggle }: { prefs: Prefs; onToggle: () => void }) {
	const dark = prefs.theme === 'dark';
	return (
		<button
			type="button"
			className="icon-btn"
			onClick={onToggle}
			aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
			title={dark ? 'Light theme' : 'Dark theme'}
		>
			{dark ? (
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="4.4" />
					<g className="rays">
						<line x1="12" y1="2.6" x2="12" y2="5" />
						<line x1="12" y1="19" x2="12" y2="21.4" />
						<line x1="2.6" y1="12" x2="5" y2="12" />
						<line x1="19" y1="12" x2="21.4" y2="12" />
						<line x1="5.2" y1="5.2" x2="6.9" y2="6.9" />
						<line x1="17.1" y1="17.1" x2="18.8" y2="18.8" />
						<line x1="5.2" y1="18.8" x2="6.9" y2="17.1" />
						<line x1="17.1" y1="6.9" x2="18.8" y2="5.2" />
					</g>
				</svg>
			) : (
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
				</svg>
			)}
		</button>
	);
}

export function SoundToggle({ prefs, onToggle }: { prefs: Prefs; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="icon-btn"
			onClick={onToggle}
			aria-label={prefs.sound ? 'Mute sound effects' : 'Unmute sound effects'}
			aria-pressed={prefs.sound}
			title={prefs.sound ? 'Sound on' : 'Sound off'}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
				{prefs.sound ? (
					<g className="waves">
						<path d="M15.5 9a4.6 4.6 0 0 1 0 6" />
						<path d="M18 6.5a8 8 0 0 1 0 11" />
					</g>
				) : (
					<g className="mute-x">
						<line x1="16" y1="9.5" x2="21" y2="14.5" />
						<line x1="21" y1="9.5" x2="16" y2="14.5" />
					</g>
				)}
			</svg>
		</button>
	);
}
