/**
 * Lightweight canvas confetti — no libraries, ~100 particles, auto-cleanup.
 * Honors prefers-reduced-motion (renders nothing).
 */

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../lib/settings';

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	color: string;
	rot: number;
	vr: number;
	shape: 'rect' | 'circle';
}

const COLORS = ['#22d3ee', '#fb7185', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'];

export interface ConfettiHandle {
	fire: () => void;
}

export function Confetti({ handleRef }: { handleRef: React.MutableRefObject<ConfettiHandle | null> }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const rafRef = useRef(0);
	const particlesRef = useRef<Particle[]>([]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const resize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		resize();
		window.addEventListener('resize', resize);

		let running = false;
		const tick = () => {
			const ps = particlesRef.current;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			for (let i = ps.length - 1; i >= 0; i--) {
				const p = ps[i];
				p.vy += 0.14; // gravity
				p.vx *= 0.995;
				p.x += p.vx;
				p.y += p.vy;
				p.rot += p.vr;
				if (p.y > canvas.height + 30) {
					ps.splice(i, 1);
					continue;
				}
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.fillStyle = p.color;
				if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
				else {
					ctx.beginPath();
					ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.restore();
			}
			if (ps.length > 0) {
				rafRef.current = requestAnimationFrame(tick);
			} else {
				running = false;
				ctx.clearRect(0, 0, canvas.width, canvas.height);
			}
		};

		handleRef.current = {
			fire: () => {
				if (prefersReducedMotion()) return;
				const ps = particlesRef.current;
				const cx = canvas.width / 2;
				const cy = canvas.height * 0.38;
				for (let i = 0; i < 110; i++) {
					const angle = Math.random() * Math.PI * 2;
					const speed = 3 + Math.random() * 8;
					ps.push({
						x: cx + (Math.random() - 0.5) * 120,
						y: cy + (Math.random() - 0.5) * 60,
						vx: Math.cos(angle) * speed,
						vy: Math.sin(angle) * speed - 4,
						size: 6 + Math.random() * 7,
						color: COLORS[Math.floor(Math.random() * COLORS.length)],
						rot: Math.random() * Math.PI,
						vr: (Math.random() - 0.5) * 0.3,
						shape: Math.random() < 0.6 ? 'rect' : 'circle',
					});
				}
				if (!running) {
					running = true;
					rafRef.current = requestAnimationFrame(tick);
				}
			},
		};

		return () => {
			window.removeEventListener('resize', resize);
			cancelAnimationFrame(rafRef.current);
			handleRef.current = null;
		};
	}, [handleRef]);

	return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
