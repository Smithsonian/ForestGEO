/**
 * ArcGIS two-sheet .xlsx import — end-to-end integration.
 *
 * Builds a tiny two-sheet workbook in memory, runs the pure reader + transform,
 * stages the canonical rows into temporarymeasurements, then exercises the real
 * bulkingestionprocess stored procedure and asserts the resulting coremeasurements.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  type TestData
} from '../setup/local-db-setup';
import { readArcgisWorkbook } from '../../lib/arcgis/workbook-reader';
import { transformArcgisWorkbook } from '../../lib/arcgis/transform';

function buildWorkbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('ArcGIS xlsx import (end-to-end)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  it('ingests a tree + its additional stem with inherited coordinates and joined codes', async () => {
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const dateSerial = 46036;

    // Only seeded codes (A/D/M/B/R) survive bulkingestionprocess.
    const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M', 'COD_R'];
    const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A'];

    const buffer = buildWorkbook({
      trees: [TREE_HEADER, ['G1', quadratName, 'T100', 'T100', speciesCode, 12.3, 1.3, 'primary', dateSerial, 5.123456, 6.234567, 'M', 'R']],
      stems: [STEM_HEADER, ['G1', 'S1', quadratName, 'T100', 'T100-2', speciesCode, 4.4, 1.3, '', dateSerial, 'A']]
    });

    const result = transformArcgisWorkbook(readArcgisWorkbook(buffer));
    expect(result.rows).toHaveLength(2);

    const measurements = result.rows.map(r => ({
      treeTag: r.tag as string,
      stemTag: (r.stemtag as string) ?? '',
      speciesCode: r.spcode as string,
      quadratName: r.quadrat as string,
      x: Number(r.lx),
      y: Number(r.ly),
      dbh: Number(r.dbh),
      hom: Number(r.hom),
      date: r.date as string,
      codes: r.codes || undefined,
      comments: r.comments || undefined
    }));

    const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements);
    const ingestion = await runBulkIngestion(connection, fileID, batchID);
    expect(ingestion.batch_failed).toBe(false);

    const [coreRows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, s.StemTag, q.QuadratName, s.LocalX, s.LocalY, cm.MeasuredDBH, cm.RawCodes,
              GROUP_CONCAT(DISTINCT cma.Code ORDER BY cma.Code SEPARATOR ';') AS Codes
         FROM coremeasurements cm
         INNER JOIN stems s ON s.StemGUID = cm.StemGUID
         INNER JOIN trees t ON t.TreeID = s.TreeID
         INNER JOIN quadrats q ON q.QuadratID = s.QuadratID
         LEFT JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
        WHERE t.TreeTag = 'T100'
        GROUP BY cm.CoreMeasurementID, t.TreeTag, s.StemTag, q.QuadratName, s.LocalX, s.LocalY, cm.MeasuredDBH, cm.RawCodes
        ORDER BY s.StemTag`,
      []
    );

    expect(coreRows).toHaveLength(2);
    const primary = coreRows.find(r => r.StemTag === 'T100');
    const additional = coreRows.find(r => r.StemTag === 'T100-2');
    expect(primary).toBeDefined();
    expect(additional).toBeDefined();

    expect(Number(primary!.LocalX)).toBeCloseTo(5.123456, 6);
    expect(Number(primary!.LocalY)).toBeCloseTo(6.234567, 6);
    expect(Number(additional!.LocalX)).toBeCloseTo(5.123456, 6);
    expect(Number(additional!.LocalY)).toBeCloseTo(6.234567, 6);
    expect(additional!.QuadratName).toBe(quadratName);
    expect(String(primary!.Codes)).toContain('M');
    expect(String(primary!.Codes)).toContain('R');
    expect(String(additional!.Codes)).toContain('A');
  });
});
