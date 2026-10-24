/** Thin REST client for the Worker API. Same-origin, JSON, no cookies. */

import {
	CreateRoomResponse,
	JoinRoomResponse,
	PublicRoomInfo,
} from '../../shared/protocol';

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			headers: { 'content-type': 'application/json' },
			...init,
		});
	} catch {
		throw new ApiError(0, 'network', 'Connection problem. Check your network and retry.');
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		/* empty body */
	}
	if (!res.ok) {
		const b = body as { error?: string; message?: string } | null;
		throw new ApiError(res.status, b?.error ?? 'error', b?.message ?? defaultMessage(res.status, b?.error));
	}
	return body as T;
}

function defaultMessage(status: number, code?: string): string {
	if (status === 429) return 'Too many attempts — please wait a moment.';
	if (status === 409 && code === 'room_full') return 'This room is already full.';
	if (status === 410) return 'This room has expired.';
	if (status === 0) return 'Network error.';
	return 'Something went wrong. Please try again.';
}

export function createRoom(p1Name: string, p2Name?: string): Promise<CreateRoomResponse> {
	return request<CreateRoomResponse>('/api/rooms', {
		method: 'POST',
		body: JSON.stringify({ p1Name, ...(p2Name ? { p2Name } : {}) }),
	});
}

export function getRoomInfo(code: string): Promise<PublicRoomInfo> {
	return request<PublicRoomInfo>(`/api/rooms/${encodeURIComponent(code)}`);
}

export function joinRoom(code: string, name: string): Promise<JoinRoomResponse> {
	return request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, {
		method: 'POST',
		body: JSON.stringify({ name }),
	});
}

export function endRoom(code: string, token: string): Promise<{ ok: boolean }> {
	return request<{ ok: boolean }>(`/api/rooms/${encodeURIComponent(code)}/end`, {
		method: 'POST',
		body: JSON.stringify({ token }),
	});
}
