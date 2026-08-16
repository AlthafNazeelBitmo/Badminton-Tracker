'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { loginSchema } from '@badminton/contracts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Button, Card, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const { run, isPending, error } = useAction(async () => {
    // Validated client-side with the same schema the API uses, so the rules cannot
    // disagree — but the server remains the authority.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setClientErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
      throw Object.assign(new Error('Check the form.'), { handled: true });
    }

    setClientErrors({});
    await api.post('/auth/login', parsed.data);
    router.replace(next);
    router.refresh();
  });

  const fieldErrors = { ...clientErrors, ...(error?.fieldErrors ?? {}) };

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-secondary">Pick up where your last session left off.</p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        noValidate
      >
        <Field label="Email" htmlFor="email" error={fieldErrors.email} required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        {error && Object.keys(error.fieldErrors).length === 0 ? (
          <p role="alert" className="text-sm text-loss">
            {error.message}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isPending}>
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-ink-secondary">
        No account yet?{' '}
        <Link
          href="/register"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          Create one
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
