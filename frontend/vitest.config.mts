import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['setup.ts'],
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
    // Prevent tests from running indefinitely
    testTimeout: 30000,
    hookTimeout: 30000,
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
