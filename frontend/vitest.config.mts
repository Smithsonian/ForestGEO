import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['setup.ts'],
    css: {
      modules: {
        classNameStrategy: 'non-scoped'
      }
    },
    server: {
      deps: {
        // Inline all MUI packages to avoid ESM directory import issues
        inline: [/@mui\//]
      }
    },
    env: loadEnv(mode, process.cwd(), ''),
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    // Memory optimization: limit worker threads to prevent excessive memory usage
    pool: 'threads',
    poolOptions: {
      threads: {
        // Limit to 2 threads max to prevent memory exhaustion on 16GB systems
        maxThreads: 2,
        minThreads: 1,
        // Isolate each test file to prevent memory leaks between tests
        isolate: true
      }
    },
    // Exclude tests that require a live database connection
    exclude: [
      'node_modules/**',
      'tests/validation-framework/**',
      'tests/deduplication-merge-fix.test.ts',
      'tests/e2e/**',
      'tests/integration/**'
    ],
    // Strict timeout controls to prevent infinite loops
    testTimeout: 15000, // 15 seconds max per test
    hookTimeout: 10000, // 10 seconds max for hooks
    teardownTimeout: 10000, // 10 seconds max for teardown
    // Bail on first failure to catch issues early
    bail: 0, // Set to 1 to stop on first failure
    // Enforce timeouts even with fake timers
    fakeTimers: {
      // Ensure fake timers respect test timeouts
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Limit coverage worker threads to reduce memory usage
      maxConcurrency: 2,
      exclude: [
        'node_modules/**',
        'build/**',
        'public/**',
        'cypress/**',
        '**/*.d.ts',
        '**/*.config.*',
        'next-env.d.ts',
        'sampledata/**',
        'sqlscripting/**',
        'documentation/**'
      ],
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'config/**/*.{ts,tsx}', 'testing/**/*.ts'],
      thresholds: {
        global: {
          branches: 60,
          functions: 60,
          lines: 60,
          statements: 60
        }
      }
    }
  }
}));
