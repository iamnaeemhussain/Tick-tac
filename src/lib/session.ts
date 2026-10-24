/**
 * Ephemeral, per-tab room credentials (sessionStorage).
 *
 * Holds ONLY {roomCode, seat, token, yourName} so a page refresh mid-match
 * can re-authenticate against the still-live room. sessionStorage dies with
 * the tab — nothing is persisted long-term, and no game state, scores or
 * history are ever written to browser storage.
 */

export interface RoomCredentials {
	code: string;
	seat: 'X' | 'O';
	token: string;
	name: string;
}

function key(code: string): string {
	return `tta.room.${code}`;
}

export function saveRoomCredentials(cred: RoomCredentials): void {
	try {
		sessionStorage.setItem(key(cred.code), JSON.stringify(cred));
	} catch {
		/* tab session unavailable — reconnection after refresh won't work,
		   but the live socket keeps the current session going */
	}
}

export function loadRoomCredentials(code: string): RoomCredentials | null {
	try {
		const raw = sessionStorage.getItem(key(code));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as RoomCredentials;
		if (
			typeof parsed?.token === 'string' &&
			(parsed.seat === 'X' || parsed.seat === 'O') &&
			typeof parsed.code === 'string'
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function clearRoomCredentials(code: string): void {
	try {
		sessionStorage.removeItem(key(code));
	} catch {
		/* ignore */
	}
}
