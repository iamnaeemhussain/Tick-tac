import { describe, expect, it } from 'vitest';
import {
	MAX_WS_MESSAGE_BYTES,
	ROOM_CODE_RE,
	parseClientMsg,
	sanitizeName,
	isRoomCode,
	isToken,
	generateRoomCodeLike,
	cryptoRandomUuidLike,
} from './helpers/protocolImports';

describe('sanitizeName', () => {
	it('trims and collapses whitespace', () => {
		expect(sanitizeName('  Ana   María  ')).toBe('Ana María');
	});

	it('strips control, zero-width and bidi-override characters', () => {
		expect(sanitizeName('A\u0000B\u001FC')).toBe('ABC');
		expect(sanitizeName('Evil\u202EName\u200B')).toBe('EvilName');
		expect(sanitizeName('\uFEFF')).toBeNull();
	});

	it('enforces length limits', () => {
		expect(sanitizeName('a'.repeat(20))).toBe('a'.repeat(20));
		expect(sanitizeName('a'.repeat(21))).toBeNull();
		expect(sanitizeName('')).toBeNull();
		expect(sanitizeName('   ')).toBeNull();
	});

	it('rejects non-strings', () => {
		expect(sanitizeName(42)).toBeNull();
		expect(sanitizeName(null)).toBeNull();
		expect(sanitizeName(undefined)).toBeNull();
		expect(sanitizeName({ name: 'x' })).toBeNull();
	});

	it('keeps unicode display names intact (rendered as text by React)', () => {
		expect(sanitizeName('نِعمان')).toBe('نِعمان');
		expect(sanitizeName('小明 🎮')).toBe('小明 🎮');
	});
});

describe('parseClientMsg', () => {
	it('accepts well-formed messages', () => {
		expect(parseClientMsg({ type: 'auth', token: 'a'.repeat(36) })).toEqual({ type: 'auth', token: 'a'.repeat(36) });
		expect(parseClientMsg({ type: 'move', cell: 4, round: 1 })).toEqual({ type: 'move', cell: 4, round: 1 });
		expect(parseClientMsg({ type: 'rematch', round: 2 })).toEqual({ type: 'rematch', round: 2 });
		expect(parseClientMsg({ type: 'ping', t: 123 })).toEqual({ type: 'ping', t: 123 });
		expect(parseClientMsg({ type: 'leave' })).toEqual({ type: 'leave' });
		expect(parseClientMsg({ type: 'updateNames', p1: 'A', p2: 'B' })).toEqual({ type: 'updateNames', p1: 'A', p2: 'B' });
	});

	it('rejects malformed or hostile payloads', () => {
		expect(parseClientMsg(null)).toBeNull();
		expect(parseClientMsg('hello')).toBeNull();
		expect(parseClientMsg([])).toBeNull();
		expect(parseClientMsg({})).toBeNull();
		expect(parseClientMsg({ type: 'auth' })).toBeNull();
		expect(parseClientMsg({ type: 'auth', token: 'short' })).toBeNull();
		expect(parseClientMsg({ type: 'move', cell: '4', round: 1 })).toBeNull();
		expect(parseClientMsg({ type: 'move', cell: 4 })).toBeNull();
		expect(parseClientMsg({ type: 'rematch' })).toBeNull();
		expect(parseClientMsg({ type: 'unknown' })).toBeNull();
		expect(parseClientMsg({ type: 'ping' })).toBeNull();
		// Cell range is validated by the engine (parse only checks shape).
		expect(parseClientMsg({ type: 'move', cell: 99999, round: 1 })).not.toBeNull();
	});
});

describe('room codes & tokens', () => {
	it('accepts the documented 8-char unambiguous alphabet', () => {
		expect(isRoomCode('Ab8kP2xQ')).toBe(true);
		expect(isRoomCode('23456789')).toBe(true);
		expect(isRoomCode('abcdefgh')).toBe(true);
	});

	it('rejects ambiguous, short or malformed codes', () => {
		expect(isRoomCode('Ab8kP2x')).toBe(false); // 7 chars
		expect(isRoomCode('Ab8kP2xQZ')).toBe(false); // 9 chars
		expect(isRoomCode('0O1lI0OO')).toBe(false); // excluded confusables 0,1,O,I,l
		expect(isRoomCode('../etc')).toBe(false);
		expect(isRoomCode('')).toBe(false);
		expect(isRoomCode(12345678)).toBe(false);
	});

	it('generated codes always match the route regex', () => {
		for (let i = 0; i < 1000; i++) {
			const code = generateRoomCodeLike();
			expect(ROOM_CODE_RE.test(code)).toBe(true);
			expect(isRoomCode(code)).toBe(true);
		}
	});

	it('token shape guard', () => {
		expect(isToken(cryptoRandomUuidLike())).toBe(true);
		expect(isToken('short')).toBe(false);
		expect(isToken('x'.repeat(65))).toBe(false);
	});
});

describe('protocol constants', () => {
	it('WS payload cap is small enough to block abuse', () => {
		expect(MAX_WS_MESSAGE_BYTES).toBeLessThanOrEqual(4096);
		expect(MAX_WS_MESSAGE_BYTES).toBeGreaterThanOrEqual(256);
	});
});
