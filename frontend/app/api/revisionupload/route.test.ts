import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  safeFormatQuery: vi.fn((_schema: string, query: string) => query),
  loggerError: vi.fn(),
  executeQuery: vi.fn(async () => []),
  closeConnection: vi.fn(async () => undefined)
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

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/revisionupload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { name: 'Mason' } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.executeQuery.mockResolvedValue([]);
    mocks.closeConnection.mockResolvedValue(undefined);
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
            StemTag: '10063'
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
            StemTag: '10063'
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
      }
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
            StemTag: '2'
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
