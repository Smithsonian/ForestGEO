const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

/** @type {import('next').NextConfig} */
const nextConfig = withBundleAnalyzer({
  experimental: {
    serverMinification: false,
    turbo: {
      resolveExtensions: ['.mdx', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json']
    }
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false };
    }

    config.module.rules.forEach(rule => {
      if (rule.use && (rule.use.loader === 'next-swc-loader' || rule.use.loader?.includes('next-swc-loader'))) {
        rule.exclude = [
          ...(rule.exclude || []),
          /node_modules[\\/]@mui[\\/]/, // Exclude MUI packages
          /node_modules[\\/]@mui[\\/]material[\\/]/, // Exclude MUI Material
          /node_modules[\\/]@mui[\\/]utils[\\/]/, // Exclude MUI Utils
          /node_modules[\\/]@mui[\\/]system[\\/]/, // Exclude MUI System
          /node_modules[\\/]@mui[\\/]private-theming[\\/]/ // Exclude MUI Private Theming
        ];
      }
    });

    // Your existing rules
    config.module.rules.push({
      test: /\.(js|ts|tsx|jsx)$/,
      exclude: /node_modules/
    });

    return config;
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  images: {
    unoptimized: true
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: 'build',
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
