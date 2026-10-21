import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app talks to Supabase only; no remote images or external fonts are loaded.
  poweredByHeader: false,
};

export default nextConfig;
