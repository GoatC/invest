import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app talks to Supabase only; no remote images or external fonts are loaded.
  poweredByHeader: false,
  // Once online (Vercel), no other site may frame the app, and the browser asks for nothing it does not use.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
  experimental: {
    // A CSV import sends the whole statement to the server, which checks it again. Vercel caps a
    // request at 4.5 MB; the import page refuses larger files first (lib/csv/limits.ts).
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
