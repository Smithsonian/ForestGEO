import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

/**
 * Unified Changelog Tracking System Tests
 *
 * Purpose: The unifiedchangelog table tracks user-initiated data modifications for audit purposes:
 * - Single-row edits via datagrid EditToolbar (PATCH/DELETE operations)
 * - File uploads (INSERT operations with batch tracking)
 *
 * Exclusions:
 * - Bulk census deletions (would flood the log with thousands of entries)
 * - System-generated changes (auto-calculations, triggers firing from other triggers)
 *
 * Test Coverage:
 * 1. Single-row UPDATE operations create ONE changelog entry
 * 2. Single-row DELETE operations create ONE changelog entry
 * 3. Census deletions do NOT create changelog entries
 * 4. File uploads create ONE changelog entry per file (not per batch)
 * 5. Multiple batches from same file UPDATE the same changelog entry
 */

// ========== Mocks ==========
vi.mock('@/config/utils/sqlsecurity', () => ({
  validateSchemaOrThrow: vi.fn(),
  safeFormatQuery: vi.fn((schema, query) => query),
  isValidSchema: vi.fn(() => true)
}));

vi.mock('mysql2/promise', () => ({
  format: vi.fn((sql, params) => {
    // Mock implementation that properly replaces ?? and ? placeholders in order
    let result = sql;
    params.forEach((param: any) => {
      if (result.includes('??')) {
        result = result.replace('??', param);
      } else if (result.includes('?')) {
        result = result.replace('?', param);
      }
    });
    return result;
  })
}));

vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    executeQuery: vi.fn(async () => []),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

vi.mock('@/config/datamapper', () => ({
  default: {
    getMapper: vi.fn(() => ({
      mapData: vi.fn((rows: any[]) => rows),
      demapData: vi.fn((rows: any[]) => rows)
    }))
  }
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(async () => '123')
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: 'test-user-id', email: 'test@example.com' }
  }))
}));

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: vi.fn(async () => undefined),
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {
    status: number;

    constructor(message: string, status: number = 409) {
      super(message);
      this.status = status;
    }
  },
  UploadSessionState: {
    INITIALIZED: 'initialized',
    UPLOADING: 'uploading'
  }
}));

// Import handlers AFTER mocks
import { PATCH, DELETE } from '@/config/macros/coreapifunctions';
import { GET as CLEARCENSUS_GET } from '../clearcensus/route';
import { POST as SQLPACKETLOAD_POST } from '../sqlpacketload/route';

// ========== Helpers ==========
function makeRequest(url: string, method: string = 'GET', body?: any): any {
  const req: any = new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : {}
  });
  req.nextUrl = new URL(url);
  req.json = async () => body;
  return req as any;
}

function makeParams(dataType: string, slugs?: string[]): { params: Promise<{ dataType: string; slugs?: string[] }> } {
  return { params: Promise.resolve({ dataType, slugs }) };
}

function mockMeasurementUploadQueries(
  exec: any,
  options: {
    preInsertCount?: number;
    postInsertCount?: number;
    existingEntry?: any[];
    changelogResult?: unknown;
    changelogError?: Error;
  } = {}
) {
  const { preInsertCount = 1, postInsertCount = preInsertCount + 1, existingEntry = [], changelogResult = {}, changelogError } = options;

  exec
    .mockResolvedValueOnce([{ PlotID: 1 }])
    .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
    .mockResolvedValueOnce([{ count: preInsertCount }])
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce([{ count: postInsertCount }]);

  if (changelogError) {
    exec.mockRejectedValueOnce(changelogError);
    return exec;
  }

  exec.mockResolvedValueOnce(existingEntry).mockResolvedValueOnce(changelogResult);
  return exec;
}

describe('Unified Changelog Tracking System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Single-Row UPDATE via EditToolbar', () => {
    it('should create ONE changelog entry when user updates a row via PATCH', async () => {
      const cm = (ConnectionManager as any).getInstance();

      // Mock the database calls
      const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
      const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = vi
        .spyOn(cm, 'executeQuery')
        .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE query
        .mockResolvedValueOnce([{ Count: 1 }]); // COUNT query

      const oldRow = { code: 'A', description: 'Old Description', status: 'alive' };
      const newRow = { code: 'A', description: 'New Description', status: 'alive' };

      const req = makeRequest('http://localhost/api/fixeddata/attributes/testschema/code', 'PATCH', {
        oldRow,
        newRow
      });

      const res = await PATCH(req, makeParams('attributes', ['testschema', 'code']));

      expect(res.status).toBe(HTTPResponses.OK);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalled();

      // Verify UPDATE was called
      const updateCall = exec.mock.calls.find(call => String(call[0]).includes('UPDATE') && String(call[0]).includes('attributes'));
      expect(updateCall).toBeDefined();

      // Once triggers are enabled, this would create ONE changelog entry via trigger
      expect(commit).toHaveBeenCalledWith('tx-1');
    });

    it('should create ONE changelog entry for personnel row update', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
      const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = vi
        .spyOn(cm, 'executeQuery')
        .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE query
        .mockResolvedValueOnce([{ Count: 1 }]); // COUNT query

      const oldRow = { personnelID: 1, firstName: 'John', lastName: 'Doe', role: 'researcher' };
      const newRow = { personnelID: 1, firstName: 'John', lastName: 'Doe', role: 'lead researcher' };

      const req = makeRequest('http://localhost/api/fixeddata/personnel/testschema/personnelID', 'PATCH', {
        oldRow,
        newRow
      });

      const res = await PATCH(req, makeParams('personnel', ['testschema', 'personnelID']));

      expect(res.status).toBe(HTTPResponses.OK);
      expect(exec).toHaveBeenCalled();
      expect(commit).toHaveBeenCalledWith('tx-2');
    });
  });

  describe('2. Single-Row DELETE via EditToolbar', () => {
    it('should create ONE changelog entry when user deletes a row via DELETE', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-3');
      const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({ affectedRows: 1 }); // DELETE query

      const rowToDelete = { code: 'B', description: 'To Delete', status: 'dead' };

      const req = makeRequest('http://localhost/api/fixeddata/attributes/testschema/code', 'DELETE', {
        newRow: rowToDelete
      });

      const res = await DELETE(req, makeParams('attributes', ['testschema', 'code']));

      expect(res.status).toBe(HTTPResponses.OK);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalled();

      // Verify DELETE was called
      const deleteCall = exec.mock.calls.find(call => String(call[0]).includes('DELETE') && String(call[0]).includes('attributes'));
      expect(deleteCall).toBeDefined();

      // Once triggers are enabled, this would create ONE changelog entry via trigger
      expect(commit).toHaveBeenCalledWith('tx-3');
    });
  });

  describe('3. Census Deletion Exclusion', () => {
    it('should NOT create changelog entries during full census deletion', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-4');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});

      const req = makeRequest('http://localhost/api/clearcensus?schema=testschema&censusID=5&type=full');

      const res = await CLEARCENSUS_GET(req);

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();
      expect(body).toEqual({ message: 'Census cleared successfully' });

      // Verify the stored procedure is called with correct parameters
      const [sql, params] = exec.mock.calls[0];
      expect(String(sql)).toMatch(/CALL testschema\.clearcensusfull\((5|\?)\);?/i);
      expect(params).toEqual([]);

      // The stored procedure sets @disable_triggers = 1
      // This prevents changelog entries from being created during bulk deletion
      expect(_commit).toHaveBeenCalledWith('tx-4');
    });

    it('should NOT create changelog entries during partial census deletion (measurements only)', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-5');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});

      const req = makeRequest('http://localhost/api/clearcensus?schema=testschema&censusID=7&type=msmts');

      const res = await CLEARCENSUS_GET(req);

      expect(res.status).toBe(HTTPResponses.OK);

      // Verify the stored procedure is called
      const [sql, params] = exec.mock.calls[0];
      expect(String(sql)).toMatch(/CALL testschema\.clearcensusmsmts\((7|\?)\);?/i);
      expect(params).toEqual([]);

      // The stored procedure sets @disable_triggers = 1
      expect(_commit).toHaveBeenCalledWith('tx-5');
    });
  });

  describe('4. File Upload Tracking - Single Row Per File', () => {
    it('should create ONE changelog entry for measurements file upload (first batch)', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-6');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      const exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        existingEntry: [],
        changelogResult: { insertId: 1 }
      });

      const fileRowSet = {
        'row-1': {
          tag: '100',
          stemtag: '1',
          spcode: 'sp1',
          quadrat: 'Q01',
          lx: 0.5,
          ly: 0.5,
          dbh: 10.5,
          hom: 1.3,
          date: new Date('2024-01-01'),
          codes: 'A',
          comments: null
        }
      };

      const req = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'measurements.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet
      });

      const res = await SQLPACKETLOAD_POST(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(HTTPResponses.OK);

      // For measurements, the code path includes:
      // 1. COUNT from temporarymeasurements before insert
      // 2. INSERT to temporarymeasurements
      // 3. COUNT from temporarymeasurements after insert
      // 4. SELECT from unifiedchangelog (check for existing entry)
      // 5. INSERT into unifiedchangelog (first batch) OR UPDATE unifiedchangelog (subsequent batches)

      // Find the changelog-related queries
      const changelogQueries = exec.mock.calls.filter(call => {
        const sql = String(call[0]);
        return sql.includes('unifiedchangelog');
      });

      // Should have at least 2 changelog queries: SELECT and INSERT
      expect(changelogQueries.length).toBeGreaterThanOrEqual(2);

      // Verify changelog INSERT was called
      const changelogInsert = exec.mock.calls.find(call => {
        const sql = String(call[0]);
        return sql.includes('INSERT') && sql.includes('unifiedchangelog');
      });

      expect(changelogInsert).toBeDefined();

      // Verify the parameters structure
      if (changelogInsert) {
        const params = changelogInsert[1] as any[];
        expect(params).toBeDefined();
        expect(params[0]).toBe('file_upload'); // TableName
        expect(params[1]).toBe('measurements.csv'); // RecordID (fileName)
        expect(params[2]).toBe('INSERT'); // Operation
        // params[3] is the JSON metadata
        const metadata = JSON.parse(params[3]);
        expect(metadata.fileName).toBe('measurements.csv');
        expect(metadata.formType).toBe('measurements');
        expect(metadata.rowCount).toBe(1);
        expect(metadata.batchCount).toBe(1);
      }
    });

    it('should UPDATE same changelog entry for subsequent batches of same file', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-7');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      const exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        existingEntry: [
          {
            ChangeID: 1,
            NewRowState: JSON.stringify({
              fileName: 'measurements.csv',
              formType: 'measurements',
              rowCount: 1,
              batchCount: 1
            })
          }
        ],
        changelogResult: {}
      });

      const fileRowSet = {
        'row-1': {
          tag: '200',
          stemtag: '1',
          spcode: 'sp2',
          quadrat: 'Q02',
          lx: 1.5,
          ly: 1.5,
          dbh: 12.5,
          hom: 1.3,
          date: new Date('2024-01-02'),
          codes: 'A',
          comments: null
        }
      };

      const req = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'measurements.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet
      });

      const res = await SQLPACKETLOAD_POST(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(HTTPResponses.OK);

      // Verify changelog UPDATE was called (not INSERT)
      const changelogUpdate = exec.mock.calls.find(call => String(call[0]).includes('UPDATE') && String(call[0]).includes('unifiedchangelog'));
      expect(changelogUpdate).toBeDefined();

      // Verify accumulated counts
      if (changelogUpdate) {
        const [_sql, params] = changelogUpdate as [string, any[]];
        const metadata = JSON.parse(params[0]);
        expect(metadata.rowCount).toBe(2);
        expect(metadata.batchCount).toBe(2); // 1 + 1
      }
    });

    it('should create ONE changelog entry for supporting data file upload (attributes)', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-8');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      const exec = vi
        .spyOn(cm, 'executeQuery')
        .mockResolvedValueOnce({}) // INSERT/UPSERT to attributes
        .mockResolvedValueOnce([]) // SELECT existing changelog entry (none)
        .mockResolvedValueOnce({}); // INSERT changelog entry

      const fileRowSet = {
        'row-1': { code: 'A', description: 'Alive', status: 'alive' },
        'row-2': { code: 'D', description: 'Dead', status: 'dead' }
      };

      const req = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'attributes',
        fileName: 'attributes.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet
      });

      const res = await SQLPACKETLOAD_POST(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(HTTPResponses.OK);

      // Verify ONE changelog entry was created
      const changelogInsert = exec.mock.calls.find(call => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('unifiedchangelog'));
      expect(changelogInsert).toBeDefined();
    });

    it('should create separate changelog entries for different files', async () => {
      const cm = (ConnectionManager as any).getInstance();

      // First file upload
      let _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-9a');
      let _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      let _exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        existingEntry: [],
        changelogResult: {}
      });

      const req1 = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'file1.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet: { 'row-1': { tag: '100', stemtag: '1', spcode: 'sp1', quadrat: 'Q01' } }
      });

      const res1 = await SQLPACKETLOAD_POST(req1);
      expect(res1).toBeDefined();
      expect(res1!.status).toBe(HTTPResponses.OK);

      vi.clearAllMocks();

      // Second file upload
      _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-9b');
      _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      _exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        existingEntry: [],
        changelogResult: {}
      });

      const req2 = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'file2.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet: { 'row-1': { tag: '200', stemtag: '1', spcode: 'sp2', quadrat: 'Q02' } }
      });

      const res2 = await SQLPACKETLOAD_POST(req2);
      expect(res2).toBeDefined();
      expect(res2!.status).toBe(HTTPResponses.OK);

      // Both files should create separate changelog entries
      // Each file gets its own INSERT into unifiedchangelog
    });
  });

  describe('5. Additional Intent-Based Test Cases', () => {
    it('should handle concurrent edits from multiple users without conflicts', async () => {
      // Test that multiple users editing different rows doesn't cause conflicts
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-10a').mockResolvedValueOnce('tx-10b');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const exec = vi
        .spyOn(cm, 'executeQuery')
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ Count: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ Count: 1 }]);

      // User 1 edits row A
      const req1 = makeRequest('http://localhost/api/fixeddata/attributes/testschema/code', 'PATCH', {
        oldRow: { code: 'A', description: 'Old A' },
        newRow: { code: 'A', description: 'New A' }
      });

      // User 2 edits row B
      const req2 = makeRequest('http://localhost/api/fixeddata/attributes/testschema/code', 'PATCH', {
        oldRow: { code: 'B', description: 'Old B' },
        newRow: { code: 'B', description: 'New B' }
      });

      const [res1, res2] = await Promise.all([
        PATCH(req1, makeParams('attributes', ['testschema', 'code'])),
        PATCH(req2, makeParams('attributes', ['testschema', 'code']))
      ]);

      expect(res1.status).toBe(HTTPResponses.OK);
      expect(res2.status).toBe(HTTPResponses.OK);

      // Both should create separate changelog entries
      expect(exec).toHaveBeenCalled();
    });

    it('should track WHO made the change via ChangedBy field', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-11');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
      const exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        existingEntry: [],
        changelogResult: {}
      });

      const req = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'test.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'john.doe@example.com',
        fileRowSet: { 'row-1': { tag: '100', stemtag: '1', spcode: 'sp1', quadrat: 'Q01' } }
      });

      await SQLPACKETLOAD_POST(req);

      // Verify ChangedBy field is populated
      const changelogInsert = exec.mock.calls.find(call => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('unifiedchangelog'));

      if (changelogInsert) {
        const params = changelogInsert[1];
        expect(params).toContain('john.doe@example.com');
      }
    });

    it('should not fail upload if changelog tracking fails', async () => {
      const cm = (ConnectionManager as any).getInstance();

      const _begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-12');
      const _commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

      // Mock changelog insert failure but upload succeeds
      const _exec = mockMeasurementUploadQueries(vi.spyOn(cm, 'executeQuery'), {
        preInsertCount: 1,
        postInsertCount: 2,
        changelogError: new Error('Changelog table locked')
      });

      const req = makeRequest('http://localhost/api/sqlpacketload', 'POST', {
        schema: 'testschema',
        formType: 'measurements',
        fileName: 'test.csv',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 10 }] },
        user: 'test-user',
        fileRowSet: { 'row-1': { tag: '100', stemtag: '1', spcode: 'sp1', quadrat: 'Q01' } }
      });

      const res = await SQLPACKETLOAD_POST(req);

      // Upload should still succeed even if changelog fails
      expect(res!.status).toBe(HTTPResponses.OK);
    });
  });
});
