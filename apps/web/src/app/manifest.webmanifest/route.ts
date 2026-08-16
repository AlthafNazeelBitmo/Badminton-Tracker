/**
 * PWA manifest.
 *
 * Installing the app to a home screen matters here: the whole product depends on
 * recording a match in the twenty seconds after it finishes, and a tap on a home-screen
 * icon is meaningfully faster than finding a browser tab.
 */
export function GET(): Response {
  const manifest = {
    name: 'Badminton Tracker',
    short_name: 'Badminton',
    description: 'Track matches and see how your badminton is actually going.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fcfcfb',
    theme_color: '#2a78d6',
    icons: [
      {
        // An inline SVG keeps the install prompt working without a binary asset.
        src:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' +
              '<rect width="192" height="192" rx="42" fill="#2a78d6"/>' +
              '<text x="96" y="128" font-size="104" text-anchor="middle">🏸</text>' +
              '</svg>',
          ),
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Record a match',
        short_name: 'Record',
        url: '/record',
      },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
