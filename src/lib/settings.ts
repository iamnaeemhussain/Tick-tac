/**
 * User preferences only (theme + sound).
 *
 * Privacy note: per the zero-persistence design we store NO personal
 * information, NO game history and NO room data in the browser — only these
 * two anonymous UI preferences. If storage is unavailable (private mode),
 * everything still works with in-memory defaults.
 */

export interface Prefs {
	theme: 'dark' | 'light';
	sound: boolean;
}

const KEY = 'tta.prefs';
const memory: Prefs = { theme: 'dark', sound: true };

function systemTheme(): 'dark' | 'light' {
	try {
		return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	} catch {
		return 'dark';
	}
}

export function loadPrefs(): Prefs {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { theme: systemTheme(), sound: true };
		const p = JSON.parse(raw) as Partial<Prefs>;
		return {
			theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : systemTheme(),
			sound: typeof p.sound === 'boolean' ? p.sound : true,
		};
	} catch {
		return { theme: systemTheme(), sound: true };
	}
}

export function savePrefs(prefs: Prefs): void {
	memory.theme = prefs.theme;
	memory.sound = prefs.sound;
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs));
	} catch {
		/* storage blocked — keep in memory */
	}
	applyTheme(prefs.theme);
}

export function applyTheme(theme: 'dark' | 'light'): void {
	document.documentElement.setAttribute('data-theme', theme);
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media]), meta[name="theme-color"]');
	if (meta) meta.content = theme === 'dark' ? '#0f1230' : '#f4f5fb';
}

export function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}
