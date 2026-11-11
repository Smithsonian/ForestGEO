import { describe, expect, it, vi } from 'vitest';
import type { PoolOptions } from 'mysql2/promise';

const constructedConfigs = vi.hoisted(() => [] as PoolOptions[]);

// tests/mocks/db-mocks.ts (loaded globally via setup.ts) replaces this entire
// module with a fake getPoolMonitorInstance that bypasses the real sqlConfig.
// Unmock it here so this file exercises the real singleton under test.
vi.unmock('@/lib/db/poolmonitorsingleton');

vi.mock('@/lib/db/poolmonitor', () => ({
  PoolMonitor: class {
    constructor(config: PoolOptions) {
      constructedConfigs.push(config);
    }
  }
}));

import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';

describe('getPoolMonitorInstance', () => {
  it('constructs the runtime pool with the UTC driver timezone', () => {
    getPoolMonitorInstance();

    expect(constructedConfigs, 'the singleton constructs exactly one PoolMonitor').toHaveLength(1);
    expect(
      constructedConfigs[0].timezone,
      "every toISOString().slice(0, 10) read of a DATE column (config/editplan/*, app/api/errors/explorer) relies on the pool decoding as UTC; without 'Z' the App Service host offset shifts the day"
    ).toBe('Z');
    expect(constructedConfigs[0].charset).toBe('utf8mb4_0900_ai_ci');
  });

  it('reuses the same PoolMonitor on repeat calls', () => {
    const first = getPoolMonitorInstance();
    const second = getPoolMonitorInstance();

    expect(second).toBe(first);
    expect(constructedConfigs).toHaveLength(1);
  });
});
