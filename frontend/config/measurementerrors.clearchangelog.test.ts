// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';

const SIGNED_IN_USER = 'signed-in.editor@forestgeo.test';
const REQUEST_SCOPE = { schema: 'forestgeo_testing', plotID: 1, censusID: 5, measurementID: 42, changedBy: SIGNED_IN_USER };
const COOKIE_SCOPE = { schema: 'forestgeo_other_site', plotID: 77, censusID: 4, user: 'someone.else@forestgeo.test' };
const TRANSACTION_ID = 'tx-clear-changelog';
const SKIP_CHANGELOG_MARKER = '/* skip_changelog */';
const IS_VALIDATED_FAILED = 0;
const CHANGELOG_FLUSH_SETTLE_MS = 20;

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    has: (name: string) => cookieJar.values.has(name),
    get: (name: string) => (cookieJar.values.has(name) ? { value: cookieJar.values.get(name) } : undefined)
  })
}));

import { flushTransactionChangelog, patchConnectionManager } from '@/lib/connectionlogger';
import { clearUnresolvedValidationErrors } from './measurementerrors';

/** The statements the database would see: whatever the logger lets through, in order. */
function buildDatabaseDouble() {
  const reached: string[] = [];
  let beforeImageRead = false;
  const manager = {
    executeQuery: async (sql: string): Promise<unknown> => {
      reached.push(sql);
      if (/FOR UPDATE/.test(sql)) return [{ CoreMeasurementID: REQUEST_SCOPE.measurementID, StemGUID: 7, isValidated: IS_VALIDATED_FAILED }];
      if (/^SELECT me\.ErrorCode/.test(sql.trim())) return [{ ErrorCode: '14', ErrorMessage: 'Measurement date falls outside the census range' }];
      if (/^DELETE mel/.test(sql.trim())) return { affectedRows: 1 };
      if (/^SELECT \* FROM/.test(sql)) {
        const image = [{ CoreMeasurementID: REQUEST_SCOPE.measurementID, IsValidated: beforeImageRead ? null : IS_VALIDATED_FAILED }];
        beforeImageRead = true;
        return image;
      }
      return { affectedRows: 1 };
    }
  };
  return { reached, manager };
}

describe('clearUnresolvedValidationErrors with the connection logger installed', () => {
  beforeEach(() => {
    cookieJar.values = new Map([
      ['schema', COOKIE_SCOPE.schema],
      ['user', COOKIE_SCOPE.user],
      ['plotID', String(COOKIE_SCOPE.plotID)],
      ['censusID', String(COOKIE_SCOPE.censusID)]
    ]);
  });

  it("marks the validation reset to skip the cookie-scoped changelog, so a cookie that differs from the request's scope is never read", async () => {
    const { reached, manager } = buildDatabaseDouble();
    patchConnectionManager(manager);

    await clearUnresolvedValidationErrors(manager as unknown as ConnectionManager, REQUEST_SCOPE, TRANSACTION_ID);
    flushTransactionChangelog(TRANSACTION_ID);
    await new Promise(resolve => setTimeout(resolve, CHANGELOG_FLUSH_SETTLE_MS));

    console.log('[clear changelog] statements that reached the database', JSON.stringify(reached, null, 2));
    const touchingCookieSchema = reached.filter(sql => sql.includes(COOKIE_SCOPE.schema));
    expect(touchingCookieSchema, 'nothing is read or written against the schema named by the cookie').toEqual([]);
    expect(
      reached.filter(sql => /^SELECT \* FROM/.test(sql)),
      'the logger read no before/after image, so it did not log the reset'
    ).toEqual([]);
    expect(
      reached.filter(sql => /INSERT INTO `forestgeo_testing`\.unifiedchangelog/.test(sql)),
      "exactly one changelog row reaches the database: Clear's own, which the logger does not re-log"
    ).toHaveLength(1);
    const reset = reached.find(sql => /SET IsValidated = NULL/.test(sql));
    expect(reset, 'the reset still runs, with the marker stripped before the database sees it').toBeDefined();
    expect(reset).not.toContain(SKIP_CHANGELOG_MARKER);
  });
});
