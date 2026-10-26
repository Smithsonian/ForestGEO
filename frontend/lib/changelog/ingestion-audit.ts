/**
 * Audit writers for coremeasurements rows touched by ingestion (issue #507).
 *
 * Three call shapes, all sharing COREMEASUREMENTS_SNAPSHOT_JSON /
 * COREMEASUREMENTS_SNAPSHOT_COLUMNS so the audited row shape cannot drift
 * between them:
 *
 *   - recordCommittedCoreMeasurementsAudit: one `INSERT ... SELECT` over
 *     every row in (UploadFileID, UploadBatchID) lacking a prior audit entry
 *     — the bulkingestionprocess CALL's own result set. Appropriate here
 *     because the CALL itself is the unit of work being audited.
 *   - auditCoreMeasurementsScopeDiff / snapshotCoreMeasurementsScope: a
 *     before/after diff over the WHOLE (UploadFileID, UploadBatchID) scope.
 *     Still correct for processSubBatch's own CALL diff, where "the batch"
 *     genuinely is the unit the caller just mutated.
 *   - auditCoreMeasurementsKeyedDiff / snapshotCoreMeasurementsByRowIndices:
 *     a before/after diff bounded to an explicit set of SourceRowIndex values
 *     under one UploadBatchID — the REAL unique key (ux_cm_uploadbatch_rowindex),
 *     not (fileID, batchID, SourceRowIndex). Use this — not the whole-scope
 *     diff above — for an incremental write that only touches specific rows
 *     within a shared batchID (e.g. one chunk's dropped-row failures): the
 *     whole-scope diff would re-read and risk re-auditing every OTHER
 *     chunk's rows sharing that batchID too. Callers MUST serialize access
 *     per (schema, batchID) themselves (see
 *     lib/changelog/ingestion-failure-audit.ts) — FOR UPDATE alone does not
 *     stop two transactions from both observing "no prior row" for the same
 *     absent key under READ COMMITTED.
 *
 * Callers run every write in the SAME transaction as the mutation it
 * audits, immediately before committing, so data and audit roll back or
 * commit together.
 */
import type { BulkIngestionExecutor } from '@/lib/ingestion/bulk-ingestion-call';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';

export const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';

/**
 * Row-state snapshot shared by the INSERT and DELETE audit statements below —
 * one definition so a column added to the audit trail cannot be added to only
 * one of the two. Deliberately NOT a `SELECT *`: that would silently start
 * leaking any future column addition into the audit trail without a
 * reviewed decision to do so. IsValidated is a BIT column (CAST to a plain
 * number); IsActive is already a tinyint(1), so no cast is needed.
 */
const COREMEASUREMENTS_SNAPSHOT_JSON = `JSON_OBJECT(
     'CoreMeasurementID', cm.CoreMeasurementID,
     'StemGUID', cm.StemGUID,
     'CensusID', cm.CensusID,
     'IsValidated', CAST(cm.IsValidated AS UNSIGNED),
     'IsActive', cm.IsActive,
     'MeasurementDate', cm.MeasurementDate,
     'MeasuredDBH', cm.MeasuredDBH,
     'MeasuredHOM', cm.MeasuredHOM,
     'Description', cm.Description,
     'UploadFileID', cm.UploadFileID,
     'UploadBatchID', cm.UploadBatchID,
     'RawTreeTag', cm.RawTreeTag,
     'RawStemTag', cm.RawStemTag,
     'RawSpCode', cm.RawSpCode,
     'RawQuadrat', cm.RawQuadrat,
     'RawX', cm.RawX,
     'RawY', cm.RawY,
     'RawPlotX', cm.RawPlotX,
     'RawPlotY', cm.RawPlotY,
     'RawCodes', cm.RawCodes,
     'RawComments', cm.RawComments,
     'SourceRowIndex', cm.SourceRowIndex
   )`;

const INSERT_COREMEASUREMENTS_AUDIT_ROWS = `INSERT INTO ??.unifiedchangelog
   (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
 SELECT
   '${COREMEASUREMENTS_TABLE_NAME}',
   cm.CoreMeasurementID,
   '${ChangelogOperation.INSERT}',
   ${COREMEASUREMENTS_SNAPSHOT_JSON},
   NOW(),
   ?,
   ?,
   ?
 FROM ??.coremeasurements cm
 WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ?
   AND NOT EXISTS (
     SELECT 1 FROM ??.unifiedchangelog existing_audit
     WHERE existing_audit.TableName = '${COREMEASUREMENTS_TABLE_NAME}'
       AND existing_audit.RecordID = cm.CoreMeasurementID
   )`;

export interface RecordCommittedCoreMeasurementsAuditParams {
  /** The CALL's own transaction executor — see the module doc above. */
  tx: Pick<BulkIngestionExecutor, 'query'>;
  schema: string;
  fileID: string;
  batchID: string;
  /** `unifiedchangelog.ChangedBy`. `null` records an unattributed write rather than throwing. */
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

/**
 * Inserts one INSERT-operation `unifiedchangelog` row per coremeasurements
 * row currently attached to (fileID, batchID) that does NOT already have an
 * audit entry — set-based, not a per-row loop (see the module doc above for
 * why the already-audited rows are excluded). Returns the number of audit
 * rows actually written. On a fresh ingest this equals the batch's row
 * count, so a caller that already knows that count can still detect a
 * mismatch; on bulkingestionprocess's "already processed, skipped" noop
 * retry it is legitimately 0 — every row in scope was already audited by
 * the run that actually committed them, and that is success, not a
 * mismatch.
 */
export async function recordCommittedCoreMeasurementsAudit(params: RecordCommittedCoreMeasurementsAuditParams): Promise<number> {
  const { tx, schema, fileID, batchID, changedBy, plotID, censusID } = params;
  const sql = safeFormatQuery(schema, INSERT_COREMEASUREMENTS_AUDIT_ROWS);
  const recordIDForError = `${fileID}:${batchID}`;
  try {
    const result = await tx.query(sql, [changedBy, plotID, censusID, fileID, batchID]);
    return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  } catch (error: unknown) {
    throw new ChangelogWriteError(ChangelogOperation.INSERT, COREMEASUREMENTS_TABLE_NAME, recordIDForError, error);
  }
}

/**
 * OldRowState mirrors the INSERT audit's NewRowState — same
 * COREMEASUREMENTS_SNAPSHOT_JSON fragment, read BEFORE the caller deletes
 * the row (see recordDeletedCoreMeasurementsAudit's doc comment), so this is
 * still the live row, not a reconstruction.
 */
function buildDeleteAuditRowsSQL(idCount: number): string {
  return `INSERT INTO ??.unifiedchangelog
   (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
 SELECT
   '${COREMEASUREMENTS_TABLE_NAME}',
   cm.CoreMeasurementID,
   '${ChangelogOperation.DELETE}',
   ${COREMEASUREMENTS_SNAPSHOT_JSON},
   NOW(),
   ?,
   ?,
   ?
 FROM ??.coremeasurements cm
 WHERE cm.CoreMeasurementID IN (${buildInPlaceholders(idCount)})`;
}

export interface RecordDeletedCoreMeasurementsAuditParams {
  /** The caller's own transaction executor — see the module doc above. */
  tx: Pick<BulkIngestionExecutor, 'query'>;
  schema: string;
  /** The exact rows about to be deleted. Must be read (and fixed) BEFORE the DELETE runs. */
  coreMeasurementIDs: number[];
  /** `unifiedchangelog.ChangedBy`. `null` records an unattributed write rather than throwing. */
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

/**
 * Inserts one DELETE-operation `unifiedchangelog` row per coremeasurements
 * row about to be removed by Clean Re-Upload's census-replacement cleanup
 * (lib/ingestion/temporary-measurements.ts cleanupPreviousFileUploads,
 * issue #507) — set-based over an explicit ID list, not a per-row loop.
 *
 * Callers MUST run this in the SAME transaction as, and BEFORE, the DELETE
 * that removes `coreMeasurementIDs`: the SELECT that produced the ID list and
 * this audit both read the row while it still exists, so the audited
 * OldRowState is the row's actual last state, not a value reconstructed after
 * the fact. A rollback of that transaction discards the pending DELETE and
 * these audit rows together.
 *
 * Returns the number of audit rows written so a caller can assert it matches
 * `coreMeasurementIDs.length` (and therefore the DELETE's own affected-row
 * count) before trusting either.
 */
export async function recordDeletedCoreMeasurementsAudit(params: RecordDeletedCoreMeasurementsAuditParams): Promise<number> {
  const { tx, schema, coreMeasurementIDs, changedBy, plotID, censusID } = params;
  if (coreMeasurementIDs.length === 0) return 0;

  const sql = safeFormatQuery(schema, buildDeleteAuditRowsSQL(coreMeasurementIDs.length));
  const recordIDForError = coreMeasurementIDs.join(',');
  try {
    const result = await tx.query(sql, [changedBy, plotID, censusID, ...coreMeasurementIDs]);
    return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  } catch (error: unknown) {
    throw new ChangelogWriteError(ChangelogOperation.DELETE, COREMEASUREMENTS_TABLE_NAME, recordIDForError, error);
  }
}

/**
 * Plain-column mirror of COREMEASUREMENTS_SNAPSHOT_JSON (same columns, no
 * JSON_OBJECT) — the unit a before/after diff is built from. A diff needs
 * the "before" side to survive past the moment its row changes or
 * disappears, which a SQL-side read taken AFTER the fact cannot do.
 */
export const COREMEASUREMENTS_SNAPSHOT_COLUMNS = [
  'CoreMeasurementID',
  'StemGUID',
  'CensusID',
  'MeasurementDate',
  'MeasuredDBH',
  'MeasuredHOM',
  'Description',
  'UploadFileID',
  'UploadBatchID',
  'RawTreeTag',
  'RawStemTag',
  'RawSpCode',
  'RawQuadrat',
  'RawX',
  'RawY',
  'RawPlotX',
  'RawPlotY',
  'RawCodes',
  'RawComments',
  'SourceRowIndex',
  'IsActive'
] as const;

export type CoreMeasurementsScopeSnapshot = Map<number, Record<string, unknown>>;

/**
 * Reads every coremeasurements row currently in (fileID, batchID) scope, keyed
 * by CoreMeasurementID. A failure here is an audit-infrastructure failure
 * like any other write in this module (#507): used before/after a CALL, an
 * unclassified error would re-enter the caller's generic retry/fallback and
 * could park genuinely good rows as a data rejection.
 */
export async function snapshotCoreMeasurementsScope(
  tx: Pick<BulkIngestionExecutor, 'query'>,
  schema: string,
  fileID: string,
  batchID: string
): Promise<CoreMeasurementsScopeSnapshot> {
  const sql = safeFormatQuery(
    schema,
    `SELECT ${COREMEASUREMENTS_SNAPSHOT_COLUMNS.join(', ')}, CAST(IsValidated AS UNSIGNED) AS IsValidated
     FROM ??.coremeasurements
     WHERE UploadFileID = ? AND UploadBatchID = ?`
  );
  try {
    const rows = await tx.query<Record<string, unknown>[]>(sql, [fileID, batchID]);
    const snapshot: CoreMeasurementsScopeSnapshot = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      snapshot.set(Number(row.CoreMeasurementID), row);
    }
    return snapshot;
  } catch (error: unknown) {
    throw new ChangelogWriteError(ChangelogOperation.INSERT, COREMEASUREMENTS_TABLE_NAME, `${fileID}:${batchID}`, error);
  }
}

function snapshotValuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function snapshotRowsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return [...COREMEASUREMENTS_SNAPSHOT_COLUMNS, 'IsValidated'].every(column => snapshotValuesEqual(a[column], b[column]));
}

const SNAPSHOT_AUDIT_INSERT_CHUNK_SIZE = 500;

export interface SnapshotAuditRowInput {
  id: number;
  oldRow: Record<string, unknown> | null;
  newRow: Record<string, unknown> | null;
}

/**
 * Bulk-writes one unifiedchangelog row per entry in `rows`, serializing the
 * CALLER-SUPPLIED snapshots as the row state rather than re-reading the table
 * (a DELETE's OldRowState describes a row that is already gone by the time
 * this runs, and an UPDATE's OldRowState describes a value the row no longer
 * holds). Chunked, not one unbounded multi-row INSERT — same per-statement
 * bound as the census-replacement deletes.
 */
export async function recordSnapshotRowsAudit(params: {
  tx: Pick<BulkIngestionExecutor, 'query'>;
  schema: string;
  operation: ChangelogOperation;
  rows: SnapshotAuditRowInput[];
  changedBy: string | null;
  plotID: number;
  censusID: number;
}): Promise<number> {
  const { tx, schema, operation, rows, changedBy, plotID, censusID } = params;
  if (rows.length === 0) return 0;

  let totalWritten = 0;
  for (let start = 0; start < rows.length; start += SNAPSHOT_AUDIT_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + SNAPSHOT_AUDIT_INSERT_CHUNK_SIZE);
    const valueTuples = chunk.map(() => '(?, ?, ?, CONVERT(? USING utf8mb4), CONVERT(? USING utf8mb4), NOW(), ?, ?, ?)').join(', ');
    const sql = safeFormatQuery(
      schema,
      `INSERT INTO ??.unifiedchangelog
        (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
       VALUES ${valueTuples}`
    );
    const bindings = chunk.flatMap(row => [
      COREMEASUREMENTS_TABLE_NAME,
      row.id,
      operation,
      row.oldRow ? JSON.stringify(row.oldRow) : null,
      row.newRow ? JSON.stringify(row.newRow) : null,
      changedBy,
      plotID,
      censusID
    ]);
    const recordIDForError = chunk.map(row => row.id).join(',');
    try {
      const result = await tx.query(sql, bindings);
      totalWritten += Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
    } catch (error: unknown) {
      throw new ChangelogWriteError(operation, COREMEASUREMENTS_TABLE_NAME, recordIDForError, error);
    }
  }
  return totalWritten;
}

export interface AuditCoreMeasurementsScopeDiffParams {
  tx: Pick<BulkIngestionExecutor, 'query'>;
  schema: string;
  fileID: string;
  batchID: string;
  /** The scope's snapshot taken BEFORE the mutation this call is auditing (snapshotCoreMeasurementsScope). */
  before: CoreMeasurementsScopeSnapshot;
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

export interface CoreMeasurementsScopeDiffResult {
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  after: CoreMeasurementsScopeSnapshot;
}

/**
 * Classifies every id in (fileID, batchID) scope by comparing `before` to a
 * fresh read: new in `after` → INSERT; gone from `after` → DELETE; present
 * in both but changed → UPDATE; present in both unchanged → no audit row.
 * All three write from the JS-side snapshots, bounded to the EXACT ids in
 * each category — never "every row lacking audit history", which would
 * fabricate an INSERT for an older row this diff never actually touched.
 *
 * Deliberately NOT a row-count comparison: an operation that both removes
 * and adds rows in the same scope (e.g. a stale-batch self-heal) can net to
 * zero while every new row still needs its own INSERT and every removed row
 * its own DELETE.
 */
export async function auditCoreMeasurementsScopeDiff(params: AuditCoreMeasurementsScopeDiffParams): Promise<CoreMeasurementsScopeDiffResult> {
  const { tx, schema, fileID, batchID, before, changedBy, plotID, censusID } = params;
  const after = await snapshotCoreMeasurementsScope(tx, schema, fileID, batchID);
  const recordIDForError = `${fileID}:${batchID}`;

  const newRows: SnapshotAuditRowInput[] = [];
  const changedRows: SnapshotAuditRowInput[] = [];
  for (const [id, row] of after) {
    const priorRow = before.get(id);
    if (priorRow === undefined) {
      // Bounded to THIS id, not "every row in scope lacking any audit
      // history" (#507): a pre-existing row this diff already had in
      // `before` but that happens to carry no prior audit entry (e.g. an
      // older write made before this mechanism existed) must stay untouched
      // here — it is not in `after`-minus-`before`, so it never reaches this
      // branch.
      newRows.push({ id, oldRow: null, newRow: row });
    } else if (!snapshotRowsEqual(priorRow, row)) {
      changedRows.push({ id, oldRow: priorRow, newRow: row });
    }
  }
  const removedRows: SnapshotAuditRowInput[] = [];
  for (const [id, row] of before) {
    if (!after.has(id)) removedRows.push({ id, oldRow: row, newRow: null });
  }

  const insertedCount = await recordSnapshotRowsAudit({ tx, schema, operation: ChangelogOperation.INSERT, rows: newRows, changedBy, plotID, censusID });
  if (insertedCount !== newRows.length) {
    throw new ChangelogWriteError(
      ChangelogOperation.INSERT,
      COREMEASUREMENTS_TABLE_NAME,
      recordIDForError,
      new Error(`Expected to audit ${newRows.length} newly committed row(s) but audited ${insertedCount} — the audit trail and the data would disagree.`)
    );
  }

  const deletedCount = await recordSnapshotRowsAudit({ tx, schema, operation: ChangelogOperation.DELETE, rows: removedRows, changedBy, plotID, censusID });
  if (deletedCount !== removedRows.length) {
    throw new ChangelogWriteError(
      ChangelogOperation.DELETE,
      COREMEASUREMENTS_TABLE_NAME,
      recordIDForError,
      new Error(`Expected to audit ${removedRows.length} removed row(s) but audited ${deletedCount} — the audit trail and the data would disagree.`)
    );
  }

  const updatedCount = await recordSnapshotRowsAudit({ tx, schema, operation: ChangelogOperation.UPDATE, rows: changedRows, changedBy, plotID, censusID });
  if (updatedCount !== changedRows.length) {
    throw new ChangelogWriteError(
      ChangelogOperation.UPDATE,
      COREMEASUREMENTS_TABLE_NAME,
      recordIDForError,
      new Error(`Expected to audit ${changedRows.length} changed row(s) but audited ${updatedCount} — the audit trail and the data would disagree.`)
    );
  }

  return { insertedCount, updatedCount, deletedCount, after };
}

export type CoreMeasurementsKeyedSnapshot = Map<string, Record<string, unknown>>;

/**
 * The REAL uniqueness boundary InnoDB enforces — `ux_cm_uploadbatch_rowindex`
 * (db/sql/tablestructures.sql) — is (UploadBatchID, SourceRowIndex) ONLY.
 * UploadFileID is NOT part of it. insertIngestionFailureRows' own
 * `ON DUPLICATE KEY UPDATE` therefore matches, and can silently overwrite, a
 * row under a DIFFERENT UploadFileID whenever the two share a (batchID,
 * sourceRowIndex) pair. Keying this snapshot by that real pair — not by
 * (fileID, batchID, sourceRowIndex), which the index does not see — is what
 * lets a caller actually detect a cross-file collision instead of filtering
 * the colliding row out of its own "before" picture first.
 */
function coreMeasurementsRowKey(batchID: unknown, sourceRowIndex: unknown): string {
  return `${batchID ?? '<NULL>'}\u0000${sourceRowIndex}`;
}

// Matches config/measurementerrors.ts's INGESTION_FAILURE_BULK_INSERT_SIZE —
// bounds the IN (...) list the same way the domain writer bounds its own bulk
// INSERT, so a caller persisting a whole rejected file cannot build one
// unbounded IN clause here.
const SNAPSHOT_BY_KEY_CHUNK_SIZE = 250;

/**
 * Reads coremeasurements rows for an EXPLICIT set of SourceRowIndex values
 * under ONE UploadBatchID, under FOR UPDATE — bounded to those keys only,
 * never the whole (fileID, batchID) scope (contrast snapshotCoreMeasurementsScope
 * above, whose WHERE clause has no SourceRowIndex filter at all). Deduplicates
 * `sourceRowIndices` first: a caller whose input repeats the same index must
 * still read (and later audit) that physical row exactly once. Chunked at
 * SNAPSHOT_BY_KEY_CHUNK_SIZE, not one unbounded IN (...) list.
 *
 * FOR UPDATE alone does not serialize two concurrent callers both missing the
 * SAME key (InnoDB takes no gap lock on an absent row under READ COMMITTED) —
 * see recordAuditedIngestionFailureRows' GET_LOCK serialization, which this
 * function relies on its caller to have already acquired.
 */
export async function snapshotCoreMeasurementsByRowIndices(
  tx: Pick<BulkIngestionExecutor, 'query'>,
  schema: string,
  batchID: string | null,
  sourceRowIndices: number[]
): Promise<CoreMeasurementsKeyedSnapshot> {
  const snapshot: CoreMeasurementsKeyedSnapshot = new Map();
  const uniqueIndices = Array.from(new Set(sourceRowIndices));
  if (uniqueIndices.length === 0) return snapshot;

  for (let start = 0; start < uniqueIndices.length; start += SNAPSHOT_BY_KEY_CHUNK_SIZE) {
    const chunk = uniqueIndices.slice(start, start + SNAPSHOT_BY_KEY_CHUNK_SIZE);
    const sql = safeFormatQuery(
      schema,
      `SELECT ${COREMEASUREMENTS_SNAPSHOT_COLUMNS.join(', ')}, CAST(IsValidated AS UNSIGNED) AS IsValidated
       FROM ??.coremeasurements
       WHERE UploadBatchID <=> ? AND SourceRowIndex IN (${buildInPlaceholders(chunk.length)})
       FOR UPDATE`
    );
    const recordIDForError = `${batchID}:${chunk.join(',')}`;
    try {
      const rows = await tx.query<Record<string, unknown>[]>(sql, [batchID, ...chunk]);
      for (const row of Array.isArray(rows) ? rows : []) {
        snapshot.set(coreMeasurementsRowKey(row.UploadBatchID, row.SourceRowIndex), row);
      }
    } catch (error: unknown) {
      throw new ChangelogWriteError(ChangelogOperation.INSERT, COREMEASUREMENTS_TABLE_NAME, recordIDForError, error);
    }
  }
  return snapshot;
}

export interface AuditCoreMeasurementsKeyedDiffParams {
  tx: Pick<BulkIngestionExecutor, 'query'>;
  schema: string;
  batchID: string | null;
  /** The exact SourceRowIndex values this call persisted — the audit's bound. */
  sourceRowIndices: number[];
  /** Captured BEFORE the mutation, via snapshotCoreMeasurementsByRowIndices for the SAME batchID. */
  before: CoreMeasurementsKeyedSnapshot;
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

export interface CoreMeasurementsKeyedDiffResult {
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  /** The fresh keyed read this diff classified against — callers can verify full coverage against it. */
  after: CoreMeasurementsKeyedSnapshot;
}

/**
 * Bounded counterpart to auditCoreMeasurementsScopeDiff: classifies each
 * (deduplicated) key in `sourceRowIndices` by comparing `before` to a fresh
 * keyed read — new → INSERT, present in both but changed → UPDATE, present in
 * both and unchanged → no audit row at all. There is no DELETE branch: the
 * only writer that calls this (insertIngestionFailureRows' INSERT ... ON
 * DUPLICATE KEY UPDATE) can create or modify a row at a given key but never
 * remove one, so unlike the whole-scope diff a key cannot "disappear" between
 * before and after. A repeated index in `sourceRowIndices` is still classified
 * exactly once (one physical row ⇒ one history row), never once per repeat.
 */
export async function auditCoreMeasurementsKeyedDiff(params: AuditCoreMeasurementsKeyedDiffParams): Promise<CoreMeasurementsKeyedDiffResult> {
  const { tx, schema, batchID, sourceRowIndices, before, changedBy, plotID, censusID } = params;
  const uniqueIndices = Array.from(new Set(sourceRowIndices));
  const after = await snapshotCoreMeasurementsByRowIndices(tx, schema, batchID, uniqueIndices);
  const recordIDForError = `${batchID}:${uniqueIndices.join(',')}`;

  const newRows: SnapshotAuditRowInput[] = [];
  const changedRows: SnapshotAuditRowInput[] = [];
  let unchangedCount = 0;

  for (const sourceRowIndex of uniqueIndices) {
    const key = coreMeasurementsRowKey(batchID, sourceRowIndex);
    const row = after.get(key);
    if (!row) {
      // insertIngestionFailureRows did not land a row under this exact key
      // (its sequential fallback path can fail to resolve an id) — nothing
      // was persisted, so there is nothing to audit and nothing to miscount.
      continue;
    }
    const id = Number(row.CoreMeasurementID);
    const priorRow = before.get(key);
    if (priorRow === undefined) {
      newRows.push({ id, oldRow: null, newRow: row });
    } else if (!snapshotRowsEqual(priorRow, row)) {
      changedRows.push({ id, oldRow: priorRow, newRow: row });
    } else {
      unchangedCount += 1;
    }
  }

  const insertedCount = await recordSnapshotRowsAudit({ tx, schema, operation: ChangelogOperation.INSERT, rows: newRows, changedBy, plotID, censusID });
  if (insertedCount !== newRows.length) {
    throw new ChangelogWriteError(
      ChangelogOperation.INSERT,
      COREMEASUREMENTS_TABLE_NAME,
      recordIDForError,
      new Error(
        `Expected to audit ${newRows.length} newly persisted failure row(s) but audited ${insertedCount} — the audit trail and the data would disagree.`
      )
    );
  }

  const updatedCount = await recordSnapshotRowsAudit({ tx, schema, operation: ChangelogOperation.UPDATE, rows: changedRows, changedBy, plotID, censusID });
  if (updatedCount !== changedRows.length) {
    throw new ChangelogWriteError(
      ChangelogOperation.UPDATE,
      COREMEASUREMENTS_TABLE_NAME,
      recordIDForError,
      new Error(`Expected to audit ${changedRows.length} changed failure row(s) but audited ${updatedCount} — the audit trail and the data would disagree.`)
    );
  }

  return { insertedCount, updatedCount, unchangedCount, after };
}
