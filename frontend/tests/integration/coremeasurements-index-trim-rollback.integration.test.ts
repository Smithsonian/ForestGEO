/**
 * Rollback of migration 2026-10-28-01 (#560, spec section 5.5): integration, real MySQL.
 *
 *   (I6a) after the trim, the hand-run rollback restores exactly the 19 pre-change index
 *         signatures, and a second run is a no-op;
 *   (I6b) while another session holds a metadata lock on coremeasurements, the rollback
 *         fails with 1205 within this session's (tighter) bound, changes nothing and does
 *         not raise the bound; once the holder finishes, a session at the server default
 *         applies it and is left capped at 60 s.
 *
 * Prerequisites: docker compose up -d mysql. Run alone, through the shared integration lock.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { applyPendingMigrations } from '@/scripts/apply-schema-migrations';
import {
  addMissingIndexes,
  connectionExecutor,
  COREMEASUREMENTS_TABLE,
  dropThrowawaySchema,
  DROPPED_CANONICAL_INDEXES,
  LOCAL_DB_HOSTS,
  mysqlErrno,
  openSessionOn,
  PRE_CHANGE_INDEX_COUNT,
  provisionCanonicalSchema,
  readIndexSignatures,
  requireTrimMigrationSource,
  showCreateTable,
  sortedSignatures,
  TRIMMED_COREMEASUREMENTS_INDEXES
} from '../setup/coremeasurements-index-fixtures';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!(LOCAL_DB_HOSTS as readonly string[]).includes(TEST_DB_HOST)) {
  throw new Error(`[coremeasurements-index-trim-rollback] REFUSING TO RUN: TEST_DB_HOST="${TEST_DB_HOST}" is not local.`);
}

const ROLLBACK_FILE = path.join(
  process.cwd(),
  'db/migrations/schema-contract-repair/rollback/2026-10-28-01-trim-coremeasurements-redundant-indexes.rollback.sql'
);
const ROLLBACK_LOCK_WAIT_BOUND_SECONDS = 60;
const SHORT_LOCK_WAIT_SECONDS = 2;
const MS_PER_SECOND = 1000;
const LOCK_WAIT_EARLY_TOLERANCE_MS = 250;
const LOCK_WAIT_LATE_SLACK_MS = 5_000;
const MYSQL_ERRNO_LOCK_WAIT_TIMEOUT = 1205;
const CASE_TIMEOUT_MS = 180_000;
const SUFFIX = { RESTORE: '_cmt_i6_a', HELD_LOCK: '_cmt_i6_b' } as const;

const preChangeSignatures = sortedSignatures([...TRIMMED_COREMEASUREMENTS_INDEXES, ...DROPPED_CANONICAL_INDEXES]);
const trimmedSignatures = sortedSignatures(TRIMMED_COREMEASUREMENTS_INDEXES);

interface SessionLockWaits {
  lockWait: number;
  innodbLockWait: number;
}

async function readSessionLockWaits(session: Connection): Promise<SessionLockWaits> {
  const [rows] = await session.query<RowDataPacket[]>(`SELECT @@SESSION.lock_wait_timeout AS lockWait, @@SESSION.innodb_lock_wait_timeout AS innodbLockWait`);
  return { lockWait: Number(rows[0].lockWait), innodbLockWait: Number(rows[0].innodbLockWait) };
}

async function provisionTrimmedSchema(suffix: string): Promise<{ schema: string; connection: Connection }> {
  const provisioned = await provisionCanonicalSchema(suffix);
  try {
    await addMissingIndexes(provisioned.connection, DROPPED_CANONICAL_INDEXES);
    const result = await applyPendingMigrations(connectionExecutor(provisioned.connection), provisioned.schema, [requireTrimMigrationSource()]);
    expect(result.failed, 'fixture: the trim migration must apply before the rollback is tested').toBeNull();
  } catch (error) {
    await dropThrowawaySchema(provisioned.connection, provisioned.schema);
    throw error;
  }
  return provisioned;
}

describe('rollback of migration 2026-10-28-01 (#560)', () => {
  const rollbackSql = fs.readFileSync(ROLLBACK_FILE, 'utf-8');

  it(
    '(I6a) restores exactly the five dropped canonical indexes, and a re-run is a no-op',
    async () => {
      const { schema, connection } = await provisionTrimmedSchema(SUFFIX.RESTORE);
      try {
        const trimmed = await readIndexSignatures(connection, schema);
        await connection.query(rollbackSql);
        const restored = await readIndexSignatures(connection, schema);
        const createAfterFirst = await showCreateTable(connection, COREMEASUREMENTS_TABLE);
        await connection.query(rollbackSql);
        const createAfterSecond = await showCreateTable(connection, COREMEASUREMENTS_TABLE);
        console.log(`[I6a] trimmed=${JSON.stringify(trimmed)}\n[I6a] restored (${restored.length})=${JSON.stringify(restored)}`);

        expect(trimmed).toEqual(trimmedSignatures);
        expect(restored).toHaveLength(PRE_CHANGE_INDEX_COUNT);
        expect(restored).toEqual(preChangeSignatures);
        expect(createAfterSecond, 'the second rollback run must change nothing').toBe(createAfterFirst);
      } finally {
        await dropThrowawaySchema(connection, schema);
      }
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(I6b) under a held metadata lock it fails with 1205 within the tighter bound and changes nothing; the retry applies and caps the session at 60 s',
    async () => {
      const { schema, connection } = await provisionTrimmedSchema(SUFFIX.HELD_LOCK);
      let holder: Connection | null = null;
      let retrySession: Connection | null = null;
      try {
        holder = await openSessionOn(schema);
        await holder.query('START TRANSACTION');
        await holder.query(`SELECT COUNT(*) FROM \`${COREMEASUREMENTS_TABLE}\``);

        await connection.query(`SET SESSION lock_wait_timeout = ${SHORT_LOCK_WAIT_SECONDS}`);
        const startedAt = Date.now();
        let rollbackError: unknown = null;
        try {
          await connection.query(rollbackSql);
        } catch (error) {
          rollbackError = error;
        }
        const elapsedMs = Date.now() - startedAt;
        const signaturesAfterTimeout = await readIndexSignatures(connection, schema);
        const waitsAfterTimeout = await readSessionLockWaits(connection);

        await holder.query('ROLLBACK');
        await holder.end();
        holder = null;

        retrySession = await openSessionOn(schema);
        const serverDefaults = await readSessionLockWaits(retrySession);
        await retrySession.query(rollbackSql);
        const signaturesAfterRetry = await readIndexSignatures(retrySession, schema);
        const waitsAfterRetry = await readSessionLockWaits(retrySession);
        console.log(
          `[I6b] errno=${mysqlErrno(rollbackError)} elapsedMs=${elapsedMs} waitsAfterTimeout=${JSON.stringify(waitsAfterTimeout)}\n` +
            `[I6b] signaturesAfterTimeout=${JSON.stringify(signaturesAfterTimeout)}\n` +
            `[I6b] serverDefaults=${JSON.stringify(serverDefaults)} waitsAfterRetry=${JSON.stringify(waitsAfterRetry)}\n` +
            `[I6b] signaturesAfterRetry=${JSON.stringify(signaturesAfterRetry)}`
        );

        expect(mysqlErrno(rollbackError), 'the rollback must give up on the metadata lock, not hang').toBe(MYSQL_ERRNO_LOCK_WAIT_TIMEOUT);
        expect(elapsedMs).toBeGreaterThanOrEqual(SHORT_LOCK_WAIT_SECONDS * MS_PER_SECOND - LOCK_WAIT_EARLY_TOLERANCE_MS);
        expect(elapsedMs, 'the file loosened a tighter session bound').toBeLessThan(SHORT_LOCK_WAIT_SECONDS * MS_PER_SECOND + LOCK_WAIT_LATE_SLACK_MS);
        expect(signaturesAfterTimeout, 'a timed-out ALTER must change nothing').toEqual(trimmedSignatures);
        expect(waitsAfterTimeout.lockWait, 'LEAST must never raise a tighter value').toBe(SHORT_LOCK_WAIT_SECONDS);
        expect(serverDefaults.lockWait, 'fixture: the server default must exceed the bound for the cap to be observable').toBeGreaterThan(
          ROLLBACK_LOCK_WAIT_BOUND_SECONDS
        );
        expect(signaturesAfterRetry).toEqual(preChangeSignatures);
        expect(waitsAfterRetry.lockWait).toBe(ROLLBACK_LOCK_WAIT_BOUND_SECONDS);
        expect(waitsAfterRetry.innodbLockWait).toBe(Math.min(serverDefaults.innodbLockWait, ROLLBACK_LOCK_WAIT_BOUND_SECONDS));
      } finally {
        // Each resource is released in its own try/finally (plan review E1): a failed ROLLBACK on the holder
        // must not leave the retry session or the throwaway schema behind. destroy() frees the holder's
        // metadata lock even when the connection is unusable.
        try {
          if (holder) await holder.query('ROLLBACK');
        } finally {
          try {
            holder?.destroy();
          } finally {
            try {
              if (retrySession) await retrySession.end();
            } finally {
              await dropThrowawaySchema(connection, schema);
            }
          }
        }
      }
    },
    CASE_TIMEOUT_MS
  );
});
