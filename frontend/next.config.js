/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const nextConfig = withBundleAnalyzer({
  webpack: (config, { isServer }) => {
    // Don't include Monaco Editor Webpack Plugin on the server
    if (!isServer) {
      config.plugins.push(
        new MonacoWebpackPlugin({
          languages: ['mysql'], // Define the languages you want to support
          filename: 'static/[name].worker.js'
        })
      );
    }

    return config;
  },
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
