/**
 * AdSlot — reserved, ad-ready container.
 *
 * Launch state (ADS_CONFIG.enabled = false): renders a subtle reserved box
 * with the exact height the real ad will occupy, so enabling ads later causes
 * ZERO layout shift. The box never overlaps the board or primary controls —
 * placements are fixed below/around the gameplay area by the page layouts.
 *
 * Enabled state: lazily injects the AdSense loader once, renders an <ins>
 * unit, and degrades gracefully to the reserved box if the script is blocked,
 * fails, or hasn't been configured — gameplay never depends on it.
 */

import { useEffect, useRef, useState } from 'react';
import { ADS_CONFIG, AdPlacement } from '../config';

declare global {
	interface Window {
		adsbygoogle?: unknown[];
	}
}

let loaderPromise: Promise<boolean> | null = null;

/** Inject the AdSense script exactly once; resolves false on failure. */
function loadAdSense(client: string): Promise<boolean> {
	if (!ADS_CONFIG.enabled || !client) return Promise.resolve(false);
	if (!loaderPromise) {
		loaderPromise = new Promise<boolean>((resolve) => {
			try {
				const existing = document.querySelector<HTMLScriptElement>('script[data-tta-ads]');
				if (existing) {
					resolve(true);
					return;
				}
				const s = document.createElement('script');
				s.async = true;
				s.dataset.ttaAds = '1';
				s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
				s.crossOrigin = 'anonymous';
				s.onload = () => resolve(true);
				s.onerror = () => resolve(false);
				document.head.appendChild(s);
			} catch {
				resolve(false);
			}
		});
	}
	return loaderPromise;
}

export function AdSlot({ placement, className = '' }: { placement: AdPlacement; className?: string }) {
	const cfg = ADS_CONFIG.slots[placement];
	const [scriptReady, setScriptReady] = useState(false);
	const insRef = useRef<HTMLModElement | null>(null);
	const pushedRef = useRef(false);

	useEffect(() => {
		if (!ADS_CONFIG.enabled) return;
		let alive = true;
		void loadAdSense(ADS_CONFIG.client).then((ok) => {
			if (!ok || !alive) return;
			setScriptReady(true);
			if (!pushedRef.current && insRef.current) {
				pushedRef.current = true;
				try {
					(window.adsbygoogle = window.adsbygoogle || []).push({});
				} catch {
					/* blocked or misconfigured — placeholder stays */
				}
			}
		});
		return () => {
			alive = false;
		};
	}, [placement]);

	const active = ADS_CONFIG.enabled && scriptReady && Boolean(cfg.id);

	return (
		<div
			className={`ad-slot ad-${placement} ${className}`.trim()}
			style={{ minHeight: cfg.minHeight }}
			data-ad-active={active ? 'true' : 'false'}
			aria-hidden="true"
		>
			{active ? (
				<ins
					ref={insRef}
					className="adsbygoogle"
					style={{ display: 'block', minHeight: cfg.minHeight }}
					data-ad-client={ADS_CONFIG.client}
					data-ad-slot={cfg.id}
					data-ad-format="auto"
					data-full-width-responsive="true"
				/>
			) : (
				<div className="ad-placeholder">
					<span>{ADS_CONFIG.enabled ? 'Advertisement' : 'Ad space — coming soon'}</span>
				</div>
			)}
		</div>
	);
}
