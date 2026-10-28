/**
 * Integration tests for the census overview export preview (#547).
 *
 * One known-totals census. Every expected number is worked out from what this
 * file inserts, never from the functions under test.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: npm run test:integration -- lib/ctfs-export/export-preview.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { createTestDatabase, teardownTestDatabase, loadSchema, DEFAULT_TEST_CONFIG } from '../../tests/setup/local-db-setup';
import { loadAppDbSeed } from '../../tests/fixtures/ctfs-export/load-app-db-seed';
import {
  checkFinishedCensus,
  isBlockingPreconditionKind,
  MAX_DISPLAY_FAILURES,
  type BlockingPreconditionKind,
  type PreconditionFailureKind
} from './precondition';
import { selectMeasurements } from './select-measurements';
import { countExportedRowsWithUnresolvedErrors, countPublishPreconditions } from './export-preview';

const PLOT_ID = 1;
const CENSUS_ID = 1;
const DB_NAME = `forestgeo_exportpreview_${process.pid}_${Date.now()}`;
// The single pass's count aliases in export-preview.ts.
const TOTAL_ACTIVE_COLUMN_ALIAS = 'totalActiveCount';
const EXPORTABLE_COLUMN_ALIAS = 'exportableCount';
const blocksNothing = (kind: PreconditionFailureKind): kind is BlockingPreconditionKind => false;
const FIXTURE_MEASUREMENT_DATE = '2024-06-02';
const FIXTURE_HOM = 1.3;
const FIXTURE_DELETED_AT = '2024-07-01 00:00:00';
// CTFS_LIMITS.dbhComments in precondition.ts; one character longer trips check 7.
const CTFS_DBH_COMMENTS_LIMIT = 128;

// app-db-seed.sql: CoreMeasurementID 1 on stem 1, fully exportable.
const SEED_EXPORTABLE_ROWS = 1;
const SEED_STEM_GUID = 1;

// Exported rows (validated, full join graph, active stem and tree).
const UNKNOWN_CODE_ROWS = MAX_DISPLAY_FAILURES + 11;
const UNKNOWN_CODE_FIRST_ID = 1001;
const DOUBLE_UNKNOWN_CODE_ROW_ID = UNKNOWN_CODE_FIRST_ID;
const MULTI_LOG_ROW_ID = 2001; // two unresolved logs
const SINGLE_LOG_ROW_ID = 2002; // one unresolved and one resolved log
const EXPORTED_WITH_UNRESOLVED_ERROR_ROWS = 2;
const DELETED_AT_STEM_ROW_ID = 3001; // active stem with DeletedAt set: the export ignores DeletedAt
const DELETED_AT_STEM_ROWS = 1;
const MISSING_SPECIES_CODE_ROW_IDS = [7001, 7002] as const;
const TOO_LONG_ROW_IDS = [8001, 8002, 8003] as const;

// Skipped rows.
const INACTIVE_STEM_ROW_ID = 4001;
const INACTIVE_TREE_ROW_ID = 4002;
const INACTIVE_STEM_OR_TREE_ROWS = 2;
const MISSING_LINK_ROW_IDS = { stemTreeID: 5001, stemQuadratID: 5002, treeSpeciesID: 5003, speciesGenusID: 5004, genusFamilyID: 5005 } as const;
const MISSING_LINK_ROWS = Object.keys(MISSING_LINK_ROW_IDS).length;
const FAILED_UNVALIDATED_ROW_ID = 6001; // no stem AND not validated: two reasons, one skipped row
const UNVALIDATED_ROW_ID = 6002; // not validated; also carries an unresolved log
const NOT_VALIDATED_ROWS = 2;
const NO_STEM_GUID_ROWS = 1;
const VALIDATION_SKIPPED_ROWS = 2;

const INACTIVE_MEASUREMENT_ROW_ID = 9901; // IsActive = 0: in no count at all

const EXPECTED_EXPORTABLE_ROWS =
  SEED_EXPORTABLE_ROWS +
  UNKNOWN_CODE_ROWS +
  EXPORTED_WITH_UNRESOLVED_ERROR_ROWS +
  DELETED_AT_STEM_ROWS +
  MISSING_SPECIES_CODE_ROW_IDS.length +
  TOO_LONG_ROW_IDS.length;
const EXPECTED_SKIPPED_ROWS = INACTIVE_STEM_OR_TREE_ROWS + MISSING_LINK_ROWS + VALIDATION_SKIPPED_ROWS;
const EXPECTED_ACTIVE_ROWS = EXPECTED_EXPORTABLE_ROWS + EXPECTED_SKIPPED_ROWS;

const KNOWN_TOTALS_ERROR_A = 9201;
const KNOWN_TOTALS_ERROR_B = 9202;

interface FixtureMeasurement {
  id: number;
  stemGUID: number | null;
  isValidated: boolean | null;
  dbh: number;
  description?: string;
  isActive?: boolean;
}

async function insertMeasurements(conn: Connection, rows: readonly FixtureMeasurement[]): Promise<void> {
  for (const row of rows) {
    await conn.query(
      `INSERT INTO coremeasurements
         (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        CENSUS_ID,
        row.stemGUID,
        row.isValidated,
        FIXTURE_MEASUREMENT_DATE,
        row.dbh,
        FIXTURE_HOM,
        row.description ?? null,
        row.isActive === false ? 0 : 1
      ]
    );
  }
}

async function insertKnownTotalsFixture(conn: Connection): Promise<void> {
  // One broken link per chain, so each break affects exactly one row.
  await conn.query(`INSERT INTO genus (GenusID, FamilyID, Genus, IsActive) VALUES (55, NULL, 'Nofamilia', 1)`);
  await conn.query(
    `INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, IDLevel, IsActive)
     VALUES (54, NULL, 'NOGEN', 'nogenus', 'species', 1),
            (55, 55, 'NOFAM', 'nofamily', 'species', 1),
            (71, 1, NULL, 'nocode', 'species', 1)`
  );
  await conn.query(
    `INSERT INTO trees (TreeID, TreeTag, SpeciesID, CensusID, IsActive)
     VALUES (42, 'T42', 1, 1, 0), (53, 'T53', NULL, 1, 1), (54, 'T54', 54, 1, 1), (55, 'T55', 55, 1, 1), (71, 'T71', 71, 1, 1)`
  );
  await conn.query(
    `INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive, DeletedAt)
     VALUES (31, 1, 1, 1, '31', 1.0, 1.0, 1, ?),
            (41, 1, 1, 1, '41', 1.0, 2.0, 0, NULL),
            (42, 42, 1, 1, '42', 1.0, 3.0, 1, NULL),
            (51, NULL, 1, 1, '51', 1.0, 4.0, 1, NULL),
            (52, 1, NULL, 1, '52', 1.0, 5.0, 1, NULL),
            (53, 53, 1, 1, '53', 1.0, 6.0, 1, NULL),
            (54, 54, 1, 1, '54', 1.0, 7.0, 1, NULL),
            (55, 55, 1, 1, '55', 1.0, 8.0, 1, NULL),
            (71, 71, 1, 1, '71', 1.0, 9.0, 1, NULL)`,
    [FIXTURE_DELETED_AT]
  );

  const tooLongDescription = 'x'.repeat(CTFS_DBH_COMMENTS_LIMIT + 1);
  await insertMeasurements(conn, [
    ...Array.from({ length: UNKNOWN_CODE_ROWS }, (_, index) => ({
      id: UNKNOWN_CODE_FIRST_ID + index,
      stemGUID: SEED_STEM_GUID,
      isValidated: true,
      dbh: 100 + index
    })),
    { id: MULTI_LOG_ROW_ID, stemGUID: SEED_STEM_GUID, isValidated: true, dbh: 201 },
    { id: SINGLE_LOG_ROW_ID, stemGUID: SEED_STEM_GUID, isValidated: true, dbh: 202 },
    { id: DELETED_AT_STEM_ROW_ID, stemGUID: 31, isValidated: true, dbh: 301 },
    { id: INACTIVE_STEM_ROW_ID, stemGUID: 41, isValidated: true, dbh: 401 },
    { id: INACTIVE_TREE_ROW_ID, stemGUID: 42, isValidated: true, dbh: 402 },
    { id: MISSING_LINK_ROW_IDS.stemTreeID, stemGUID: 51, isValidated: true, dbh: 501 },
    { id: MISSING_LINK_ROW_IDS.stemQuadratID, stemGUID: 52, isValidated: true, dbh: 502 },
    { id: MISSING_LINK_ROW_IDS.treeSpeciesID, stemGUID: 53, isValidated: true, dbh: 503 },
    { id: MISSING_LINK_ROW_IDS.speciesGenusID, stemGUID: 54, isValidated: true, dbh: 504 },
    { id: MISSING_LINK_ROW_IDS.genusFamilyID, stemGUID: 55, isValidated: true, dbh: 505 },
    { id: FAILED_UNVALIDATED_ROW_ID, stemGUID: null, isValidated: false, dbh: 601 },
    { id: UNVALIDATED_ROW_ID, stemGUID: SEED_STEM_GUID, isValidated: null, dbh: 602 },
    { id: MISSING_SPECIES_CODE_ROW_IDS[0], stemGUID: 71, isValidated: true, dbh: 701 },
    { id: MISSING_SPECIES_CODE_ROW_IDS[1], stemGUID: 71, isValidated: true, dbh: 702 },
    ...TOO_LONG_ROW_IDS.map((id, index) => ({ id, stemGUID: SEED_STEM_GUID, isValidated: true, dbh: 801 + index, description: tooLongDescription })),
    { id: INACTIVE_MEASUREMENT_ROW_ID, stemGUID: SEED_STEM_GUID, isValidated: false, dbh: 991, isActive: false }
  ]);

  for (let index = 0; index < UNKNOWN_CODE_ROWS; index++) {
    await conn.query(`INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, 'ZZ')`, [UNKNOWN_CODE_FIRST_ID + index]);
  }
  await conn.query(`INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, 'ZY')`, [DOUBLE_UNKNOWN_CODE_ROW_ID]);

  await conn.query(
    `INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage)
     VALUES (?, 'validation', 'KNOWN_TOTALS_A', 'Known totals error A'), (?, 'validation', 'KNOWN_TOTALS_B', 'Known totals error B')`,
    [KNOWN_TOTALS_ERROR_A, KNOWN_TOTALS_ERROR_B]
  );
  await conn.query(
    `INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
     VALUES (?, ?, 0), (?, ?, 0), (?, ?, 0), (?, ?, 1), (?, ?, 0)`,
    [
      MULTI_LOG_ROW_ID,
      KNOWN_TOTALS_ERROR_A,
      MULTI_LOG_ROW_ID,
      KNOWN_TOTALS_ERROR_B,
      SINGLE_LOG_ROW_ID,
      KNOWN_TOTALS_ERROR_A,
      SINGLE_LOG_ROW_ID,
      KNOWN_TOTALS_ERROR_B,
      UNVALIDATED_ROW_ID,
      KNOWN_TOTALS_ERROR_A
    ]
  );
}

describe('export preview on a known-totals census', () => {
  let conn: Connection;
  const config = { ...DEFAULT_TEST_CONFIG, database: DB_NAME };
  const publishInput = { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID };

  beforeAll(async () => {
    conn = await createTestDatabase(config);
    await loadSchema(conn);
    await loadAppDbSeed(conn);
    await insertKnownTotalsFixture(conn);
  });

  afterAll(async () => {
    await teardownTestDatabase(conn, config);
  });

  it('counts every blocking kind exactly, including one above the display cap', async () => {
    const counted = await countPublishPreconditions(conn, publishInput, isBlockingPreconditionKind);
    console.log('[#547 known totals] blockers:', JSON.stringify(counted.blockers));

    expect(UNKNOWN_CODE_ROWS, 'the fixture must exceed the display cap').toBeGreaterThan(MAX_DISPLAY_FAILURES);
    expect(counted.blockers).toEqual([
      { kind: 'unknown-attribute-code', count: UNKNOWN_CODE_ROWS },
      { kind: 'missing-taxonomy-fields', count: MISSING_SPECIES_CODE_ROW_IDS.length },
      { kind: 'string-too-long', count: TOO_LONG_ROW_IDS.length }
    ]);
  });

  it('still returns exactly MAX_DISPLAY_FAILURES IDs from checkFinishedCensus for the kind above the cap', async () => {
    const gate = await checkFinishedCensus(conn, publishInput);
    const unknownCodeIds = gate.ok ? [] : (gate.reasons.find(reason => reason.kind === 'unknown-attribute-code')?.coreMeasurementIds ?? []);
    console.log(`[#547 known totals] gate unknown-attribute-code IDs returned: ${unknownCodeIds.length}`);

    expect(unknownCodeIds).toHaveLength(MAX_DISPLAY_FAILURES);
  });

  it('agrees with checkFinishedCensus on count and totalActiveCount, and both match the fixture', async () => {
    const gate = await checkFinishedCensus(conn, publishInput);
    const counted = await countPublishPreconditions(conn, publishInput, isBlockingPreconditionKind);
    console.log(`[#547 known totals] gate ${gate.count}/${gate.totalActiveCount}, counter ${counted.count}/${counted.totalActiveCount}`);

    expect(counted.count).toBe(gate.count);
    expect(counted.totalActiveCount).toBe(gate.totalActiveCount);
    expect(counted.count, 'exportable rows worked out from the fixture').toBe(EXPECTED_EXPORTABLE_ROWS);
    expect(counted.totalActiveCount, 'active rows worked out from the fixture').toBe(EXPECTED_ACTIVE_ROWS);
  });

  it('previews exactly the rows selectMeasurements would export', async () => {
    const counted = await countPublishPreconditions(conn, publishInput, isBlockingPreconditionKind);
    const { measurementRows } = await selectMeasurements(conn, publishInput);
    const exportedIds = new Set(measurementRows.map(row => row.CoreMeasurementID));
    console.log(`[#547 known totals] selectMeasurements rows: ${measurementRows.length}, preview exportable: ${counted.count}`);

    expect(measurementRows.length, 'exportableCount must equal the real export').toBe(counted.count);
    expect(counted.totalActiveCount - measurementRows.length, 'skippedCount = active - exported').toBe(EXPECTED_SKIPPED_ROWS);
    for (const exportedId of [DELETED_AT_STEM_ROW_ID, SINGLE_LOG_ROW_ID, MULTI_LOG_ROW_ID]) {
      expect(exportedIds.has(exportedId), `row ${exportedId} must be exported`).toBe(true);
    }
    for (const skippedId of [
      INACTIVE_STEM_ROW_ID,
      INACTIVE_TREE_ROW_ID,
      ...Object.values(MISSING_LINK_ROW_IDS),
      FAILED_UNVALIDATED_ROW_ID,
      UNVALIDATED_ROW_ID,
      INACTIVE_MEASUREMENT_ROW_ID
    ]) {
      expect(exportedIds.has(skippedId), `row ${skippedId} must not be exported`).toBe(false);
    }
  });

  it('counts each skip reason over skipped rows only, with other at zero', async () => {
    const { skipReasons: reasons } = await countPublishPreconditions(conn, publishInput, isBlockingPreconditionKind);
    console.log('[#547 known totals] skip reasons:', JSON.stringify(reasons));

    expect(reasons).toEqual([
      { kind: 'not-validated', count: NOT_VALIDATED_ROWS },
      { kind: 'no-stem-guid', count: NO_STEM_GUID_ROWS },
      { kind: 'inactive-stem-or-tree', count: INACTIVE_STEM_OR_TREE_ROWS },
      { kind: 'missing-link', count: MISSING_LINK_ROWS },
      { kind: 'other', count: 0 }
    ]);
    for (const reason of reasons) {
      expect(reason.count, `${reason.kind} cannot exceed the skipped rows`).toBeLessThanOrEqual(EXPECTED_SKIPPED_ROWS);
    }
  });

  it('counts exported rows with an unresolved error once each, ignoring resolved logs and skipped rows', async () => {
    const exportedWithUnresolvedErrors = await countExportedRowsWithUnresolvedErrors(conn, publishInput);
    console.log(`[#547 known totals] exported rows with an unresolved error: ${exportedWithUnresolvedErrors}`);

    expect(exportedWithUnresolvedErrors).toBe(EXPORTED_WITH_UNRESOLVED_ERROR_ROWS);
  });

  it('rejects an invalid schema before running SQL', async () => {
    const querySpy = vi.spyOn(conn, 'query');
    await expect(
      countPublishPreconditions(conn, { ...publishInput, schema: 'bad; DROP TABLE coremeasurements; --' }, isBlockingPreconditionKind)
    ).rejects.toThrow('Invalid or unauthorized schema');
    await expect(countExportedRowsWithUnresolvedErrors(conn, { ...publishInput, schema: 'bad`name' })).rejects.toThrow('Invalid or unauthorized schema');
    expect(querySpy, 'no SQL may run for an invalid schema').not.toHaveBeenCalled();
  });

  it('throws naming the column when the single pass omits a count, instead of reporting NaN', async () => {
    const passRowMissingExportableCount = { [TOTAL_ACTIVE_COLUMN_ALIAS]: SEED_EXPORTABLE_ROWS };
    vi.spyOn(conn, 'query').mockResolvedValueOnce([[passRowMissingExportableCount], []] as never);

    await expect(countPublishPreconditions(conn, publishInput, blocksNothing)).rejects.toThrow(`'${EXPORTABLE_COLUMN_ALIAS}' is missing or not a number`);
  });
});
