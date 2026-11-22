import { cx } from '@/lib/cx';

/**
 * The mark: a shuttlecock seen from above-side — a cork and a fanned skirt — on a volt
 * tile. Drawn as SVG so it is crisp at every size and themable.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-[10px] bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.15)]',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[66%]"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Feather skirt, widening away from the cork. */}
        <path d="M9.9 14.6 5.6 4.2M14.1 14.6l4.3-10.4M12 14.6V3.6" strokeWidth="1.7" />
        <path d="M5.6 4.2C9.6 3 14.4 3 18.4 4.2" strokeWidth="1.7" />
        <path d="M7.5 9.2c3-.8 6-.8 9 0" strokeWidth="1.4" opacity="0.6" />
        {/* Cork. */}
        <path d="M8.9 15.2h6.2a3.1 3.1 0 0 1-6.2 0Z" fill="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
        Badminton<span className="text-ink-muted"> Tracker</span>
      </span>
    </span>
  );
}
