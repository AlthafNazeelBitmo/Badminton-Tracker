import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <span aria-hidden="true" className="text-4xl">
        🏸
      </span>
      <h1 className="text-xl font-semibold tracking-tight">That page does not exist</h1>
      <p className="max-w-sm text-sm text-ink-secondary">
        The link may be out of date, or the match may have been deleted.
      </p>
      <Link
        href="/"
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
