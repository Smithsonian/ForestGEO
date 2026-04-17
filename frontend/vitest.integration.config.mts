import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Vitest configuration for integration tests.
 *
 * Integration tests require:
 * - Longer timeouts (database operations take time)
 * - No jsdom (pure Node.js environment)
 * - Sequential execution (database isolation)
 *
 * Prerequisites:
 *   docker compose up -d mysql
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Integration tests run in Node.js, not jsdom
    environment: 'node',

    // Only run integration tests
    include: ['tests/integration/**/*.test.ts'],

    // Extended timeouts for database operations
    testTimeout: 60000, // 60 seconds per test
    hookTimeout: 90000, // 90 seconds for beforeAll/afterAll (DB setup)
    teardownTimeout: 30000, // 30 seconds for cleanup

    // Run tests sequentially to avoid database conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in single process
        isolate: false // Share database connection between tests
      }
    },

    // Show verbose output for debugging
    reporters: ['verbose'],

    // Don't bail on first failure - run all tests
    bail: 0,

    // Restore mocks between tests
    restoreMocks: true,
    clearMocks: true,
    mockReset: true
  }
});
