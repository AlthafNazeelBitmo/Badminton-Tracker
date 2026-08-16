'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/hooks';
import { api } from '@/lib/api';
import { ThemeToggle } from './theme-provider';
import { Button, Spinner, cx } from './ui';

/**
 * Navigation, ordered by how often it is used rather than alphabetically.
 *
 * The five `primary` entries are the mobile bottom bar. "Record" sits in the middle
 * because it is the reason the app is open: finish match, open app, record, done.
 */
interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Appears in the mobile bottom bar. Exactly five, or the grid breaks. */
  primary?: boolean;
  /** Raised treatment on the bottom bar, for the one action that matters most. */
  emphasis?: boolean;
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '📊', primary: true },
  { href: '/matches', label: 'Matches', icon: '🏸', primary: true },
  { href: '/record', label: 'Record', icon: '＋', primary: true, emphasis: true },
  { href: '/analytics', label: 'Analytics', icon: '📈', primary: true },
  { href: '/opponents', label: 'Opponents', icon: '👥', primary: true },
  { href: '/venues', label: 'Venues', icon: '📍' },
  { href: '/records', label: 'Records', icon: '🏆' },
  { href: '/goals', label: 'Goals', icon: '🎯' },
  { href: '/calendar', label: 'Calendar', icon: '🗓️' },
  { href: '/players', label: 'Players', icon: '📇' },
  { href: '/import', label: 'Import & export', icon: '↔️' },
  { href: '/profile', label: 'Profile', icon: '⚙️' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isSignedOut } = useSession();

  useEffect(() => {
    if (isSignedOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isSignedOut, pathname, router]);

  if (isLoading || (!user && !isSignedOut)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6 text-ink-muted" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (!user) return null;

  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Even if the request fails, the local view of the session must not persist.
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span aria-hidden="true" className="text-lg">
            🏸
          </span>
          <span className="font-semibold tracking-tight">Badminton</span>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
                    )}
                  >
                    <span aria-hidden="true" className="w-5 text-center">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-line p-3">
          <div className="mb-2 min-w-0 px-1">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true">🏸</span>
          Badminton
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main id="main" className="pb-nav lg:ml-60 lg:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV.filter((item) => item.primary).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-[4.25rem] flex-col items-center justify-center gap-1 text-[11px]',
                    active ? 'text-accent' : 'text-ink-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'text-lg leading-none',
                      // The record action is visually raised so it is reachable without
                      // reading the labels.
                      item.emphasis
                        ? 'flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink'
                        : '',
                    )}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Secondary links, surfaced on the dashboard since they are off the mobile bar. */
export function SecondaryNav() {
  return (
    <nav aria-label="More" className="lg:hidden">
      <ul className="flex flex-wrap gap-2">
        {NAV.filter((item) => !item.primary).map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-secondary"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
