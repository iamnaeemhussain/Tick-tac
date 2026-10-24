/** Document head management (title + robots) for the SPA routes. */

import { useEffect } from 'react';
import { APP_NAME } from '../config';

export function useMeta(opts: { title?: string; robots?: string }): void {
	const { title, robots } = opts;
	useEffect(() => {
		if (title) document.title = title;
		let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
		if (robots) {
			if (!meta) {
				meta = document.createElement('meta');
				meta.name = 'robots';
				document.head.appendChild(meta);
			}
			meta.content = robots;
		} else if (meta) {
			meta.remove();
		}
	}, [title, robots]);
}

export const HOME_TITLE = `${APP_NAME} — Instant Online Tic-Tac-Toe with Friends`;
