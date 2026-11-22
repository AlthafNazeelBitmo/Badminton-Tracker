'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from 'lucide-react';
import { EM_DASH } from '@/lib/format';

import { cx } from '@/lib/cx';

export { cx };

// --- Buttons ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Exported so links styled as buttons (`<Link className={buttonClass(...)}>`) look
 * exactly like buttons without a second copy of the classes.
 */
const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink border border-black/5 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.08)] hover:bg-accent-hover active:translate-y-px',
  secondary:
    'bg-surface-raised text-ink border border-line shadow-card hover:border-line-strong hover:bg-surface-overlay active:translate-y-px',
  ghost:
    'bg-transparent text-ink-secondary border border-transparent hover:bg-ink/[0.05] hover:text-ink',
  danger:
    'bg-surface-raised text-loss border border-line hover:border-loss/50 hover:bg-loss-soft active:translate-y-px',
};

const buttonSizes: Record<ButtonSize, string> = {
  // Touch targets stay at least 40px tall, and 44px for the main sizes on mobile.
  sm: 'h-9 px-3 text-[13px] rounded-lg',
  md: 'h-10 px-4 text-sm rounded-lg sm:h-10 max-sm:h-11',
  lg: 'h-12 px-5 text-[15px] rounded-xl',
};

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    buttonVariants[variant],
    buttonSizes[size],
    className,
  );
}

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
      className={buttonClass(variant, size, className)}
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
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70',
        className,
      )}
    />
  );
}

/** A keyboard shortcut hint, as in menus and command palettes. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-sunken px-1 font-sans text-[11px] font-medium text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
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
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
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
        <p role="alert" className="text-xs font-medium text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const controlClasses =
  'w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-card ' +
  'placeholder:text-ink-muted transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-line-strong focus:border-accent-text/60 focus:shadow-ring focus:outline-none ' +
  'focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-loss';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(controlClasses, 'h-11 sm:h-10', className)} {...rest} />;
  },
);

/** A native select styled as a control, with a drawn chevron in place of the OS arrow. */
export const selectClasses = cx(
  controlClasses,
  'appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9',
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")]",
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(selectClasses, 'h-11 sm:h-10', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(controlClasses, 'py-2.5', className)} {...rest} />;
});

/**
 * A segmented control: a small set of mutually exclusive options in one pill, as in
 * iOS and every modern dashboard's period picker.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  value: T | undefined;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-sunken p-0.5 scrollbar-none',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'shrink-0 rounded-md font-medium transition-[background-color,color,box-shadow] duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active
                ? 'bg-surface-raised text-ink shadow-lift dark:bg-surface-overlay'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-ink-secondary [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  );
}

// --- Identity ------------------------------------------------------------

const AVATAR_TINTS = [
  'bg-[#e8f0fe] text-[#1d4ed8] dark:bg-[#172554] dark:text-[#93c5fd]',
  'bg-[#fdf2e9] text-[#b45309] dark:bg-[#3a2410] dark:text-[#fcd34d]',
  'bg-[#ecfdf3] text-[#047857] dark:bg-[#0f2a21] dark:text-[#6ee7b7]',
  'bg-[#f5f0ff] text-[#6d28d9] dark:bg-[#24183f] dark:text-[#c4b5fd]',
  'bg-[#fff1f3] text-[#be123c] dark:bg-[#331820] dark:text-[#fda4af]',
  'bg-[#f0fdfa] text-[#0f766e] dark:bg-[#0d2b28] dark:text-[#5eead4]',
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Initials on a tint chosen from the name, so a person keeps their colour everywhere. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tint = AVATAR_TINTS[hash % AVATAR_TINTS.length];
  const sizes = {
    xs: 'size-5 text-[9px]',
    sm: 'size-7 text-[11px]',
    md: 'size-9 text-xs',
    lg: 'size-12 text-sm',
  };
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight',
        tint,
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
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
    neutral: 'bg-surface-sunken text-ink-secondary ring-line',
    win: 'bg-win-soft text-win ring-win/15',
    loss: 'bg-loss-soft text-loss ring-loss/15',
    accent: 'bg-accent-soft text-accent-text ring-accent-text/15',
    warn: 'bg-warn-soft text-warn ring-warn/15',
  };

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
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
export function ResultBadge({
  result,
  size = 'md',
}: {
  result: 'WIN' | 'LOSS' | 'DRAW';
  size?: 'sm' | 'md';
}) {
  const config = {
    WIN: { label: 'Win', short: 'W', className: 'bg-win-soft text-win ring-win/20' },
    LOSS: { label: 'Loss', short: 'L', className: 'bg-loss-soft text-loss ring-loss/20' },
    DRAW: {
      label: 'Draw',
      short: 'D',
      className: 'bg-surface-sunken text-ink-secondary ring-line',
    },
  }[result];

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-bold ring-1 ring-inset',
        size === 'sm' ? 'size-6 text-[11px]' : 'size-8 text-xs',
        config.className,
      )}
    >
      <span aria-hidden="true">{config.short}</span>
      <span className="sr-only">{config.label}</span>
    </span>
  );
}

/**
 * Recent form as a row of results, oldest on the left — the way form is shown in every
 * sports table. Each pill carries its letter, so colour is never the only signal.
 */
export function FormStrip({
  results,
  className,
}: {
  results: Array<'WIN' | 'LOSS' | 'DRAW'>;
  className?: string;
}) {
  return (
    <ol className={cx('flex items-center gap-1', className)} aria-label="Recent form, oldest first">
      {results.map((result, index) => (
        <li key={index}>
          <ResultBadge result={result} size="sm" />
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="relative flex size-14 items-center justify-center rounded-2xl border border-line bg-surface-sunken text-ink-secondary shadow-card [&_svg]:size-6"
      >
        <span className="absolute -right-1 -top-1 size-3 rounded-full bg-accent ring-4 ring-surface-raised" />
        {icon ?? <Sparkles />}
      </span>
      <div>
        <p className="font-semibold tracking-tight text-ink">{title}</p>
        {description ? (
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-loss-soft text-loss">
        !
      </span>
      <p className="font-semibold text-ink">Could not load this</p>
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
      className={cx(
        'relative overflow-hidden rounded-lg bg-surface-sunken',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-ink/[0.04] before:to-transparent',
        className,
      )}
    />
  );
}

export function Stat({
  label,
  value,
  detail,
  delta,
  tone,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  delta?: number | null;
  tone?: 'win' | 'loss' | 'neutral';
  icon?: ReactNode;
  className?: string;
}) {
  const toneClass = tone === 'win' ? 'text-win' : tone === 'loss' ? 'text-loss' : 'text-ink';

  return (
    <div className={cx('card card-pad flex flex-col', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {icon ? <span className="text-ink-muted [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p className={cx('tabular mt-3 text-stat', toneClass)}>{value}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-xs">
        {delta !== undefined && delta !== null ? <Delta value={delta} /> : null}
        {detail ? <span className="text-ink-muted">{detail}</span> : null}
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
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-sunken px-1.5 py-0.5 font-medium text-ink-muted">
        <Minus className="size-3" aria-hidden="true" /> no change
      </span>
    );
  }

  const rising = value > 0;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium',
        rising ? 'bg-win-soft text-win' : 'bg-loss-soft text-loss',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="tabular">
        {Math.abs(value).toFixed(1)} {suffix}
      </span>
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
  tone = 'accent',
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
  tone?: 'accent' | 'win';
}) {
  const percentage = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percentage)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cx('h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-700 ease-out',
          tone === 'win' ? 'bg-win' : 'bg-[var(--diverge-positive)]',
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

/**
 * A progress ring — the activity-ring idiom of fitness products, used for a single
 * proportion that deserves to be the hero of its card. The value is always printed in
 * the middle; the arc is reinforcement.
 */
export function Ring({
  value,
  size = 132,
  stroke = 12,
  label,
  children,
}: {
  /** 0–1, or null when unknown. */
  value: number | null;
  size?: number;
  stroke?: number;
  label: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.min(1, Math.max(0, value));

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--grid)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--diverge-positive)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
}
