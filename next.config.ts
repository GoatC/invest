import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app talks to Supabase only; no remote images or external fonts are loaded.
  poweredByHeader: false,
  experimental: {
    // A CSV import sends the whole statement to the server, which checks it again. Vercel caps a
    // request at 4.5 MB; the import page refuses larger files first (lib/csv/limits.ts).
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
