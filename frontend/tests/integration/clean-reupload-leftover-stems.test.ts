/**
 * CLEAN_REUPLOAD leftover stems/trees — Integration Tests (issue #489)
 *
 * trees and stems are census-scoped, and ingestion reuses an existing
 * current-census stem on (TreeID, CensusID, StemTag) without updating its
 * quadrat or coordinates. A census replacement deletes only measurements, so
 * every earlier upload's trees/stems stay behind. On Cooks Branch that produced
 * false validation-7 species flags and STEM_RESOLUTION_FAILED rows (measured
 * 2026-09-24: 33 leftover stems, 21 leftover trees).
 *
 * The fix rebuilds a measurement-less stem from the incoming row that names it
 * (TreeTag + StemTag) while carrying its StemCrossID and PublishedStemID, which
 * re-ingestion cannot otherwise recover for a first-census stem when the
 * replacement file omits the optional PublishedStemID column.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/clean-reupload-leftover-stems.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  createAdditionalCensus,
  getValidationErrors,
  insertTestMeasurements,
  runBulkIngestion,
  runValidationForTest,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[clean-reupload-leftover-stems] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite deletes stems and trees.`);
}

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  counter: 0
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (sql: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(sql, params ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.counter += 1;
      sharedState.activeTransactionID = `leftover-stems-tx-${sharedState.counter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async () => {
      await sharedState.connection!.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await sharedState.connection!.rollback();
      sharedState.activeTransactionID = null;
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { cleanupPreviousFileUploads } from '@/lib/ingestion/temporary-measurements';

type MeasurementRow = Parameters<typeof insertTestMeasurements>[2][number];

const ORIGINAL_FILE = 'original.csv';
const REPLACEMENT_FILE = 'replacement.csv';
const LATER_CENSUS_FILE = 'later-census.csv';

const FIRST_CENSUS_DATE = '2024-03-15';
const SECOND_VISIT_DATE = '2024-06-15';
const LATER_CENSUS = { plotCensusNumber: 2, startDate: '2025-01-01', endDate: '2025-12-31' };
const LATER_CENSUS_DATE = '2025-03-15';

const VALIDATION_DIFFERENT_SPECIES = 7;
const UNCHANGED_PUBLISHED_STEM_ID = 5001;
const SPECIES_FIX_PUBLISHED_STEM_ID = 5002;
const QUADRAT_FIX_PUBLISHED_STEM_ID = 5003;

function row(treeTag: string, speciesCode: string, quadratName: string, date: string, publishedStemID: number | null = null): MeasurementRow {
  return { treeTag, stemTag: '1', speciesCode, quadratName, x: 5, y: 5, dbh: 10, hom: 1.3, date, publishedStemID };
}

describe('CLEAN_REUPLOAD leftover stems and trees (#489) — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let censusID: number;
  let connectionManager: ReturnType<typeof ConnectionManager.getInstance>;
  let batchCounter = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    sharedState.connection = connection;
    connectionManager = ConnectionManager.getInstance();
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    console.log(`[setup] schema=${schema} plot=${plotID} census=${censusID}`);
  }, 120000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await connection.query(`DELETE FROM specimens`);
    await cleanupTestMeasurements(connection, testData, { preserveCensusCount: 1 });
    testData.census.length = 1;
  });

  async function ingest(fileID: string, rows: MeasurementRow[], targetCensusID = censusID): Promise<string> {
    batchCounter += 1;
    const batchID = `batch-${batchCounter}`;
    await insertTestMeasurements(connection, testData, rows, { censusID: targetCensusID, fileID, batchID });
    const result = await runBulkIngestion(connection, fileID, batchID);
    expect(result.success, `ingestion of ${fileID}/${batchID}: ${result.message}`).toBe(true);
    return batchID;
  }

  async function cleanReupload(rows: MeasurementRow[], targetCensusID = censusID): Promise<void> {
    const incomingBatchID = `batch-${batchCounter + 1}`;
    const transactionID = await connectionManager.beginTransaction();
    await cleanupPreviousFileUploads(connectionManager, schema, REPLACEMENT_FILE, incomingBatchID, plotID, targetCensusID, transactionID);
    await connectionManager.commitTransaction(transactionID);
    await ingest(REPLACEMENT_FILE, rows, targetCensusID);
  }

  async function stemsByTag(forCensusID: number): Promise<Record<string, Array<Record<string, unknown>>>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, sp.SpeciesCode, q.QuadratName, s.StemGUID, s.StemCrossID, s.PublishedStemID,
              (SELECT COUNT(*) FROM coremeasurements cm WHERE cm.StemGUID = s.StemGUID) AS Measurements
       FROM stems s
       JOIN trees t ON t.TreeID = s.TreeID
       JOIN species sp ON sp.SpeciesID = t.SpeciesID
       JOIN quadrats q ON q.QuadratID = s.QuadratID
       WHERE s.CensusID = ?
       ORDER BY t.TreeTag, sp.SpeciesCode`,
      [forCensusID]
    );
    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const stem of rows) {
      const tag = String(stem.TreeTag);
      grouped[tag] = [
        ...(grouped[tag] ?? []),
        {
          species: stem.SpeciesCode,
          quadrat: stem.QuadratName,
          stemGUID: Number(stem.StemGUID),
          stemCrossID: stem.StemCrossID === null ? null : Number(stem.StemCrossID),
          publishedStemID: stem.PublishedStemID === null ? null : Number(stem.PublishedStemID),
          measurements: Number(stem.Measurements)
        }
      ];
    }
    return grouped;
  }

  async function failedRows(forCensusID: number): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.RawTreeTag, me.ErrorCode, me.ErrorMessage
       FROM coremeasurements cm
       JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.CensusID = ? AND cm.StemGUID IS NULL`,
      [forCensusID]
    );
    return rows;
  }

  async function treeTagsWithSpecies(forCensusID: number): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, sp.SpeciesCode FROM trees t JOIN species sp ON sp.SpeciesID = t.SpeciesID WHERE t.CensusID = ? ORDER BY t.TreeTag, sp.SpeciesCode`,
      [forCensusID]
    );
    return rows.map(tree => `${tree.TreeTag}:${tree.SpeciesCode}`);
  }

  it('#489: a re-upload that corrects a species and moves a stem ingests without failures or species flags', async () => {
    await ingest(ORIGINAL_FILE, [row('SPECIES-FIX', 'ACERRU', 'Q01', FIRST_CENSUS_DATE), row('QUADRAT-FIX', 'ACERRU', 'Q01', FIRST_CENSUS_DATE)]);

    await cleanReupload([row('SPECIES-FIX', 'QUERCO', 'Q01', FIRST_CENSUS_DATE), row('QUADRAT-FIX', 'ACERRU', 'Q02', FIRST_CENSUS_DATE)]);
    await runValidationForTest(connection, VALIDATION_DIFFERENT_SPECIES, { censusID, plotID });

    const failures = await failedRows(censusID);
    const trees = await treeTagsWithSpecies(censusID);
    const stems = await stemsByTag(censusID);
    const speciesFlags = await getValidationErrors(connection, { censusID, validationID: VALIDATION_DIFFERENT_SPECIES });
    console.log(
      `[#489] failures=${JSON.stringify(failures)} trees=${JSON.stringify(trees)} stems=${JSON.stringify(stems)} validation7=${JSON.stringify(speciesFlags)}`
    );

    expect(failures).toEqual([]);
    expect(trees).toEqual(['QUADRAT-FIX:ACERRU', 'SPECIES-FIX:QUERCO']);
    expect(stems['QUADRAT-FIX'].map(stem => stem.quadrat)).toEqual(['Q02']);
    expect(speciesFlags).toEqual([]);
  }, 120000);

  it('keeps each stem’s PublishedStemID and StemCrossID when the replacement file omits the PublishedStemID column', async () => {
    await ingest(ORIGINAL_FILE, [
      row('UNCHANGED', 'ACERRU', 'Q01', FIRST_CENSUS_DATE, UNCHANGED_PUBLISHED_STEM_ID),
      row('SPECIES-FIX', 'ACERRU', 'Q01', FIRST_CENSUS_DATE, SPECIES_FIX_PUBLISHED_STEM_ID),
      row('QUADRAT-FIX', 'ACERRU', 'Q01', FIRST_CENSUS_DATE, QUADRAT_FIX_PUBLISHED_STEM_ID)
    ]);
    const before = await stemsByTag(censusID);

    await cleanReupload([
      row('UNCHANGED', 'ACERRU', 'Q01', FIRST_CENSUS_DATE),
      row('SPECIES-FIX', 'QUERCO', 'Q01', FIRST_CENSUS_DATE),
      row('QUADRAT-FIX', 'ACERRU', 'Q02', FIRST_CENSUS_DATE)
    ]);

    const after = await stemsByTag(censusID);
    const identity = (stems: Record<string, Array<Record<string, unknown>>>) =>
      Object.fromEntries(Object.entries(stems).map(([tag, tagStems]) => [tag, tagStems.map(stem => [stem.stemCrossID, stem.publishedStemID])]));
    console.log(`[identity] before=${JSON.stringify(before)}\n[identity] after=${JSON.stringify(after)}`);

    expect(identity(after)).toEqual({
      UNCHANGED: [[before.UNCHANGED[0].stemCrossID, UNCHANGED_PUBLISHED_STEM_ID]],
      'SPECIES-FIX': [[before['SPECIES-FIX'][0].stemCrossID, SPECIES_FIX_PUBLISHED_STEM_ID]],
      'QUADRAT-FIX': [[before['QUADRAT-FIX'][0].stemCrossID, QUADRAT_FIX_PUBLISHED_STEM_ID]]
    });
    expect(await failedRows(censusID)).toEqual([]);
  }, 120000);

  it('keeps a later census linked by StemCrossID when an earlier census is replaced', async () => {
    await ingest(ORIGINAL_FILE, [row('LINKED', 'ACERRU', 'Q01', FIRST_CENSUS_DATE)]);
    const laterCensus = await createAdditionalCensus(connection, testData, LATER_CENSUS);
    await ingest(LATER_CENSUS_FILE, [row('LINKED', 'ACERRU', 'Q01', LATER_CENSUS_DATE)], laterCensus.censusID);
    const laterBefore = await stemsByTag(laterCensus.censusID);

    await cleanReupload([row('LINKED', 'QUERCO', 'Q01', FIRST_CENSUS_DATE)]);

    const earlierAfter = await stemsByTag(censusID);
    const laterAfter = await stemsByTag(laterCensus.censusID);
    console.log(`[successor] earlier after=${JSON.stringify(earlierAfter)} later before=${JSON.stringify(laterBefore)} after=${JSON.stringify(laterAfter)}`);

    expect(laterAfter).toEqual(laterBefore);
    expect(earlierAfter.LINKED.map(stem => [stem.species, stem.quadrat, stem.stemCrossID])).toEqual([['QUERCO', 'Q01', laterBefore.LINKED[0].stemCrossID]]);
  }, 120000);

  it('reuses, rather than rebuilds, a stem an earlier batch of the same upload already measured', async () => {
    await ingest(ORIGINAL_FILE, [row('TWO-VISITS', 'ACERRU', 'Q01', FIRST_CENSUS_DATE)]);
    const afterFirstBatch = await stemsByTag(censusID);

    await ingest(ORIGINAL_FILE, [row('TWO-VISITS', 'ACERRU', 'Q01', SECOND_VISIT_DATE)]);

    const afterSecondBatch = await stemsByTag(censusID);
    console.log(`[measured stem] after batch 1=${JSON.stringify(afterFirstBatch)} after batch 2=${JSON.stringify(afterSecondBatch)}`);
    expect(afterSecondBatch['TWO-VISITS'].map(stem => [stem.stemGUID, stem.measurements])).toEqual([[afterFirstBatch['TWO-VISITS'][0].stemGUID, 2]]);
  }, 120000);

  it('never deletes a stem that holds a specimen', async () => {
    await ingest(ORIGINAL_FILE, [row('SPECIMEN', 'ACERRU', 'Q01', FIRST_CENSUS_DATE)]);
    const original = await stemsByTag(censusID);
    const specimenStemGUID = original.SPECIMEN[0].stemGUID;
    await connection.query(`INSERT INTO specimens (StemID, SpecimenNumber, IsActive) VALUES (?, 1, 1)`, [specimenStemGUID]);

    await cleanReupload([row('SPECIMEN', 'QUERCO', 'Q01', FIRST_CENSUS_DATE)]);

    const [specimenRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM specimens WHERE StemID = ?`, [specimenStemGUID]);
    const after = await stemsByTag(censusID);
    console.log(`[specimen] stem ${specimenStemGUID}: specimens=${specimenRows[0].count} stems after=${JSON.stringify(after)}`);
    expect(Number(specimenRows[0].count)).toBe(1);
    expect(after.SPECIMEN.map(stem => stem.stemGUID)).toContain(specimenStemGUID);
  }, 120000);
});
