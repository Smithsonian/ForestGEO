/**
 * Hand-run twin migration 62 (#560, spec section 5.7): integration, real MySQL.
 *
 * Executed the way the mysql client runs it: the repo's splitSqlFile (which honours
 * DELIMITER), one statement at a time, stopping at the first error. The runner scripts
 * themselves cannot run at the base commit (REPO_ROOT and a removed helper file; follow-up),
 * so their files are run in the scripts' order instead.
 *   (a) pre-change 19 -> 62 -> canonical 14, helper gone; a second 62 changes nothing
 *   (b) canonical 14 -> 28 -> 15 -> 62 -> canonical 14
 *   (c) each successor removed, reshaped, invisible or (ux_measure_unique) non-unique on the post-28
 *       schema: 62 stops with SQLSTATE 45000 naming exactly that successor, and the signatures are byte-identical
 *   (d) once restored, 62 completes and removes the helper the refused run left behind
 *
 * Prerequisites: docker compose up -d mysql. Run alone, through the shared integration lock.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import {
  addMissingIndexes,
  dropThrowawaySchema,
  DROPPED_CANONICAL_INDEXES,
  LOCAL_DB_HOSTS,
  mysqlErrno,
  mysqlSqlState,
  provisionCanonicalSchema,
  readIndexSignatures,
  routineExists,
  showCreateTable,
  sortedSignatures,
  SUCCESSOR_REFUSAL_CASES,
  TRIM_REFUSAL_MESSAGE_PREFIX,
  TRIMMED_COREMEASUREMENTS_INDEXES
} from '../setup/coremeasurements-index-fixtures';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!(LOCAL_DB_HOSTS as readonly string[]).includes(TEST_DB_HOST)) {
  throw new Error(`[coremeasurements-index-trim-twin] REFUSING TO RUN: TEST_DB_HOST="${TEST_DB_HOST}" is not local.`);
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const TWIN_TRIM_FILE = 'unified-measurements-migrations/62_trim_coremeasurements_redundant_indexes.sql';
const MIGRATION_28_FILE = 'unified-measurements-migrations/28_add_bulk_ingestion_performance_indexes.sql';
const TWIN_HELPER_PROCEDURE = 'mig_62_trim_coremeasurements_redundant_indexes';
const MYSQL_ERRNO_SIGNAL_EXCEPTION = 1644;
const CONTRACT_CONFLICT_SQLSTATE = '45000';
const RE_ADDED_BY_MIGRATION_28 = 'idx_cm_census_active';
const CASE_TIMEOUT_MS = 120_000;
const SUFFIX = { PRE_CHANGE: '_cmt_i8_a', AFTER_28: '_cmt_i8_b' } as const;

const trimmedSignatures = sortedSignatures(TRIMMED_COREMEASUREMENTS_INDEXES);
const censusActiveIndex = DROPPED_CANONICAL_INDEXES.find(index => index.name === RE_ADDED_BY_MIGRATION_28)!;
const post28Signatures = sortedSignatures([...TRIMMED_COREMEASUREMENTS_INDEXES, censusActiveIndex]);

interface ClientRunOutcome {
  statementsRun: number;
  error: unknown;
  failedAtLine: number | null;
}

/** The mysql client contract: statements in order, stop at the first error. */
async function runFileLikeMysqlClient(connection: Connection, relativePath: string): Promise<ClientRunOutcome> {
  const statements = splitSqlFile(fs.readFileSync(path.join(MIGRATIONS_DIR, relativePath), 'utf-8'));
  let statementsRun = 0;
  for (const statement of statements) {
    try {
      await connection.query(statement.sql);
    } catch (error) {
      return { statementsRun, error, failedAtLine: statement.lineNumber };
    }
    statementsRun += 1;
  }
  return { statementsRun, error: null, failedAtLine: null };
}

function describeOutcome(outcome: ClientRunOutcome): string {
  const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  return `statementsRun=${outcome.statementsRun} failedAtLine=${outcome.failedAtLine} errno=${mysqlErrno(outcome.error)} sqlState=${mysqlSqlState(outcome.error)} message=${outcome.error ? message : 'none'}`;
}

describe('hand-run twin migration 62 (#560)', () => {
  it(
    '(I8a) takes the pre-change 19 to the canonical 14, removes its helper, and a second run changes nothing',
    async () => {
      const { schema, connection } = await provisionCanonicalSchema(SUFFIX.PRE_CHANGE);
      try {
        await addMissingIndexes(connection, DROPPED_CANONICAL_INDEXES);
        const first = await runFileLikeMysqlClient(connection, TWIN_TRIM_FILE);
        const afterFirst = await readIndexSignatures(connection, schema);
        const createAfterFirst = await showCreateTable(connection);
        const helperLeft = await routineExists(connection, schema, TWIN_HELPER_PROCEDURE);
        const second = await runFileLikeMysqlClient(connection, TWIN_TRIM_FILE);
        const createAfterSecond = await showCreateTable(connection);
        console.log(
          `[I8a] first: ${describeOutcome(first)}\n[I8a] second: ${describeOutcome(second)}\n[I8a] after=${JSON.stringify(afterFirst)} helperLeft=${helperLeft}`
        );

        expect(first.error).toBeNull();
        expect(afterFirst).toEqual(trimmedSignatures);
        expect(helperLeft).toBe(false);
        expect(second.error).toBeNull();
        expect(createAfterSecond).toBe(createAfterFirst);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(I8b) re-trims after migration 28 re-creates idx_cm_census_active: 14 -> 15 -> 14',
    async () => {
      const { schema, connection } = await provisionCanonicalSchema(SUFFIX.AFTER_28);
      try {
        const run28 = await runFileLikeMysqlClient(connection, MIGRATION_28_FILE);
        const after28 = await readIndexSignatures(connection, schema);
        const run62 = await runFileLikeMysqlClient(connection, TWIN_TRIM_FILE);
        const after62 = await readIndexSignatures(connection, schema);
        console.log(`[I8b] 28: ${describeOutcome(run28)} -> ${after28.length}\n[I8b] 62: ${describeOutcome(run62)} -> ${after62.length}`);

        expect(run28.error).toBeNull();
        expect(after28, 'fixture: migration 28 must re-add exactly idx_cm_census_active').toEqual(post28Signatures);
        expect(run62.error).toBeNull();
        expect(after62).toEqual(trimmedSignatures);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it.each(SUCCESSOR_REFUSAL_CASES)(
    '(I8c/d) $label after 28: 62 refuses, changes no signature, and completes once restored',
    async ({ label, caseTag, refusedName, regress, restore }) => {
      const { schema, connection } = await provisionCanonicalSchema(`_cmt_i8_c${caseTag}`);
      try {
        const run28 = await runFileLikeMysqlClient(connection, MIGRATION_28_FILE);
        expect(run28.error, 'fixture: migration 28 must apply').toBeNull();
        await regress(connection);
        const before = await readIndexSignatures(connection, schema);

        const refused = await runFileLikeMysqlClient(connection, TWIN_TRIM_FILE);
        const afterRefusal = await readIndexSignatures(connection, schema);
        const helperAfterRefusal = await routineExists(connection, schema, TWIN_HELPER_PROCEDURE);

        await restore(connection);
        const retry = await runFileLikeMysqlClient(connection, TWIN_TRIM_FILE);
        const afterRetry = await readIndexSignatures(connection, schema);
        const helperAfterRetry = await routineExists(connection, schema, TWIN_HELPER_PROCEDURE);
        console.log(
          `[I8c] ${label} refused: ${describeOutcome(refused)}\n[I8c] before=${JSON.stringify(before)}\n[I8c] afterRefusal=${JSON.stringify(afterRefusal)} helper=${helperAfterRefusal}\n` +
            `[I8d] ${label} retry: ${describeOutcome(retry)} after=${JSON.stringify(afterRetry)} helper=${helperAfterRetry}`
        );

        expect(mysqlErrno(refused.error)).toBe(MYSQL_ERRNO_SIGNAL_EXCEPTION);
        expect(mysqlSqlState(refused.error)).toBe(CONTRACT_CONFLICT_SQLSTATE);
        expect((refused.error as Error).message).toBe(`${TRIM_REFUSAL_MESSAGE_PREFIX} ${refusedName}`);
        expect(afterRefusal, 'a refused 62 must drop nothing, idx_cm_census_active included').toEqual(before);
        expect(afterRefusal.some(signature => signature.startsWith(`${RE_ADDED_BY_MIGRATION_28}(`))).toBe(true);
        expect(helperAfterRefusal, 'the client stops at the SIGNAL, so the helper stays until the next run (F13)').toBe(true);
        expect(retry.error).toBeNull();
        expect(afterRetry).toEqual(trimmedSignatures);
        expect(helperAfterRetry).toBe(false);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );
});
