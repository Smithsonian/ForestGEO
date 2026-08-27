/**
 * Stale-schema repair proof (integration, real MySQL).
 *
 * Provisions a throwaway schema from the canonical DDL, intentionally regresses it
 * to the known live-schema drift (drops temporarymeasurements.PublishedStemID and
 * SourceFormat, stems.PublishedStemID and its lookup index, and
 * coremeasurements.RawPublishedStemID — the exact shape of a site provisioned by a
 * deployment that predates the PublishedStemID work; reverts viewfulltable to its
 * pre-rename StemID column — the shape forestgeo_panama/mpala/serc carried, which
 * made every single-row measurement edit roll back on "Unknown column 'StemGUID'";
 * downgrades representative VARCHAR/TEXT columns to utf8mb3; no migration ledger),
 * then proves the migrate + verify pipeline repairs the application write contract
 * end to end without rebuilding unrelated tables and remains idempotent:
 *
 *   (1) the read-only contract audit FAILS, naming both the missing columns and
 *       the legacy-collation columns as maintenance warnings;
 *   (2) applying the manifest migrations SUCCEEDS;
 *   (3) a second apply is a no-op (nothing pending, no rows re-applied);
 *   (4) the read-only compatibility gate PASSES while retaining the warnings;
 *   (5) a real temporarymeasurements insert built from the production keyed
 *       builder (SourceFormat + PublishedStemID included) plus a one-row
 *       bulkingestionprocess both succeed against the repaired schema.
 *
 * This guards the incident where app code depending on new write columns deployed
 * ahead of the schema, producing runtime 500s.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, runBulkIngestion, type TestData } from '../setup/local-db-setup';
import { formatContractFailures, type SchemaQueryRow } from '@/lib/db/schema-contract';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import {
  loadMigrationSources,
  selectPendingMigrations,
  applyPendingMigrations,
  auditSchemaContract,
  readLedger,
  LEDGER_TABLE,
  MIGRATION_STATUS,
  type MigrationSource,
  type SqlExecutor
} from '@/scripts/apply-schema-migrations';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';
import {
  TEMPORARY_MEASUREMENT_INSERT_COLUMNS,
  buildTemporaryMeasurementInsertRecord,
  toTemporaryMeasurementInsertValues
} from '@/lib/ingestion/temporary-measurements';
import { SourceFormat, type FileRow } from '@/config/macros/formdetails';

const REPRESENTATIVE_TEXT_COLUMN = 'Comments';
const LEGACY_CHARSET = 'utf8mb3';
const LEGACY_COLLATION = 'utf8mb3_general_ci';
const PUBLISHED_STEMID_INDEX = 'idx_stems_publishedstemid';
const PUBLISHED_STEMID_CONFLICT_CODE = 'PUBLISHED_STEMID_CONFLICT';
// Sentinel viewfulltable cache row: proves the StemID -> StemGUID repair is a
// metadata-only RENAME that preserves cached rows, not a drop-and-recreate.
const VFT_SENTINEL_CORE_MEASUREMENT_ID = 999001;
const VFT_SENTINEL_STEM_VALUE = 424242;

const PLOT_COORDINATE_MIGRATION_ID = '2026-08-27-01-add-plot-coordinates';
const PLOT_COORDINATE_TYPE = 'decimal(12,6)';
// The ten nullable plot-coordinate columns the migration adds, one home per
// table on the ingest path — never one axis standing in for its pair.
const PLOT_COORDINATE_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'temporarymeasurements', column: 'PlotX' },
  { table: 'temporarymeasurements', column: 'PlotY' },
  { table: 'stems', column: 'PlotX' },
  { table: 'stems', column: 'PlotY' },
  { table: 'coremeasurements', column: 'RawPlotX' },
  { table: 'coremeasurements', column: 'RawPlotY' },
  { table: 'measurementssummary', column: 'StemPlotX' },
  { table: 'measurementssummary', column: 'StemPlotY' },
  { table: 'viewfulltable', column: 'StemPlotX' },
  { table: 'viewfulltable', column: 'StemPlotY' }
];
const CANONICAL_DDL_PATH = path.join(process.cwd(), 'db', 'sql', 'tablestructures.sql');

const VALIDATION_19_MIGRATION_ID = '2026-08-27-02-seed-validation-19';
const VALIDATION_19_PROCEDURE_NAME = 'ValidatePlotCoordinateConsistency';
const VALIDATION_19_ERROR_SOURCE = 'validation';
const VALIDATION_19_ERROR_CODE = '19';
const VALIDATION_IDENTITY_CONFLICT_PATTERN = /Validation identity conflict/;

/** sitespecificvalidations.IsEnabled is a MySQL `bit` column: mysql2 returns it as a Buffer. */
function isEnabledFlag(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

describe('Stale-schema migrate + verify pipeline', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let exec: SqlExecutor;
  let sources: MigrationSource[];
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;

    exec = async (sql: string, params?: unknown[]): Promise<SchemaQueryRow[]> => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
    };

    sources = loadMigrationSources(SCHEMA_MIGRATION_MANIFEST, path.join(process.cwd(), 'db', 'migrations'));

    // Regress the freshly-provisioned schema to the known drift.
    await connection.query('ALTER TABLE temporarymeasurements DROP COLUMN PublishedStemID');
    await connection.query('ALTER TABLE temporarymeasurements DROP COLUMN SourceFormat');
    // A site provisioned by a deployment older than the PublishedStemID work also
    // lacks the storage columns, their lookup index, and the conflict error code.
    await connection.query('ALTER TABLE stems DROP COLUMN PublishedStemID');
    await connection.query('ALTER TABLE coremeasurements DROP COLUMN RawPublishedStemID');
    // A site provisioned before the plot-coordinate work lacks all ten columns
    // outright. Dropping them here (rather than only in the isolated drift
    // fixtures below) forces the ADD branch of migration 2026-08-27-01 to run
    // for every table, not just temporarymeasurements.PlotY via the partial-pair
    // fixture — a typo'd ALTER on stems/coremeasurements/measurementssummary/
    // viewfulltable would otherwise never execute in any test.
    await connection.query('ALTER TABLE temporarymeasurements DROP COLUMN PlotX, DROP COLUMN PlotY');
    await connection.query('ALTER TABLE stems DROP COLUMN PlotX, DROP COLUMN PlotY');
    await connection.query('ALTER TABLE coremeasurements DROP COLUMN RawPlotX, DROP COLUMN RawPlotY');
    await connection.query('ALTER TABLE measurementssummary DROP COLUMN StemPlotX, DROP COLUMN StemPlotY');
    await connection.query('ALTER TABLE viewfulltable DROP COLUMN StemPlotX, DROP COLUMN StemPlotY');
    // Reproduce a partially-applied prior-snapshot migration: PriorCensusID is
    // present, while the two value columns are missing. The original migration
    // only checked PriorCensusID, so the follow-up must repair both independently.
    await connection.query('ALTER TABLE measurement_error_log DROP COLUMN PriorHOM, DROP COLUMN PriorDBH');
    await connection.query('DELETE FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', ['ingestion', PUBLISHED_STEMID_CONFLICT_CODE]);
    // The 2025-09 identity rename (StemID => StemGUID) never migrated the
    // viewfulltable caches on ctfs-migrated schemas. Reproduce that shape, with
    // a cached row that must survive the repair rename.
    await connection.query('ALTER TABLE viewfulltable RENAME COLUMN StemGUID TO StemID');
    await connection.query('INSERT INTO viewfulltable (CoreMeasurementID, StemID) VALUES (?, ?)', [VFT_SENTINEL_CORE_MEASUREMENT_ID, VFT_SENTINEL_STEM_VALUE]);
    await connection.query(
      `ALTER TABLE temporarymeasurements MODIFY COLUMN ${REPRESENTATIVE_TEXT_COLUMN} varchar(255) CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NULL`
    );
    // Exercise a generated unique signature and a TEXT-family column. The
    // additive migration must leave both definitions untouched.
    await connection.query(`ALTER TABLE species MODIFY COLUMN SpeciesName varchar(64) CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NULL`);
    await connection.query(`ALTER TABLE uploadintegrityalerts MODIFY COLUMN message text CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NOT NULL`);
    // Task 12 baked validation 19 (ValidatePlotCoordinateConsistency) — both its
    // enabled sitespecificvalidations row and its measurement_errors catalog
    // row — into corequeries.sql/tablestructures.sql, so setupTestDatabase()
    // above already seeded both. Remove them here to reproduce the pre-Task-12
    // stale shape that migration 2026-08-27-02 exists to repair (seeded
    // disabled, because at migration time on a real stale site the helper
    // procedure it CALLs is not guaranteed to exist yet).
    await connection.query('DELETE FROM sitespecificvalidations WHERE ValidationID = 19');
    await connection.query(`DELETE FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '19'`);
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  it('(1) read-only contract audit fails, naming the missing columns and the legacy-collation column', async () => {
    const ledger = await readLedger(exec, schema); // no ledger table yet -> []
    expect(ledger).toEqual([]);

    const pending = selectPendingMigrations(sources, ledger);
    expect(pending.map(s => s.id)).toEqual(SCHEMA_MIGRATION_MANIFEST.map(m => m.id));

    const audit = await auditSchemaContract(
      exec,
      schema,
      pending.map(s => s.id)
    );

    expect(audit.ok).toBe(false);
    const missingColumns = audit.contractFailures.filter(f => f.kind === 'missing' && f.category === 'column').map(f => f.object);
    expect(missingColumns).toContain('PublishedStemID');
    expect(missingColumns).toContain('SourceFormat');
    expect(missingColumns).toContain('RawPublishedStemID');
    // stems.PublishedStemID is dropped from a different table than the
    // temporarymeasurements column of the same name — assert the table too.
    expect(audit.contractFailures.some(f => f.kind === 'missing' && f.category === 'column' && f.table === 'stems' && f.object === 'PublishedStemID')).toBe(
      true
    );
    // The pre-rename viewfulltable cache (forestgeo_panama/mpala/serc shape) is
    // named as drift on the exact table+column the edit-apply refresh writes.
    expect(audit.contractFailures.some(f => f.kind === 'missing' && f.category === 'column' && f.table === 'viewfulltable' && f.object === 'StemGUID')).toBe(
      true
    );
    const missingIndexes = audit.contractFailures.filter(f => f.kind === 'missing' && f.category === 'index').map(f => f.object);
    expect(missingIndexes).toContain(PUBLISHED_STEMID_INDEX);
    expect(audit.collationViolations.some(v => v.startsWith(`temporarymeasurements.${REPRESENTATIVE_TEXT_COLUMN}`))).toBe(true);
    // The generated-column table's non-generated text column is flagged too.
    expect(audit.collationViolations.some(v => v.startsWith('species.SpeciesName'))).toBe(true);
    expect(audit.collationViolations.some(v => v.startsWith('uploadintegrityalerts.message'))).toBe(true);
  });

  it('(2) applying the manifest migrations succeeds', async () => {
    const result = await applyPendingMigrations(exec, schema, sources);
    expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
    expect(result.appliedNow).toEqual(SCHEMA_MIGRATION_MANIFEST.map(m => m.id));

    const ledger = await readLedger(exec, schema);
    for (const source of sources) {
      const row = ledger.find(r => r.MigrationID === source.id);
      expect(row?.Status).toBe(MIGRATION_STATUS.APPLIED);
      expect(row?.Checksum).toBe(source.checksum);
    }
  });

  it('(3) a second apply is a no-op (nothing pending, no rows re-applied)', async () => {
    const appliedAtById = async (): Promise<Record<string, string>> => {
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT MigrationID, AppliedAt FROM \`${LEDGER_TABLE}\``);
      return Object.fromEntries(rows.map(r => [String(r.MigrationID), String(r.AppliedAt)]));
    };

    const before = await appliedAtById();
    const result = await applyPendingMigrations(exec, schema, sources);
    expect(result.pendingBefore).toEqual([]);
    expect(result.appliedNow).toEqual([]);

    const after = await appliedAtById();
    // Row count unchanged AND no ledger row's AppliedAt was rewritten: the
    // second apply neither inserted nor re-recorded any migration.
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after).toEqual(before);

    // Re-running the ledger-gated apply must not have duplicated the seeded
    // validation-19 rows.
    const [validationRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM sitespecificvalidations WHERE ValidationID = 19`);
    expect(Number(validationRows[0].count)).toBe(1);
    const [errorRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`, [
      VALIDATION_19_ERROR_SOURCE,
      VALIDATION_19_ERROR_CODE
    ]);
    expect(Number(errorRows[0].count)).toBe(1);
  });

  it('(4) compatibility gate passes after repair while legacy collations remain visible', async () => {
    const ledger = await readLedger(exec, schema);
    const pending = selectPendingMigrations(sources, ledger);
    expect(pending).toEqual([]);

    const audit = await auditSchemaContract(exec, schema, []);
    if (!audit.ok) {
      throw new Error(
        `Post-migration audit still failing:\n${formatContractFailures(audit.contractFailures)}\n` +
          `collation: ${audit.collationViolations.join(', ')}\nmissing procedures: ${audit.missingProcedures.join(', ')}`
      );
    }
    expect(audit.ok).toBe(true);
    expect(audit.collationViolations.some(v => v.includes(LEGACY_COLLATION))).toBe(true);

    const [repairedSnapshotColumns] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'measurement_error_log'
         AND COLUMN_NAME IN ('PriorCensusID', 'PriorDBH', 'PriorHOM')`,
      [schema]
    );
    expect(repairedSnapshotColumns.map(row => String(row.COLUMN_NAME)).sort()).toEqual(['PriorCensusID', 'PriorDBH', 'PriorHOM']);

    // All ten plot-coordinate columns exist post-migration, each independently
    // decimal(12,6) NULL — this schema was freshly provisioned (never regressed
    // on these columns), so this proves the "already exact -> no-op" branch of
    // the migration leaves a fresh contract-matching schema untouched.
    const [plotCoordinateColumns] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND (TABLE_NAME, COLUMN_NAME) IN (${PLOT_COORDINATE_COLUMNS.map(() => '(?, ?)').join(', ')})`,
      [schema, ...PLOT_COORDINATE_COLUMNS.flatMap(({ table, column }) => [table, column])]
    );
    expect(plotCoordinateColumns.length).toBe(PLOT_COORDINATE_COLUMNS.length);
    for (const { table, column } of PLOT_COORDINATE_COLUMNS) {
      const row = plotCoordinateColumns.find(r => String(r.TABLE_NAME) === table && String(r.COLUMN_NAME) === column);
      expect(row, `${table}.${column} missing after migration`).toBeDefined();
      expect(row?.COLUMN_TYPE, `${table}.${column} type`).toBe(PLOT_COORDINATE_TYPE);
      expect(row?.IS_NULLABLE, `${table}.${column} nullability`).toBe('YES');
    }

    // The error catalog is outside the structural contract, so audit.ok cannot
    // speak for it — but bulkingestionprocess writes this code, so a repair that
    // restored the columns without the catalog row would log conflicts to nothing.
    const [conflictCode] = await connection.query<RowDataPacket[]>(`SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`, [
      'ingestion',
      PUBLISHED_STEMID_CONFLICT_CODE
    ]);
    expect(conflictCode.length).toBe(1);

    // The viewfulltable repair must be a column RENAME, not a rebuild: the
    // sentinel cache row survives with its stem value now under StemGUID.
    const [sentinel] = await connection.query<RowDataPacket[]>(`SELECT StemGUID FROM viewfulltable WHERE CoreMeasurementID = ?`, [
      VFT_SENTINEL_CORE_MEASUREMENT_ID
    ]);
    expect(sentinel.length).toBe(1);
    expect(Number(sentinel[0].StemGUID)).toBe(VFT_SENTINEL_STEM_VALUE);

    // Validation 19 (ValidatePlotCoordinateConsistency) is seeded, disabled — the
    // helper procedure it CALLs does not exist yet at migration time.
    const [validation19] = await connection.query<RowDataPacket[]>(`SELECT ProcedureName, IsEnabled FROM sitespecificvalidations WHERE ValidationID = 19`);
    expect(validation19.length).toBe(1);
    expect(validation19[0].ProcedureName).toBe(VALIDATION_19_PROCEDURE_NAME);
    expect(isEnabledFlag(validation19[0].IsEnabled)).toBe(false);

    const [validation19Error] = await connection.query<RowDataPacket[]>(`SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`, [
      VALIDATION_19_ERROR_SOURCE,
      VALIDATION_19_ERROR_CODE
    ]);
    expect(validation19Error.length).toBe(1);

    // An existing, unrelated validation's IsEnabled flag (loaded from the
    // repository defaults before the migration ran) must be untouched.
    const [validation1] = await connection.query<RowDataPacket[]>(`SELECT ProcedureName, IsEnabled FROM sitespecificvalidations WHERE ValidationID = 1`);
    expect(validation1.length).toBe(1);
    expect(validation1[0].ProcedureName).toBe('ValidateDBHGrowthExceedsMax');
    expect(isEnabledFlag(validation1[0].IsEnabled)).toBe(true);
  });

  it('(5) a production keyed insert + one-row bulkingestionprocess succeed against the repaired schema', async () => {
    const fileID = `${'f'.repeat(46)}.csv`;
    expect(fileID).toHaveLength(50);
    const batchID = 'schema-repair-b1';
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;

    const row: FileRow = {
      tag: 'REPAIRTREE1',
      stemtag: '1',
      spcode: testData.species[0].SpeciesCode,
      quadrat: testData.quadrats[0].QuadratName,
      lx: '1',
      ly: '1',
      dbh: '10',
      hom: '1.3',
      date: '2026-01-01',
      codes: null,
      comments: null,
      publishedstemid: '7001'
    };

    const record = buildTemporaryMeasurementInsertRecord(row, fileID, batchID, null, SourceFormat.csv, plotID, censusID);
    const values = toTemporaryMeasurementInsertValues(record);

    const columnList = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.join(', ');
    const placeholders = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.map(() => '?').join(', ');
    await connection.query(`INSERT INTO temporarymeasurements (${columnList}) VALUES (${placeholders})`, values);

    const ingestion = await runBulkIngestion(connection, fileID, batchID);
    expect(ingestion.success, ingestion.message).toBe(true);

    const [ingested] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, cm.StemGUID, s.PublishedStemID
       FROM coremeasurements cm
       LEFT JOIN stems s ON s.StemGUID = cm.StemGUID
       WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ?`,
      [fileID, batchID]
    );
    expect(ingested.length).toBe(1);
    expect(ingested[0].StemGUID).not.toBeNull(); // resolved, not a failed measurement
    expect(ingested[0].PublishedStemID).toBe(7001);
  });

  it('(6) additive repair leaves utf8mb3 TEXT and generated unique-key definitions untouched', async () => {
    const [generated] = await connection.query<RowDataPacket[]>(
      `SELECT EXTRA, GENERATION_EXPRESSION
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'species' AND COLUMN_NAME = 'unique_sig'`,
      [schema]
    );
    expect(generated.length).toBe(1);
    expect(String(generated[0].EXTRA).toUpperCase()).toContain('STORED GENERATED');
    expect(String(generated[0].GENERATION_EXPRESSION).length).toBeGreaterThan(0);

    const [speciesNameMetadata] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_TYPE, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'species' AND COLUMN_NAME = 'SpeciesName'`,
      [schema]
    );
    expect(speciesNameMetadata[0].COLUMN_TYPE).toBe('varchar(64)');
    expect(speciesNameMetadata[0].COLLATION_NAME).toBe(LEGACY_COLLATION);

    const [messageMetadata] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_TYPE, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'uploadintegrityalerts' AND COLUMN_NAME = 'message'`,
      [schema]
    );
    expect(messageMetadata[0].COLUMN_TYPE).toBe('text');
    expect(messageMetadata[0].COLLATION_NAME).toBe(LEGACY_COLLATION);

    const insertedCode = 'REPAIRSP1';
    await connection.query(`INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive) VALUES (?, ?, 'species', 1)`, [insertedCode, 'Repairus testus']);
    const [roundTrip] = await connection.query<RowDataPacket[]>(`SELECT SpeciesName, unique_sig FROM species WHERE SpeciesCode = ?`, [insertedCode]);
    expect(roundTrip.length).toBe(1);
    expect(roundTrip[0].SpeciesName).toBe('Repairus testus');
    // The STORED unique signature still recomputes on insert.
    expect(String(roundTrip[0].unique_sig)).toContain(insertedCode);
  });
});

/**
 * Plot-coordinate migration column-level guard proof (integration, real MySQL).
 *
 * Each of the ten plot-coordinate columns is probed independently by
 * migration 2026-08-27-01, never treating one axis as a proxy for its pair.
 * These fixtures isolate that per-column behavior against two throwaway
 * schemas loaded straight from the canonical DDL (which already bakes the
 * columns in), each deliberately regressed to one specific drift shape:
 *   - a partial pair (X present, Y dropped) must be repaired to add only Y;
 *   - an existing same-named column of the wrong type must stop the
 *     migration with a named contract error and be left completely
 *     untouched, never silently coerced.
 */
describe('Plot-coordinate migration column-level guards', () => {
  let connection: Connection;
  let sources: MigrationSource[];

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST ?? 'localhost',
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? 'testpassword',
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      multipleStatements: true
    });
    sources = loadMigrationSources();
  }, 60_000);

  afterAll(async () => {
    if (!connection) return;
    await connection.end();
  });

  /** Loads the canonical DDL into a fresh throwaway schema, then applies `regress`. */
  async function provisionDriftSchema(schemaName: string, regress: (exec: SqlExecutor) => Promise<void>): Promise<SqlExecutor> {
    await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await connection.query(`CREATE DATABASE \`${schemaName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${schemaName}\``);

    const statements = splitSqlFile(fs.readFileSync(CANONICAL_DDL_PATH, 'utf-8'));
    const failures: string[] = [];
    for (const statement of statements) {
      try {
        await connection.query(statement.sql);
      } catch (error) {
        failures.push(`line ${statement.lineNumber}: ${(error as Error).message}`);
      }
    }
    expect(failures, `${schemaName} canonical DDL failed to load cleanly:\n${failures.join('\n')}`).toEqual([]);

    const exec: SqlExecutor = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
    };
    await regress(exec);
    return exec;
  }

  it('a partial pair (PlotX present, PlotY dropped) is repaired by adding only the missing axis', async () => {
    const schemaName = 'plotcoord_partial_pair';
    const exec = await provisionDriftSchema(schemaName, async e => {
      await e('ALTER TABLE temporarymeasurements DROP COLUMN PlotY');
    });

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
      expect(result.appliedNow).toContain(PLOT_COORDINATE_MIGRATION_ID);

      const [columns] = await connection.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'temporarymeasurements' AND COLUMN_NAME IN ('PlotX', 'PlotY')`,
        [schemaName]
      );
      const byColumn = Object.fromEntries(columns.map(row => [String(row.COLUMN_NAME), row]));
      // PlotX was never touched (already matched the contract); PlotY was added.
      expect(byColumn.PlotX?.COLUMN_TYPE).toBe(PLOT_COORDINATE_TYPE);
      expect(byColumn.PlotX?.IS_NULLABLE).toBe('YES');
      expect(byColumn.PlotY?.COLUMN_TYPE).toBe(PLOT_COORDINATE_TYPE);
      expect(byColumn.PlotY?.IS_NULLABLE).toBe('YES');
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);

  it('an existing same-named column with an incompatible type stops the migration with a named contract error and is left untouched', async () => {
    const schemaName = 'plotcoord_wrong_type';
    const exec = await provisionDriftSchema(schemaName, async e => {
      await e(`ALTER TABLE temporarymeasurements MODIFY COLUMN PlotX varchar(50) NULL`);
    });

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed).not.toBeNull();
      expect(result.failed?.id).toBe(PLOT_COORDINATE_MIGRATION_ID);
      expect(result.failed?.error).toContain('Plot-coordinate schema contract conflict');
      expect(result.failed?.error).toContain('temporarymeasurements.PlotX');

      const [columns] = await connection.query<RowDataPacket[]>(
        `SELECT COLUMN_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'temporarymeasurements' AND COLUMN_NAME = 'PlotX'`,
        [schemaName]
      );
      // The offending column was never coerced — the migration failed loudly
      // instead of silently accepting or "fixing" a shape it does not own.
      expect(columns[0]?.COLUMN_TYPE).toBe('varchar(50)');
      expect(columns[0]?.IS_NULLABLE).toBe('YES');

      const [helpers] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = 'mig_2026_08_27_01_raise_contract_conflict'`,
        [schemaName]
      );
      expect(Number(helpers[0].count), 'failed migration must clean up its helper procedure').toBe(0);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);
});

/**
 * Validation 19 identity-conflict preflight proof (integration, real MySQL).
 *
 * Migration 2026-08-27-02 must never seed ValidatePlotCoordinateConsistency over
 * the top of a pre-existing, differently-identified rule: ValidationID is
 * AUTO_INCREMENT for admin-authored rules, so the repository defaults ending at
 * 18 do not prove 19 is free on every live site. A collision on either the ID or
 * the ProcedureName must abort the whole migration with a named error and leave
 * both the conflicting row and the error catalog completely untouched — never a
 * silently swallowed INSERT IGNORE.
 */
describe('Validation 19 identity-conflict preflight', () => {
  let connection: Connection;
  let sources: MigrationSource[];

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST ?? 'localhost',
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? 'testpassword',
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      multipleStatements: true
    });
    sources = loadMigrationSources();
  }, 60_000);

  afterAll(async () => {
    if (!connection) return;
    await connection.end();
  });

  /** Loads the canonical DDL into a fresh throwaway schema, then applies `regress`. */
  async function provisionSchema(schemaName: string, seed?: (exec: SqlExecutor) => Promise<void>): Promise<SqlExecutor> {
    await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await connection.query(`CREATE DATABASE \`${schemaName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${schemaName}\``);

    const statements = splitSqlFile(fs.readFileSync(CANONICAL_DDL_PATH, 'utf-8'));
    const failures: string[] = [];
    for (const statement of statements) {
      try {
        await connection.query(statement.sql);
      } catch (error) {
        failures.push(`line ${statement.lineNumber}: ${(error as Error).message}`);
      }
    }
    expect(failures, `${schemaName} canonical DDL failed to load cleanly:\n${failures.join('\n')}`).toEqual([]);

    const exec: SqlExecutor = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
    };
    if (seed) await seed(exec);
    return exec;
  }

  it('refuses to seed validation 19 when the ID is held by a custom rule', async () => {
    const schemaName = 'validation19_id_conflict';
    const exec = await provisionSchema(schemaName, async e => {
      await e(
        `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
         VALUES (19, 'CustomSiteRule', 'site-authored', 'x', 'SELECT 1;', '', TRUE)`
      );
    });

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed).not.toBeNull();
      expect(result.failed?.id).toBe(VALIDATION_19_MIGRATION_ID);
      expect(result.failed?.error).toMatch(VALIDATION_IDENTITY_CONFLICT_PATTERN);

      const [rows] = await connection.query<RowDataPacket[]>(`SELECT ProcedureName FROM sitespecificvalidations WHERE ValidationID = 19`);
      expect(rows[0].ProcedureName, 'the conflicting row must be left untouched').toBe('CustomSiteRule');

      // The measurement_errors ('validation', '19') row ships in the canonical
      // DDL itself (tablestructures.sql), so provisionSchema() above already
      // seeded it before the migration ever ran — its presence here proves
      // only that the canonical seed exists, not that the migration inserted
      // it. What the preflight abort must guarantee is that it stays at
      // exactly one row: no duplicate insert past the identity-conflict check.
      const [errorRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`, [
        VALIDATION_19_ERROR_SOURCE,
        VALIDATION_19_ERROR_CODE
      ]);
      expect(Number(errorRows[0].count)).toBe(1);

      const [helpers] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = 'mig_2026_08_27_02_raise_validation_conflict'`,
        [schemaName]
      );
      expect(Number(helpers[0].count), 'failed migration must clean up its helper procedure').toBe(0);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);

  it('refuses to seed validation 19 when ValidatePlotCoordinateConsistency already exists under a different ID', async () => {
    const schemaName = 'validation19_name_conflict';
    const exec = await provisionSchema(schemaName, async e => {
      await e(
        `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
         VALUES (5, 'ValidatePlotCoordinateConsistency', 'relocated by hand', 'x', 'SELECT 1;', '', TRUE)`
      );
    });

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed).not.toBeNull();
      expect(result.failed?.id).toBe(VALIDATION_19_MIGRATION_ID);
      expect(result.failed?.error).toMatch(VALIDATION_IDENTITY_CONFLICT_PATTERN);

      const [rows] = await connection.query<RowDataPacket[]>(`SELECT ValidationID FROM sitespecificvalidations WHERE ProcedureName = ?`, [
        VALIDATION_19_PROCEDURE_NAME
      ]);
      expect(rows.length, 'the conflicting row must be left untouched, and no row must have been added at ValidationID 19').toBe(1);
      expect(rows[0].ValidationID).toBe(5);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);

  it('seeds validation 19 disabled on a clean schema, and re-running the migration SQL directly is a no-op', async () => {
    const schemaName = 'validation19_happy_path';
    const exec = await provisionSchema(schemaName);
    const migration = sources.find(source => source.id === VALIDATION_19_MIGRATION_ID);
    if (!migration) throw new Error(`Migration source ${VALIDATION_19_MIGRATION_ID} not found in manifest sources`);

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
      expect(result.appliedNow).toContain(VALIDATION_19_MIGRATION_ID);

      const [validationRows] = await connection.query<RowDataPacket[]>(`SELECT ProcedureName, IsEnabled FROM sitespecificvalidations WHERE ValidationID = 19`);
      expect(validationRows.length).toBe(1);
      expect(validationRows[0].ProcedureName).toBe(VALIDATION_19_PROCEDURE_NAME);
      expect(isEnabledFlag(validationRows[0].IsEnabled)).toBe(false);

      const [errorRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`, [
        VALIDATION_19_ERROR_SOURCE,
        VALIDATION_19_ERROR_CODE
      ]);
      expect(Number(errorRows[0].count)).toBe(1);

      // Re-execute the migration's raw SQL a second time, bypassing the ledger
      // entirely, to prove the migration's own information_schema/NOT EXISTS
      // guards make it idempotent on a re-run — not merely skipped by the ledger.
      await connection.query(migration.contents);

      const [validationRowsAfterRerun] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM sitespecificvalidations WHERE ValidationID = 19`
      );
      expect(Number(validationRowsAfterRerun[0].count)).toBe(1);
      const [errorRowsAfterRerun] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?`,
        [VALIDATION_19_ERROR_SOURCE, VALIDATION_19_ERROR_CODE]
      );
      expect(Number(errorRowsAfterRerun[0].count)).toBe(1);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);

  it('repairs repository-owned fields on an exact but partially seeded validation identity', async () => {
    const schemaName = 'validation19_partial_exact';
    const exec = await provisionSchema(schemaName, async e => {
      await e(`DELETE FROM sitespecificvalidations WHERE ValidationID = 19`);
      await e(
        `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
         VALUES (19, 'ValidatePlotCoordinateConsistency', 'partial', 'x', 'SELECT 1;', 'wrong', FALSE)`
      );
    });

    try {
      const result = await applyPendingMigrations(exec, schemaName, sources);
      expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();

      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT Description, Criteria, Definition, ChangelogDefinition, IsEnabled
           FROM sitespecificvalidations WHERE ValidationID = 19`
      );
      expect(rows[0]).toMatchObject({
        Description: "Plot coordinate disagrees with the quadrat's own median offset",
        Criteria: 'stemPlotX;stemPlotY;stemLocalX;stemLocalY;quadratName;treeTag;stemTag',
        Definition: 'CALL RunPlotCoordinateConsistencyValidation(@p_CensusID, @p_PlotID);',
        ChangelogDefinition: ''
      });
      expect(isEnabledFlag(rows[0].IsEnabled)).toBe(false);
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    }
  }, 60_000);
});
