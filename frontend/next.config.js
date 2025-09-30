/* eslint-disable @typescript-eslint/no-require-imports */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

/** @type {import('next').NextConfig} */
const nextConfig = withBundleAnalyzer({
  experimental: {
    serverMinification: false
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false };
    }
    config.resolve.mainFields = ['main', 'module', 'browser'];
    config.resolve.alias = {
      ...config.resolve.alias,
      '@mui/material/esm': '@mui/material',
      '@mui/utils/esm': '@mui/utils'
    };
    config.module.rules.push({
      test: /\.cy.(js|ts|tsx|jsx)$/,
      exclude: /node_modules/
    });

    return config;
  },
  turbopack: {
    resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json']
  },
  // Type checking and linting enabled for production builds
  // These should NEVER be disabled - they catch critical errors before deployment
  eslint: {
    ignoreDuringBuilds: false
  },
  typescript: {
    ignoreBuildErrors: false
  },
  images: {
    unoptimized: true
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: 'build'
  // SECURITY: Do NOT add environment variables here unless they need to be public
  // Variables added to the 'env' block are inlined into the client bundle at build time
  // This means they are visible in browser DevTools and the JavaScript source
  //
  // For server-only secrets (database credentials, API keys):
  //   - Keep them in .env.local (already done ✓)
  //   - Access via process.env in Server Components and Route Handlers
  //
  // For client-exposed values:
  //   - Add NEXT_PUBLIC_ prefix in .env.local
  //   - Next.js automatically inlines these at build time
  //
  // See: https://nextjs.org/docs/app/building-your-application/configuring/environment-variables
});

module.exports = nextConfig;
