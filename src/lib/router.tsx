/**
 * Micro router — no dependencies.
 * Routes: '/' (home + solo) and '/room/:code' (invite / waiting / match).
 */

import { useCallback, useSyncExternalStore } from 'react';

const NAV_EVENT = 'tta:navigate';

function subscribe(cb: () => void): () => void {
	window.addEventListener('popstate', cb);
	window.addEventListener(NAV_EVENT, cb);
	return () => {
		window.removeEventListener('popstate', cb);
		window.removeEventListener(NAV_EVENT, cb);
	};
}

export function usePath(): string {
	return useSyncExternalStore(
		subscribe,
		() => window.location.pathname,
		() => '/',
	);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
	if (window.location.pathname === to) return;
	if (opts.replace) window.history.replaceState(null, '', to);
	else window.history.pushState(null, '', to);
	window.dispatchEvent(new Event(NAV_EVENT));
}

export function useNavigate() {
	return useCallback((to: string, opts?: { replace?: boolean }) => navigate(to, opts), []);
}

const ROOM_RE = /^\/room\/([2-9A-HJ-NP-Za-km-z]{8})\/?$/;

/** Extract the room code from a path, or null. */
export function matchRoomCode(path: string): string | null {
	const m = ROOM_RE.exec(path);
	return m ? m[1] : null;
}
