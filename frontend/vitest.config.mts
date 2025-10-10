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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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
