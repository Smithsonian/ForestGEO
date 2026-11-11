import type { EditOperationStateRow, EditOperationType } from '@/config/editoperationtypes';
import { ChangelogOperation, type ChangelogRowState } from '@/lib/changelog/record-mutation';

/** Projects edit-ledger snapshots into Recent Changes; summary rows carry a marker instead of a field diff. */
export const BULK_REVISION_SUMMARY_KIND = 'bulk-revision-apply';

/**
 * Mirrors `SPECIES_CORRECTION_METADATA_TABLE` in
 * `config/editplan/tree-species-correction-writer.ts`, duplicated (not
 * imported) because that module pulls in `ConnectionManager`/mysql2 and this
 * file ships to client bundles. It names undo bookkeeping, not a real table.
 */
const SPECIES_CORRECTION_METADATA_MARKER_TABLE = 'species_correction_metadata';

export interface ProjectedChangelogRow {
  tableName: string;
  recordID: string;
  operation: ChangelogOperation;
  oldRowState: ChangelogRowState | null;
  // null for DELETE: the row no longer exists, there is no "new" state to show.
  newRowState: ChangelogRowState | null;
}

/** The edit-operation suffix keeps separate edits distinct and lets the backfill skip dual-written events. */
function buildRecordID(primaryKeyValue: string | number, editOperationID: number): string {
  return `${primaryKeyValue}::edit-op-${editOperationID}`;
}

function stateRowKey(row: EditOperationStateRow): string {
  return `${row.table}::${String(row.primaryKeyValue)}`;
}

/** Sort keys after JSON serialization hooks so Date/Buffer snapshots compare like persisted JSON. */
function sortKeysForComparison(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return sortKeysForComparison((toJSON as () => unknown).call(value));
  }
  if (Array.isArray(value)) return value.map(sortKeysForComparison);
  const entries = Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, sortKeysForComparison(v)] as const);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

/** Key-order-insensitive equality for two row snapshots (see sortKeysForComparison). */
function rowStatesAreEqual(before: ChangelogRowState, after: ChangelogRowState): boolean {
  return JSON.stringify(sortKeysForComparison(before)) === JSON.stringify(sortKeysForComparison(after));
}

/** Bulk revisions carry summary counts, not per-record before/after snapshots. */
function projectBulkRevisionRow(editOperationID: number, beforeState: EditOperationStateRow[]): ProjectedChangelogRow[] {
  const summaryRow = beforeState[0];
  if (!summaryRow || summaryRow.row === null) {
    return [];
  }

  return [
    {
      tableName: summaryRow.table,
      recordID: buildRecordID(summaryRow.primaryKeyValue, editOperationID),
      operation: ChangelogOperation.UPDATE,
      oldRowState: null,
      newRowState: { ...summaryRow.row, summaryKind: BULK_REVISION_SUMMARY_KIND }
    }
  ];
}

/** Pair snapshots by table/key: after-only INSERT, before-only DELETE, changed pair UPDATE; skip no-ops and undo metadata. */
function projectPairedStateRows(editOperationID: number, beforeState: EditOperationStateRow[], afterState: EditOperationStateRow[]): ProjectedChangelogRow[] {
  const isRealDomainRow = (row: EditOperationStateRow) => row.table !== SPECIES_CORRECTION_METADATA_MARKER_TABLE;
  const realBeforeState = beforeState.filter(isRealDomainRow);
  const realAfterState = afterState.filter(isRealDomainRow);

  const beforeByKey = new Map(realBeforeState.map(row => [stateRowKey(row), row]));
  const afterByKey = new Map(realAfterState.map(row => [stateRowKey(row), row]));

  const orderedKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const row of [...realBeforeState, ...realAfterState]) {
    const key = stateRowKey(row);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      orderedKeys.push(key);
    }
  }

  const projected: ProjectedChangelogRow[] = [];
  for (const key of orderedKeys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);

    let operation: ChangelogOperation;
    let oldRowState: ChangelogRowState | null = null;
    let newRowState: ChangelogRowState | null = null;

    if (!before?.row && after?.row) {
      operation = ChangelogOperation.INSERT;
      newRowState = after.row;
    } else if (before?.row && !after?.row) {
      operation = ChangelogOperation.DELETE;
      oldRowState = before.row;
    } else if (before?.row && after?.row) {
      if (rowStatesAreEqual(before.row, after.row)) {
        // Both sides captured the row but nothing actually changed — not a
        // real edit, don't let it show up in Recent Changes as a false UPDATE.
        continue;
      }
      operation = ChangelogOperation.UPDATE;
      oldRowState = before.row;
      newRowState = after.row;
    } else {
      // Neither side has a materialized row for this key — nothing to project.
      continue;
    }

    const targetRow = after ?? before!;
    projected.push({
      tableName: targetRow.table,
      recordID: buildRecordID(targetRow.primaryKeyValue, editOperationID),
      operation,
      oldRowState,
      newRowState
    });
  }

  return projected;
}

/**
 * Projects one edit_operations entry onto the unifiedchangelog rows it must
 * also produce. Called from writeEditOperation on the SAME transaction as the
 * ledger INSERT, and reproduced row-for-row by the
 * 2026-10-14-02-backfill-edit-operations-to-unifiedchangelog.sql migration
 * for historical ledger entries that predate the dual-write.
 */
export function projectEditOperationToChangelogRows(
  operationType: EditOperationType,
  editOperationID: number,
  beforeState: EditOperationStateRow[],
  afterState: EditOperationStateRow[]
): ProjectedChangelogRow[] {
  if (operationType === 'bulk-revision-row') {
    return projectBulkRevisionRow(editOperationID, beforeState);
  }
  return projectPairedStateRows(editOperationID, beforeState, afterState);
}
