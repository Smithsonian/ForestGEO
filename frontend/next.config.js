/* eslint-disable @typescript-eslint/no-require-imports */
// SECURITY: never ship a production build with the e2e bypass enabled. NEXT_PUBLIC_E2E_TESTING gates
// both the e2e-upload-harness route and the e2e-credentials auth bypass, and because it is a
// NEXT_PUBLIC_ var it is inlined into the client bundle at build time — so a single mis-set
// production build would ship both live. Fail the build loudly instead of relying on process discipline.
if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_E2E_TESTING === 'true') {
  throw new Error(
    'Refusing to build: NEXT_PUBLIC_E2E_TESTING=true with NODE_ENV=production would ship the e2e upload harness and auth bypass to a live deployment. Unset NEXT_PUBLIC_E2E_TESTING for production builds.'
  );
}

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true'
});

// Enforce only the low-risk CSP directives that should not affect Next/MUI
// runtime behavior. Keep the broader policy report-only until its violations
// are observed and tightened.
const SECURITY_CSP_ENFORCED = ["base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'"].join('; ');

// Report-Only Content-Security-Policy. `script-src`/`style-src` intentionally
// allow 'unsafe-inline' (and 'unsafe-eval') because Next's runtime and
// MUI/emotion inject inline scripts/styles. `connect-src` whitelists the Azure
// Application Insights ingestion/live endpoints the browser telemetry beacons to.
const SECURITY_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.applicationinsights.azure.com https://*.in.applicationinsights.azure.com https://*.monitor.azure.com",
  "form-action 'self'"
].join('; ');

// Cypress component testing builds this webpack config through Next's own
// getNextJsBaseWebpackConfig, but @cypress/webpack-dev-server's findPagesDir()
// falls back to the PROJECT ROOT when a project has no pages/ or src/pages/
// (this app is app-router only). next-swc-loader then computes
// `isPageFile = filename.startsWith(pagesDir)`, so every file under the repo --
// all of node_modules included -- is compiled as a Next page and rejected for
// using `export * from '...'`, which MUI's esm barrels do.
//
// Next itself never sets pagesDir to the project root: find-pages-dir returns a
// real subdirectory or undefined. So `pagesDir === dir` identifies the
// Cypress-only value unambiguously, and this is a no-op during dev and build.
function neutralizeCypressPagesDir(config, dir) {
  if (!dir) return;

  const visit = rules => {
    for (const rule of rules || []) {
      if (!rule || typeof rule === 'string') continue;
      for (const use of [].concat(rule.use || [])) {
        const isSwcLoader = use && typeof use === 'object' && String(use.loader || '').includes('next-swc-loader');
        if (isSwcLoader && use.options && use.options.pagesDir === dir) {
          use.options.pagesDir = undefined;
        }
      }
      if (rule.oneOf) visit(rule.oneOf);
      if (rule.rules) visit(rule.rules);
    }
  };

  visit(config.module && config.module.rules);
}

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
  webpack: (config, { isServer, dev, dir }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false };
    }
    config.resolve.mainFields = ['main', 'module', 'browser'];
    // The `@mui/material/esm` -> `@mui/material` aliases that used to sit here were a
    // previous attempt at the `export *` build failure and were provably inert:
    // aliases match the REQUEST specifier, but source imports `@mui/material/utils`
    // and the `esm/` segment is introduced downstream by the package exports map,
    // which the alias never sees. MUI also sets `exports["./esm"] = null`, blocking
    // the aliased specifier outright. The real fix is neutralizeCypressPagesDir below.
    neutralizeCypressPagesDir(config, dir);
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
  // Cache headers for static assets (animations) + baseline security headers on every response.
  async headers() {
    return [
      {
        // Cache Lottie animation files for 1 year (immutable)
        source: '/animations/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable'
          }
        ]
      },
      {
        // Defense-in-depth response headers for the whole app. A narrow CSP
        // enforces anti-framing / anti-object / anti-base-tag protections now;
        // the broader CSP remains Report-Only so it can be tightened after
        // telemetry shows whether any runtime sources are still missing.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'Content-Security-Policy',
            value: SECURITY_CSP_ENFORCED
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: SECURITY_CSP_REPORT_ONLY
          }
        ]
      }
    ];
  },
  output: 'standalone',
  // db/sql/*.sql is loaded at runtime by lib/provisioning/sql-runner.ts via
  // path.join(process.cwd(), 'db/sql/...'). Next.js cannot statically detect
  // these dynamic paths, so we must tell file-tracing to include the folder in the
  // standalone bundle. Without this, provisioning fails on Azure with ENOENT.
  // The orchestrator bootstrap runs from instrumentation as well as from the
  // /api/admin/provision routes, so include the folder for both.
  outputFileTracingIncludes: {
    '/api/admin/provision/**/*': ['./db/sql/**/*'],
    '/instrumentation': ['./db/sql/**/*']
  },
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
