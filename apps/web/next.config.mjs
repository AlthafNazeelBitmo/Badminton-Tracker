import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsSource = path.resolve(here, '../../packages/contracts/src/index.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The web app consumes the contracts package's TypeScript **source**, not its built
  // `dist`. The API keeps using `dist` (CommonJS, which is what Nest wants).
  //
  // Why: the package is a workspace symlink outside `apps/web`, so Next treats it as
  // first-party code and applies the React Fast Refresh transform to it. Applied to a
  // CommonJS file that injects `import.meta.webpackHot`, which is a parse error — and
  // one that breaks `next dev` while leaving `next build` working, so it only surfaces
  // when someone tries to develop. Pointing at the source sidesteps it entirely and
  // means the client picks up contract changes without a rebuild.
  transpilePackages: ['@badminton/contracts'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@badminton/contracts': contractsSource,
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      '@badminton/contracts': contractsSource,
    },
  },
  output: 'standalone',
  eslint: {
    // Linting runs as its own CI step against the whole workspace.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
