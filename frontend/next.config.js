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
  logging: {
    fetches: {
      fullUrl: true
    }
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: 'build',
  images: {
    unoptimized: true // since images are served from public directory
  },
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AZURE_SQL_USER: process.env.AZURE_SQL_USER,
    AZURE_SQL_PASSWORD: process.env.AZURE_SQL_PASSWORD,
    AZURE_SQL_SERVER: process.env.AZURE_SQL_SERVER,
    AZURE_SQL_PORT: process.env.AZURE_SQL_PORT,
    AZURE_SQL_SCHEMA: process.env.AZURE_SQL_SCHEMA,
    AZURE_SQL_CATALOG_SCHEMA: process.env.AZURE_SQL_CATALOG_SCHEMA,
    FG_PAT: process.env.FG_PAT,
    OWNER: process.env.OWNER,
    REPO: process.env.REPO,
    AZURE_AD_CLIENT_SECRET: process.env.NODE_ENV === 'production' ? process.env.AZURE_AD_CLIENT_SECRET : process.env.AZURE_AD_DEVELOPMENT_CLIENT_SECRET,
    AZURE_AD_CLIENT_ID: process.env.NODE_ENV === 'production' ? process.env.AZURE_AD_CLIENT_ID : process.env.AZURE_AD_DEVELOPMENT_CLIENT_ID,
    AZURE_AD_TENANT_ID: process.env.NODE_ENV === 'production' ? process.env.AZURE_AD_TENANT_ID : process.env.AZURE_AD_DEVELOPMENT_TENANT_ID,
  }
});

module.exports = nextConfig;
