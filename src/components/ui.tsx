/** Small UI primitives: buttons, inputs, segmented controls, cards, spinner. */

import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type BtnVariant = 'primary' | 'ghost' | 'soft' | 'danger';

export function Button({
	variant = 'primary',
	size = 'md',
	loading,
	children,
	className = '',
	...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: BtnVariant;
	size?: 'md' | 'lg';
	loading?: boolean;
}) {
	return (
		<button
			className={`btn btn-${variant} btn-${size}${loading ? ' is-loading' : ''} ${className}`.trim()}
			disabled={rest.disabled || loading}
			{...rest}
		>
			{loading && <Spinner className="btn-spinner" />}
			<span>{children}</span>
		</button>
	);
}

export function Spinner({ className = '' }: { className?: string }) {
	return <span className={`spinner ${className}`} role="status" aria-label="Loading" />;
}

export function TextField({
	label,
	hint,
	error,
	maxLength = 20,
	...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
	const id = rest.id ?? rest.name ?? label.toLowerCase().replace(/\W+/g, '-');
	return (
		<div className="field">
			<label className="field-label" htmlFor={id}>
				{label}
			</label>
			<input
				id={id}
				className={`input${error ? ' input-error' : ''}`}
				maxLength={maxLength}
				autoComplete="off"
				{...rest}
			/>
			{hint && !error && <div className="field-hint">{hint}</div>}
			{error && (
				<div className="field-error" role="alert">
					{error}
				</div>
			)}
		</div>
	);
}

export interface SegmentOption<T extends string> {
	value: T;
	label: string;
	sub?: string;
	icon?: ReactNode;
}

export function Segmented<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
}: {
	options: SegmentOption<T>[];
	value: T;
	onChange: (v: T) => void;
	ariaLabel: string;
}) {
	return (
		<div className="segmented" role="radiogroup" aria-label={ariaLabel}>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					className={`segment${value === o.value ? ' segment-active' : ''}`}
					onClick={() => onChange(o.value)}
				>
					{o.icon && <span className="segment-icon">{o.icon}</span>}
					<span className="segment-label">{o.label}</span>
					{o.sub && <span className="segment-sub">{o.sub}</span>}
				</button>
			))}
		</div>
	);
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
	return <div className={`card ${className}`.trim()}>{children}</div>;
}
