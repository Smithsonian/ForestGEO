// Mutating writer for a #427 tree-species-correction undo. Runs entirely
// inside the caller's (`revert.ts`) already-open transaction; never
// begins/commits/rolls back, never acquires the scope lock, issues no DDL.
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { handleUpsert } from '@/config/utils';
import { CMAttributesResult } from '@/lib/db/definitions/core';
import type { EditOperationStateRow } from '@/config/editoperations';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';
import { SPECIES_CORRECTION_UNDO_RESTORATION_VERSION, type SpeciesCorrectionUndoRestoration } from './types';
import {
  refreshCorrectionErrorsAndValidationPending,
  type CorrectionErrorRefreshResult,
  type SpeciesCorrectionColumnChange,
  type SpeciesCorrectionDiffCoreMeasurementColumn,
  type SpeciesCorrectionDiffStemColumn,
  type SpeciesCorrectionMetadataMeasurement
} from './tree-species-correction-writer';
import type { SpeciesCorrectionUndoPreflight } from './species-correction-undo';

const TREES_TABLE = 'trees';
const STEMS_TABLE = 'stems';
const COREMEASUREMENTS_TABLE = 'coremeasurements';
const CMATTRIBUTES_TABLE = 'cmattributes';

type StoredColumnKind = 'decimal' | 'date' | 'text';
const STORED_COLUMN_KINDS: Record<SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn, StoredColumnKind> = {
  MeasuredDBH: 'decimal',
  MeasuredHOM: 'decimal',
  RawX: 'decimal',
  RawY: 'decimal',
  RawPlotX: 'decimal',
  RawPlotY: 'decimal',
  LocalX: 'decimal',
  LocalY: 'decimal',
  PlotX: 'decimal',
  PlotY: 'decimal',
  MeasurementDate: 'date',
  Description: 'text',
  RawComments: 'text',
  RawCodes: 'text'
};

export class SpeciesCorrectionUndoTransactionMismatchError extends Error {
  constructor(
    public readonly preflightTransactionID: string,
    public readonly writeTransactionID: string
  ) {
    super(
      `writeSpeciesCorrectionUndo: preflight was captured under transaction "${preflightTransactionID}" but this write is running under transaction "${writeTransactionID}"; a locked preflight can only be applied inside the exact transaction that produced it.`
    );
    this.name = 'SpeciesCorrectionUndoTransactionMismatchError';
  }
}

export class SpeciesCorrectionUndoWriteIntegrityError extends Error {
  constructor(
    public readonly table: string,
    public readonly primaryKeyValue: number,
    reason: string
  ) {
    super(`writeSpeciesCorrectionUndo: ${table} pk=${primaryKeyValue}: ${reason}`);
    this.name = 'SpeciesCorrectionUndoWriteIntegrityError';
  }
}

export interface SpeciesCorrectionUndoWriteInput {
  readonly preflight: SpeciesCorrectionUndoPreflight;
  /**
   * Awaited exactly once, immediately after the before-state locking reads
   * below and before the first UPDATE — mirrors `applyEditInTransaction`'s
   * own `assertAuthorizationFresh` timing for the legacy revert path.
   */
  readonly assertAuthorizationFresh?: () => Promise<void>;
}

export interface SpeciesCorrectionUndoWriteResult {
  readonly treeBeforeState: EditOperationStateRow;
  readonly treeAfterState: EditOperationStateRow;
  readonly editedStemBeforeState: EditOperationStateRow | null;
  readonly editedStemAfterState: EditOperationStateRow | null;
  /** Every member of the corrected tree (edited row included), full `coremeasurements` rows, ascending by CoreMeasurementID. */
  readonly memberCoreMeasurementBeforeState: EditOperationStateRow[];
  readonly memberCoreMeasurementAfterState: EditOperationStateRow[];
  /** Only non-empty when the original correction actually changed the edited row's attribute associations. */
  readonly attributeBeforeState: EditOperationStateRow[];
  readonly attributeAfterState: EditOperationStateRow[];
  readonly errorRefresh: CorrectionErrorRefreshResult;
  readonly restoration: SpeciesCorrectionUndoRestoration;
}

function buildPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function buildStateRow(table: string, primaryKey: string, primaryKeyValue: number, row: Record<string, unknown> | null): EditOperationStateRow {
  return { table, primaryKey, primaryKeyValue, row };
}

function areAttributeCodeSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((code, index) => code === sortedB[index]);
}

function buildColumnRestorations<TColumn extends string>(
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>
): Array<{ column: string; value: unknown }> {
  return (Object.keys(changes) as TColumn[]).map(column => ({ column, value: changes[column]!.before })).sort((a, b) => a.column.localeCompare(b.column));
}

// Mirrors the calendar-date reduction measurementssummary.ts/revert.ts
// already apply before binding a DATE column (neither exports it, so it is
// reproduced here rather than invented): an ISO instant is cut to its
// 'YYYY-MM-DD' prefix so MySQL never receives a 'T'/'Z'-bearing literal.
function normalizeStoredColumnValueForBinding(column: SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn, value: unknown): unknown {
  if (value === null) return null;
  if (STORED_COLUMN_KINDS[column] === 'date' && typeof value === 'string') {
    return value.includes('T') ? value.slice(0, 10) : value;
  }
  return value;
}

async function selectSingleRowByPrimaryKey(
  cm: ConnectionManager,
  schema: string,
  table: string,
  primaryKeyColumn: string,
  primaryKeyValue: number,
  transactionID: string
): Promise<Record<string, unknown> | null> {
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.${table} WHERE ${primaryKeyColumn} = ? LIMIT 1 FOR UPDATE`),
    [primaryKeyValue],
    transactionID
  );
  const result: Array<Record<string, unknown>> = Array.isArray(rows) ? rows : [];
  return result.length > 0 ? result[0] : null;
}

async function selectCoreMeasurementRowsByIDs(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementIDs: readonly number[],
  transactionID: string
): Promise<Array<Record<string, unknown>>> {
  if (coreMeasurementIDs.length === 0) return [];
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT * FROM ??.${COREMEASUREMENTS_TABLE} WHERE CoreMeasurementID IN (${buildPlaceholders(coreMeasurementIDs.length)}) ORDER BY CoreMeasurementID FOR UPDATE`
    ),
    [...coreMeasurementIDs],
    transactionID
  );
  return Array.isArray(rows) ? rows : [];
}

async function selectAttributeStateRows(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string
): Promise<EditOperationStateRow[]> {
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.${CMATTRIBUTES_TABLE} WHERE CoreMeasurementID = ? ORDER BY CMAID FOR UPDATE`),
    [coreMeasurementID],
    transactionID
  );
  const result: Array<Record<string, unknown>> = Array.isArray(rows) ? rows : [];
  return result.map(row => buildStateRow(CMATTRIBUTES_TABLE, 'CMAID', Number(row.CMAID), row));
}

function extractAffectedRows(result: unknown): number {
  return Number((result as { affectedRows?: unknown } | undefined)?.affectedRows ?? 0);
}

/** Only `trees.SpeciesID`, scoped by (TreeID, CensusID) — no tree/stem creation, no other column. */
async function restoreTreeSpecies(
  cm: ConnectionManager,
  schema: string,
  treeID: number,
  censusID: number,
  restoredSpeciesID: number,
  transactionID: string
): Promise<void> {
  const result = await cm.executeQuery(
    safeFormatQuery(schema, `UPDATE ??.${TREES_TABLE} SET SpeciesID = ? WHERE TreeID = ? AND CensusID = ?`),
    [restoredSpeciesID, treeID, censusID],
    transactionID
  );
  if (extractAffectedRows(result) === 0) {
    throw new SpeciesCorrectionUndoWriteIntegrityError(
      TREES_TABLE,
      treeID,
      `SpeciesID restore UPDATE (-> ${restoredSpeciesID}) in census ${censusID} matched 0 rows`
    );
  }
}

/** Writes back exactly the allowlisted columns `changes` declares, each at its recorded `before` value; a column absent from `changes` is never referenced. */
async function restoreDeclaredColumns<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  cm: ConnectionManager,
  schema: string,
  table: string,
  primaryKeyColumn: string,
  primaryKeyValue: number,
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  transactionID: string
): Promise<void> {
  const columns = Object.keys(changes) as TColumn[];
  if (columns.length === 0) return;
  const setClause = columns.map(column => `${column} = ?`).join(', ');
  const values = columns.map(column => normalizeStoredColumnValueForBinding(column, changes[column]!.before));
  const result = await cm.executeQuery(
    safeFormatQuery(schema, `UPDATE ??.${table} SET ${setClause} WHERE ${primaryKeyColumn} = ?`),
    [...values, primaryKeyValue],
    transactionID
  );
  if (extractAffectedRows(result) !== 1) {
    throw new SpeciesCorrectionUndoWriteIntegrityError(
      table,
      primaryKeyValue,
      `restoring declared column(s) [${columns.join(', ')}] affected ${extractAffectedRows(result)} row(s), expected exactly 1`
    );
  }
}

// One UPDATE per member: each restores a different exact RawSpCode (NULL
// included verbatim), so a shared affected-rows check would misfire for any
// member whose restored value happens to equal its current one.
async function restoreMemberRawSpCodes(
  cm: ConnectionManager,
  schema: string,
  members: readonly SpeciesCorrectionMetadataMeasurement[],
  transactionID: string
): Promise<void> {
  for (const member of members) {
    await cm.executeQuery(
      safeFormatQuery(schema, `UPDATE ??.${COREMEASUREMENTS_TABLE} SET RawSpCode = ? WHERE CoreMeasurementID = ?`),
      [member.rawSpCode, member.coreMeasurementID],
      transactionID
    );
  }
}

async function restoreAttributeAssociations(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  codes: readonly string[],
  transactionID: string
): Promise<void> {
  await cm.executeQuery(safeFormatQuery(schema, `DELETE FROM ??.${CMATTRIBUTES_TABLE} WHERE CoreMeasurementID = ?`), [coreMeasurementID], transactionID);
  for (const code of codes) {
    await handleUpsert<CMAttributesResult>(cm, schema, CMATTRIBUTES_TABLE, { CoreMeasurementID: coreMeasurementID, Code: code }, 'CMAID', transactionID);
  }
}

export async function writeSpeciesCorrectionUndo(
  cm: ConnectionManager,
  schema: string,
  input: SpeciesCorrectionUndoWriteInput,
  transactionID: string
): Promise<SpeciesCorrectionUndoWriteResult> {
  const { preflight, assertAuthorizationFresh } = input;
  if (preflight.transactionID !== transactionID) {
    throw new SpeciesCorrectionUndoTransactionMismatchError(preflight.transactionID, transactionID);
  }

  const { metadata, reverseCorrection } = preflight;
  const targetTreeID = reverseCorrection.targetTreeID;
  const censusID = reverseCorrection.censusID;
  const restoredSpeciesID = reverseCorrection.newSpeciesID;
  const restoredSpeciesCode = reverseCorrection.newSpeciesCode;
  const replacedSpeciesID = reverseCorrection.oldSpeciesID;
  const replacedSpeciesCode = reverseCorrection.oldSpeciesCode;
  const editedCoreMeasurementID = metadata.after.editedCoreMeasurementID;
  const editedStemGUID = metadata.after.editedStemGUID;
  const domainDiff = metadata.after.domainDiff;
  const stemColumnsToRestore = Object.keys(domainDiff.stems) as SpeciesCorrectionDiffStemColumn[];
  const memberIDs = metadata.before.measurements.map(m => m.coreMeasurementID).sort((a, b) => a - b);
  const activeMemberIDs = metadata.before.measurements.filter(m => m.isActive).map(m => m.coreMeasurementID);
  const attributeCodesChanged = !areAttributeCodeSetsEqual(domainDiff.attributeCodes.before, domainDiff.attributeCodes.after);

  // --- "before" snapshot: FOR UPDATE reads bypass this transaction's
  // REPEATABLE READ consistent-read snapshot, so every value here is current. ---------
  const treeBeforeRow = await selectSingleRowByPrimaryKey(cm, schema, TREES_TABLE, 'TreeID', targetTreeID, transactionID);
  if (!treeBeforeRow) throw new SpeciesCorrectionUndoWriteIntegrityError(TREES_TABLE, targetTreeID, 'row no longer exists at write time');
  const treeBeforeState = buildStateRow(TREES_TABLE, 'TreeID', targetTreeID, treeBeforeRow);

  let editedStemBeforeState: EditOperationStateRow | null = null;
  if (stemColumnsToRestore.length > 0) {
    const stemBeforeRow = await selectSingleRowByPrimaryKey(cm, schema, STEMS_TABLE, 'StemGUID', editedStemGUID, transactionID);
    if (!stemBeforeRow) {
      throw new SpeciesCorrectionUndoWriteIntegrityError(
        STEMS_TABLE,
        editedStemGUID,
        'row no longer exists at write time but domainDiff.stems declares column(s) to restore'
      );
    }
    editedStemBeforeState = buildStateRow(STEMS_TABLE, 'StemGUID', editedStemGUID, stemBeforeRow);
  }

  const memberBeforeRows = await selectCoreMeasurementRowsByIDs(cm, schema, memberIDs, transactionID);
  if (memberBeforeRows.length !== memberIDs.length) {
    throw new SpeciesCorrectionUndoWriteIntegrityError(
      COREMEASUREMENTS_TABLE,
      editedCoreMeasurementID,
      `expected ${memberIDs.length} member row(s), found ${memberBeforeRows.length} at write time`
    );
  }
  const memberCoreMeasurementBeforeState = memberBeforeRows.map(row =>
    buildStateRow(COREMEASUREMENTS_TABLE, 'CoreMeasurementID', Number(row.CoreMeasurementID), row)
  );

  const attributeBeforeState = attributeCodesChanged ? await selectAttributeStateRows(cm, schema, editedCoreMeasurementID, transactionID) : [];

  // Re-checked here, after every before-state locking read above and before
  // this function's first UPDATE — mirrors `applyEditInTransaction`'s own
  // `assertAuthorizationFresh` timing on the legacy revert path.
  if (assertAuthorizationFresh) {
    await assertAuthorizationFresh();
  }

  // --- 1. Tree species. -----------------------------------------------------------
  await restoreTreeSpecies(cm, schema, targetTreeID, censusID, restoredSpeciesID, transactionID);

  // --- 3/4. Only the declared-changed coremeasurements/stems columns, at their
  // exact recorded `before` value; dates normalized identically to the forward writer. ---
  await restoreDeclaredColumns(cm, schema, COREMEASUREMENTS_TABLE, 'CoreMeasurementID', editedCoreMeasurementID, domainDiff.coremeasurements, transactionID);
  await restoreDeclaredColumns(cm, schema, STEMS_TABLE, 'StemGUID', editedStemGUID, domainDiff.stems, transactionID);

  // --- 2. Every member's exact prior RawSpCode, NULL preserved verbatim. ----------
  await restoreMemberRawSpCodes(cm, schema, metadata.before.measurements, transactionID);

  // --- 5. Attribute-code association set, only if the original correction changed it. ---
  const restoredAttributeCodes = attributeCodesChanged ? [...domainDiff.attributeCodes.before].sort() : null;
  if (attributeCodesChanged) {
    await restoreAttributeAssociations(cm, schema, editedCoreMeasurementID, restoredAttributeCodes as string[], transactionID);
  }

  // --- 7. Error-state refresh over the whole corrected membership. ----------------
  const errorRefresh = await refreshCorrectionErrorsAndValidationPending(cm, schema, censusID, memberIDs, activeMemberIDs, transactionID);

  // --- Honest "after" snapshot, reflecting every write above. ---------------------
  const treeAfterRow = await selectSingleRowByPrimaryKey(cm, schema, TREES_TABLE, 'TreeID', targetTreeID, transactionID);
  if (!treeAfterRow) throw new SpeciesCorrectionUndoWriteIntegrityError(TREES_TABLE, targetTreeID, 'row vanished immediately after being restored');
  const treeAfterState = buildStateRow(TREES_TABLE, 'TreeID', targetTreeID, treeAfterRow);

  let editedStemAfterState: EditOperationStateRow | null = null;
  if (stemColumnsToRestore.length > 0) {
    const stemAfterRow = await selectSingleRowByPrimaryKey(cm, schema, STEMS_TABLE, 'StemGUID', editedStemGUID, transactionID);
    if (!stemAfterRow) throw new SpeciesCorrectionUndoWriteIntegrityError(STEMS_TABLE, editedStemGUID, 'row vanished immediately after being restored');
    editedStemAfterState = buildStateRow(STEMS_TABLE, 'StemGUID', editedStemGUID, stemAfterRow);
  }

  const memberAfterRows = await selectCoreMeasurementRowsByIDs(cm, schema, memberIDs, transactionID);
  if (memberAfterRows.length !== memberIDs.length) {
    throw new SpeciesCorrectionUndoWriteIntegrityError(
      COREMEASUREMENTS_TABLE,
      editedCoreMeasurementID,
      `expected ${memberIDs.length} member row(s), found ${memberAfterRows.length} immediately after restoring`
    );
  }
  const memberCoreMeasurementAfterState = memberAfterRows.map(row =>
    buildStateRow(COREMEASUREMENTS_TABLE, 'CoreMeasurementID', Number(row.CoreMeasurementID), row)
  );

  const attributeAfterState = attributeCodesChanged ? await selectAttributeStateRows(cm, schema, editedCoreMeasurementID, transactionID) : [];

  // --- View/summary refresh, after every error-log mutation above. ----------------
  const affectedCoreMeasurementIDs = new Set<number>(memberIDs);
  for (const id of errorRefresh.ingestionRefreshedMeasurementIDs) affectedCoreMeasurementIDs.add(id);
  for (const id of errorRefresh.pendingMeasurementIDs) affectedCoreMeasurementIDs.add(id);
  await refreshMeasurementViewsForCoreMeasurements(cm, schema, Array.from(affectedCoreMeasurementIDs), transactionID);

  const restoration: SpeciesCorrectionUndoRestoration = {
    version: SPECIES_CORRECTION_UNDO_RESTORATION_VERSION,
    targetTreeID,
    restoredSpeciesID,
    restoredSpeciesCode,
    replacedSpeciesID,
    replacedSpeciesCode,
    restoredMemberRawSpCodes: [...metadata.before.measurements]
      .sort((a, b) => a.coreMeasurementID - b.coreMeasurementID)
      .map(member => ({ coreMeasurementID: member.coreMeasurementID, rawSpCode: member.rawSpCode })),
    restoredCoreMeasurementColumns: buildColumnRestorations(domainDiff.coremeasurements),
    restoredStemColumns: buildColumnRestorations(domainDiff.stems),
    restoredAttributeCodes
  };

  return {
    treeBeforeState,
    treeAfterState,
    editedStemBeforeState,
    editedStemAfterState,
    memberCoreMeasurementBeforeState,
    memberCoreMeasurementAfterState,
    attributeBeforeState,
    attributeAfterState,
    errorRefresh,
    restoration
  };
}
