'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Contact,
  CornerDownLeft,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Swords,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useSession } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Avatar, Kbd, Spinner, cx } from './ui';
import { LogoMark, Wordmark } from './logo';

/**
 * Navigation, grouped by intent and ordered by how often it is used.
 *
 * The `primary` entries are the mobile bottom bar. "Record" sits in the middle because
 * it is the reason the app is open: finish match, open app, record, done.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'Play' | 'Analyse' | 'Manage';
  /** Single-key shortcut, shown in the command palette and sidebar tooltips. */
  key?: string;
  /** Appears in the mobile bottom bar. Exactly five, or the grid breaks. */
  primary?: boolean;
  /** Raised treatment on the bottom bar, for the one action that matters most. */
  emphasis?: boolean;
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Play', key: 'D', primary: true },
  { href: '/matches', label: 'Matches', icon: ListOrdered, group: 'Play', key: 'M', primary: true },
  {
    href: '/record',
    label: 'Record',
    icon: Plus,
    group: 'Play',
    key: 'R',
    primary: true,
    emphasis: true,
  },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, group: 'Play', key: 'C' },
  { href: '/goals', label: 'Goals', icon: Target, group: 'Play', key: 'G' },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    group: 'Analyse',
    key: 'A',
    primary: true,
  },
  {
    href: '/opponents',
    label: 'Opponents',
    icon: Swords,
    group: 'Analyse',
    key: 'O',
    primary: true,
  },
  { href: '/records', label: 'Records', icon: Trophy, group: 'Analyse' },
  { href: '/venues', label: 'Venues', icon: MapPin, group: 'Analyse' },
  { href: '/players', label: 'Players', icon: Contact, group: 'Manage', key: 'P' },
  { href: '/import', label: 'Import & export', icon: ArrowLeftRight, group: 'Manage' },
  { href: '/profile', label: 'Settings', icon: Settings, group: 'Manage', key: ',' },
];

const GROUPS = ['Play', 'Analyse', 'Manage'] as const;

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** True when a keypress belongs to a text field and must not trigger a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, isSignedOut } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (isSignedOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isSignedOut, pathname, router]);

  // ⌘K / Ctrl+K opens the palette anywhere; single letters jump between pages, as in
  // Linear and GitHub — but never while typing into a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const item = NAV.find(
        (entry) => entry.key && entry.key.toLowerCase() === event.key.toLowerCase(),
      );
      if (item && !paletteOpen) router.push(item.href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, router]);

  if (isLoading || (!user && !isSignedOut)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <LogoMark className="size-10 animate-pulse" />
        <Spinner className="h-5 w-5 text-ink-muted" />
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-surface-sunken lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/" aria-label="Dashboard">
            <Wordmark />
          </Link>
        </div>

        <div className="space-y-2 px-3">
          <Link
            href="/record"
            className="group flex h-10 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.1)] transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
            Record match
            <Kbd className="ml-auto border-black/10 bg-black/5 text-accent-ink/70">R</Kbd>
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-[13px] text-ink-muted shadow-card transition-colors hover:border-line-strong hover:text-ink-secondary"
          >
            <Search className="size-4" aria-hidden="true" />
            Search or jump to…
            <span className="ml-auto flex gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>

        <nav aria-label="Main" className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => (
            <div key={group} className="mb-4">
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted/80">
                {group}
              </p>
              <ul className="space-y-px">
                {NAV.filter((item) => item.group === group && !item.emphasis).map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors',
                          active
                            ? 'bg-surface-raised font-medium text-ink shadow-card ring-1 ring-line dark:bg-surface-overlay'
                            : 'text-ink-secondary hover:bg-ink/[0.04] hover:text-ink',
                        )}
                      >
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="absolute -left-3 top-2 h-5 w-1 rounded-r-full bg-accent"
                          />
                        ) : null}
                        <Icon
                          className={cx(
                            'size-[17px]',
                            active ? 'text-ink' : 'text-ink-muted group-hover:text-ink-secondary',
                          )}
                          strokeWidth={active ? 2.2 : 1.8}
                          aria-hidden="true"
                        />
                        {item.label}
                        {item.key ? (
                          <Kbd className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                            {item.key}
                          </Kbd>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <UserMenu name={user.name} email={user.email} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/70 bg-surface-sunken/80 px-4 backdrop-blur-xl lg:hidden">
        <Link href="/" aria-label="Dashboard">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-ink/[0.05]"
          >
            <Search className="size-5" />
          </button>
          <Link href="/profile" aria-label="Settings">
            <Avatar name={user.name} size="sm" />
          </Link>
        </div>
      </header>

      {/* Content: an inset panel on desktop, as in Linear — the chrome frames the work. */}
      <main id="main" className="pb-nav lg:py-2 lg:pl-[248px] lg:pr-2">
        <div className="min-h-[calc(100dvh-1rem)] lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:shadow-card">
          <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9 animate-in">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface-raised/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV.filter((item) => item.primary).map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex h-[4.25rem] flex-col items-center justify-center gap-1 text-[10.5px] font-medium',
                    active ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {item.emphasis ? (
                    // The record action is raised so it is reachable without reading.
                    <span className="-mt-5 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-glow ring-4 ring-surface-raised">
                      <Icon className="size-6" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  ) : (
                    <span
                      className={cx(
                        'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                        active ? 'bg-accent-soft text-accent-text' : '',
                      )}
                    >
                      <Icon
                        className="size-5"
                        strokeWidth={active ? 2.2 : 1.8}
                        aria-hidden="true"
                      />
                    </span>
                  )}
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSignOut={signOut}
      />
    </div>
  );
}

function UserMenu({
  name,
  email,
  onSignOut,
}: {
  name: string;
  email: string;
  onSignOut: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <div className="space-y-3 border-t border-line p-3">
      <div
        role="group"
        aria-label="Theme"
        className="grid grid-cols-3 gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5"
      >
        {themes.map((option) => {
          const Icon = option.icon;
          const active = mounted && theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(option.value)}
              title={option.label}
              className={cx(
                'flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                active ? 'bg-surface-sunken text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 px-1">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{name}</p>
          <p className="truncate text-[11px] text-ink-muted">{email}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * ⌘K: every destination and action, filtered as you type. Arrow keys move, Enter goes.
 * The standard of every serious product UI, and the fastest way around for keyboard users.
 */
function CommandPalette({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () => [
      ...NAV.map((item) => ({
        id: item.href,
        label: item.href === '/record' ? 'Record a match' : `Go to ${item.label}`,
        icon: item.icon,
        section: item.href === '/record' ? 'Actions' : 'Navigation',
        hint: item.key,
        run: () => router.push(item.href),
      })),
      {
        id: 'light',
        label: 'Switch to light theme',
        icon: Sun,
        section: 'Theme',
        hint: undefined,
        run: () => setTheme('light'),
      },
      {
        id: 'dark',
        label: 'Switch to dark theme',
        icon: Moon,
        section: 'Theme',
        hint: undefined,
        run: () => setTheme('dark'),
      },
      {
        id: 'system',
        label: 'Use system theme',
        icon: Monitor,
        section: 'Theme',
        hint: undefined,
        run: () => setTheme('system'),
      },
      {
        id: 'signout',
        label: 'Sign out',
        icon: LogOut,
        section: 'Account',
        hint: undefined,
        run: onSignOut,
      },
    ],
    [router, setTheme, onSignOut],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? commands.filter((command) => command.label.toLowerCase().includes(needle))
      : commands;
    // Actions first, so "Record a match" is always one keystroke away.
    return [...list].sort((a, b) =>
      a.section === 'Actions' ? -1 : b.section === 'Actions' ? 1 : 0,
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const run = (position: number) => {
    const command = results[position];
    if (!command) return;
    onClose();
    command.run();
  };

  let lastSection = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-in w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-surface-overlay shadow-pop"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((value) => Math.min(results.length - 1, value + 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((value) => Math.max(0, value - 1));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            run(index);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] text-ink-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command or search…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `cmd-${results[index]!.id}` : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="palette-results" role="listbox" className="max-h-[360px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-ink-muted">No matching commands</li>
          ) : null}
          {results.map((command, position) => {
            const Icon = command.icon;
            const header = command.section !== lastSection ? command.section : null;
            lastSection = command.section;
            const active = position === index;
            return (
              <li key={command.id} role="presentation">
                {header ? (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                    {header}
                  </p>
                ) : null}
                <div
                  id={`cmd-${command.id}`}
                  role="option"
                  aria-selected={active}
                  onMouseMove={() => setIndex(position)}
                  onClick={() => run(position)}
                  className={cx(
                    'flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm',
                    active ? 'bg-ink/[0.06] text-ink' : 'text-ink-secondary',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {command.label}
                  <span className="ml-auto flex items-center gap-2">
                    {command.hint ? <Kbd>{command.hint}</Kbd> : null}
                    {active ? (
                      <CornerDownLeft className="size-3.5 text-ink-muted" aria-hidden="true" />
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Secondary links, surfaced on the dashboard since they are off the mobile bar. */
export function SecondaryNav() {
  return (
    <nav aria-label="More" className="lg:hidden">
      <p className="eyebrow mb-2">More</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {NAV.filter((item) => !item.primary).map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="card flex h-12 items-center gap-2.5 px-3 text-[13px] font-medium text-ink-secondary"
              >
                <Icon className="size-4 text-ink-muted" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
