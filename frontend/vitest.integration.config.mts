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

    // Integration tests: top-level folder, colocated lib/provisioning tests,
    // and admin provisioning endpoint unit tests (no live DB needed, but they
    // must run in Node — not jsdom — because the route uses Node-only modules)
    include: ['tests/integration/**/*.test.ts', 'lib/provisioning/**/*.test.ts', 'lib/ctfs-export/**/*.test.ts', 'app/api/admin/provision/**/*.test.ts'],

    // SAFETY: ConnectionManager connects via getPoolMonitorInstance(), whose
    // sqlConfig.host = process.env.AZURE_SQL_SERVER — which points at PRODUCTION
    // Azure MySQL by default. Force it to the local docker container for ALL
    // integration tests so a ConnectionManager-driven test can never write to a
    // real database. These are the documented local docker creds (root /
    // testpassword / 3306), not secrets. Tests using TEST_DB_* are unaffected.
    env: {
      AZURE_SQL_SERVER: '127.0.0.1',
      AZURE_SQL_USER: 'root',
      AZURE_SQL_PASSWORD: 'testpassword',
      AZURE_SQL_PORT: '3306'
    },

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
