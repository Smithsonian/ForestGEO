import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

// ===== hoisted spies/fixtures used by mocks =====
const { loggerInfo, loggerError, mockAuth, mockAssertSchemaAccess } = vi.hoisted(() => {
  return {
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    mockAuth: vi.fn(),
    // typed to accept NextResponse | null so mockReturnValue(deniedResponse) is valid
    mockAssertSchemaAccess: vi.fn() as import('vitest').MockInstance<(session: any, schema: any) => import('next/server').NextResponse | null>
  };
});

// ===== Mocks (must be before importing the route) =====

// Wrap ConnectionManager so getInstance() always returns a usable instance
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate && typeof candidate.executeQuery === 'function' && candidate) || {
    executeQuery: vi.fn(async () => []),
    beginTransaction: vi.fn(async () => 'tx'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// Logger
vi.mock('@/ailogger', () => ({
  default: { info: loggerInfo, error: loggerError, warn: vi.fn() }
}));

// SQL security validation
vi.mock('@/config/utils/sqlsecurity', () => ({
  validateSchemaOrThrow: vi.fn((schema: string) => {
    if (!schema || schema.includes('invalid')) {
      throw new Error('Invalid schema');
    }
  })
}));

// Auth — default: authenticated user
vi.mock('@/auth', () => ({
  auth: mockAuth
}));

// Authorization guard — default: access permitted
vi.mock('@/lib/authz', () => ({
  assertSchemaAccess: mockAssertSchemaAccess,
  isAdminSession: vi.fn(() => false),
  hasSchemaAccess: vi.fn(() => true)
}));

// ===== helpers =====
function makeRequest() {
  const url = new URL('http://localhost/api');
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url;
  return req as any;
}

async function callGET(schema: string, plotID: string, censusID: string) {
  const props = {
    params: Promise.resolve({ schema, plotID, censusID })
  } as any;
  const req = makeRequest();
  return GET(req, props);
}

// ===== authorizedSession: a session whose user is a member of 'testschema' =====
const authorizedSession = {
  user: {
    userStatus: 'user',
    sites: [{ schemaName: 'testschema' }]
  }
};

describe('GET /api/dashboardmetrics/all/[schema]/[plotID]/[censusID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: auth returns an authorized session
    mockAuth.mockResolvedValue(authorizedSession);

    // Default: schema access is permitted
    mockAssertSchemaAccess.mockReturnValue(null);
  });

  describe('parameter validation', () => {
    it('returns 400 when missing required parameters', async () => {
      const props = {
        params: Promise.resolve({ schema: '', plotID: '1', censusID: '2' })
      } as any;
      const res = await GET(makeRequest(), props);
      expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
      const body = await res.json();
      expect(body.error).toMatch(/Missing required parameters/i);
    });

    it('returns 400 when plotID is not a valid number', async () => {
      const res = await callGET('testschema', 'notanumber', '2');
      expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid plot ID or census ID/i);
    });

    it('returns error when schema validation fails', async () => {
      const res = await callGET('invalid_schema', '1', '2');
      expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    });
  });

  describe('first census (no previous census)', () => {
    it('returns all stems as new recruits when no previous census exists', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      const beginTx = vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      const commitTx = vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Query 1: Check for previous census - returns NULL (first census)
      exec.mockResolvedValueOnce([{ PrevCensusID: null }]);

      // Queries 2-5: The 4 parallel queries (progressTacho, activeUsers, countTrees, countStems)
      exec.mockResolvedValueOnce([{ total_quadrats: 10, populated_quadrats: 5, populated_pct: 50, unpopulated_quadrats: 'Q1;Q2' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 3 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 100 }]);
      exec.mockResolvedValueOnce([{ CountStems: 150 }]);

      // Query 6: Fast path count for new recruits
      exec.mockResolvedValueOnce([{ CountNewRecruits: 150 }]);

      const res = await callGET('testschema', '1', '1');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // Verify stemTypes uses fast path (all new recruits)
      expect(body.stemTypes).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 150
      });

      // Verify other metrics are present
      expect(body.progressTachometer).toBeDefined();
      expect(body.activeUsers).toBeDefined();
      expect(body.countTrees).toBeDefined();
      expect(body.countStems).toBeDefined();

      // Informational dashboard reads should not use a shared transaction.
      expect(beginTx).not.toHaveBeenCalled();
      expect(commitTx).not.toHaveBeenCalled();
      expect(exec.mock.calls.every(call => call[2] === undefined)).toBe(true);
    });
  });

  describe('subsequent census (with previous census)', () => {
    it('correctly classifies stems into old, multi, and new recruits', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Query 1: Check for previous census - returns census ID 1
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);

      // Queries 2-5: The 4 parallel queries
      exec.mockResolvedValueOnce([{ total_quadrats: 20, populated_quadrats: 18, populated_pct: 90, unpopulated_quadrats: 'Q19;Q20' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 5 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 500 }]);
      exec.mockResolvedValueOnce([{ CountStems: 700 }]);

      // Query 6: Optimized stem types query with classification
      exec.mockResolvedValueOnce([
        {
          CountOldStems: 400,
          CountMultiStems: 200,
          CountNewRecruits: 100
        }
      ]);

      const res = await callGET('testschema', '1', '2');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      expect(body.stemTypes).toEqual({
        CountOldStems: 400,
        CountMultiStems: 200,
        CountNewRecruits: 100
      });

      // Verify complete response structure
      expect(body).toEqual({
        progressTachometer: {
          TotalQuadrats: 20,
          PopulatedQuadrats: 18,
          PopulatedPercent: 90,
          UnpopulatedQuadrats: 'Q19;Q20'
        },
        activeUsers: { CountActiveUsers: 5 },
        countTrees: { CountTrees: 500 },
        countStems: { CountStems: 700 },
        stemTypes: {
          CountOldStems: 400,
          CountMultiStems: 200,
          CountNewRecruits: 100
        }
      });
    });
  });

  describe('edge cases', () => {
    it('handles empty measurements (returns zeros)', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Previous census exists
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);

      // All queries return empty/zero results
      exec.mockResolvedValueOnce([{ total_quadrats: 10, populated_quadrats: 0, populated_pct: 0, unpopulated_quadrats: null }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 0 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 0 }]);
      exec.mockResolvedValueOnce([{ CountStems: 0 }]);
      exec.mockResolvedValueOnce([{ CountOldStems: 0, CountMultiStems: 0, CountNewRecruits: 0 }]);

      const res = await callGET('testschema', '1', '2');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      expect(body.stemTypes).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
      expect(body.countTrees.CountTrees).toBe(0);
      expect(body.countStems.CountStems).toBe(0);
    });

    it('handles NULL database values with fallback to 0', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Previous census exists
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);

      // All queries return null values
      exec.mockResolvedValueOnce([{ total_quadrats: null, populated_quadrats: null, populated_pct: null, unpopulated_quadrats: null }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: null }]);
      exec.mockResolvedValueOnce([{ CountTrees: null }]);
      exec.mockResolvedValueOnce([{ CountStems: null }]);
      exec.mockResolvedValueOnce([{ CountOldStems: null, CountMultiStems: null, CountNewRecruits: null }]);

      const res = await callGET('testschema', '1', '2');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // All values should fall back to 0
      expect(body.stemTypes.CountOldStems).toBe(0);
      expect(body.stemTypes.CountMultiStems).toBe(0);
      expect(body.stemTypes.CountNewRecruits).toBe(0);
    });

    it('handles empty result arrays gracefully', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Previous census exists
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);

      // Return empty arrays
      exec.mockResolvedValueOnce([]);
      exec.mockResolvedValueOnce([]);
      exec.mockResolvedValueOnce([]);
      exec.mockResolvedValueOnce([]);
      exec.mockResolvedValueOnce([]);

      const res = await callGET('testschema', '1', '2');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // Should handle undefined gracefully with || 0 fallback
      expect(body.stemTypes.CountOldStems).toBe(0);
      expect(body.stemTypes.CountMultiStems).toBe(0);
      expect(body.stemTypes.CountNewRecruits).toBe(0);
    });
  });

  describe('error handling', () => {
    it('returns 500 on database error without opening or rolling back a read transaction', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('DB connection failed'));
      const beginTx = vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      const rollbackTx = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValue(undefined);

      const res = await callGET('testschema', '1', '2');

      expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      const body = await res.json();
      expect(body.error).toMatch(/Failed to retrieve aggregated dashboard metrics/i);

      expect(beginTx).not.toHaveBeenCalled();
      expect(rollbackTx).not.toHaveBeenCalled();
    });

    it('logs error when query fails', async () => {
      const cm = (ConnectionManager as any).getInstance();
      vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('Query timeout'));
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'rollbackTransaction').mockResolvedValue(undefined);

      await callGET('testschema', '1', '2');

      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe('query structure verification', () => {
    it('uses explicit previous census ID in subsequent census query (not CTE)', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // Previous census ID is 5
      exec.mockResolvedValueOnce([{ PrevCensusID: 5 }]);

      // Mock the parallel queries
      exec.mockResolvedValueOnce([{ total_quadrats: 10, populated_quadrats: 5, populated_pct: 50, unpopulated_quadrats: '' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 1 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 10 }]);
      exec.mockResolvedValueOnce([{ CountStems: 15 }]);

      // The stem types query
      exec.mockResolvedValueOnce([{ CountOldStems: 10, CountMultiStems: 3, CountNewRecruits: 2 }]);

      await callGET('testschema', '1', '6');

      // Find the stem types query (should be the last one after parallel queries)
      const stemTypesCall = exec.mock.calls.find(call => String(call[0]).includes('measured_stems') && String(call[0]).includes('previous_stems'));

      expect(stemTypesCall).toBeDefined();

      // Verify it uses LEFT JOINs (optimized pattern)
      expect(String(stemTypesCall![0])).toMatch(/LEFT JOIN previous_stems/i);
      expect(String(stemTypesCall![0])).toMatch(/LEFT JOIN previous_trees/i);

      // Verify COALESCE is used for NULL handling
      expect(String(stemTypesCall![0])).toMatch(/COALESCE\(SUM\(CASE/i);

      // Verify parameters include the previous census ID (5)
      // Parameters: censusID, censusID, previousCensusID, previousCensusID, previousCensusID
      expect(stemTypesCall![1]).toEqual([6, 6, 5, 5, 5]);
    });

    it('does not pass a shared transaction ID to dashboard read queries', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      const beginTx = vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      const commitTx = vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);
      const rollbackTx = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValue(undefined);

      exec.mockResolvedValueOnce([{ PrevCensusID: 5 }]);
      exec.mockResolvedValueOnce([{ total_quadrats: 10, populated_quadrats: 5, populated_pct: 50, unpopulated_quadrats: '' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 1 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 10 }]);
      exec.mockResolvedValueOnce([{ CountStems: 15 }]);
      exec.mockResolvedValueOnce([{ CountOldStems: 10, CountMultiStems: 3, CountNewRecruits: 2 }]);

      const res = await callGET('testschema', '1', '6');

      expect(res.status).toBe(HTTPResponses.OK);
      expect(beginTx).not.toHaveBeenCalled();
      expect(commitTx).not.toHaveBeenCalled();
      expect(rollbackTx).not.toHaveBeenCalled();
      expect(exec).toHaveBeenCalledTimes(6);
      expect(exec.mock.calls.every(call => call[2] === undefined)).toBe(true);
    });

    it('uses fast path query for first census (no complex CTEs)', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');
      vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx123');
      vi.spyOn(cm, 'commitTransaction').mockResolvedValue(undefined);

      // No previous census
      exec.mockResolvedValueOnce([{ PrevCensusID: null }]);

      // Mock the parallel queries
      exec.mockResolvedValueOnce([{ total_quadrats: 10, populated_quadrats: 5, populated_pct: 50, unpopulated_quadrats: '' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 1 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 10 }]);
      exec.mockResolvedValueOnce([{ CountStems: 15 }]);

      // Fast path count query
      exec.mockResolvedValueOnce([{ CountNewRecruits: 15 }]);

      await callGET('testschema', '1', '1');

      // Find the fast path query (should be a simple COUNT, not the complex CTE)
      const fastPathCall = exec.mock.calls.find(
        call =>
          String(call[0]).includes('COUNT(DISTINCT s.StemGUID)') && String(call[0]).includes('CountNewRecruits') && !String(call[0]).includes('previous_stems')
      );

      expect(fastPathCall).toBeDefined();
      expect(String(fastPathCall![0])).not.toMatch(/WITH measured_stems AS.*previous_stems/is);
    });
  });

  // ===== Authorization security tests =====
  // The aggregated "all" endpoint passes the raw URL schema directly to SQL.
  // These tests confirm that auth + schema-access are enforced before any DB call.
  describe('authorization enforcement', () => {
    it('returns 401 when there is no authenticated session', async () => {
      mockAuth.mockResolvedValue(null); // no session

      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      const res = await callGET('testschema', '1', '1');

      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHENTICATED');

      // The database must not be queried — the request is blocked before any SQL executes
      expect(exec).not.toHaveBeenCalled();
    });

    it('returns 403 when the authenticated user does not have access to the requested schema, and the DB is never queried', async () => {
      const { NextResponse } = await import('next/server');
      const deniedResponse = NextResponse.json(
        { error: 'SQL references a schema outside the authenticated user scope', code: 'SCHEMA_ACCESS_DENIED' },
        { status: 403 }
      );
      mockAssertSchemaAccess.mockReturnValue(deniedResponse);

      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // User is authenticated but NOT a member of this schema
      const res = await callGET('testschema', '1', '1');

      expect(res.status).toBe(HTTPResponses.FORBIDDEN);

      // CRITICAL: no DB queries must run when the schema is unauthorized
      expect(exec).not.toHaveBeenCalled();
    });

    it('proceeds to executeQuery when schema is valid and user is authorized', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // All queries succeed
      exec.mockResolvedValueOnce([{ PrevCensusID: null }]);
      exec.mockResolvedValueOnce([{ total_quadrats: 5, populated_quadrats: 3, populated_pct: 60, unpopulated_quadrats: 'Q4;Q5' }]);
      exec.mockResolvedValueOnce([{ PersonnelCount: 2 }]);
      exec.mockResolvedValueOnce([{ CountTrees: 50 }]);
      exec.mockResolvedValueOnce([{ CountStems: 80 }]);
      exec.mockResolvedValueOnce([{ CountNewRecruits: 80 }]);

      const res = await callGET('testschema', '2', '3');

      expect(res.status).toBe(HTTPResponses.OK);
      // At least one executeQuery call confirms the DB was reached
      expect(exec).toHaveBeenCalled();
    });
  });
});
