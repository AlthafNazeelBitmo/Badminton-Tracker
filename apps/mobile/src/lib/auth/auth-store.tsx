import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedUser, SessionResponse } from '@badminton/contracts';
import { onSessionLost, request } from '../api/client';
import { clearTokens, readTokens, saveTokens } from '../storage/secure-tokens';
import { clearLocalData } from '../db/database';
import { resetSyncCursor } from '../sync/engine';

/**
 * Who is signed in.
 *
 * The app starts in `loading` while the keychain is read, and the router waits for that
 * rather than guessing. Rendering the sign-in screen first and replacing it a beat later
 * is a visible flash on every cold start, and it is the sort of thing that makes an app
 * feel unfinished.
 */

type Status = 'loading' | 'signed-in' | 'signed-out';

interface AuthValue {
  status: Status;
  user: AuthenticatedUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  timeZone: string;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const applySession = useCallback(async (session: SessionResponse) => {
    // The API returns tokens in the body only for a native client. Their absence means
    // the request went out without identifying itself as one, which would leave the app
    // apparently signed in and unable to make a single authenticated request.
    if (!session.tokens) {
      throw new Error('The server did not return session tokens for this client.');
    }

    await saveTokens(session.tokens);
    setUser(session.user);
    setStatus('signed-in');
  }, []);

  const forgetSession = useCallback(async () => {
    // Local data goes with the session. The next person to use this device must not be
    // able to read the previous one's match history out of a cache that was merely hidden.
    await clearTokens();
    await clearLocalData();
    setUser(null);
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const tokens = await readTokens();
      if (!tokens) {
        if (!cancelled) setStatus('signed-out');
        return;
      }

      try {
        // A stored token is a claim, not proof. The server decides whether the account
        // still exists and is still allowed in.
        const session = await request<{ user: AuthenticatedUser }>('/auth/me');
        if (!cancelled) {
          setUser(session.user);
          setStatus('signed-in');
        }
      } catch {
        // Offline at launch is the common case, and it must not sign anyone out — the
        // whole point of the app is that it works without a connection. The client
        // clears tokens itself when the server actually rejects them.
        const stillHeld = await readTokens();
        if (cancelled) return;
        setStatus(stillHeld ? 'signed-in' : 'signed-out');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Fired when a refresh fails: the session ended for a reason the user did not choose.
    return onSessionLost(() => {
      void forgetSession();
    });
  }, [forgetSession]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      signIn: async (email, password) => {
        const session = await request<SessionResponse>('/auth/login', {
          method: 'POST',
          body: { email, password },
          anonymous: true,
        });
        await applySession(session);
      },
      register: async (input) => {
        const session = await request<SessionResponse>('/auth/register', {
          method: 'POST',
          body: input,
          anonymous: true,
        });
        await applySession(session);
      },
      signOut: async () => {
        try {
          await request('/auth/logout', { method: 'POST' });
        } catch {
          // Signing out has to work offline too. The refresh token is discarded locally
          // either way, and the server's copy expires on its own.
        }
        await resetSyncCursor().catch(() => undefined);
        await forgetSession();
      },
    }),
    [status, user, applySession, forgetSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider.');
  return value;
}
