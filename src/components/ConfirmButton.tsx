/**
 * ConfirmButton — two-step inline confirmation for destructive actions
 * (restart an active match / end a live session). No native dialogs; the
 * button arms on first click and confirms on the second within 3.5 s.
 */

import { useEffect, useState } from 'react';

export function ConfirmButton({
	label,
	confirmLabel = 'Tap again to confirm',
	onConfirm,
	className = 'btn btn-ghost btn-sm',
	title,
}: {
	label: string;
	confirmLabel?: string;
	onConfirm: () => void;
	className?: string;
	title?: string;
}) {
	const [armed, setArmed] = useState(false);

	useEffect(() => {
		if (!armed) return;
		const id = setTimeout(() => setArmed(false), 3500);
		return () => clearTimeout(id);
	}, [armed]);

	return (
		<button
			type="button"
			className={`${className}${armed ? ' armed' : ''}`}
			title={title}
			onClick={() => {
				if (armed) {
					setArmed(false);
					onConfirm();
				} else {
					setArmed(true);
				}
			}}
		>
			{armed ? confirmLabel : label}
		</button>
	);
}
