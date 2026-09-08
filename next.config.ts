import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Build must fail on type errors. Never set this to true.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Build must fail on lint errors. Never set this to true.
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
