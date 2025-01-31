/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

const nextConfig = withBundleAnalyzer({
  experimental: {
    serverMinification: false,
    turbo: {
      resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json']
    }
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false }; // ✅ Fixes 'fs' module issue in client builds
    }

    return config;
  },
  logging: {
    fetches: {
      fullUrl: true
    }
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: 'build',
  images: {
    unoptimized: true // since images are served from the public directory
  },
  env: {
    AZURE_SQL_USER: process.env.AZURE_SQL_USER,
    AZURE_SQL_PASSWORD: process.env.AZURE_SQL_PASSWORD,
    AZURE_SQL_SERVER: process.env.AZURE_SQL_SERVER,
    AZURE_SQL_PORT: process.env.AZURE_SQL_PORT,
    AZURE_SQL_SCHEMA: process.env.AZURE_SQL_SCHEMA,
    AZURE_SQL_CATALOG_SCHEMA: process.env.AZURE_SQL_CATALOG_SCHEMA,
    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
    FG_PAT: process.env.FG_PAT,
    OWNER: process.env.OWNER,
    REPO: process.env.REPO
  }
});

module.exports = nextConfig;
