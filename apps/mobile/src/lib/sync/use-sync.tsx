import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { countFailed, countPending, millisecondsUntilNextAttempt } from './outbox';
import { sync, type SyncOutcome } from './engine';
import { isOnline, watchConnectivity } from './connectivity';

/**
 * Sync, as the interface sees it.
 *
 * The app syncs on its own at the four moments something has actually changed — launch,
 * returning to the foreground, regaining connectivity, and when a queued entry's backoff
 * expires — rather than on a timer. A timer would wake the radio on a schedule that has
 * nothing to do with whether there is anything to send, which on a phone is a battery
 * cost paid for nothing.
 */

interface SyncValue {
  /** Queued writes not yet accepted. Drives the "not synced" indicator. */
  pending: number;
  /** Writes the server refused. These need a person to decide what happens. */
  failed: number;
  online: boolean;
  syncing: boolean;
  lastOutcome: SyncOutcome | null;
  /** Runs a sync now. Used by pull-to-refresh and after recording a match. */
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  /** False while signed out: there is no session to sync against. */
  enabled: boolean;
}): React.JSX.Element {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<SyncOutcome | null>(null);

  const backoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const readCounts = useCallback(async () => {
    const [queued, rejected] = await Promise.all([countPending(), countFailed()]);
    if (!mounted.current) return;
    setPending(queued);
    setFailed(rejected);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setSyncing(true);
    try {
      const outcome = await sync();
      if (mounted.current) setLastOutcome(outcome);
    } finally {
      if (mounted.current) setSyncing(false);
      await readCounts();
    }
  }, [enabled, readCounts]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (backoffTimer.current) clearTimeout(backoffTimer.current);
    };
  }, []);

  // Launch, and whenever a session begins.
  useEffect(() => {
    if (!enabled) return;
    void isOnline().then(setOnline);
    void refresh();
  }, [enabled, refresh]);

  // Returning to the foreground. Someone who has been away has often been somewhere with
  // no signal, which is exactly when the queue has something waiting.
  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });

    return () => subscription.remove();
  }, [enabled, refresh]);

  // Regaining connectivity. The moment worth reacting to, and the reason the sports-hall
  // case works at all: the queue drains as you walk out to the car park.
  useEffect(() => {
    if (!enabled) return;

    return watchConnectivity((connected) => {
      setOnline(connected);
      if (connected) void refresh();
    });
  }, [enabled, refresh]);

  /**
   * One timer, armed for the next entry's backoff and re-armed after each attempt.
   *
   * Deliberately not a polling interval. Nothing changes between attempts, so waking to
   * check would cost battery for no information.
   */
  useEffect(() => {
    if (!enabled || pending === 0) return;

    let cancelled = false;

    void (async () => {
      const wait = await millisecondsUntilNextAttempt();
      if (cancelled || wait === null) return;

      backoffTimer.current = setTimeout(
        () => {
          if (!cancelled) void refresh();
        },
        Math.max(wait, 1_000),
      );
    })();

    return () => {
      cancelled = true;
      if (backoffTimer.current) clearTimeout(backoffTimer.current);
    };
  }, [enabled, pending, lastOutcome, refresh]);

  useEffect(() => {
    if (enabled) void readCounts();
  }, [enabled, readCounts]);

  const value = useMemo<SyncValue>(
    () => ({ pending, failed, online, syncing, lastOutcome, refresh }),
    [pending, failed, online, syncing, lastOutcome, refresh],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside a SyncProvider.');
  return value;
}
