/** Small helpers shared by the Worker entry and Durable Objects. */

import { MAX_HTTP_BODY_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/protocol';

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			// Never cache API responses (room state is live & private).
			'cache-control': 'no-store',
			...extraHeaders,
		},
	});
}

export function clientIp(request: Request): string {
	return (
		request.headers.get('CF-Connecting-IP') ??
		request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
		'local'
	);
}

/** Read and parse a JSON body with a hard size cap. Returns null if invalid. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const lenHeader = request.headers.get('content-length');
		if (lenHeader && Number(lenHeader) > MAX_HTTP_BODY_BYTES) return null;
		const text = await request.text();
		if (text.length > MAX_HTTP_BODY_BYTES) return null;
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Cryptographically random, unambiguous 8-char room code (54^8 ≈ 7.2e13). */
export function generateRoomCode(): string {
	const bytes = new Uint8Array(ROOM_CODE_LENGTH);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
		out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
	}
	return out;
}

/** Unpredictable bearer token for a seat. */
export function generateToken(): string {
	return crypto.randomUUID();
}

export function envInt(value: string | undefined, fallback: number): number {
	const n = value === undefined ? NaN : Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
