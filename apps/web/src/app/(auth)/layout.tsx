export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true">🏸</span>
        Badminton Tracker
      </div>
      {children}
      <p className="max-w-sm text-center text-xs text-ink-muted">
        Your match data is private by default and is never shown to anyone else.
      </p>
    </div>
  );
}
