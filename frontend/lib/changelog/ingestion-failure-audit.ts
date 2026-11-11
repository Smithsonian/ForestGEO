/**
 * Bounded, audited persistence for ingestion failure rows (dropped/duplicate
 * measurement rows parked in coremeasurements with StemGUID=NULL). Wraps
 * insertIngestionFailureRows (config/measurementerrors.ts), which owns the
 * domain upsert SQL, with a before/after audit bounded to the REAL unique key
 * the write can collide on — (UploadBatchID, SourceRowIndex), per
 * `ux_cm_uploadbatch_rowindex` (db/sql/tablestructures.sql) — never the whole
 * (fileID, batchID) scope. Callers: stage-measurements.ts, arcgis-commit.ts,
 * record-invalid-rows.ts. The exported signature and result shape are a
 * public contract shared by all three; do not change them without updating
 * every caller.
 *
 * CALLER CONTRACT for a best-effort DATA-persistence retry (e.g.
 * stage-measurements.ts's retry-once-then-uploadintegrityalerts fallback):
 * catch this call's rejection, and if it is `instanceof ChangelogWriteError`,
 * rethrow immediately — it is an audit/precondition failure, not a retryable
 * data error, and retrying would re-run the whole sequence as if the data
 * were at fault.
 */
import crypto from 'crypto';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { insertIngestionFailureRows, ingestionFailureRowKey, type IngestionFailureRowInput } from '@/config/measurementerrors';
import { transactionExecutorFor } from '@/lib/ingestion/bulk-ingestion-call';
import {
  auditCoreMeasurementsKeyedDiff,
  snapshotCoreMeasurementsByRowIndices,
  COREMEASUREMENTS_TABLE_NAME,
  type CoreMeasurementsKeyedSnapshot
} from '@/lib/changelog/ingestion-audit';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';

export interface RecordAuditedIngestionFailureRowsParams {
  connectionManager: ConnectionManager;
  schema: string;
  rows: IngestionFailureRowInput[];
  /** The caller's own transaction — data and audit commit or roll back together. */
  transactionID: string;
  /** `unifiedchangelog.ChangedBy`. `null` records an unattributed write rather than throwing. */
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

export interface RecordAuditedIngestionFailureRowsResult {
  /** insertIngestionFailureRows' own result — one CoreMeasurementID per persisted input row. */
  measurementIDs: number[];
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
}

interface BatchGroup {
  batchID: string | null;
  sourceRowIndices: number[];
}

/** Groups input rows by the REAL collision boundary — UploadBatchID alone, not (fileID, batchID). */
function groupByBatch(rows: IngestionFailureRowInput[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  rows.forEach((row, index) => {
    const key = ingestionFailureRowKey(row, index);
    const groupKey = `${key.batchID ?? '<NULL>'}`;
    const group = groups.get(groupKey) ?? { batchID: key.batchID, sourceRowIndices: [] };
    group.sourceRowIndices.push(key.sourceRowIndex);
    groups.set(groupKey, group);
  });
  // Deterministic acquisition order: a call spanning several batchIDs must
  // always lock them in the same order, or two such calls racing over the
  // same batchID pair in opposite orders could deadlock on GET_LOCK.
  return Array.from(groups.values()).sort((a, b) => String(a.batchID).localeCompare(String(b.batchID)));
}

const BATCH_LOCK_TIMEOUT_MS = 30_000;

/** Exported for direct testing of the lock's actual cross-connection semantics. */
export function buildIngestionFailureBatchLockName(schema: string, batchID: string | null): string {
  // Hashed for the same reason lib/uploads/ingest-batch.ts's buildIngestionLockName
  // hashes its scope: GET_LOCK names have a bounded length budget.
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([schema, batchID]))
    .digest('hex')
    .slice(0, 40);
  return `ingestion-failure:${digest}`;
}

/**
 * Serializes per (schema, batchID) via MySQL GET_LOCK, held until the
 * caller's transaction commits or rolls back (ConnectionManager's
 * cleanupApplicationLocks releases it then — never released here). This is
 * the actual fix for a race `SELECT ... FOR UPDATE` cannot close: under READ
 * COMMITTED, InnoDB takes no gap lock on a row that does not exist yet, so
 * two concurrent transactions could otherwise both read "no prior row" for
 * the same (batchID, SourceRowIndex) and both classify their own write as an
 * INSERT.
 */
async function acquireBatchSerializationLocks(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID: string,
  groups: BatchGroup[]
): Promise<void> {
  for (const group of groups) {
    const lockName = buildIngestionFailureBatchLockName(schema, group.batchID);
    const acquired = await connectionManager.acquireApplicationLock(lockName, transactionID, BATCH_LOCK_TIMEOUT_MS);
    if (!acquired) {
      throw new ChangelogWriteError(
        ChangelogOperation.INSERT,
        COREMEASUREMENTS_TABLE_NAME,
        `${group.batchID}`,
        new Error(`Failed to acquire the ingestion-failure serialization lock for batch ${JSON.stringify(group.batchID)} within ${BATCH_LOCK_TIMEOUT_MS}ms`)
      );
    }
  }
}

/**
 * Rejects any input row whose own scope is unsafe to persist under, BEFORE
 * any lock/snapshot/write: a non-finite or non-integer SourceRowIndex (a
 * legitimate NEGATIVE index is fine — see record-invalid-rows.ts), a missing
 * fileID/batchID (both are required identity components for this wrapper's
 * actual callers), or a plotID/censusID that disagrees with the call's own
 * supplied scope.
 */
/** A positive safe integer, exactly — not merely a value that loosely `==`s one. */
function asPositiveSafeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertValidRowScope(rows: IngestionFailureRowInput[], plotID: number, censusID: number): void {
  const scopePlotID = asPositiveSafeInteger(plotID);
  const scopeCensusID = asPositiveSafeInteger(censusID);

  rows.forEach((row, index) => {
    const key = ingestionFailureRowKey(row, index);
    const problems: string[] = [];
    if (!key.fileID) problems.push('missing fileID');
    if (!key.batchID) problems.push('missing batchID');
    if (!Number.isSafeInteger(key.sourceRowIndex)) problems.push(`unsafe sourceRowIndex ${JSON.stringify(key.sourceRowIndex)}`);

    const rowPlotID = asPositiveSafeInteger(row.plotID);
    if (rowPlotID === null || scopePlotID === null || rowPlotID !== scopePlotID) {
      problems.push(`plotID ${JSON.stringify(row.plotID)} does not match supplied scope ${JSON.stringify(plotID)}`);
    }
    const rowCensusID = asPositiveSafeInteger(row.censusID);
    if (rowCensusID === null || scopeCensusID === null || rowCensusID !== scopeCensusID) {
      problems.push(`censusID ${JSON.stringify(row.censusID)} does not match supplied scope ${JSON.stringify(censusID)}`);
    }

    if (problems.length === 0) return;
    throw new ChangelogWriteError(
      ChangelogOperation.INSERT,
      COREMEASUREMENTS_TABLE_NAME,
      `${key.batchID}:${key.sourceRowIndex}`,
      new Error(`Refusing to persist an ingestion failure row at index ${index}: ${problems.join('; ')}`)
    );
  });
}

/**
 * Rejects an input row whose (UploadBatchID, SourceRowIndex) key already
 * belongs to a different file, a different census, or a row that is no
 * longer an unresolved failure placeholder (StemGUID is not NULL) —
 * insertIngestionFailureRows' ON DUPLICATE KEY UPDATE would otherwise
 * silently rewrite a measurement this call has no business touching. A
 * same-file, same-census, still-unresolved prior row is a legitimate retry,
 * left for the diff to classify as INSERT/UPDATE/no-op.
 */
function assertNoIdentityConflicts(rows: IngestionFailureRowInput[], before: CoreMeasurementsKeyedSnapshot, censusID: number): void {
  rows.forEach((row, index) => {
    const key = ingestionFailureRowKey(row, index);
    const priorRow = before.get(`${key.batchID ?? '<NULL>'}\u0000${key.sourceRowIndex}`);
    if (priorRow === undefined) return;

    const priorFileID = priorRow.UploadFileID ?? null;
    const priorCensusID = Number(priorRow.CensusID);
    const priorIsUnresolved = priorRow.StemGUID === null || priorRow.StemGUID === undefined;
    if (priorFileID === key.fileID && priorCensusID === censusID && priorIsUnresolved) return;

    throw new ChangelogWriteError(
      ChangelogOperation.UPDATE,
      COREMEASUREMENTS_TABLE_NAME,
      `${key.batchID}:${key.sourceRowIndex}`,
      new Error(
        `Refusing to persist an ingestion failure row at (UploadBatchID=${JSON.stringify(key.batchID)}, SourceRowIndex=${key.sourceRowIndex}): ` +
          `that key already belongs to a different identity (UploadFileID ${JSON.stringify(priorFileID)} vs ${JSON.stringify(key.fileID)}, ` +
          `CensusID ${priorCensusID} vs ${censusID}, unresolved=${priorIsUnresolved}).`
      )
    );
  });
}

export async function recordAuditedIngestionFailureRows(params: RecordAuditedIngestionFailureRowsParams): Promise<RecordAuditedIngestionFailureRowsResult> {
  const { connectionManager, schema, rows, transactionID, changedBy, plotID, censusID } = params;
  if (rows.length === 0) {
    return { measurementIDs: [], insertedCount: 0, updatedCount: 0, unchangedCount: 0 };
  }

  assertValidRowScope(rows, plotID, censusID);

  const tx = transactionExecutorFor(connectionManager, transactionID);
  const groups = groupByBatch(rows);

  await acquireBatchSerializationLocks(connectionManager, schema, transactionID, groups);

  // Snapshot every group's bounded keys BEFORE the write. Merged into one
  // map: CoreMeasurementsKeyedSnapshot's keys already encode (UploadBatchID,
  // SourceRowIndex), so entries from different groups never collide.
  const before: CoreMeasurementsKeyedSnapshot = new Map();
  for (const group of groups) {
    const groupSnapshot = await snapshotCoreMeasurementsByRowIndices(tx, schema, group.batchID, group.sourceRowIndices);
    for (const [key, row] of groupSnapshot) before.set(key, row);
  }

  assertNoIdentityConflicts(rows, before, censusID);

  // A retry must see the original rows even if a later chunk or error-link
  // insert fails after earlier writes have succeeded in this transaction.
  const savepoint = `failure_audit_${crypto.randomBytes(12).toString('hex')}`;
  try {
    await connectionManager.executeQuery(`SAVEPOINT ${savepoint}`, undefined, transactionID);
  } catch (error) {
    throw new ChangelogWriteError(ChangelogOperation.INSERT, COREMEASUREMENTS_TABLE_NAME, savepoint, error);
  }
  try {
    const measurementIDs = await insertIngestionFailureRows(connectionManager, schema, rows, transactionID);

    // Re-read the same bounded keys and audit the diff, per group.
    let insertedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const coveredMeasurementIDs = new Set<number>();
    for (const group of groups) {
      const diff = await auditCoreMeasurementsKeyedDiff({
        tx,
        schema,
        batchID: group.batchID,
        sourceRowIndices: group.sourceRowIndices,
        before,
        changedBy,
        plotID,
        censusID
      });
      insertedCount += diff.insertedCount;
      updatedCount += diff.updatedCount;
      unchangedCount += diff.unchangedCount;
      for (const row of diff.after.values()) coveredMeasurementIDs.add(Number(row.CoreMeasurementID));
    }

    const uncoveredMeasurementID = measurementIDs.find(id => !coveredMeasurementIDs.has(id));
    if (uncoveredMeasurementID !== undefined) {
      throw new ChangelogWriteError(
        ChangelogOperation.INSERT,
        COREMEASUREMENTS_TABLE_NAME,
        String(uncoveredMeasurementID),
        new Error(`insertIngestionFailureRows persisted CoreMeasurementID ${uncoveredMeasurementID} but the bounded audit snapshot never covered it.`)
      );
    }

    await connectionManager.executeQuery(`RELEASE SAVEPOINT ${savepoint}`, undefined, transactionID);
    return { measurementIDs, insertedCount, updatedCount, unchangedCount };
  } catch (error) {
    try {
      await connectionManager.executeQuery(`ROLLBACK TO SAVEPOINT ${savepoint}`, undefined, transactionID);
      await connectionManager.executeQuery(`RELEASE SAVEPOINT ${savepoint}`, undefined, transactionID);
    } catch (restorationError) {
      throw new ChangelogWriteError(
        ChangelogOperation.INSERT,
        COREMEASUREMENTS_TABLE_NAME,
        savepoint,
        new AggregateError([error, restorationError], 'Failed to restore the ingestion failure attempt')
      );
    }
    throw error;
  }
}
