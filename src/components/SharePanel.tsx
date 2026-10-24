/**
 * Invite sharing — copy link, WhatsApp, and the native share sheet.
 * Clear "Copied!" feedback; works without any third-party scripts.
 */

import { useState } from 'react';
import { playSound } from '../lib/sound';

export function inviteUrl(code: string): string {
	return `${window.location.origin}/room/${code}`;
}

function inviteText(code: string, inviterName: string): string {
	return `${inviterName} invited you to Tic-Tac-Toe! Join the game: ${inviteUrl(code)}`;
}

export function SharePanel({
	code,
	inviterName,
}: {
	code: string;
	inviterName: string;
}) {
	const [copied, setCopied] = useState(false);
	const url = inviteUrl(code);

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Fallback for older browsers / non-secure contexts.
			try {
				const ta = document.createElement('textarea');
				ta.value = url;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
			} catch {
				return;
			}
		}
		playSound('click');
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	function shareNative(): void {
		if (navigator.share) {
			navigator
				.share({ title: 'Play Tic-Tac-Toe with me!', text: inviteText(code, inviterName), url })
				.catch(() => void copy());
		} else {
			void copy();
		}
	}

	const waHref = `https://wa.me/?text=${encodeURIComponent(inviteText(code, inviterName))}`;

	return (
		<div className="share-panel">
			<div className="share-link-row">
				<input className="input share-link" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
				<button type="button" className={`btn btn-primary copy-btn${copied ? ' copied' : ''}`} onClick={() => void copy()}>
					{copied ? (
						<>
							<svg viewBox="0 0 24 24" className="btn-ic" aria-hidden="true">
								<polyline points="4 12.5 9.5 18 20 6.5" />
							</svg>
							Copied!
						</>
					) : (
						<>
							<svg viewBox="0 0 24 24" className="btn-ic" aria-hidden="true">
								<rect x="9" y="9" width="11" height="11" rx="2.5" />
								<path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5" />
							</svg>
							Copy link
						</>
					)}
				</button>
			</div>
			<div className="share-buttons">
				<a className="btn btn-whatsapp" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => playSound('click')}>
					<svg viewBox="0 0 24 24" className="btn-ic" aria-hidden="true">
						<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.4-.2-2.6.7.7-2.5-.2-.4A8 8 0 0 1 12 4zm-3.3 4c-.2 0-.4 0-.6.3-.2.3-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.7 2.7 4.2 3.7 2.1.8 2.5.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1 0-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5v-.5l-.7-1.7c-.2-.4-.4-.4-.6-.4h-.6z" />
					</svg>
					WhatsApp
				</a>
				{typeof navigator !== 'undefined' && 'share' in navigator && (
					<button type="button" className="btn btn-soft" onClick={shareNative}>
						<svg viewBox="0 0 24 24" className="btn-ic" aria-hidden="true">
							<path d="M12 3v12m0-12L8 7m4-4l4 4" />
							<path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
						</svg>
						More…
					</button>
				)}
			</div>
			<p className="share-hint">{copied ? 'Link copied — send it to your friend!' : 'Send this link — your friend joins instantly.'}</p>
		</div>
	);
}
