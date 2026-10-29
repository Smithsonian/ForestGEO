/**
 * coremeasurements index trim (#560): migration 2026-10-28-01 on real MySQL.
 *
 * Every case runs on a throwaway schema built from the canonical DDL, with the five
 * pre-change indexes re-added (the shape every Azure schema has before the deploy):
 *   (I1) the real runner takes the 19-index table to exactly the 14, leaves the same-named
 *        indexes of measurementssummary and unifiedchangelog alone, and the contract audit passes;
 *   (I1b) on an already-trimmed coremeasurements beside an intact measurementssummary (which keeps
 *        its own idx_description / idx_measurementdate) the migration is a clean no-op;
 *   (I2) the harvard and mpala/rabi 21-index shapes end at the same 14; a second runner pass
 *        and a raw re-execution change nothing;
 *   (I3) both coremeasurements foreign keys survive and still enforce;
 *   (I4) any successor removed, reshaped, invisible or (ux_measure_unique) no longer unique:
 *        named conflict, nothing dropped, no helper, ledger failed; once restored, the retry applies.
 *
 * Prerequisites: docker compose up -d mysql (from the main checkout root).
 * Run alone, through the shared integration lock (#560 plan, section 0).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { applyPendingMigrations, auditSchemaContract, MIGRATION_STATUS, type MigrationSource } from '@/scripts/apply-schema-migrations';
import {
  addMissingIndexes,
  connectionExecutor,
  COREMEASUREMENTS_TABLE,
  CTFS_DRIFT_INDEX_COUNT,
  CTFS_DRIFT_SHAPES,
  dropThrowawaySchema,
  dropThrowawaySchemaAfterSetupFailure,
  DROPPED_CANONICAL_INDEXES,
  LOCAL_DB_HOSTS,
  MEASUREMENTS_SUMMARY_TABLE,
  mysqlErrno,
  PRE_CHANGE_INDEX_COUNT,
  provisionCanonicalSchema,
  readIndexSignatures,
  readLedgerEntry,
  requireTrimMigrationSource,
  routineExists,
  showCreateTable,
  sortedSignatures,
  SUCCESSOR_REFUSAL_CASES,
  TRIM_CONFLICT_HELPER_PROCEDURE,
  TRIM_MIGRATION_ID,
  TRIM_REFUSAL_MESSAGE_PREFIX,
  TRIMMED_COREMEASUREMENTS_INDEXES,
  UNIFIED_CHANGELOG_TABLE
} from '../setup/coremeasurements-index-fixtures';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!(LOCAL_DB_HOSTS as readonly string[]).includes(TEST_DB_HOST)) {
  throw new Error(`[coremeasurements-index-trim] REFUSING TO RUN: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite creates, alters and drops schemas.`);
}

const CASE_TIMEOUT_MS = 120_000;
/** The schema contract never models PRIMARY, so the audit lists it as an extra on every table, trimmed or not. */
const PRIMARY_INDEX_NAME = 'PRIMARY';
const MYSQL_ERRNO_NO_REFERENCED_ROW = 1452;
const EXPECTED_FOREIGN_KEYS = ['FK_CoreMeasurements_Stems', 'coremeasurements_census_CensusID_fk'].sort();
const NONEXISTENT_CENSUS_OFFSET = 1000;
const FK_FIXTURE = {
  PLOT_NAME: 'I3 plot',
  CENSUS_NUMBER: 1,
  CENSUS_START: '2024-01-01',
  CENSUS_END: '2024-12-31',
  QUADRAT_NAME: 'Q01',
  TREE_TAG: 'I3-TREE',
  STEM_TAG: '1',
  MEASUREMENT_DATE: '2024-03-15',
  DBH: 10,
  HOM: 1.3
} as const;
const SUFFIX = { I1: '_cmt_i1', I1B: '_cmt_i1b', I3: '_cmt_i3' } as const;

const trimmedSignatures = sortedSignatures(TRIMMED_COREMEASUREMENTS_INDEXES);

async function provisionPreChangeSchema(suffix: string): Promise<{ schema: string; connection: Connection }> {
  const provisioned = await provisionCanonicalSchema(suffix);
  try {
    await addMissingIndexes(provisioned.connection, DROPPED_CANONICAL_INDEXES);
  } catch (error) {
    await dropThrowawaySchemaAfterSetupFailure(provisioned.connection, provisioned.schema, error);
  }
  return provisioned;
}

function logSignatures(tag: string, label: string, signatures: string[]): void {
  console.log(`[${tag}] ${label} (${signatures.length}):\n  ${signatures.join('\n  ')}`);
}

describe('migration 2026-10-28-01 on throwaway schemas (#560)', () => {
  let trimSource: MigrationSource;

  beforeAll(() => {
    trimSource = requireTrimMigrationSource();
  });

  it(
    '(I1) takes the pre-change 19-index table to exactly the 14 and touches no other table',
    async () => {
      const { schema, connection } = await provisionPreChangeSchema(SUFFIX.I1);
      try {
        const before = await readIndexSignatures(connection, schema);
        const summaryBefore = await readIndexSignatures(connection, schema, MEASUREMENTS_SUMMARY_TABLE);
        const changelogBefore = await readIndexSignatures(connection, schema, UNIFIED_CHANGELOG_TABLE);

        const result = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);

        const after = await readIndexSignatures(connection, schema);
        const summaryAfter = await readIndexSignatures(connection, schema, MEASUREMENTS_SUMMARY_TABLE);
        const changelogAfter = await readIndexSignatures(connection, schema, UNIFIED_CHANGELOG_TABLE);
        const audit = await auditSchemaContract(connectionExecutor(connection), schema, []);
        const coremeasurementsIndexExtras = audit.contractExtras.filter(
          extra => extra.table.toLowerCase() === COREMEASUREMENTS_TABLE && extra.category === 'index' && extra.object !== PRIMARY_INDEX_NAME
        );
        const helperLeft = await routineExists(connection, schema, TRIM_CONFLICT_HELPER_PROCEDURE);
        logSignatures('I1', 'before', before);
        logSignatures('I1', 'after', after);
        console.log(
          `[I1] result=${JSON.stringify(result)} helperLeft=${helperLeft}\n` +
            `[I1] contractFailures=${JSON.stringify(audit.contractFailures)} coremeasurementsIndexExtras=${JSON.stringify(coremeasurementsIndexExtras)}`
        );

        expect(before, 'fixture is not the pre-change shape').toHaveLength(PRE_CHANGE_INDEX_COUNT);
        expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
        expect(result.appliedNow).toEqual([TRIM_MIGRATION_ID]);
        expect(after).toEqual(trimmedSignatures);
        expect(summaryAfter, 'the drop list must be filtered to coremeasurements (F4)').toEqual(summaryBefore);
        expect(changelogAfter, 'the drop list must be filtered to coremeasurements (F4)').toEqual(changelogBefore);
        // The throwaway schema has no stored procedures, so audit.ok is false for missingProcedures;
        // the structural contract is what this case proves.
        expect(audit.contractFailures).toEqual([]);
        expect(coremeasurementsIndexExtras).toEqual([]);
        expect(helperLeft).toBe(false);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(I1b) is a clean no-op on an already-trimmed coremeasurements beside an intact measurementssummary',
    async () => {
      const { schema, connection } = await provisionCanonicalSchema(SUFFIX.I1B);
      try {
        const before = await readIndexSignatures(connection, schema);
        const summaryBefore = await readIndexSignatures(connection, schema, MEASUREMENTS_SUMMARY_TABLE);
        const changelogBefore = await readIndexSignatures(connection, schema, UNIFIED_CHANGELOG_TABLE);

        const result = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);

        const after = await readIndexSignatures(connection, schema);
        const summaryAfter = await readIndexSignatures(connection, schema, MEASUREMENTS_SUMMARY_TABLE);
        const changelogAfter = await readIndexSignatures(connection, schema, UNIFIED_CHANGELOG_TABLE);
        logSignatures('I1b', 'measurementssummary before', summaryBefore);
        console.log(`[I1b] result=${JSON.stringify(result)}`);

        expect(before, 'fixture: the canonical DDL is already trimmed').toEqual(trimmedSignatures);
        expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
        expect(result.appliedNow).toEqual([TRIM_MIGRATION_ID]);
        expect(after).toEqual(trimmedSignatures);
        expect(summaryAfter, 'same-named measurementssummary indexes must survive (F4)').toEqual(summaryBefore);
        expect(changelogAfter).toEqual(changelogBefore);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it.each(CTFS_DRIFT_SHAPES)(
    '(I2) $label drift (21 indexes) ends at the same 14, and re-runs change nothing',
    async ({ label, suffix, extras }) => {
      const { schema, connection } = await provisionPreChangeSchema(suffix);
      try {
        await addMissingIndexes(connection, extras);
        const before = await readIndexSignatures(connection, schema);

        const firstRun = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);
        const after = await readIndexSignatures(connection, schema);
        const createAfterFirst = await showCreateTable(connection);
        const ledgerAfterFirst = await readLedgerEntry(connection, schema, TRIM_MIGRATION_ID);

        const secondRun = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);
        await connection.query(trimSource.contents);
        const createAfterReruns = await showCreateTable(connection);
        const ledgerAfterReruns = await readLedgerEntry(connection, schema, TRIM_MIGRATION_ID);
        logSignatures('I2', `${label} before`, before);
        logSignatures('I2', `${label} after`, after);
        console.log(
          `[I2] ${label} firstRun=${JSON.stringify(firstRun)} secondRun=${JSON.stringify(secondRun)}\n` +
            `[I2] ledger first=${JSON.stringify(ledgerAfterFirst)} afterReruns=${JSON.stringify(ledgerAfterReruns)}`
        );

        expect(before, 'fixture is not the 21-index drift shape').toHaveLength(CTFS_DRIFT_INDEX_COUNT);
        expect(firstRun.failed, firstRun.failed ? `${firstRun.failed.id}: ${firstRun.failed.error}` : undefined).toBeNull();
        expect(after).toEqual(trimmedSignatures);
        expect(secondRun.pendingBefore, 'an applied migration must not be selected again').toEqual([]);
        expect(secondRun.appliedNow).toEqual([]);
        expect(createAfterReruns, 'the raw re-execution must be a no-op').toBe(createAfterFirst);
        expect(ledgerAfterReruns).toEqual(ledgerAfterFirst);
        expect(ledgerAfterFirst?.status).toBe(MIGRATION_STATUS.APPLIED);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(I3) both coremeasurements foreign keys survive the drop and still enforce',
    async () => {
      const { schema, connection } = await provisionPreChangeSchema(SUFFIX.I3);
      try {
        const result = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);
        const [foreignKeyRows] = await connection.query<RowDataPacket[]>(
          `SELECT CONSTRAINT_NAME AS constraintName FROM information_schema.REFERENTIAL_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`,
          [schema, COREMEASUREMENTS_TABLE]
        );
        const foreignKeys = foreignKeyRows.map(row => String(row.constraintName)).sort();

        const insertedID = async (sql: string, params: unknown[]): Promise<number> => {
          const [header] = await connection.query<ResultSetHeader>(sql, params);
          return header.insertId;
        };
        const plotID = await insertedID(`INSERT INTO plots (PlotName) VALUES (?)`, [FK_FIXTURE.PLOT_NAME]);
        const censusID = await insertedID(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate) VALUES (?, ?, ?, ?)`, [
          plotID,
          FK_FIXTURE.CENSUS_NUMBER,
          FK_FIXTURE.CENSUS_START,
          FK_FIXTURE.CENSUS_END
        ]);
        const quadratID = await insertedID(`INSERT INTO quadrats (PlotID, QuadratName) VALUES (?, ?)`, [plotID, FK_FIXTURE.QUADRAT_NAME]);
        const treeID = await insertedID(`INSERT INTO trees (TreeTag, CensusID) VALUES (?, ?)`, [FK_FIXTURE.TREE_TAG, censusID]);
        const stemGUID = await insertedID(`INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag) VALUES (?, ?, ?, ?)`, [
          treeID,
          quadratID,
          censusID,
          FK_FIXTURE.STEM_TAG
        ]);
        const measurementID = await insertedID(
          `INSERT INTO coremeasurements (CensusID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM) VALUES (?, ?, ?, ?, ?)`,
          [censusID, stemGUID, FK_FIXTURE.MEASUREMENT_DATE, FK_FIXTURE.DBH, FK_FIXTURE.HOM]
        );

        let unknownCensusError: unknown = null;
        try {
          await connection.query(`INSERT INTO coremeasurements (CensusID, MeasurementDate) VALUES (?, ?)`, [
            censusID + NONEXISTENT_CENSUS_OFFSET,
            FK_FIXTURE.MEASUREMENT_DATE
          ]);
        } catch (error) {
          unknownCensusError = error;
        }

        await connection.query(`DELETE FROM stems WHERE StemGUID = ?`, [stemGUID]);
        const [remaining] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS remaining FROM coremeasurements WHERE CoreMeasurementID = ?`, [
          measurementID
        ]);
        console.log(
          `[I3] result=${JSON.stringify(result)} foreignKeys=${JSON.stringify(foreignKeys)} ` +
            `unknownCensusErrno=${mysqlErrno(unknownCensusError)} remainingAfterStemDelete=${remaining[0].remaining}`
        );

        expect(result.failed).toBeNull();
        expect(foreignKeys).toEqual(EXPECTED_FOREIGN_KEYS);
        expect(mysqlErrno(unknownCensusError), 'the census foreign key no longer enforces').toBe(MYSQL_ERRNO_NO_REFERENCED_ROW);
        expect(Number(remaining[0].remaining), 'the stems foreign key no longer cascades').toBe(0);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it.each(SUCCESSOR_REFUSAL_CASES)(
    '(I4) $label: refuses with the named conflict, drops nothing, leaves no helper, and applies once restored',
    async ({ label, caseTag, refusedName, regress, restore }) => {
      const { schema, connection } = await provisionPreChangeSchema(`_cmt_i4_${caseTag}`);
      try {
        await regress(connection);
        const before = await readIndexSignatures(connection, schema);

        const refused = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);
        const afterRefusal = await readIndexSignatures(connection, schema);
        const ledgerAfterRefusal = await readLedgerEntry(connection, schema, TRIM_MIGRATION_ID);
        const helperAfterRefusal = await routineExists(connection, schema, TRIM_CONFLICT_HELPER_PROCEDURE);

        await restore(connection);
        const retry = await applyPendingMigrations(connectionExecutor(connection), schema, [trimSource]);
        const afterRetry = await readIndexSignatures(connection, schema);
        const ledgerAfterRetry = await readLedgerEntry(connection, schema, TRIM_MIGRATION_ID);
        const helperAfterRetry = await routineExists(connection, schema, TRIM_CONFLICT_HELPER_PROCEDURE);
        logSignatures('I4', `${label} before`, before);
        logSignatures('I4', `${label} after refusal`, afterRefusal);
        console.log(
          `[I4] ${label} refused=${JSON.stringify(refused.failed)} ledger=${JSON.stringify(ledgerAfterRefusal)} helper=${helperAfterRefusal}\n` +
            `[I4] ${label} retry=${JSON.stringify(retry)} ledger=${JSON.stringify(ledgerAfterRetry)} helper=${helperAfterRetry}`
        );

        expect(refused.failed?.id).toBe(TRIM_MIGRATION_ID);
        expect(refused.failed?.error).toBe(`${TRIM_REFUSAL_MESSAGE_PREFIX} ${refusedName}`);
        expect(refused.appliedNow).toEqual([]);
        expect(afterRefusal, 'a refused run must drop nothing').toEqual(before);
        expect(ledgerAfterRefusal?.status).toBe(MIGRATION_STATUS.FAILED);
        expect(helperAfterRefusal, 'failureCleanup must remove the helper').toBe(false);
        expect(retry.failed, retry.failed ? `${retry.failed.id}: ${retry.failed.error}` : undefined).toBeNull();
        expect(retry.appliedNow).toEqual([TRIM_MIGRATION_ID]);
        expect(afterRetry).toEqual(trimmedSignatures);
        expect(ledgerAfterRetry?.status).toBe(MIGRATION_STATUS.APPLIED);
        expect(helperAfterRetry).toBe(false);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );
});
