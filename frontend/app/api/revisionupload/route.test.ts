import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import type { BulkEditPlan } from '@/config/editplan/types';

const EMPTY_BULK_PLAN: BulkEditPlan = {
  dataType: 'measurementssummary',
  rowCount: 0,
  rowPlans: [],
  aggregateEffects: [],
  maxSeverity: 'info',
  planHash: 'test-plan-hash-empty',
  generatedAt: '2026-04-20T00:00:00.000Z'
};

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  safeFormatQuery: vi.fn((_schema: string, query: string) => query),
  loggerError: vi.fn(),
  executeQuery: vi.fn<(...args: any[]) => Promise<any>>(async () => []),
  closeConnection: vi.fn(async () => undefined),
  analyzeBulk: vi.fn(),
  assertCanEditMeasurementScope: vi.fn(async () => undefined),
  MockScopeAccessError: class MockScopeAccessError extends Error {},
  MockScopeBusyError: class MockScopeBusyError extends Error {}
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mocks.executeQuery,
      closeConnection: mocks.closeConnection
    })
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

vi.mock('@/config/editplan/bulkanalyzer', () => ({
  analyzeBulk: (...args: unknown[]) => mocks.analyzeBulk(...args)
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: mocks.MockScopeAccessError,
  ScopeBusyError: mocks.MockScopeBusyError
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/revisionupload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { name: 'Mason', email: 'mason@example.com', userStatus: 'global', sites: [] } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.executeQuery.mockResolvedValue([]);
    mocks.closeConnection.mockResolvedValue(undefined);
    mocks.analyzeBulk.mockResolvedValue({ ...EMPTY_BULK_PLAN });
    mocks.assertCanEditMeasurementScope.mockResolvedValue(undefined);
  });

  it('returns 403 before scope checks for pending users', async () => {
    mocks.auth.mockResolvedValue({ user: { name: 'Mason', email: 'mason@example.com', userStatus: 'pending', sites: [] } });

    const response = await POST(
      buildRequest({
        rows: [{ tag: 'T1', stemtag: '1', dbh: '10.0' }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'pending users cannot edit measurements' });
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.analyzeBulk).not.toHaveBeenCalled();
  });

  it('marks revision new-row species codes as blocking for field crew users', async () => {
    mocks.auth.mockResolvedValue({
      user: { name: 'Mason', email: 'mason@example.com', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
    });
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        rows: [{ tag: 'T1', stemtag: '1', spcode: 'QUAS', quadrat: '101', lx: '1', ly: '2', date: '2026-04-01', dbh: '10.0' }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.newRows).toHaveLength(1);
    expect(body.bulkPlan).toMatchObject({
      canApply: false,
      maxSeverity: 'destructive',
      errors: [expect.objectContaining({ kind: 'RoleForbiddenField', field: 'spcode', role: 'field crew', rowIndex: 0 })]
    });
  });

  it('matches View Data export rows by StemGUID and keeps the highest measurement ID as survivor', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 400,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'Broken and leaning',
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'AAAAAA',
            QuadratName: '101',
            LocalX: 9.33,
            LocalY: 1111
          },
          {
            CoreMeasurementID: 401,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 43.9,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'Broken and leaning',
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'AAAAAA',
            QuadratName: '101',
            LocalX: 9.33,
            LocalY: 1111
          }
        ];
      }

      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'measurements_csv_export.csv',
            rows: [
              {
                stemid: '5283365',
                tag: '10063',
                stemtag: '10063',
                quadrat: '101',
                date: '2026-03-14',
                dbh: '44.100000',
                hom: '1.300000',
                comments: 'Broken and leaning',
                codes: 'Q;L'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matchedRows: [
        {
          csvRow: {
            stemid: '5283365',
            tag: '10063',
            stemtag: '10063',
            quadrat: '101',
            date: '2026-03-14',
            dbh: '44.100000',
            hom: '1.300000',
            comments: 'Broken and leaning',
            codes: 'Q;L'
          },
          coreMeasurementID: 401,
          duplicateMeasurementIDsToDelete: [400],
          existingValues: {
            measuredDBH: 43.9,
            measuredHOM: 1.3,
            measurementDate: '2026-03-14',
            rawCodes: 'Q;L',
            description: 'Broken and leaning'
          },
          changes: {
            dbh: {
              from: '43.9',
              to: '44.100000'
            }
          }
        }
      ],
      newRows: [],
      invalidRows: [],
      counts: {
        matched: 1,
        matchedWithChanges: 1,
        new: 0,
        invalid: 0,
        total: 1
      },
      bulkPlan: EMPTY_BULK_PLAN
    });
  });

  it('falls back to tag + stemtag matching when stemid is absent', async () => {
    mocks.executeQuery.mockImplementation(async (query: string, params: unknown[]) => {
      if (query.includes("LOWER(TRIM(COALESCE(t.TreeTag, cm.RawTreeTag, '')))")) {
        expect(params).toEqual([2, 'tree-7', '2']);
        return [
          {
            CoreMeasurementID: 777,
            StemGUID: 98765,
            IsActive: 1,
            MeasuredDBH: 12.4,
            MeasuredHOM: 1.1,
            MeasurementDate: '2025-05-01',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'TREE-7',
            RawStemTag: '2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'TREE-7',
            StemTag: '2',
            SpeciesCode: 'AAAAAA',
            QuadratName: '101',
            LocalX: 1.5,
            LocalY: 2.5
          }
        ];
      }

      return [];
    });

    const response = await POST(
      buildRequest({
        rows: [
          {
            tag: 'TREE-7',
            stemtag: '2',
            dbh: '12.8'
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matchedRows).toHaveLength(1);
    expect(body.matchedRows[0]).toMatchObject({
      coreMeasurementID: 777,
      duplicateMeasurementIDsToDelete: [],
      changes: {
        dbh: {
          from: '12.4',
          to: '12.8'
        }
      }
    });
  });

  it('flags duplicate stemid rows within a single file as invalid instead of silently collapsing them', async () => {
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'duplicates.csv',
            rows: [
              { stemid: '100', tag: 't', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '10.0', date: '2026-04-01' },
              { stemid: '100', tag: 't', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '11.0', date: '2026-04-02' },
              { stemid: '200', tag: 't2', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '12.0', date: '2026-04-03' }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.invalidRows).toHaveLength(2);
    expect(body.invalidRows[0].reason).toMatch(/duplicate stemid 100/);
    expect(body.invalidRows[1].reason).toMatch(/duplicate stemid 100/);
    expect(body.invalidRows.map((row: { csvIndex: number }) => row.csvIndex)).toEqual([0, 1]);
    expect(body.newRows).toHaveLength(1);
    expect(body.newRows[0].csvRow.stemid).toBe('200');
  });

  it('flags duplicate tag+stemtag rows within a single file as invalid', async () => {
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'duplicate-tags.csv',
            rows: [
              { tag: 'TREE-7', stemtag: '2', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '10.0', date: '2026-04-01' },
              { tag: 'tree-7', stemtag: '2', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '11.0', date: '2026-04-02' }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.invalidRows).toHaveLength(2);
    expect(body.invalidRows[0].reason).toMatch(/duplicate tag\+stemtag/);
    expect(body.newRows).toHaveLength(0);
  });

  it('routes unmatched stemid rows to newRows with a stemid-not-found reason', async () => {
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'unmatched-stemid.csv',
            rows: [
              {
                stemid: '9999999',
                tag: 'NEW-TREE',
                stemtag: '1',
                spcode: 'quas',
                quadrat: 'q',
                lx: '1.5',
                ly: '2.5',
                dbh: '12.3',
                date: '2026-04-14'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.matchedRows).toHaveLength(0);
    expect(body.invalidRows).toHaveLength(0);
    expect(body.newRows).toHaveLength(1);
    expect(body.newRows[0].reason).toBe('stemid-not-found');
    expect(body.newRows[0].csvRow.stemid).toBe('9999999');
  });

  it('does not report fake changes when the CSV cell is a literal "NULL" placeholder and the DB value is null', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 600,
            StemGUID: 123,
            IsActive: 1,
            MeasuredDBH: 12.5,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T',
            RawStemTag: 'S',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T',
            StemTag: 'S',
            SpeciesCode: 'AAA',
            QuadratName: 'Q',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'roundtrip.csv',
            rows: [
              {
                stemid: '123',
                dbh: '12.5',
                hom: '1.3',
                date: '2026-03-14',
                codes: 'NULL',
                comments: 'NULL'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows).toHaveLength(1);
    expect(body.matchedRows[0].changes).toEqual({});
  });

  it('renders MeasurementDate returned as a Date object using local calendar components, not UTC', async () => {
    // Construct a local Date that lives on 2026-03-14 locally but is 2026-03-15 in UTC
    // when the local offset is negative (e.g. Americas). The comparison should still
    // see 2026-03-14 because the CSV author edited a yyyy-mm-dd string.
    const localDate = new Date(2026, 2, 14, 23, 30, 0); // month is 0-indexed

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 500,
            StemGUID: 999,
            IsActive: 1,
            MeasuredDBH: 10.0,
            MeasuredHOM: 1.0,
            MeasurementDate: localDate,
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T',
            RawStemTag: 'S',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T',
            StemTag: 'S',
            SpeciesCode: 'AAA',
            QuadratName: 'Q',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'date-tz.csv',
            rows: [{ stemid: '999', date: '2026-03-14' }]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows).toHaveLength(1);
    expect(body.matchedRows[0].existingValues.measurementDate).toBe('2026-03-14');
    expect(body.matchedRows[0].changes).toEqual({});
  });

  it('surfaces edits to non-updatable columns (spcode, ly) as ignoredEdits rather than silently dropping them', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 700,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'Broken and leaning',
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'SLOATE',
            QuadratName: '101',
            LocalX: 9.33,
            LocalY: 2.4
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'ignored-edits.csv',
            rows: [
              {
                stemid: '5283365',
                tag: '10063',
                stemtag: '10063',
                spcode: 'AAAAAA',
                quadrat: '101',
                lx: '9.330000',
                ly: '1111',
                date: '2026-03-14',
                dbh: '44.000000',
                hom: '1.300000',
                comments: 'Broken and leaning',
                codes: 'Q;L'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matchedRows).toHaveLength(1);
    expect(body.matchedRows[0].changes).toEqual({});
    expect(body.matchedRows[0].ignoredEdits).toEqual({
      spcode: { from: 'SLOATE', to: 'AAAAAA' },
      ly: { from: 2.4, to: '1111' }
    });
  });

  it('tolerates leading-zero differences on quadrat/tag/stemtag so spreadsheet-mangled round-trips do not produce fake ignored edits', async () => {
    // Simulates Numbers/Excel stripping leading zeros: DB has '0101'/'10063'/'10063',
    // CSV re-upload has '101'/'10063'/'10063'. Only quadrat was mangled; tag/stemtag
    // happen to be digit-only too and should tolerate the same coercion. spcode is
    // alphanumeric and MUST remain strict.
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 900,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'Broken and leaning',
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'CRUD02',
            QuadratName: '0101',
            LocalX: 9.33,
            LocalY: 7.39
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'spreadsheet-mangled.csv',
            rows: [
              {
                stemid: '5283365',
                tag: '10063',
                stemtag: '10063',
                spcode: 'CRUD02',
                quadrat: '101',
                lx: '9.33',
                ly: '7.39',
                date: '2026-03-14',
                dbh: '44.000000',
                hom: '1.300000',
                comments: 'Broken and leaning',
                codes: 'Q;L'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows[0].ignoredEdits).toBeUndefined();
  });

  it('still reports ignored edits for long digit-only tags that differ beyond JS safe integer range', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 903,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: '9007199254740993',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '9007199254740993',
            StemTag: '10063',
            SpeciesCode: 'CRUD02',
            QuadratName: '0101',
            LocalX: 9.33,
            LocalY: 7.39
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'long-tag-edit.csv',
            rows: [{ stemid: '5283365', tag: '9007199254740992' }]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows[0].ignoredEdits).toEqual({
      tag: { from: '9007199254740993', to: '9007199254740992' }
    });
  });

  it('still reports a quadrat ignored edit when CSV value is genuinely different, not just leading-zero mangled', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 901,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'CRUD02',
            QuadratName: '0101',
            LocalX: 9.33,
            LocalY: 7.39
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'real-quadrat-edit.csv',
            rows: [{ stemid: '5283365', quadrat: '999' }]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows[0].ignoredEdits).toEqual({
      quadrat: { from: '0101', to: '999' }
    });
  });

  it('keeps spcode comparison strict so alphanumeric species codes like CRUD02 vs CRUD2 are still flagged as ignored edits', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 902,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'CRUD02',
            QuadratName: '0101',
            LocalX: 9.33,
            LocalY: 7.39
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'spcode-edit.csv',
            rows: [{ stemid: '5283365', spcode: 'CRUD2' }]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows[0].ignoredEdits).toEqual({
      spcode: { from: 'CRUD02', to: 'CRUD2' }
    });
  });

  it('does not report ignoredEdits when CSV and DB values for non-updatable columns agree', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 800,
            StemGUID: 5283365,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'Broken and leaning',
            RawTreeTag: '10063',
            RawStemTag: '10063',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: '10063',
            StemTag: '10063',
            SpeciesCode: 'AAAAAA',
            QuadratName: '101',
            LocalX: 9.33,
            LocalY: 1111
          }
        ];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'clean.csv',
            rows: [
              {
                stemid: '5283365',
                tag: '10063',
                stemtag: '10063',
                spcode: 'AAAAAA',
                quadrat: '101',
                lx: '9.330000',
                ly: '1111.000000',
                date: '2026-03-14',
                dbh: '44.000000',
                hom: '1.300000',
                comments: 'Broken and leaning',
                codes: 'Q;L'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.matchedRows[0].ignoredEdits).toBeUndefined();
  });

  it('includes a bulkPlan in the response shaped as a BulkEditPlan with rowPlans, aggregateEffects, maxSeverity and a planHash', async () => {
    const capturedBulkPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 401, status: 'matched' }],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'captured-plan-hash',
      generatedAt: '2026-04-20T00:00:00.000Z'
    };
    mocks.analyzeBulk.mockResolvedValue(capturedBulkPlan);
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        files: [{ fileName: 'basic.csv', rows: [{ stemid: '12345', dbh: '10.0' }] }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    const body = await response.json();
    expect(body.bulkPlan).toEqual(capturedBulkPlan);
  });

  it('passes matched rows to analyzeBulk with coreMeasurementID as targetID and canonicalized Attributes/MeasuredDBH/... keys so R5 can fire on codes changes across 3 rows', async () => {
    const dbRows = [
      {
        CoreMeasurementID: 501,
        StemGUID: 100,
        IsActive: 1,
        MeasuredDBH: 20.0,
        MeasuredHOM: 1.3,
        MeasurementDate: '2026-03-14',
        RawCodes: 'A',
        Description: null,
        RawTreeTag: 'T1',
        RawStemTag: 'S1',
        StemIsActive: 1,
        TreeIsActive: 1,
        QuadratIsActive: 1,
        PlotID: 1,
        TreeTag: 'T1',
        StemTag: 'S1',
        SpeciesCode: 'SP1',
        QuadratName: 'Q1',
        LocalX: 1,
        LocalY: 1
      },
      {
        CoreMeasurementID: 502,
        StemGUID: 200,
        IsActive: 1,
        MeasuredDBH: 21.0,
        MeasuredHOM: 1.3,
        MeasurementDate: '2026-03-14',
        RawCodes: 'A',
        Description: null,
        RawTreeTag: 'T2',
        RawStemTag: 'S2',
        StemIsActive: 1,
        TreeIsActive: 1,
        QuadratIsActive: 1,
        PlotID: 1,
        TreeTag: 'T2',
        StemTag: 'S2',
        SpeciesCode: 'SP1',
        QuadratName: 'Q1',
        LocalX: 1,
        LocalY: 1
      },
      {
        CoreMeasurementID: 503,
        StemGUID: 300,
        IsActive: 1,
        MeasuredDBH: 22.0,
        MeasuredHOM: 1.3,
        MeasurementDate: '2026-03-14',
        RawCodes: 'A',
        Description: null,
        RawTreeTag: 'T3',
        RawStemTag: 'S3',
        StemIsActive: 1,
        TreeIsActive: 1,
        QuadratIsActive: 1,
        PlotID: 1,
        TreeTag: 'T3',
        StemTag: 'S3',
        SpeciesCode: 'SP1',
        QuadratName: 'Q1',
        LocalX: 1,
        LocalY: 1
      }
    ];
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) return dbRows;
      return [];
    });

    const R5_EFFECT = {
      id: 'R5',
      severity: 'destructive' as const,
      category: 'destructive' as const,
      title: 'Attribute codes A will be removed',
      detail: '3 row(s) affected',
      affectedTable: 'cmattributes',
      affectedRowCount: 3
    };
    mocks.analyzeBulk.mockResolvedValue({
      dataType: 'measurementssummary',
      rowCount: 3,
      rowPlans: [
        { rowIndex: 0, targetID: 501, status: 'matched' },
        { rowIndex: 1, targetID: 502, status: 'matched' },
        { rowIndex: 2, targetID: 503, status: 'matched' }
      ],
      aggregateEffects: [R5_EFFECT],
      maxSeverity: 'destructive',
      planHash: 'r5-plan-hash',
      generatedAt: '2026-04-20T00:00:00.000Z'
    } as BulkEditPlan);

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'attr-changes.csv',
            rows: [
              { stemid: '100', codes: 'B' },
              { stemid: '200', codes: 'B' },
              { stemid: '300', codes: 'B' }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(1);
    const analyzeBulkArgs = mocks.analyzeBulk.mock.calls[0];
    // args: (cm, schema, dataType, plotID, censusID, bulkInput)
    expect(analyzeBulkArgs[1]).toBe('forestgeo_testing');
    expect(analyzeBulkArgs[2]).toBe('measurementssummary');
    expect(analyzeBulkArgs[3]).toBe(1);
    expect(analyzeBulkArgs[4]).toBe(2);
    const bulkInput = analyzeBulkArgs[5];
    expect(bulkInput.matched).toHaveLength(3);
    expect(bulkInput.matched[0].targetID).toBe(501);
    expect(bulkInput.matched[0].newRow).toEqual({ Attributes: 'B' });
    expect(bulkInput.matched[1].targetID).toBe(502);
    expect(bulkInput.matched[1].newRow).toEqual({ Attributes: 'B' });
    expect(bulkInput.matched[2].targetID).toBe(503);

    const body = await response.json();
    const r5 = body.bulkPlan.aggregateEffects.find((e: { id: string }) => e.id === 'R5');
    expect(r5).toBeTruthy();
    expect(r5.affectedRowCount).toBe(3);
    expect(body.bulkPlan.maxSeverity).toBe('destructive');
  });

  it('forwards duplicateMeasurementIDsToDelete into analyzeBulk so R6 fires with destructive severity when duplicate survivors are detected', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 600,
            StemGUID: 700,
            IsActive: 1,
            MeasuredDBH: 10.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T1',
            RawStemTag: 'S1',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T1',
            StemTag: 'S1',
            SpeciesCode: 'SP1',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 601,
            StemGUID: 700,
            IsActive: 1,
            MeasuredDBH: 10.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T1',
            RawStemTag: 'S1',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T1',
            StemTag: 'S1',
            SpeciesCode: 'SP1',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    const R6_EFFECT = {
      id: 'R6',
      severity: 'destructive' as const,
      category: 'destructive' as const,
      title: '1 duplicate measurement(s) will be deleted',
      detail: 'Survivor selection keeps one measurement per stem in this census; the rest are removed.',
      affectedTable: 'coremeasurements',
      affectedRowCount: 1
    };
    mocks.analyzeBulk.mockResolvedValue({
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 601, status: 'matched' }],
      aggregateEffects: [R6_EFFECT],
      maxSeverity: 'destructive',
      planHash: 'r6-plan-hash',
      generatedAt: '2026-04-20T00:00:00.000Z'
    } as BulkEditPlan);

    const response = await POST(
      buildRequest({
        files: [{ fileName: 'dup.csv', rows: [{ stemid: '700', dbh: '10.0' }] }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const bulkInput = mocks.analyzeBulk.mock.calls[0][5];
    expect(bulkInput.duplicateMeasurementIDsToDelete).toEqual([600]);

    const body = await response.json();
    const r6 = body.bulkPlan.aggregateEffects.find((e: { id: string }) => e.id === 'R6');
    expect(r6).toBeTruthy();
    expect(r6.severity).toBe('destructive');
    expect(body.bulkPlan.maxSeverity).toBe('destructive');
  });

  it('rejects files that do not contain stemid values or tag + stemtag headers', async () => {
    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'unsupported.csv',
            rows: [
              {
                dbh: '15.6',
                comments: 'no match keys here'
              }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Revision file "unsupported.csv" must include stemid values or both tag and stemtag headers'
    });
  });
});
