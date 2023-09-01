/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/home/none/0',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
