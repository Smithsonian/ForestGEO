/* eslint-disable @typescript-eslint/no-require-imports */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

/** @type {import('next').NextConfig} */
const nextConfig = withBundleAnalyzer({
  experimental: {
    serverMinification: false,
    // Optimize for runtime speed over bundle size
    optimizePackageImports: ['@mui/material', '@mui/icons-material', '@mui/joy', '@mui/lab'],
    // Note: optimizeCss requires 'critters' package
    // Install with: npm install critters
    // Then uncomment: optimizeCss: true
    // Increase body size limit for large measurement file uploads
    serverActions: {
      bodySizeLimit: '10mb'
    }
  },
  // Compiler optimizations for faster runtime (larger bundle)
  compiler: {
    // Remove console logs in production for slight speed boost
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false
  },
  // Production optimizations
  productionBrowserSourceMaps: false, // Faster builds, smaller deployment
  // Aggressive caching strategy
  generateBuildId: async () => {
    // Use timestamp for cache busting only when needed
    return process.env.BUILD_ID || `build-${Date.now()}`;
  },
  webpack: (config, { isServer, dev }) => {
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

    // Production-only optimizations for speed over size (client-side only)
    if (!dev && !isServer) {
      // Aggressive chunk splitting for better caching (client bundles only)
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        runtimeChunk: 'single',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            // Separate vendor chunks for long-term caching
            mui: {
              test: /[\\/]node_modules[\\/](@mui|@emotion)[\\/]/,
              name: 'mui',
              priority: 40,
              reuseExistingChunk: true
            },
            datagrid: {
              test: /[\\/]node_modules[\\/]@mui[\\/]x-data-grid/,
              name: 'datagrid',
              priority: 50,
              reuseExistingChunk: true
            },
            recharts: {
              test: /[\\/]node_modules[\\/]recharts/,
              name: 'recharts',
              priority: 45,
              reuseExistingChunk: true
            },
            // Bundle frequently used utilities together
            utils: {
              test: /[\\/]node_modules[\\/](date-fns|moment|lodash|uuid)[\\/]/,
              name: 'utils',
              priority: 35,
              reuseExistingChunk: true
            },
            // Default vendor chunk for other dependencies
            defaultVendors: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              priority: 30,
              reuseExistingChunk: true
            },
            // Application code chunks
            commons: {
              name: 'commons',
              minChunks: 2,
              priority: 20,
              reuseExistingChunk: true
            }
          },
          // Increase size limits since deployment size isn't a concern
          maxInitialRequests: 30,
          maxAsyncRequests: 30,
          minSize: 20000,
          maxSize: 244000 // ~240KB per chunk for optimal HTTP/2 multiplexing
        }
      };

      // Minimize only what's necessary (faster builds, slightly larger bundles)
      if (config.optimization.minimizer) {
        config.optimization.minimizer.forEach(minimizer => {
          if (minimizer.constructor.name === 'TerserPlugin') {
            minimizer.options = {
              ...minimizer.options,
              terserOptions: {
                ...minimizer.options?.terserOptions,
                compress: {
                  ...minimizer.options?.terserOptions?.compress,
                  // Optimize for speed, not size
                  passes: 1, // Fewer passes = faster minification
                  pure_getters: true,
                  unsafe: false,
                  unsafe_comps: false,
                  inline: 2 // Aggressive inlining for speed
                },
                mangle: {
                  safari10: true
                },
                format: {
                  comments: false,
                  ascii_only: true
                }
              }
            };
          }
        });
      }
    }

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
