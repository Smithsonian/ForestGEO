/** @type {import('next').NextConfig} */
const nextConfig = {
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: 'standalone',
  reactStrictMode: true,
  distDir: "build",
}

module.exports = nextConfig
