import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Badminton Tracker',
    template: '%s · Badminton Tracker',
  },
  description:
    'Track every match, session and opponent, and turn the raw results into an honest picture of how you are playing.',
  applicationName: 'Badminton Tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Badminton', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled: pinch-to-zoom is an accessibility feature, not a nuisance.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#08090a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-dvh bg-surface-sunken">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
