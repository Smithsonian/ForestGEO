import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import {
  cleanupTestMeasurements,
  getFailedMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const FAILED_MEASUREMENTS_DATA_TYPE = 'failedmeasurements';
const READY_FOR_REINGESTION_LABEL = 'Ready for reingestion';
const EXPORTED_TREE_TAG = 'EXPORT_FAIL_1';
const EXPORTED_STEM_TAG = 'S001';
const INVALID_SPECIES_CODE = 'BADSPECIES_EXPORT';
const EMPTY_FILTER_MODEL = { items: [] };

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// A 'global' role satisfies the route's auth() gate and assertSchemaAccess without a
// live session. Mocking @/auth also keeps the real next-auth module out of the
// Node ESM resolver, which cannot load its extensionless `next/server` subpath.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
    },
    closeConnection: async () => undefined
  };

  return {
    default: {
      getInstance: () => manager
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

import { POST as formDownloadPost } from '@/app/api/formdownload/[dataType]/[[...slugs]]/route';

interface ExportedFailedRow {
  failedmeasurementid: number;
  fileid: string;
  batchid: string;
  tag: string;
  stemtag: string;
  spcode: string;
  quadrat: string;
  failureReasons: string | null;
  originalFailureReasons: string | null;
  currentFailureReasons: string | null;
  lastValidatedAt: string | null;
}

describe('Failed-measurements CSV export route (integration, #265)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData, {
      additionalTables: ['uploadintegrityalerts', 'uploadmetrics']
    });
    vi.clearAllMocks();
  });

  async function exportFailedRows(): Promise<ExportedFailedRow[]> {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const url = `http://localhost/api/formdownload/${FAILED_MEASUREMENTS_DATA_TYPE}/${config.database}/${plotID}/${censusID}`;
    const request = new NextRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterModel: EMPTY_FILTER_MODEL })
    });
    const context = {
      params: Promise.resolve({
        dataType: FAILED_MEASUREMENTS_DATA_TYPE,
        slugs: [config.database, String(plotID), String(censusID)]
      })
    } as any;

    const response = await formDownloadPost(request, context);
    const body = await response.json();
    expect(response.status, `export route responded ${response.status}: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body as ExportedFailedRow[];
  }

  async function seedInvalidSpeciesFailure() {
    const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
    if (!quadratName) {
      throw new Error('Test setup failed: missing quadrat data');
    }

    const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
      {
        treeTag: EXPORTED_TREE_TAG,
        stemTag: EXPORTED_STEM_TAG,
        speciesCode: INVALID_SPECIES_CODE,
        quadratName,
        x: 10,
        y: 20,
        dbh: 100,
        hom: 1.3,
        date: '2024-06-15',
        codes: 'A'
      }
    ]);
    const ingestionResult = await runBulkIngestion(connection, fileID, batchID);
    expect(ingestionResult.batch_failed, JSON.stringify(ingestionResult)).toBe(false);

    const failedRows = await getFailedMeasurements(connection, { fileID, batchID });
    expect(failedRows, 'the invalid species code must park exactly one row').toHaveLength(1);
    return { fileID, batchID, failedRow: failedRows[0], quadratName };
  }

  it('exports the stored failure reasons and last-validated time for a parked row instead of blank columns', async () => {
    const { fileID, batchID, failedRow, quadratName } = await seedInvalidSpeciesFailure();
    expect(failedRow.FailureReasons, 'the seeded row must carry an unresolved ingestion reason').toBeTruthy();

    const exported = await exportFailedRows();
    expect(exported, JSON.stringify(exported)).toHaveLength(1);
    const [row] = exported;

    expect(row.failedmeasurementid).toBe(failedRow.FailedMeasurementID);
    expect(row.fileid).toBe(fileID);
    expect(row.batchid).toBe(batchID);
    expect(row.tag).toBe(EXPORTED_TREE_TAG);
    expect(row.stemtag).toBe(EXPORTED_STEM_TAG);
    expect(row.spcode).toBe(INVALID_SPECIES_CODE);
    expect(row.quadrat).toBe(quadratName);

    expect(row.originalFailureReasons, JSON.stringify(row)).toBe(failedRow.FailureReasons);
    expect(row.currentFailureReasons, JSON.stringify(row)).toBe(failedRow.FailureReasons);
    expect(row.failureReasons, JSON.stringify(row)).toBe(failedRow.FailureReasons);
    expect(row.lastValidatedAt, JSON.stringify(row)).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(row.lastValidatedAt as string)), `lastValidatedAt is not a date: ${row.lastValidatedAt}`).toBe(false);
  });

  it('keeps the original reasons and reports the row as ready once every ingestion error is resolved', async () => {
    const { failedRow } = await seedInvalidSpeciesFailure();
    const resolvedAt = new Date('2026-01-02T03:04:05Z');
    await connection.query('UPDATE measurement_error_log SET IsResolved = TRUE, ResolvedAt = ? WHERE MeasurementID = ?', [
      resolvedAt,
      failedRow.FailedMeasurementID
    ]);

    const exported = await exportFailedRows();
    expect(exported, JSON.stringify(exported)).toHaveLength(1);
    const [row] = exported;

    expect(row.originalFailureReasons, JSON.stringify(row)).toBe(failedRow.FailureReasons);
    expect(row.currentFailureReasons, JSON.stringify(row)).toBeNull();
    expect(row.failureReasons, JSON.stringify(row)).toBe(READY_FOR_REINGESTION_LABEL);
    expect(new Date(row.lastValidatedAt as string).getTime(), JSON.stringify(row)).toBe(resolvedAt.getTime());
  });
});
