/**
 * Tiny WebAudio sound effects — synthesized on the fly, no audio files,
 * no third-party requests. All sounds are short, soft, and can be muted
 * from the header toggle (preference saved with other UI prefs only).
 */

import { loadPrefs } from './settings';

type SoundName = 'place' | 'win' | 'lose' | 'draw' | 'join' | 'invalid' | 'click' | 'rematch';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
	try {
		if (!ctx) {
			const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AC) return null;
			ctx = new AC();
		}
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	} catch {
		return null;
	}
}

interface Tone {
	freq: number;
	start: number; // seconds from now
	dur: number;
	type?: OscillatorType;
	gain?: number;
}

function playTones(tones: Tone[]): void {
	const ac = ensureCtx();
	if (!ac) return;
	const now = ac.currentTime;
	for (const t of tones) {
		const osc = ac.createOscillator();
		const g = ac.createGain();
		osc.type = t.type ?? 'sine';
		osc.frequency.setValueAtTime(t.freq, now + t.start);
		const peak = t.gain ?? 0.12;
		g.gain.setValueAtTime(0.0001, now + t.start);
		g.gain.exponentialRampToValueAtTime(peak, now + t.start + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
		osc.connect(g).connect(ac.destination);
		osc.start(now + t.start);
		osc.stop(now + t.start + t.dur + 0.05);
	}
}

const RECIPES: Record<SoundName, Tone[]> = {
	place: [{ freq: 520, start: 0, dur: 0.09, type: 'triangle', gain: 0.14 }],
	click: [{ freq: 660, start: 0, dur: 0.05, type: 'sine', gain: 0.07 }],
	join: [
		{ freq: 523, start: 0, dur: 0.1, type: 'sine' },
		{ freq: 784, start: 0.09, dur: 0.14, type: 'sine' },
	],
	win: [
		{ freq: 523, start: 0, dur: 0.12, type: 'triangle', gain: 0.16 },
		{ freq: 659, start: 0.1, dur: 0.12, type: 'triangle', gain: 0.16 },
		{ freq: 784, start: 0.2, dur: 0.12, type: 'triangle', gain: 0.16 },
		{ freq: 1047, start: 0.3, dur: 0.25, type: 'triangle', gain: 0.18 },
	],
	lose: [
		{ freq: 392, start: 0, dur: 0.15, type: 'sine', gain: 0.1 },
		{ freq: 311, start: 0.13, dur: 0.15, type: 'sine', gain: 0.1 },
		{ freq: 233, start: 0.26, dur: 0.3, type: 'sine', gain: 0.1 },
	],
	draw: [
		{ freq: 440, start: 0, dur: 0.14, type: 'sine', gain: 0.1 },
		{ freq: 415, start: 0.14, dur: 0.2, type: 'sine', gain: 0.1 },
	],
	invalid: [{ freq: 160, start: 0, dur: 0.12, type: 'square', gain: 0.05 }],
	rematch: [
		{ freq: 587, start: 0, dur: 0.09, type: 'triangle', gain: 0.12 },
		{ freq: 880, start: 0.08, dur: 0.14, type: 'triangle', gain: 0.12 },
	],
};

export function playSound(name: SoundName): void {
	try {
		if (!loadPrefs().sound) return;
	} catch {
		return;
	}
	playTones(RECIPES[name]);
}

/** Unlock the AudioContext on the first user gesture (browser policy). */
export function primeAudio(): void {
	ensureCtx();
}
