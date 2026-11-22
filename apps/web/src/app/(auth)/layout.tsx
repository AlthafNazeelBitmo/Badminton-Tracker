import { LogoMark, Wordmark } from '@/components/logo';

/**
 * Sign-in and registration: a split screen, as in most modern product sign-ins — the
 * form on a quiet surface, and a brand panel showing what the product is for. The panel
 * is decoration and drops away on small screens, where the form is all that matters.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Wordmark />
        <div className="flex flex-1 items-center justify-center py-10">{children}</div>
        <p className="text-xs text-ink-muted">
          Your match data is private by default and is never shown to anyone else.
        </p>
      </div>

      <aside
        aria-hidden="true"
        className="relative m-2 hidden overflow-hidden rounded-2xl bg-[#0b0c0e] text-white lg:block"
      >
        <CourtLines />
        <div className="pointer-events-none absolute -right-24 -top-24 size-[480px] rounded-full bg-[radial-gradient(closest-side,rgb(205_242_75/0.22),transparent)]" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-[radial-gradient(closest-side,rgb(96_165_250/0.12),transparent)]" />

        <div className="relative flex h-full flex-col justify-between p-12">
          <LogoMark className="size-10" />

          <PreviewCard />

          <div>
            <p className="max-w-md text-[34px] font-semibold leading-[1.1] tracking-[-0.03em]">
              Every rally recorded.
              <br />
              <span className="text-white/45">Every trend revealed.</span>
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/55">
              Log a match in twenty seconds. See your form, your rating and the opponents who have
              your number.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A badminton court's markings, drawn in perspective-free plan view as a texture. */
function CourtLines() {
  return (
    <svg
      viewBox="0 0 610 1340"
      className="absolute left-1/2 top-1/2 h-[135%] -translate-x-1/2 -translate-y-1/2 rotate-[24deg] opacity-[0.09]"
      fill="none"
      stroke="white"
      strokeWidth="4"
    >
      <rect x="2" y="2" width="606" height="1336" />
      <line x1="46" y1="2" x2="46" y2="1338" />
      <line x1="564" y1="2" x2="564" y2="1338" />
      <line x1="2" y1="78" x2="608" y2="78" />
      <line x1="2" y1="1262" x2="608" y2="1262" />
      <line x1="2" y1="472" x2="608" y2="472" />
      <line x1="2" y1="868" x2="608" y2="868" />
      <line x1="305" y1="2" x2="305" y2="472" />
      <line x1="305" y1="868" x2="305" y2="1338" />
      <line x1="2" y1="670" x2="608" y2="670" strokeWidth="8" />
    </svg>
  );
}

/** An illustrative slice of the dashboard, so the sign-in page shows the product. */
function PreviewCard() {
  const form = ['W', 'W', 'L', 'W', 'W', 'L', 'W', 'W'];
  return (
    <div className="mx-auto w-full max-w-sm rotate-[-2deg] rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-5">
        <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90">
          <circle
            cx="46"
            cy="46"
            r="40"
            fill="none"
            stroke="rgb(255 255 255 / 0.1)"
            strokeWidth="9"
          />
          <circle
            cx="46"
            cy="46"
            r="40"
            fill="none"
            stroke="#cdf24b"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 40}
            strokeDashoffset={2 * Math.PI * 40 * 0.32}
          />
        </svg>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/50">
            Win rate
          </p>
          <p className="text-4xl font-semibold tracking-[-0.04em]">68%</p>
          <p className="mt-1 text-xs text-[#cdf24b]">↗ 9.4 pts this month</p>
        </div>
      </div>
      <div className="mt-5 flex gap-1">
        {form.map((result, index) => (
          <span
            key={index}
            className={
              result === 'W'
                ? 'flex size-6 items-center justify-center rounded-md bg-emerald-400/15 text-[11px] font-bold text-emerald-300'
                : 'flex size-6 items-center justify-center rounded-md bg-rose-400/15 text-[11px] font-bold text-rose-300'
            }
          >
            {result}
          </span>
        ))}
      </div>
    </div>
  );
}
