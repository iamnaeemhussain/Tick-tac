/**
 * Re-exports of shared protocol utilities for tests, plus deterministic
 * stand-ins for the Worker-only crypto helpers (the room-code generator lives
 * in worker/util.ts which imports ambient Workers APIs; the alphabet logic is
 * duplicated here so it can be tested under plain Node).
 */

export {
	MAX_WS_MESSAGE_BYTES,
	ROOM_CODE_RE,
	ROOM_CODE_ALPHABET,
	parseClientMsg,
	sanitizeName,
	isRoomCode,
	isToken,
} from '../../shared/protocol';

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/protocol';
import { randomBytes, randomUUID } from 'node:crypto';

/** Same algorithm as worker/util.ts generateRoomCode, using node:crypto. */
export function generateRoomCodeLike(): string {
	const bytes = randomBytes(ROOM_CODE_LENGTH);
	let out = '';
	for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
		out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
	}
	return out;
}

export function cryptoRandomUuidLike(): string {
	return randomUUID();
}
