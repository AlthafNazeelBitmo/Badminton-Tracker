'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@badminton/contracts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { browserTimeZone } from '@/lib/format';
import { Button, Card, Field, Input } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const { run, isPending, error } = useAction(async () => {
    const parsed = registerSchema.safeParse({ ...form, timeZone: browserTimeZone() });
    if (!parsed.success) {
      setClientErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
      throw Object.assign(new Error('Check the form.'), { handled: true });
    }

    setClientErrors({});
    await api.post('/auth/register', parsed.data);
    router.replace('/record?welcome=1');
    router.refresh();
  });

  const fieldErrors = { ...clientErrors, ...(error?.fieldErrors ?? {}) };
  const update = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-ink-secondary">Start recording matches in under a minute.</p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        noValidate
      >
        <Field label="Name" htmlFor="name" error={fieldErrors.name} required>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={(event) => update('name')(event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={fieldErrors.email} required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={form.email}
            onChange={(event) => update('email')(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={fieldErrors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number. A memorable phrase works well.`}
          required
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => update('password')(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        {error && Object.keys(error.fieldErrors).length === 0 ? (
          <p role="alert" className="text-sm text-loss">
            {error.message}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isPending}>
          Create account
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-ink-secondary">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
