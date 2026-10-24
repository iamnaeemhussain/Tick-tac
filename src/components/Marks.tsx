/** Animated SVG X and O marks (stroke-draw animation, reduced-motion aware). */

interface MarkProps {
	/** Renders a faint preview mark for hover states. */
	ghost?: boolean;
}

export function XMark({ ghost }: MarkProps) {
	return (
		<svg
			viewBox="0 0 100 100"
			className={`mark mark-x${ghost ? ' mark-ghost' : ''}`}
			aria-hidden="true"
			focusable="false"
		>
			<line className="mark-stroke s1" x1="26" y1="26" x2="74" y2="74" />
			<line className="mark-stroke s2" x1="74" y1="26" x2="26" y2="74" />
		</svg>
	);
}

export function OMark({ ghost }: MarkProps) {
	return (
		<svg
			viewBox="0 0 100 100"
			className={`mark mark-o${ghost ? ' mark-ghost' : ''}`}
			aria-hidden="true"
			focusable="false"
		>
			<circle className="mark-stroke c1" cx="50" cy="50" r="26" />
		</svg>
	);
}

export function Mark({ value, ghost }: { value: 'X' | 'O'; ghost?: boolean }) {
	return value === 'X' ? <XMark ghost={ghost} /> : <OMark ghost={ghost} />;
}
