/**
 * Stale-schema repair proof (integration, real MySQL).
 *
 * Provisions a throwaway schema from the canonical DDL, intentionally regresses it
 * to the known live-schema drift (drops temporarymeasurements.PublishedStemID and
 * SourceFormat; downgrades representative VARCHAR/TEXT columns to utf8mb3; no
 * migration ledger), then proves the migrate + verify pipeline repairs the
 * application write contract end to end without rebuilding unrelated tables and
 * remains idempotent:
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
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, runBulkIngestion, type TestData } from '../setup/local-db-setup';
import { formatContractFailures, type SchemaQueryRow } from '@/lib/db/schema-contract';
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
    await connection.query(
      `ALTER TABLE temporarymeasurements MODIFY COLUMN ${REPRESENTATIVE_TEXT_COLUMN} varchar(255) CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NULL`
    );
    // Exercise a generated unique signature and a TEXT-family column. The
    // additive migration must leave both definitions untouched.
    await connection.query(`ALTER TABLE species MODIFY COLUMN SpeciesName varchar(64) CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NULL`);
    await connection.query(`ALTER TABLE uploadintegrityalerts MODIFY COLUMN message text CHARACTER SET ${LEGACY_CHARSET} COLLATE ${LEGACY_COLLATION} NOT NULL`);
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
  });

  it('(5) a production keyed insert + one-row bulkingestionprocess succeed against the repaired schema', async () => {
    const fileID = 'schema-repair-f1';
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
