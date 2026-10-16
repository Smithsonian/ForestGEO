import { defineConfig } from 'vitest/config';
import integrationConfig from './vitest.integration.config.mts';

const BENCHMARK_INCLUDE_GLOB = 'tests/benchmarks/**/*.benchmark.ts';
const BENCHMARK_TEST_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Opt-in benchmarks. Reuses the integration config (local-only env, Node, forks) but REPLACES its include list
 * (mergeConfig would union them and pull the whole integration suite in). No integration or unit include glob matches
 * the benchmark glob.
 */
// Not mergeConfig: it unions the `include` arrays, which would pull the whole integration suite into the benchmark run.
export default defineConfig({
  ...integrationConfig,
  test: {
    ...integrationConfig.test,
    include: [BENCHMARK_INCLUDE_GLOB],
    testTimeout: BENCHMARK_TEST_TIMEOUT_MS
  }
});
