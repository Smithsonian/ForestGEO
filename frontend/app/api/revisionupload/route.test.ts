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
  generatedAt: '2026-04-20T00:00:00.000Z',
  duplicateDeletions: []
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

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/lib/db/connectionmanager', () => ({
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

vi.mock('@/config/editplan/bulkanalyzer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/editplan/bulkanalyzer')>();
  return { ...actual, analyzeBulk: (...args: unknown[]) => mocks.analyzeBulk(...args) };
});

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
          csvIndex: 0,
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
      collapsedRows: [],
      counts: {
        matched: 1,
        matchedWithChanges: 1,
        new: 0,
        invalid: 0,
        collapsed: 0,
        total: 1
      },
      bulkPlan: EMPTY_BULK_PLAN,
      // Minted fresh by this route per #505 (randomUUID, so not a fixed
      // literal here); asserted present/well-shaped by pattern. The
      // uploadAttemptID/invalidRowsIntegrityHash contract itself — malformed/
      // missing/mismatched — is exercised in depth by apply/route.test.ts,
      // which is where a wrong value actually changes behavior (400/409).
      uploadAttemptID: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      invalidRowsIntegrityHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  // #505 review round 2: route.ts used to mint a brand-new random
  // uploadAttemptID on every call, with no way for a client re-matching the
  // SAME attempt (as opposed to starting a new upload) to retain its
  // identity. The per-attempt failed-row batchID (shared/invalidrowintegrity.ts)
  // is derived from uploadAttemptID, so losing it on a re-match would orphan
  // any evidence already tied to the first attempt.
  it('reuses a valid previousUploadAttemptID as this response uploadAttemptID instead of minting a new one', async () => {
    const PREVIOUS_UPLOAD_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';

    const response = await POST(
      buildRequest({
        rows: [{ tag: 'T1', stemtag: '1', spcode: 'QUAS', quadrat: '101', lx: '1', ly: '2', date: '2026-04-01', dbh: '10.0' }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing',
        previousUploadAttemptID: PREVIOUS_UPLOAD_ATTEMPT_ID
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadAttemptID).toBe(PREVIOUS_UPLOAD_ATTEMPT_ID);
  });

  it('returns 400 when previousUploadAttemptID is present but not a valid UUID', async () => {
    const response = await POST(
      buildRequest({
        rows: [{ tag: 'T1', stemtag: '1', spcode: 'QUAS', quadrat: '101', lx: '1', ly: '2', date: '2026-04-01', dbh: '10.0' }],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing',
        previousUploadAttemptID: 'not-a-uuid'
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'previousUploadAttemptID must be a valid UUID when present' });
    expect(mocks.analyzeBulk).not.toHaveBeenCalled();
  });

  it('mints a fresh uploadAttemptID when previousUploadAttemptID is omitted (a genuinely new upload)', async () => {
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
    expect(body.uploadAttemptID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
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

  it('demotes only the row with an out-of-range cell, instead of 422ing the whole file with no row locator', async () => {
    // computeDiff canonicalizes numeric cells, so one bad value used to throw
    // out of the match loop and reject every row in the upload with a bare
    // field name — unusable on a 10,000-row revision file.
    const MATCHED_ROWS = [
      { CoreMeasurementID: 777, RawTreeTag: 'TREE-7', TreeTag: 'TREE-7', StemTag: '2', RawStemTag: '2' },
      { CoreMeasurementID: 778, RawTreeTag: 'TREE-8', TreeTag: 'TREE-8', StemTag: '2', RawStemTag: '2' }
    ];

    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes("LOWER(TRIM(COALESCE(t.TreeTag, cm.RawTreeTag, '')))")) {
        return MATCHED_ROWS.map(row => ({
          ...row,
          StemGUID: row.CoreMeasurementID,
          IsActive: 1,
          MeasuredDBH: 12.4,
          MeasuredHOM: 1.1,
          MeasurementDate: '2025-05-01',
          RawCodes: null,
          Description: null,
          StemIsActive: 1,
          TreeIsActive: 1,
          QuadratIsActive: 1,
          PlotID: 1,
          SpeciesCode: 'AAAAAA',
          QuadratName: '101',
          LocalX: 1.5,
          LocalY: 2.5
        }));
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        rows: [
          { tag: 'TREE-7', stemtag: '2', dbh: '12.8' },
          { tag: 'TREE-8', stemtag: '2', dbh: '9999999' }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.matchedRows).toHaveLength(1);
    expect(body.matchedRows[0].csvIndex).toBe(0);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0].csvIndex).toBe(1);
    expect(body.invalidRows[0].reason).toMatch(/MeasuredDBH/);
  });

  // #505 regression: the first occurrence of a repeated stemid used to be
  // invalidated right alongside its later duplicate(s), losing the one
  // legitimate row entirely. The first occurrence must survive (here: as a
  // newRow, since the stemid lookup resolves to no DB row) and only the
  // later same-key row(s) with genuinely different content are rejected —
  // with a stable csvIndex apply can later persist as a DUPLICATE_ENTRY
  // failed measurement.
  it('keeps the first occurrence of a duplicate stemid and flags only the later copy as invalid (#505)', async () => {
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

    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0].csvIndex).toBe(1);
    expect(body.invalidRows[0].reason).toMatch(/duplicate stemid 100/);
    expect(body.collapsedRows).toHaveLength(0);
    expect(body.newRows).toHaveLength(2);
    expect(body.newRows.map((row: { csvIndex: number }) => row.csvIndex)).toEqual([0, 2]);
    expect(body.newRows[0].csvRow.stemid).toBe('100');
    expect(body.newRows[1].csvRow.stemid).toBe('200');
    expect(body.counts).toMatchObject({ new: 2, invalid: 1, collapsed: 0, total: 3 });
  });

  it('keeps the first occurrence of a duplicate tag+stemtag and flags only the later copy as invalid (#505)', async () => {
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

    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0].csvIndex).toBe(1);
    expect(body.invalidRows[0].reason).toMatch(/duplicate tag\+stemtag/);
    expect(body.newRows).toHaveLength(1);
    expect(body.newRows[0].csvIndex).toBe(0);
  });

  // #505: an EXACT duplicate (identical content, not just the same key) must
  // follow the same survive-first/invalidate-later rule as a content-differing
  // duplicate — the bug this regresses against invalidated BOTH copies of an
  // exact duplicate, losing the only legitimate occurrence.
  it('keeps the first occurrence of an EXACT duplicate row (identical content) and flags only the later copy as invalid (#505)', async () => {
    mocks.executeQuery.mockResolvedValue([]);

    const identicalRow = { stemid: '300', tag: 't3', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '10.0', date: '2026-04-01' };

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'exact-duplicates.csv',
            rows: [identicalRow, { ...identicalRow }]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.newRows).toHaveLength(1);
    expect(body.newRows[0].csvIndex).toBe(0);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0].csvIndex).toBe(1);
    expect(body.invalidRows[0].reason).toMatch(/duplicate stemid 300/);
    expect(body.collapsedRows).toHaveLength(0);
  });

  // #505: a later row sharing a match key with an earlier row, differing only
  // beyond coremeasurements' stored DECIMAL(12,6) precision (export-tool float
  // rounding noise in the 7th+ decimal), must collapse into the earlier row
  // instead of invalidating either copy — this is accounting-only, not a
  // failure, and must show up in counts.collapsed/total.
  it('collapses a later row into the earlier occurrence when they differ only beyond stored DECIMAL(12,6) precision (#505)', async () => {
    mocks.executeQuery.mockResolvedValue([]);

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'precision-noise.csv',
            rows: [
              { stemid: '400', tag: 't4', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '44.000000', date: '2026-04-01' },
              { stemid: '400', tag: 't4', stemtag: 's', spcode: 'quas', quadrat: 'q', lx: '1', ly: '1', dbh: '44.0000004', date: '2026-04-01' }
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

    expect(body.invalidRows).toHaveLength(0);
    expect(body.newRows).toHaveLength(1);
    expect(body.newRows[0].csvIndex).toBe(0);
    expect(body.collapsedRows).toHaveLength(1);
    expect(body.collapsedRows[0]).toMatchObject({ csvIndex: 1, collapsedIntoCsvIndex: 0 });
    expect(body.counts).toMatchObject({ new: 1, invalid: 0, collapsed: 1, total: 2 });
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

  it('does not pass NULL identity fields into the analyzer payload (regression: round-trip CSV with NULL on TreeTag/SpeciesCode/etc must not 422 invalid clear)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 700,
            StemGUID: 5283335,
            IsActive: 1,
            MeasuredDBH: 1,
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
            SpeciesCode: 'SLOATE',
            QuadratName: 'Q1',
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
            // Simulates the View Data CSV roundtrip the user uploaded for
            // RABI Census 3: every column is present, identity columns are
            // literal "NULL" placeholders meaning "no change", and only one
            // field (spcode) actually changed. Before the diff-driven analyzer
            // payload, NULL on TreeTag/StemTag/QuadratName/MeasurementDate
            // would 422 with `invalid clear` because those fields have
            // policy=invalid-clear in canonicalizeEditPayload.
            fileName: 'roundtrip-with-identity.csv',
            rows: [
              {
                stemid: '5283335',
                tag: null,
                stemtag: null,
                spcode: 'NEWSPC',
                quadrat: null,
                lx: null,
                ly: null,
                date: null,
                dbh: null,
                hom: null,
                codes: null,
                comments: null
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
    expect(body.matchedRows[0].changes).toEqual({ spcode: { from: 'SLOATE', to: 'NEWSPC' } });

    // The bulk-plan input must contain ONLY the diffed field. No null entries
    // for TreeTag, StemTag, QuadratName, MeasurementDate (which would 422
    // `invalid clear` if they reached canonicalizeEditPayload).
    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(1);
    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as { matched: Array<{ newRow: Record<string, unknown> }> };
    expect(bulkInput.matched).toHaveLength(1);
    expect(bulkInput.matched[0].newRow).toEqual({ SpeciesCode: 'NEWSPC' });
  });

  it('demotes matched rows to invalidRows when their spcode change targets an unknown species (regression: #427 batch grouping, not a route-level species pre-check, is the single source of truth — the unknown-species row must still reach analyzeBulk)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string, _params?: unknown[]) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 701,
            StemGUID: 5283335,
            IsActive: 1,
            MeasuredDBH: 12.5,
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
            SpeciesCode: 'SLOATE',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 702,
            StemGUID: 5283336,
            IsActive: 1,
            MeasuredDBH: 14.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T2',
            RawStemTag: 'S2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T2',
            StemTag: 'S2',
            SpeciesCode: 'SLOATE',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    // analyzeBulk (mocked here, but see bulkanalyzer.ts phase 1 for the real
    // implementation) is the ONLY place that decides a species code is
    // unknown: it converts a thrown SpeciesNotFoundError into this
    // status:'invalid' rowPlan. Row 1 (REALSPC) resolves and matches fine.
    mocks.analyzeBulk
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 2,
        rowPlans: [
          { rowIndex: 0, targetID: 701, status: 'invalid', reason: 'Species not found: CHANGED' },
          {
            rowIndex: 1,
            targetID: 702,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 702,
              fieldChanges: [{ field: 'SpeciesCode', from: 'SLOATE', to: 'REALSPC' }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan-702',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          }
        ]
      })
      // Second call: route re-runs analyzeBulk on the surviving row only,
      // exactly like the TreeStemResolution demote-and-re-run path.
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: 702, status: 'matched' }],
        planHash: 'plan-after-species-demotion'
      });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'unknown-species.csv',
            rows: [
              { stemid: '5283335', spcode: 'CHANGED' },
              { stemid: '5283336', spcode: 'REALSPC' }
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
    expect(body.matchedRows[0].coreMeasurementID).toBe(702);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0]).toMatchObject({
      csvIndex: 0,
      reason: 'Species not found: CHANGED'
    });

    expect(mocks.analyzeBulk, 'route-level pre-validation must not strip the unknown-species row before analyzeBulk ever sees it').toHaveBeenCalledTimes(2);
    const firstCallInput = (mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number; explicitSpeciesCode?: string | null }>;
    };
    expect(
      firstCallInput.matched.map(m => m.targetID),
      'both rows, including the unknown-species one, must reach the FIRST analyzeBulk call so #427 batch grouping can see them'
    ).toEqual([701, 702]);
    expect(firstCallInput.matched.map(m => m.explicitSpeciesCode)).toEqual(['CHANGED', 'REALSPC']);

    const secondCallInput = (mocks.analyzeBulk.mock.calls[1] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number }>;
    };
    expect(secondCallInput.matched.map(m => m.targetID)).toEqual([702]);
    expect(body.bulkPlan.planHash).toBe('plan-after-species-demotion');
  });

  it('demotes matched rows whose plan has a blocking TreeStemResolution error into invalidRows and re-runs the bulk plan on the survivors (regression: a quadrat-not-found row should land in the Invalid tab, not block the whole batch)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 901,
            StemGUID: 5283335,
            IsActive: 1,
            MeasuredDBH: 12.5,
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
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 902,
            StemGUID: 5283336,
            IsActive: 1,
            MeasuredDBH: 14.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T2',
            RawStemTag: 'S2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T2',
            StemTag: 'S2',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    // First analyzeBulk call: row at array index 0 (target 901) was demoted
    // by the analyzer because its quadrat change target ('999') doesn't
    // resolve. Row 1 (target 902) is fine.
    mocks.analyzeBulk
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 2,
        rowPlans: [
          {
            rowIndex: 0,
            targetID: 901,
            status: 'invalid',
            reason: 'Row 1: quadrat "999" was not found in this plot/census'
          },
          {
            rowIndex: 1,
            targetID: 902,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 902,
              fieldChanges: [{ field: 'MeasuredDBH', from: 14, to: 15 }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          }
        ]
      })
      // Second call: route re-runs analyzeBulk on the surviving row only.
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 1,
        rowPlans: [
          {
            rowIndex: 0,
            targetID: 902,
            status: 'matched'
          }
        ],
        planHash: 'plan-after-demotion'
      });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'quadrat-not-found.csv',
            rows: [
              { stemid: '5283335', quadrat: '999' },
              { stemid: '5283336', dbh: '15.0' }
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
    expect(body.matchedRows[0].coreMeasurementID).toBe(902);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0]).toMatchObject({
      csvIndex: 0,
      reason: 'Row 1: quadrat "999" was not found in this plot/census'
    });
    expect(body.bulkPlan.planHash).toBe('plan-after-demotion');

    // Re-run is essential: classify's plan hash must match what /apply would
    // compute on the survivor-only payload. Otherwise every apply 409s with
    // a phantom drift.
    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(2);
    const firstCallInput = (mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number }>;
    };
    const secondCallInput = (mocks.analyzeBulk.mock.calls[1] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number }>;
      invalid: Array<{ rowIndex: number }>;
    };
    expect(firstCallInput.matched.map(m => m.targetID)).toEqual([901, 902]);
    expect(secondCallInput.matched.map(m => m.targetID)).toEqual([902]);
    // The demoted row now appears in the bulkInput.invalid list (under its
    // CSV index), so apply's analyzeBulk on the same input shape will hash
    // identically.
    expect(secondCallInput.invalid.map(i => i.rowIndex)).toEqual([0]);
  });

  const GROUP_CONFLICT_TREE_ID = 42;
  const GROUP_CONFLICT_ROW_INDEXES = [0, 1];
  const GROUP_SPECIES_CONFLICT_ERROR = {
    kind: 'TreeStemResolution',
    subject: 'species',
    reason: 'group_species_conflict',
    field: 'SpeciesCode',
    message: `Tree T#${GROUP_CONFLICT_TREE_ID} (TreeTag "T1") has conflicting species corrections requested in this batch: "BBB", "CCC". Submit one species per tree in a single batch.`,
    severity: 'destructive',
    blocking: true,
    treeID: GROUP_CONFLICT_TREE_ID,
    rowIndex: GROUP_CONFLICT_ROW_INDEXES[0],
    rowIndexes: GROUP_CONFLICT_ROW_INDEXES
  } as const;

  function mockTwoStemDbRows() {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 901,
            StemGUID: 5283335,
            IsActive: 1,
            MeasuredDBH: 12.5,
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
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 902,
            StemGUID: 5283336,
            IsActive: 1,
            MeasuredDBH: 14.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T2',
            RawStemTag: 'S2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T2',
            StemTag: 'S2',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });
  }

  function postTwoStemRequest() {
    return POST(
      buildRequest({
        files: [
          {
            fileName: 'group-species-conflict.csv',
            rows: [
              { stemid: '5283335', spcode: 'BBB' },
              { stemid: '5283336', spcode: 'CCC' }
            ]
          }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );
  }

  it('skips the demote-and-re-run entirely when the plan carries a batch-level group blocker (#427), keeping the row that would have been demoted inside matchedRows and preserving the group error in the response', async () => {
    mockTwoStemDbRows();

    // Row 0 (target 901) individually threw TargetNotFoundError/SpeciesNotFoundError
    // in phase 1 (status:'invalid'), which would normally be demoted; row 1
    // (target 902) matched fine. Both also triggered phase 2's group conflict.
    mocks.analyzeBulk.mockResolvedValueOnce({
      ...EMPTY_BULK_PLAN,
      rowCount: 2,
      rowPlans: [
        {
          rowIndex: 0,
          targetID: 901,
          status: 'invalid',
          reason: 'Row 1: species "BBB" was not found'
        },
        {
          rowIndex: 1,
          targetID: 902,
          status: 'matched',
          plan: {
            dataType: 'measurementssummary',
            targetID: 902,
            fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'CCC' }],
            effects: [],
            errors: [],
            canApply: true,
            maxSeverity: 'info',
            planHash: 'inner-plan-902',
            generatedAt: '2026-04-20T00:00:00.000Z'
          }
        }
      ],
      errors: [GROUP_SPECIES_CONFLICT_ERROR],
      maxSeverity: 'destructive',
      planHash: 'plan-with-group-blocker'
    });

    const response = await postTwoStemRequest();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(
      mocks.analyzeBulk,
      'a batch-level group blocker already makes canApply false; re-running on survivors only would drop row 0 explicitSpeciesCode and silently erase the conflict'
    ).toHaveBeenCalledTimes(1);
    const firstCallInput = (mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number; explicitSpeciesCode?: string | null }>;
    };
    expect(
      firstCallInput.matched.map(m => m.targetID),
      'the row that would normally be demoted (901, unknown species "BBB") must reach analyzeBulk alongside the valid correction row (902) — not an empty/near-empty input'
    ).toEqual([901, 902]);
    expect(firstCallInput.matched.map(m => m.explicitSpeciesCode)).toEqual(['BBB', 'CCC']);
    expect(
      body.matchedRows.map((r: { coreMeasurementID: number }) => r.coreMeasurementID),
      'row 901 would normally be demoted into invalidRows, but must stay in matchedRows while a group blocker is present'
    ).toEqual([901, 902]);
    expect(
      body.invalidRows,
      'the would-be-demoted row must not be pushed into invalidRows without also leaving matchedRows (would double-count it in counts)'
    ).toHaveLength(0);
    expect(body.counts).toMatchObject({ matched: 2, invalid: 0, total: 2 });
    expect(body.bulkPlan.errors).toEqual([GROUP_SPECIES_CONFLICT_ERROR]);
  });

  it('still demotes and re-runs when the only blocking error is a non-group TreeStemResolution reason (regression: the #427 gate must match only reason values prefixed "group_", not any blocking error)', async () => {
    mockTwoStemDbRows();

    mocks.analyzeBulk
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 2,
        rowPlans: [
          {
            rowIndex: 0,
            targetID: 901,
            status: 'invalid',
            reason: 'Matching stem exists in a different quadrat'
          },
          {
            rowIndex: 1,
            targetID: 902,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 902,
              fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'CCC' }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan-902',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          }
        ],
        errors: [
          {
            kind: 'TreeStemResolution',
            subject: 'stem',
            reason: 'different_quadrat',
            field: 'QuadratName',
            message: 'Matching stem exists in a different quadrat',
            severity: 'destructive',
            blocking: true,
            rowIndex: 0
          }
        ],
        maxSeverity: 'destructive'
      })
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: 902, status: 'matched' }],
        planHash: 'plan-after-demotion-non-group'
      });

    const response = await postTwoStemRequest();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(
      mocks.analyzeBulk,
      'a non-group blocking error must not engage the #427 gate; demotion+re-run is still required so classify and apply hash the same survivor-only input'
    ).toHaveBeenCalledTimes(2);
    expect(body.matchedRows.map((r: { coreMeasurementID: number }) => r.coreMeasurementID)).toEqual([902]);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0]).toMatchObject({ csvIndex: 0, reason: 'Matching stem exists in a different quadrat' });
    expect(body.bulkPlan.planHash).toBe('plan-after-demotion-non-group');
  });

  it('keeps an unknown-explicit species row from file 2 in the SAME batch analyzeBulk call as a correction requested in file 1 (regression: #427 grouping must see every file in the request, not just the file a row originated in)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 951,
            StemGUID: 6000001,
            IsActive: 1,
            MeasuredDBH: 12.5,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T9',
            RawStemTag: 'S1',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T9',
            StemTag: 'S1',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 952,
            StemGUID: 6000002,
            IsActive: 1,
            MeasuredDBH: 14.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T9',
            RawStemTag: 'S2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T9',
            StemTag: 'S2',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    // The file-1 row (951, requesting "BBB") is the correction request; the
    // file-2 row (952, requesting unknown "ZZZZ") is the sibling that must
    // still reach the same batch call so #427 grouping can see both.
    mocks.analyzeBulk
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 2,
        rowPlans: [
          {
            rowIndex: 0,
            targetID: 951,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 951,
              fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'BBB' }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan-951',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          },
          { rowIndex: 1, targetID: 952, status: 'invalid', reason: 'Species not found: ZZZZ' }
        ]
      })
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, targetID: 951, status: 'matched' }],
        planHash: 'plan-after-multifile-demotion'
      });

    const response = await POST(
      buildRequest({
        files: [
          { fileName: 'file-1.csv', rows: [{ stemid: '6000001', spcode: 'BBB' }] },
          { fileName: 'file-2.csv', rows: [{ stemid: '6000002', spcode: 'ZZZZ' }] }
        ],
        plotID: 1,
        censusID: 2,
        schema: 'forestgeo_testing'
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.analyzeBulk, 'file-1 and file-2 rows must combine into a SINGLE batch analyzeBulk call, not one call per file').toHaveBeenCalledTimes(2);
    const firstCallInput = (mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number; explicitSpeciesCode?: string | null }>;
    };
    expect(
      firstCallInput.matched.map(m => m.targetID),
      'the file-2 row (952) must reach the same analyzeBulk call as the file-1 row (951), proving per-file classification does not isolate batch grouping'
    ).toEqual([951, 952]);
    expect(firstCallInput.matched.map(m => m.explicitSpeciesCode)).toEqual(['BBB', 'ZZZZ']);

    expect(body.matchedRows.map((r: { coreMeasurementID: number }) => r.coreMeasurementID)).toEqual([951]);
    expect(body.invalidRows).toHaveLength(1);
    expect(body.invalidRows[0]).toMatchObject({ reason: 'Species not found: ZZZZ' });
    expect(body.bulkPlan.planHash).toBe('plan-after-multifile-demotion');
  });

  it('surfaces an unrelated unknown-species row into invalidRows while a batch-level group blocker is present, without erasing the group conflict (regression: surfacing invalid rows and preserving the group blocker are separate concerns)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 901,
            StemGUID: 5283335,
            IsActive: 1,
            MeasuredDBH: 12.5,
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
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 902,
            StemGUID: 5283336,
            IsActive: 1,
            MeasuredDBH: 14.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T1',
            RawStemTag: 'S2',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T1',
            StemTag: 'S2',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 903,
            StemGUID: 5283337,
            IsActive: 1,
            MeasuredDBH: 9.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T3',
            RawStemTag: 'S3',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T3',
            StemTag: 'S3',
            SpeciesCode: 'AAA',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          }
        ];
      }
      return [];
    });

    // Rows 0/1 (901/902) conflict on tree T1's species ("BBB" vs "CCC") and
    // are named by the group blocker's rowIndexes — they must survive any
    // demotion. Row 2 (903, unrelated tree T3) independently requests an
    // unknown species and is a genuine demotion candidate.
    mocks.analyzeBulk
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 3,
        rowPlans: [
          { rowIndex: 0, targetID: 901, status: 'invalid', reason: 'Row 1: species "BBB" was not found' },
          {
            rowIndex: 1,
            targetID: 902,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 902,
              fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'CCC' }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan-902',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          },
          { rowIndex: 2, targetID: 903, status: 'invalid', reason: 'Species not found: ZZZZ' }
        ],
        errors: [GROUP_SPECIES_CONFLICT_ERROR],
        maxSeverity: 'destructive'
      })
      .mockResolvedValueOnce({
        ...EMPTY_BULK_PLAN,
        rowCount: 2,
        rowPlans: [
          { rowIndex: 0, targetID: 901, status: 'invalid', reason: 'Row 1: species "BBB" was not found' },
          {
            rowIndex: 1,
            targetID: 902,
            status: 'matched',
            plan: {
              dataType: 'measurementssummary',
              targetID: 902,
              fieldChanges: [{ field: 'SpeciesCode', from: 'AAA', to: 'CCC' }],
              effects: [],
              errors: [],
              canApply: true,
              maxSeverity: 'info',
              planHash: 'inner-plan-902',
              generatedAt: '2026-04-20T00:00:00.000Z'
            }
          }
        ],
        errors: [GROUP_SPECIES_CONFLICT_ERROR],
        maxSeverity: 'destructive',
        planHash: 'plan-group-blocker-with-unrelated-demotion'
      });

    const response = await POST(
      buildRequest({
        files: [
          {
            fileName: 'group-plus-unrelated-unknown.csv',
            rows: [
              { stemid: '5283335', spcode: 'BBB' },
              { stemid: '5283336', spcode: 'CCC' },
              { stemid: '5283337', spcode: 'ZZZZ' }
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

    // The re-run DOES fire here (row 903 is a genuine, group-unrelated
    // demotion), unlike the group-blocker-only test above. What must NOT
    // happen is the group-implicated rows (901, 902) being dropped from the
    // re-run input — see route.ts's groupImplicatedRowIndexes exclusion.
    expect(
      mocks.analyzeBulk,
      'an unrelated demotable row still triggers a re-run; only group-implicated rows are protected from demotion'
    ).toHaveBeenCalledTimes(2);
    const firstCallInput = (mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number; explicitSpeciesCode?: string | null }>;
    };
    expect(firstCallInput.matched.map(m => m.targetID)).toEqual([901, 902, 903]);
    expect(firstCallInput.matched.map(m => m.explicitSpeciesCode)).toEqual(['BBB', 'CCC', 'ZZZZ']);

    const secondCallInput = (mocks.analyzeBulk.mock.calls[1] as unknown as Array<unknown>)[5] as {
      matched: Array<{ targetID: number; explicitSpeciesCode?: string | null }>;
    };
    expect(
      secondCallInput.matched.map(m => m.targetID),
      'the group-implicated rows (901, 902) must survive the re-run — dropping either would silently erase the group conflict'
    ).toEqual([901, 902]);
    expect(secondCallInput.matched.map(m => m.explicitSpeciesCode)).toEqual(['BBB', 'CCC']);

    expect(body.matchedRows.map((r: { coreMeasurementID: number }) => r.coreMeasurementID)).toEqual([901, 902]);
    expect(body.invalidRows, 'the unrelated unknown-species row (903) must be surfaced into invalidRows').toHaveLength(1);
    expect(body.invalidRows[0]).toMatchObject({ csvIndex: 2, reason: 'Species not found: ZZZZ' });
    expect(body.bulkPlan.errors, 'the group blocker must still be present in the final response').toEqual([GROUP_SPECIES_CONFLICT_ERROR]);
    expect(body.bulkPlan.planHash).toBe('plan-group-blocker-with-unrelated-demotion');
  });

  it('does not send leading-zero-mangled identity fields into the analyzer payload (regression: round-trip CSV must not surface fake bulk-plan changes for tag/stemtag/quadrat)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 800,
            StemGUID: 5283366,
            IsActive: 1,
            MeasuredDBH: 44.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: 'Q;L',
            Description: 'unchanged',
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
            fileName: 'leading-zero-roundtrip.csv',
            rows: [
              {
                // Spreadsheet-mangled values: '10063' (unchanged) and '101'
                // (was '0101' in DB). Per FIELD_DESCRIPTORS for tag/stemtag/
                // quadrat, the leading-zero tolerance treats both sides as
                // equivalent — so computeDiff returns {} and the analyzer
                // payload must also be empty (no fake fieldChanges in the
                // bulk plan).
                stemid: '5283366',
                tag: '10063',
                stemtag: '10063',
                quadrat: '101',
                spcode: 'CRUD02'
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

    expect(mocks.analyzeBulk).toHaveBeenCalledTimes(1);
    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as { matched: Array<{ newRow: Record<string, unknown> }> };
    expect(bulkInput.matched).toHaveLength(1);
    expect(bulkInput.matched[0].newRow).toEqual({});
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

  it('promotes identity edits (spcode, ly) into changes so they flow through the bulk plan analyzer', async () => {
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
            fileName: 'identity-edits.csv',
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
    expect(body.matchedRows[0].changes).toEqual({
      spcode: { from: 'SLOATE', to: 'AAAAAA' },
      ly: { from: '2.4', to: '1111' }
    });
  });

  it('tolerates leading-zero differences on quadrat/tag/stemtag so spreadsheet-mangled round-trips do not produce fake changes', async () => {
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
    // Identity fields flow through `changes`, but the leading-zero tolerance
    // still applies — none of the identity columns in this CSV genuinely
    // differ from the DB after digit-string normalization.
    expect(body.matchedRows[0].changes).toEqual({});
  });

  it('reports tag changes for long digit-only tags that differ beyond JS safe integer range', async () => {
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
    expect(body.matchedRows[0].changes).toEqual({
      tag: { from: '9007199254740993', to: '9007199254740992' }
    });
  });

  it('reports a quadrat change when CSV value is genuinely different, not just leading-zero mangled', async () => {
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
    expect(body.matchedRows[0].changes).toEqual({
      quadrat: { from: '0101', to: '999' }
    });
  });

  it('keeps spcode comparison strict so alphanumeric species codes like CRUD02 vs CRUD2 are flagged as changes', async () => {
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
    expect(body.matchedRows[0].changes).toEqual({
      spcode: { from: 'CRUD02', to: 'CRUD2' }
    });
  });

  it('does not report changes when CSV and DB values for identity columns agree', async () => {
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
    expect(body.matchedRows[0].changes).toEqual({});
  });

  it('includes a bulkPlan in the response shaped as a BulkEditPlan with rowPlans, aggregateEffects, maxSeverity and a planHash', async () => {
    const capturedBulkPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 401, status: 'matched' }],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'captured-plan-hash',
      generatedAt: '2026-04-20T00:00:00.000Z',
      duplicateDeletions: []
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
      generatedAt: '2026-04-20T00:00:00.000Z',
      duplicateDeletions: []
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
      generatedAt: '2026-04-20T00:00:00.000Z',
      duplicateDeletions: []
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
    expect(bulkInput.duplicateMeasurementIDsToDelete).toEqual([{ coreMeasurementID: 600, survivorCoreMeasurementID: 601 }]);

    const body = await response.json();
    const r6 = body.bulkPlan.aggregateEffects.find((e: { id: string }) => e.id === 'R6');
    expect(r6).toBeTruthy();
    expect(r6.severity).toBe('destructive');
    expect(body.bulkPlan.maxSeverity).toBe('destructive');
  });

  it('carries explicitSpeciesCode into the bulk input for matched rows, even when the spcode cell is unchanged and dropped from newRow (#427 batch species-correction grouping needs the sibling signal computeDiff throws away)', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('cm.StemGUID IN')) {
        return [
          {
            CoreMeasurementID: 801,
            StemGUID: 801,
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
            SpeciesCode: 'QUEMAR',
            QuadratName: 'Q1',
            LocalX: 1,
            LocalY: 1
          },
          {
            CoreMeasurementID: 802,
            StemGUID: 802,
            IsActive: 1,
            MeasuredDBH: 11.0,
            MeasuredHOM: 1.3,
            MeasurementDate: '2026-03-14',
            RawCodes: null,
            Description: null,
            RawTreeTag: 'T2',
            RawStemTag: 'S1',
            StemIsActive: 1,
            TreeIsActive: 1,
            QuadratIsActive: 1,
            PlotID: 1,
            TreeTag: 'T2',
            StemTag: 'S1',
            SpeciesCode: 'QUEMAR',
            QuadratName: 'Q1',
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
            fileName: 'explicit-species.csv',
            rows: [
              // Row 0: spcode retyped with a case-only match against the DB
              // value — computeDiff reports no change, so newRow has no
              // SpeciesCode, but the request still explicitly named 'quemar'.
              { stemid: '801', spcode: 'quemar' },
              // Row 1: blank spcode — genuinely unspecified.
              { stemid: '802', spcode: '' }
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
    expect(body.matchedRows).toHaveLength(2);
    expect(body.matchedRows[0].changes).toEqual({});

    const analyzeArgs = mocks.analyzeBulk.mock.calls[0] as unknown as Array<unknown>;
    const bulkInput = analyzeArgs[5] as {
      matched: Array<{ targetID: number; newRow: Record<string, unknown>; explicitSpeciesCode?: string | null }>;
    };
    expect(bulkInput.matched).toHaveLength(2);

    const row0 = bulkInput.matched.find(m => m.targetID === 801)!;
    expect(row0.newRow).toEqual({});
    expect(row0.explicitSpeciesCode).toBe('quemar');

    const row1 = bulkInput.matched.find(m => m.targetID === 802)!;
    expect(row1.explicitSpeciesCode).toBeNull();
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
