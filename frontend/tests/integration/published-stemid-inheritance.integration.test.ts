import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type mysql from 'mysql2/promise';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertTestMeasurements,
  runBulkIngestion,
  createAdditionalCensus,
  type TestData
} from '@/tests/setup/local-db-setup';

describe('PublishedStemID cross-census inheritance', () => {
  let connection: mysql.Connection;
  let testData: TestData;
  let dbConfig: Awaited<ReturnType<typeof setupTestDatabase>>['config'];

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    dbConfig = setup.config;
  });
  afterAll(async () => {
    await teardownTestDatabase(connection, dbConfig);
  });

  it('inherits/catch-up-fills PublishedStemID across consecutive censuses, keeps recruits NULL, and never overwrites a non-null value', async () => {
    const census1 = testData.census[0].censusID;
    const tree = { treeTag: 'PUBTREE1', speciesCode: testData.species[0].SpeciesCode, quadratName: testData.quadrats[0].QuadratName };

    await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: tree.treeTag,
          stemTag: '1',
          speciesCode: tree.speciesCode,
          quadratName: tree.quadratName,
          x: 1,
          y: 1,
          dbh: 10,
          hom: 1.3,
          date: '2026-01-01',
          publishedStemID: 5001
        }
      ],
      { fileID: 'f1', batchID: 'b1', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f1', 'b1');

    const [initialRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID
       FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = ? AND s.StemTag = '1' AND s.CensusID = ?`,
      [tree.treeTag, census1]
    );
    expect(initialRows[0].PublishedStemID).toBe(5001);

    const [rawRows] = await connection.query<any[]>(
      `SELECT RawPublishedStemID
       FROM coremeasurements
       WHERE UploadFileID = 'f1' AND UploadBatchID = 'b1'`
    );
    expect(rawRows[0].RawPublishedStemID).toBe(5001);

    const census2Info = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: 2,
      startDate: '2027-01-01',
      endDate: '2027-12-31'
    });
    const census2 = census2Info.censusID;
    await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: tree.treeTag,
          stemTag: '1',
          speciesCode: tree.speciesCode,
          quadratName: tree.quadratName,
          x: 1,
          y: 1,
          dbh: 11,
          hom: 1.3,
          date: '2027-01-01'
        },
        { treeTag: tree.treeTag, stemTag: '2', speciesCode: tree.speciesCode, quadratName: tree.quadratName, x: 2, y: 2, dbh: 5, hom: 1.3, date: '2027-01-01' }
      ],
      { fileID: 'f2', batchID: 'b2', censusID: census2 }
    );
    await runBulkIngestion(connection, 'f2', 'b2');

    const [rows] = await connection.query<any[]>(
      `SELECT s.StemTag, s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = ? AND s.CensusID = ? ORDER BY s.StemTag`,
      [tree.treeTag, census2]
    );
    const byTag = Object.fromEntries(rows.map(r => [r.StemTag, r.PublishedStemID]));
    expect(byTag['1']).toBe(5001);
    expect(byTag['2']).toBeNull();

    // Catch-up: an existing current-census stem at NULL must be filled on re-ingest.
    await connection.query(
      `UPDATE stems s JOIN trees t ON t.TreeID = s.TreeID
       SET s.PublishedStemID = NULL
       WHERE t.TreeTag = ? AND s.StemTag = '1' AND s.CensusID = ?`,
      [tree.treeTag, census2]
    );
    await insertTestMeasurements(
      connection,
      testData,
      [
        { treeTag: tree.treeTag, stemTag: '1', speciesCode: tree.speciesCode, quadratName: tree.quadratName, x: 1, y: 1, dbh: 11, hom: 1.3, date: '2027-01-01' }
      ],
      { fileID: 'f2_retry', batchID: 'b2_retry', censusID: census2 }
    );
    await runBulkIngestion(connection, 'f2_retry', 'b2_retry');
    const [catchupRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = ? AND s.StemTag = '1' AND s.CensusID = ?`,
      [tree.treeTag, census2]
    );
    expect(catchupRows[0].PublishedStemID).toBe(5001);

    // No-overwrite invariant: a non-null current value must survive re-ingest even though
    // the previous census carries a different value (guard: s.PublishedStemID IS NULL).
    await connection.query(
      `UPDATE stems s JOIN trees t ON t.TreeID = s.TreeID
       SET s.PublishedStemID = 9999
       WHERE t.TreeTag = ? AND s.StemTag = '1' AND s.CensusID = ?`,
      [tree.treeTag, census2]
    );
    await insertTestMeasurements(
      connection,
      testData,
      [
        { treeTag: tree.treeTag, stemTag: '1', speciesCode: tree.speciesCode, quadratName: tree.quadratName, x: 1, y: 1, dbh: 11, hom: 1.3, date: '2027-01-01' }
      ],
      { fileID: 'f2_noov', batchID: 'b2_noov', censusID: census2 }
    );
    await runBulkIngestion(connection, 'f2_noov', 'b2_noov');
    const [noOverwriteRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = ? AND s.StemTag = '1' AND s.CensusID = ?`,
      [tree.treeTag, census2]
    );
    // Previous census holds 5001; the existing non-null 9999 must NOT be overwritten.
    expect(noOverwriteRows[0].PublishedStemID).toBe(9999);
  });

  it('rejects an uploaded PublishedStemID that is already assigned to another stem identity in the plot', async () => {
    const census1 = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;

    await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: 'PUBCONFLICT_A',
          stemTag: '1',
          speciesCode,
          quadratName,
          x: 3,
          y: 3,
          dbh: 10,
          hom: 1.3,
          date: '2026-02-01',
          publishedStemID: 6001
        }
      ],
      { fileID: 'f_conflict_a', batchID: 'b_conflict_a', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_conflict_a', 'b_conflict_a');

    await insertTestMeasurements(
      connection,
      testData,
      [
        {
          treeTag: 'PUBCONFLICT_B',
          stemTag: '1',
          speciesCode,
          quadratName,
          x: 4,
          y: 4,
          dbh: 11,
          hom: 1.3,
          date: '2026-02-02',
          publishedStemID: 6001
        }
      ],
      { fileID: 'f_conflict_b', batchID: 'b_conflict_b', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_conflict_b', 'b_conflict_b');

    const [failureRows] = await connection.query<any[]>(
      `SELECT cm.StemGUID, cm.RawPublishedStemID, me.ErrorCode
       FROM coremeasurements cm
       JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.UploadFileID = 'f_conflict_b'
         AND cm.UploadBatchID = 'b_conflict_b'`
    );
    const publishedConflict = failureRows.find(row => row.ErrorCode === 'PUBLISHED_STEMID_CONFLICT');
    expect(publishedConflict).toBeDefined();
    expect(publishedConflict.StemGUID).toBeNull();
    expect(publishedConflict.RawPublishedStemID).toBe(6001);

    const [conflictingStemRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID
       FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = 'PUBCONFLICT_B' AND s.StemTag = '1' AND s.CensusID = ?`,
      [census1]
    );
    expect(conflictingStemRows[0]?.PublishedStemID ?? null).toBeNull();
  });

  it('rejects two distinct stems in one batch that carry the same uploaded PublishedStemID', async () => {
    const census1 = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;

    // Two different trees (=> two different StemCrossID groups) sharing one uploaded id in a single batch.
    await insertTestMeasurements(
      connection,
      testData,
      [
        { treeTag: 'PUBBATCHID_A', stemTag: '1', speciesCode, quadratName, x: 5, y: 5, dbh: 10, hom: 1.3, date: '2026-03-01', publishedStemID: 7001 },
        { treeTag: 'PUBBATCHID_B', stemTag: '1', speciesCode, quadratName, x: 6, y: 6, dbh: 11, hom: 1.3, date: '2026-03-01', publishedStemID: 7001 }
      ],
      { fileID: 'f_batchid', batchID: 'b_batchid', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_batchid', 'b_batchid');

    const [failures] = await connection.query<any[]>(
      `SELECT cm.RawTreeTag, cm.StemGUID
       FROM coremeasurements cm
       JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.UploadFileID = 'f_batchid' AND cm.UploadBatchID = 'b_batchid'
         AND me.ErrorCode = 'PUBLISHED_STEMID_CONFLICT'`
    );
    const failedTags = new Set(failures.map(r => r.RawTreeTag));
    expect(failedTags.has('PUBBATCHID_A')).toBe(true);
    expect(failedTags.has('PUBBATCHID_B')).toBe(true);
    expect(failures.every(r => r.StemGUID === null)).toBe(true);

    // Neither stem should have been assigned the contested id.
    const [stemRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag IN ('PUBBATCHID_A', 'PUBBATCHID_B') AND s.CensusID = ?`,
      [census1]
    );
    expect(stemRows.length).toBe(2);
    expect(stemRows.every(r => (r.PublishedStemID ?? null) === null)).toBe(true);
  });

  it('rejects a stem measured twice in one batch with different PublishedStemIDs (via tag/stemtag collision) so neither id is adopted', async () => {
    // The only way two rows in one batch resolve to the same StemCrossID is by sharing
    // (CensusID, TreeTag, StemTag). Stage 2b flags those as DUPLICATE_TAG_STEMTAG and removes
    // them before stem resolution, so the dedicated same-group PublishedStemID guard never fires
    // in this path. This test documents that upstream behavior: both rows fail and no stem adopts
    // either contested id.
    const census1 = testData.census[0].censusID;
    const plotId = testData.plots[0].plotID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;

    await insertTestMeasurements(
      connection,
      testData,
      [
        { treeTag: 'PUBBATCHGRP', stemTag: '1', speciesCode, quadratName, x: 7, y: 7, dbh: 10, hom: 1.3, date: '2026-04-01', publishedStemID: 7101 },
        { treeTag: 'PUBBATCHGRP', stemTag: '1', speciesCode, quadratName, x: 7, y: 7, dbh: 12, hom: 1.3, date: '2026-04-02', publishedStemID: 7102 }
      ],
      { fileID: 'f_batchgrp', batchID: 'b_batchgrp', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_batchgrp', 'b_batchgrp');

    // Both rows failed (no successful ingestion => StemGUID NULL on every batch row).
    const [batchRows] = await connection.query<any[]>(
      `SELECT cm.StemGUID FROM coremeasurements cm
       WHERE cm.UploadFileID = 'f_batchgrp' AND cm.UploadBatchID = 'b_batchgrp'`
    );
    expect(batchRows.length).toBeGreaterThan(0);
    expect(batchRows.every(r => r.StemGUID === null)).toBe(true);

    // Neither contested id was adopted by any stem in the plot.
    const [adopted] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s
       INNER JOIN census c ON c.CensusID = s.CensusID AND c.PlotID = ?
       WHERE s.PublishedStemID IN (7101, 7102)`,
      [plotId]
    );
    expect(adopted.length).toBe(0);
  });

  it('rejects an upload that assigns a different PublishedStemID to a stem that already has one', async () => {
    const census1 = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;

    // First upload backfills 8001.
    await insertTestMeasurements(
      connection,
      testData,
      [{ treeTag: 'PUBEXISTING', stemTag: '1', speciesCode, quadratName, x: 8, y: 8, dbh: 10, hom: 1.3, date: '2026-05-01', publishedStemID: 8001 }],
      { fileID: 'f_exist_a', batchID: 'b_exist_a', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_exist_a', 'b_exist_a');

    const [firstRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = 'PUBEXISTING' AND s.StemTag = '1' AND s.CensusID = ?`,
      [census1]
    );
    expect(firstRows[0].PublishedStemID).toBe(8001);

    // Second upload of the same stem carries a different id 8002 => conflict, existing value preserved.
    await insertTestMeasurements(
      connection,
      testData,
      [{ treeTag: 'PUBEXISTING', stemTag: '1', speciesCode, quadratName, x: 8, y: 8, dbh: 11, hom: 1.3, date: '2026-05-02', publishedStemID: 8002 }],
      { fileID: 'f_exist_b', batchID: 'b_exist_b', censusID: census1 }
    );
    await runBulkIngestion(connection, 'f_exist_b', 'b_exist_b');

    const [failures] = await connection.query<any[]>(
      `SELECT cm.StemGUID, cm.RawPublishedStemID
       FROM coremeasurements cm
       JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.UploadFileID = 'f_exist_b' AND cm.UploadBatchID = 'b_exist_b'
         AND me.ErrorCode = 'PUBLISHED_STEMID_CONFLICT'`
    );
    expect(failures[0]).toBeDefined();
    expect(failures[0].StemGUID).toBeNull();
    expect(failures[0].RawPublishedStemID).toBe(8002);

    const [finalRows] = await connection.query<any[]>(
      `SELECT s.PublishedStemID FROM stems s JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.TreeTag = 'PUBEXISTING' AND s.StemTag = '1' AND s.CensusID = ?`,
      [census1]
    );
    expect(finalRows[0].PublishedStemID).toBe(8001);
  });
});
