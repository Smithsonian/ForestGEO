/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: "standalone",
  async redirects() {
    return [
      {
        source: '/',
        destination: '/login',
        permanent: false,
      },
    ]
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  output: 'standalone',
}

module.exports = nextConfig
