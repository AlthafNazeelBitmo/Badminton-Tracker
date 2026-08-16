'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { EM_DASH } from '@/lib/format';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// --- Buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90 border border-transparent',
  secondary: 'bg-surface-raised text-ink border border-line hover:border-line-strong',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-sunken border border-transparent',
  danger: 'bg-transparent text-loss border border-line hover:border-loss',
};

const buttonSizes: Record<ButtonSize, string> = {
  // Touch targets stay at least 44px tall on mobile, where this app is mostly used.
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

// --- Form controls ---------------------------------------------------------

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-loss" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {/* Announced to screen readers as soon as it appears, not only on focus. */}
      {error ? (
        <p role="alert" className="text-xs text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClasses =
  'w-full rounded border border-line bg-surface-raised px-3 text-ink placeholder:text-ink-muted ' +
  'focus:border-accent disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(controlClasses, 'h-11', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(controlClasses, 'h-11', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(controlClasses, 'py-2.5', className)} {...rest} />;
  },
);

// --- Layout ----------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={cx('card', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-secondary">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

// --- Status --------------------------------------------------------------

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'win' | 'loss' | 'accent' | 'warn';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-sunken text-ink-secondary border-line',
    win: 'bg-transparent text-win border-current',
    loss: 'bg-transparent text-loss border-current',
    accent: 'bg-accent-soft text-accent border-transparent',
    warn: 'bg-transparent text-warn border-current',
  };

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Win/loss indicator.
 *
 * Carries a letter as well as a colour: result is never communicated by colour alone,
 * which matters for colour-blind readers and in forced-colors mode.
 */
export function ResultBadge({ result }: { result: 'WIN' | 'LOSS' | 'DRAW' }) {
  const config = {
    WIN: { label: 'Win', short: 'W', tone: 'win' as const },
    LOSS: { label: 'Loss', short: 'L', tone: 'loss' as const },
    DRAW: { label: 'Draw', short: 'D', tone: 'neutral' as const },
  }[result];

  return (
    <Badge tone={config.tone}>
      <span aria-hidden="true" className="font-bold">
        {config.short}
      </span>
      <span className="sr-only">{config.label}</span>
    </Badge>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = '🏸',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="font-medium text-ink">Could not load this</p>
      <p className="max-w-sm text-sm text-ink-secondary">{error.message}</p>
      {onRetry ? (
        <Button onClick={onRetry} size="sm">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Skeleton placeholder sized like the content it replaces, to avoid layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded bg-surface-sunken', className)}
    />
  );
}

export function Stat({
  label,
  value,
  detail,
  delta,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  delta?: number | null;
  tone?: 'win' | 'loss' | 'neutral';
}) {
  const toneClass =
    tone === 'win' ? 'text-win' : tone === 'loss' ? 'text-loss' : 'text-ink';

  return (
    <div className="card card-pad">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cx('mt-1.5 text-stat font-semibold', toneClass)}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {detail ? <span className="text-ink-secondary">{detail}</span> : null}
        {delta !== undefined && delta !== null ? <Delta value={delta} /> : null}
      </div>
    </div>
  );
}

/**
 * Period-over-period change. The arrow and the sign both carry the direction, so the
 * colour is reinforcement rather than the only signal.
 */
export function Delta({ value, suffix = 'pts' }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.05) {
    return <span className="text-ink-muted">no change</span>;
  }

  const rising = value > 0;
  return (
    <span className={rising ? 'text-win' : 'text-loss'}>
      <span aria-hidden="true">{rising ? '↑' : '↓'}</span>{' '}
      {Math.abs(value).toFixed(1)} {suffix}
      <span className="sr-only">{rising ? ' increase' : ' decrease'}</span>
    </span>
  );
}

export function ValueOrDash({ children }: { children: ReactNode }) {
  return <>{children ?? EM_DASH}</>;
}

/** A compact bar showing progress toward a target, with the value stated in text. */
export function Meter({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const percentage = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percentage)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cx('h-2 w-full overflow-hidden rounded-sm bg-surface-sunken', className)}
    >
      <div
        className="h-full rounded-sm bg-accent transition-[width]"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
