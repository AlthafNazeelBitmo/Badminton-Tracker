import Link from 'next/link';
import { LogoMark } from '@/components/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark className="size-12" />
      <p className="eyebrow mt-2">404</p>
      <h1 className="text-2xl font-semibold tracking-[-0.025em]">Out of bounds</h1>
      <p className="max-w-sm text-sm text-ink-secondary">
        That page does not exist. The link may be out of date, or the match may have been deleted.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-hover"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
