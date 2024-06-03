/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverMinification: false,
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: "build",
  env: {
    AZURE_SQL_USER: process.env.AZURE_SQL_USER,
    AZURE_SQL_PASSWORD: process.env.AZURE_SQL_PASSWORD,
    AZURE_SQL_SERVER: process.env.AZURE_SQL_SERVER,
    AZURE_SQL_PORT: process.env.AZURE_SQL_PORT,
    AZURE_SQL_SCHEMA: process.env.AZURE_SQL_SCHEMA,
    AZURE_SQL_CATALOG_SCHEMA: process.env.AZURE_SQL_CATALOG_SCHEMA,
  },
}

module.exports = nextConfig
