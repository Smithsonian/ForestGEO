// measurementssummary writer — applies a single-row edit that the analyzer
// has already validated.
//
// Ported from `frontend/config/macros/coreapifunctions.ts::PATCH` (the
// `dataType === 'measurementssummary'` branch). The legacy PATCH handler is
// still in place for other dataTypes but will be removed by Task 18.
//
// The writer runs INSIDE an outer transaction (owned by `applyEditInTransaction`
// or a batch caller such as revision apply). It MUST NOT begin, commit, or
// rollback transactions, and it MUST NOT close the connection.
import ConnectionManager from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { EditPlan } from '../types';
import type { ApplyInTransactionInput } from '../apply';
import type { EditOperationStateRow } from '@/config/editoperations';
import { computeTreeStemState, resolveMeasurementSummaryQuadratID, resolveMeasurementSummaryStem, resolveMeasurementSummaryTree } from './resolvers-mutating';
import { refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';
import { refreshMeasurementViewsForCoreMeasurements, refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { handleUpsert } from '@/config/utils';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { CMAttributesResult } from '@/lib/db/definitions/core';
import { parseAttributeCodes } from '../rules/attributes';
import {
  prepareTreeSpeciesCorrection,
  applyPreparedTreeSpeciesCorrection,
  assertNoEditedFieldDriftForSpeciesCorrection,
  buildSpeciesCorrectionDomainDiff,
  buildSpeciesCorrectionMetadataStateRows,
  PreparedSpeciesCorrection,
  AppliedSpeciesCorrectionResult
} from '../tree-species-correction-writer';

export interface WriterResult {
  updatedIDs: Record<string, number>;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  postValidation?: { newErrors: number; clearedErrors: number };
  validationPending: boolean;
}

// --- #427 batch-executor group-member write context -----------------------
// A tree-wide species correction's batch executor writes every group
// member's row-local fields through this writer FIRST, then applies the
// correction itself exactly once afterward — because applying the
// correction ends by refreshing ingestion errors/validation state for every
// attached member, which must observe the already-edited values. This
// context flips this writer onto the same sparse correction write policy
// (see `correctionWritePolicyActive` below) for that row-local write
// WITHOUT also re-running the tree correction — never constructible from
// request JSON; the writer instead validates it at the top of
// `writeMeasurementsSummary`, before any read or write.
export const SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND = 'species-correction-group-member';

export interface SpeciesCorrectionGroupMemberWriteContext {
  kind: typeof SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND;
  /** Must equal the `txID` this exact call runs under — the executor's own open transaction, never a different one. */
  transactionID: string;
  schema: string;
  plotID: number;
  censusID: number;
  /** Must equal `Number(input.targetID)` — the row this specific write is for. */
  targetCoreMeasurementID: number;
}

export class SpeciesCorrectionGroupMemberContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeciesCorrectionGroupMemberContextError';
  }
}

/**
 * Hard validation standing in for "not constructible from request JSON" —
 * every field the context claims is cross-checked against the caller's own
 * `input`/`plan`/`txID` before any read or write runs. `writeLedger`/
 * `refreshViews` must both be exactly `false`: the group path builds no
 * ledger row (so no `species_correction_metadata` marker either) and no
 * per-row view refresh (the batch's sibling set is not available here; the
 * executor runs one scope refresh after every member is written).
 * `plan.speciesCorrection` must be absent — a group member's row-local write
 * must never also carry its own correction plan, since the executor applies
 * that correction exactly once, outside this call.
 */
function assertValidSpeciesCorrectionGroupMemberContext(
  context: SpeciesCorrectionGroupMemberWriteContext,
  input: ApplyInTransactionInput,
  plan: EditPlan,
  txID: string
): void {
  if (context.kind !== SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context has kind "${String(context.kind)}"; expected "${SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND}".`
    );
  }
  if (context.transactionID !== txID) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context's transactionID ("${context.transactionID}") does not match this call's own transaction ("${txID}"); a group-member write must run inside the executor's own transaction.`
    );
  }
  if (context.schema !== input.schema) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context's schema ("${context.schema}") does not match input.schema ("${input.schema}").`
    );
  }
  if (Number(context.plotID) !== Number(input.plotID)) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context's plotID (${context.plotID}) does not match input.plotID (${input.plotID}).`
    );
  }
  if (Number(context.censusID) !== Number(input.censusID)) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context's censusID (${context.censusID}) does not match input.censusID (${input.censusID}).`
    );
  }
  if (Number(context.targetCoreMeasurementID) !== Number(input.targetID)) {
    throw new SpeciesCorrectionGroupMemberContextError(
      `species-correction group-member write context's targetCoreMeasurementID (${context.targetCoreMeasurementID}) does not match input.targetID (${input.targetID}).`
    );
  }
  if (input.writeLedger !== false) {
    throw new SpeciesCorrectionGroupMemberContextError(
      'species-correction group-member write requires input.writeLedger === false; the group path builds no ledger row and therefore no species_correction_metadata marker.'
    );
  }
  if (input.refreshViews !== false) {
    throw new SpeciesCorrectionGroupMemberContextError(
      'species-correction group-member write requires input.refreshViews === false; the batch executor performs one scope refresh after every member has been written.'
    );
  }
  if (plan.speciesCorrection) {
    throw new SpeciesCorrectionGroupMemberContextError(
      'species-correction group-member write context cannot be combined with plan.speciesCorrection; the executor applies the tree-wide correction exactly once itself, outside this row-local write.'
    );
  }
}

const RAW_SYNC_TRIGGER_FIELDS: ReadonlySet<string> = new Set([
  'SpeciesCode',
  'TreeTag',
  'StemTag',
  'QuadratName',
  'StemLocalX',
  'StemLocalY',
  'StemPlotX',
  'StemPlotY',
  'MeasuredDBH',
  'MeasuredHOM',
  'MeasurementDate',
  'Description',
  'Attributes'
]);

const STEM_NEIGHBOR_REFRESH_FIELDS: ReadonlySet<string> = new Set([
  'SpeciesCode',
  'TreeTag',
  'StemTag',
  'QuadratName',
  'StemLocalX',
  'StemLocalY',
  'StemPlotX',
  'StemPlotY'
]);

export type MeasurementViewRefreshTargetDecision =
  | { mode: 'targeted'; coreMeasurementIDs: number[] }
  | { mode: 'scope'; reason: 'invalid-target-id' | 'invalid-scope' | 'unsupported-field' };

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = toPositiveNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function changedFieldsIncludeAny(changedFields: ReadonlySet<string>, fields: ReadonlySet<string>): boolean {
  for (const field of changedFields) {
    if (fields.has(field)) return true;
  }
  return false;
}

function addPositiveInteger(values: Set<number>, value: unknown): void {
  const parsed = toPositiveInteger(value);
  if (parsed !== null) values.add(parsed);
}

export async function resolveMeasurementViewRefreshTargets(
  cm: ConnectionManager,
  schema: string,
  input: {
    coreMeasurementID: number;
    plotID: number;
    censusID: number;
    changedFields: ReadonlySet<string>;
    beforeStemGUID: number | null;
    afterStemGUID: number | null;
    transactionID: string;
  }
): Promise<MeasurementViewRefreshTargetDecision> {
  const coreMeasurementID = toPositiveInteger(input.coreMeasurementID);
  if (coreMeasurementID === null) return { mode: 'scope', reason: 'invalid-target-id' };

  for (const field of input.changedFields) {
    if (!RAW_SYNC_TRIGGER_FIELDS.has(field)) return { mode: 'scope', reason: 'unsupported-field' };
  }

  const affectedIDs = new Set<number>([coreMeasurementID]);
  if (!changedFieldsIncludeAny(input.changedFields, STEM_NEIGHBOR_REFRESH_FIELDS)) {
    return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs) };
  }

  const plotID = toPositiveInteger(input.plotID);
  const censusID = toPositiveInteger(input.censusID);
  if (plotID === null || censusID === null) return { mode: 'scope', reason: 'invalid-scope' };

  const stemGUIDs = new Set<number>();
  addPositiveInteger(stemGUIDs, input.beforeStemGUID);
  addPositiveInteger(stemGUIDs, input.afterStemGUID);
  if (stemGUIDs.size === 0) return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs) };

  const stemGUIDList = Array.from(stemGUIDs).sort((a, b) => a - b);
  const placeholders = stemGUIDList.map(() => '?').join(', ');
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT cm.CoreMeasurementID
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE cm.StemGUID IN (${placeholders})
         AND c.PlotID = ?
         AND cm.CensusID = ?
       ORDER BY cm.CoreMeasurementID`
    ),
    [...stemGUIDList, plotID, censusID],
    input.transactionID
  );
  for (const row of rows as Array<{ CoreMeasurementID?: unknown }>) {
    addPositiveInteger(affectedIDs, row.CoreMeasurementID);
  }

  return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs).sort((a, b) => a - b) };
}

function normalizeMeasurementSummaryDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (!value.includes('T')) return value;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface LoadedCoreMeasurementRow {
  CoreMeasurementID: number;
  CensusID: number | null;
  PlotID: number | null;
  StemGUID: number | null;
  MeasurementDate: string | Date | null;
  MeasuredDBH: number | string | null;
  MeasuredHOM: number | string | null;
  Description: string | null;
  Attributes: string | null;
  TreeTag: string | null;
  TreeID: number | null;
  SpeciesCode: string | null;
  SpeciesID: number | null;
  StemTag: string | null;
  StemLocalX: number | string | null;
  StemLocalY: number | string | null;
  StemPlotX: number | string | null;
  StemPlotY: number | string | null;
  QuadratName: string | null;
  QuadratID?: number | null;
}

/**
 * `forUpdate` must be set on the #427 species-correction path (see
 * `correctionWritePolicyActive` in `writeMeasurementsSummary`): the caller's own
 * `analyzeEdit` may have run earlier in this exact transaction before any
 * lock was taken, fixing a REPEATABLE READ snapshot that a plain `SELECT`
 * here would still observe even though `tree-species-correction-writer.ts`'s
 * locked replan has already forced a current read of the overlapping
 * trees/stems/measurements rows — a lock taken by one statement does not
 * make a later, unrelated plain `SELECT` current. Non-correction callers
 * leave this `false` (default), preserving existing behavior exactly.
 */
async function loadCurrentJoinedRow(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<LoadedCoreMeasurementRow> {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT
       cm.CoreMeasurementID,
       cm.CensusID,
       c.PlotID,
       cm.StemGUID,
       cm.MeasurementDate,
       cm.MeasuredDBH,
       cm.MeasuredHOM,
       cm.Description,
       cm.RawCodes AS Attributes,
       t.TreeTag,
       t.TreeID,
       sp.SpeciesCode,
       sp.SpeciesID,
       s.StemTag,
       s.LocalX AS StemLocalX,
       s.LocalY AS StemLocalY,
       COALESCE(cm.RawPlotX, s.PlotX) AS StemPlotX,
       COALESCE(cm.RawPlotY, s.PlotY) AS StemPlotY,
       q.QuadratName
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     LEFT JOIN ??.stems s ON s.StemGUID = cm.StemGUID
     LEFT JOIN ??.trees t ON t.TreeID = s.TreeID
     LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
     LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
     WHERE cm.CoreMeasurementID = ?
     LIMIT 1${lockClause}`
    ),
    [coreMeasurementID],
    transactionID
  );
  if (!rows.length) throw new Error(`measurementssummary writer: coremeasurements row ${coreMeasurementID} not found`);
  return rows[0] as LoadedCoreMeasurementRow;
}

/**
 * The 12 fields `assertNoEditedFieldDriftForSpeciesCorrection` checks
 * (`SpeciesCode` excluded — that precondition belongs to the locked replan
 * comparison in `tree-species-correction-writer.ts`). Single source of
 * truth for the shape: used directly by the drift guard below AND by
 * `loadLockedEditedFieldValuesForSpeciesCorrection`, so the batch executor's
 * pre-write guard can never drift from this writer's own.
 */
function buildLockedEditedFieldValuesForSpeciesCorrection(row: LoadedCoreMeasurementRow): Record<string, unknown> {
  return {
    TreeTag: row.TreeTag,
    StemTag: row.StemTag,
    QuadratName: row.QuadratName,
    StemLocalX: row.StemLocalX,
    StemLocalY: row.StemLocalY,
    StemPlotX: row.StemPlotX,
    StemPlotY: row.StemPlotY,
    MeasurementDate: row.MeasurementDate,
    MeasuredDBH: row.MeasuredDBH,
    MeasuredHOM: row.MeasuredHOM,
    Description: row.Description,
    Attributes: row.Attributes
  };
}

/**
 * Read-only: the exact locked (`FOR UPDATE`) current values the batch
 * executor must pass to `assertNoEditedFieldDriftForSpeciesCorrection`
 * (imported from `../tree-species-correction-writer`) before its own first
 * write for a group member's row-local field changes. Issues NO write.
 * `loadCurrentJoinedRow` already throws when the row does not exist, so a
 * missing row never silently returns a half-empty map here.
 */
export async function loadLockedEditedFieldValuesForSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string
): Promise<Record<string, unknown>> {
  const row = await loadCurrentJoinedRow(cm, schema, coreMeasurementID, transactionID, { forUpdate: true });
  return buildLockedEditedFieldValuesForSpeciesCorrection(row);
}

/** `forUpdate`: see `loadCurrentJoinedRow` doc comment above — same correction-path rationale. */
async function loadCoreMeasurementRow(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.coremeasurements WHERE CoreMeasurementID = ? LIMIT 1${lockClause}`),
    [coreMeasurementID],
    transactionID
  );
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

/** `forUpdate`: see `loadCurrentJoinedRow` doc comment above — same correction-path rationale. */
async function loadStemRow(
  cm: ConnectionManager,
  schema: string,
  stemGUID: number | null,
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  if (stemGUID === null) return null;
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const rows = await cm.executeQuery(safeFormatQuery(schema, `SELECT * FROM ??.stems WHERE StemGUID = ? LIMIT 1${lockClause}`), [stemGUID], transactionID);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

/** `forUpdate`: see `loadCurrentJoinedRow` doc comment above — same correction-path rationale. */
async function loadTreeRow(
  cm: ConnectionManager,
  schema: string,
  treeID: number | null,
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  if (treeID === null) return null;
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const rows = await cm.executeQuery(safeFormatQuery(schema, `SELECT * FROM ??.trees WHERE TreeID = ? LIMIT 1${lockClause}`), [treeID], transactionID);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

/** `forUpdate`: see `loadCurrentJoinedRow` doc comment above — same correction-path rationale. */
async function loadCmAttributeRows(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.cmattributes WHERE CoreMeasurementID = ? ORDER BY CMAID${lockClause}`),
    [coreMeasurementID],
    transactionID
  );
  return rows as Array<Record<string, unknown>>;
}

function buildStateRow(table: string, primaryKey: string, primaryKeyValue: string | number, row: Record<string, unknown> | null): EditOperationStateRow {
  return { table, primaryKey, primaryKeyValue, row };
}

function hasStateRow(state: EditOperationStateRow[], table: string, primaryKeyValue: string | number): boolean {
  return state.some(row => row.table === table && String(row.primaryKeyValue) === String(primaryKeyValue));
}

async function findExistingTreeID(
  cm: ConnectionManager,
  schema: string,
  treeTag: unknown,
  speciesID: unknown,
  censusID: unknown,
  transactionID: string
): Promise<number | null> {
  const normalizedSpeciesID = toPositiveNumber(speciesID);
  const normalizedCensusID = toPositiveNumber(censusID);
  if (!treeTag || normalizedSpeciesID === null || normalizedCensusID === null) return null;

  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT TreeID
     FROM ??.trees
     WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
     ORDER BY TreeID
     LIMIT 1`
    ),
    [treeTag, normalizedSpeciesID, normalizedCensusID],
    transactionID
  );
  return rows.length ? toPositiveNumber(rows[0].TreeID) : null;
}

async function findExactActiveStemGUID(
  cm: ConnectionManager,
  schema: string,
  treeID: unknown,
  censusID: unknown,
  stemTag: unknown,
  quadratID: unknown,
  transactionID: string
): Promise<number | null> {
  const normalizedTreeID = toPositiveNumber(treeID);
  const normalizedCensusID = toPositiveNumber(censusID);
  const normalizedQuadratID = toPositiveNumber(quadratID);
  if (normalizedTreeID === null || normalizedCensusID === null || !stemTag || normalizedQuadratID === null) return null;

  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID
     FROM ??.stems
     WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1
     LIMIT 1`
    ),
    [normalizedTreeID, normalizedCensusID, stemTag, normalizedQuadratID],
    transactionID
  );
  return rows.length ? toPositiveNumber(rows[0].StemGUID) : null;
}

export async function writeMeasurementsSummary(
  cm: ConnectionManager,
  input: ApplyInTransactionInput,
  plan: EditPlan,
  txID: string,
  groupMemberContext?: SpeciesCorrectionGroupMemberWriteContext
): Promise<WriterResult> {
  // Must run before ANY read/write below — see `assertValidSpeciesCorrectionGroupMemberContext`'s own doc comment.
  if (groupMemberContext) {
    assertValidSpeciesCorrectionGroupMemberContext(groupMemberContext, input, plan, txID);
  }

  const { schema, plotID, censusID, targetID } = input;
  const coreMeasurementID = Number(targetID);

  const changedFields = new Set<string>(plan.fieldChanges.map(fc => fc.field));
  const newValues: Record<string, unknown> = {};
  for (const { field, to } of plan.fieldChanges) {
    newValues[field] = to;
  }

  // True only for the row that itself carries the previewed correction (the
  // tree-correction target). Drives ONLY the pre-write drift guard below —
  // never the broader write-policy gates, which also cover a group member's
  // row-local write (see `correctionWritePolicyActive`).
  const hasOwnSpeciesCorrectionPlan = Boolean(plan.speciesCorrection);

  // A #427 species correction — whether this row carries its own correction
  // plan, or is a sibling group member whose row-local field changes the
  // batch executor is applying via `groupMemberContext` — rewrites the
  // EXISTING tree's SpeciesID in place (see tree-species-correction-writer.ts)
  // rather than re-linking this measurement to a different/newly-created
  // tree, and must never hard-delete this row's error history. Computed from
  // `plan`/`groupMemberContext` alone (no DB read needed), so every
  // read/write below this point on the correction path can be made a
  // current locking read from the start.
  const correctionWritePolicyActive = hasOwnSpeciesCorrectionPlan || Boolean(groupMemberContext);

  // Capture before-state rows for exact-revert support. On the correction
  // path these are locking (`FOR UPDATE`) reads: this exact transaction's
  // earlier `analyzeEdit` pass may have already fixed a REPEATABLE READ
  // snapshot before any lock was taken, and `tree-species-correction-writer`'s
  // own locks (taken immediately below) do not retroactively make these
  // reads current — only `FOR UPDATE` on each read itself does.
  const beforeCoreRow = await loadCoreMeasurementRow(cm, schema, coreMeasurementID, txID, { forUpdate: correctionWritePolicyActive });
  if (!beforeCoreRow) throw new Error(`measurementssummary writer: coremeasurements ${coreMeasurementID} not found at write time`);
  const beforeStemGUID = beforeCoreRow.StemGUID as number | null;
  const beforeStemRow = await loadStemRow(cm, schema, beforeStemGUID, txID, { forUpdate: correctionWritePolicyActive });
  const beforeTreeID = beforeStemRow ? toPositiveNumber(beforeStemRow.TreeID) : null;
  const beforeTreeRow = await loadTreeRow(cm, schema, beforeTreeID, txID, { forUpdate: correctionWritePolicyActive });
  const beforeCmAttrRows = await loadCmAttributeRows(cm, schema, coreMeasurementID, txID, { forUpdate: correctionWritePolicyActive });

  const beforeState: EditOperationStateRow[] = [];
  beforeState.push(buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, beforeCoreRow));
  if (beforeStemRow && beforeStemGUID !== null) {
    beforeState.push(buildStateRow('stems', 'StemGUID', beforeStemGUID, beforeStemRow));
  }
  if (beforeTreeRow && beforeTreeID !== null) {
    beforeState.push(buildStateRow('trees', 'TreeID', beforeTreeID, beforeTreeRow));
  }
  if (changedFields.has('Attributes')) {
    for (const attrRow of beforeCmAttrRows) {
      beforeState.push(buildStateRow('cmattributes', 'CMAID', Number(attrRow.CMAID), attrRow));
    }
  }

  // --- #427 preflight: locked replan, complete precondition comparison, and
  // the sibling "before" snapshot — ALL before this function's first write
  // (see `prepareTreeSpeciesCorrection`'s doc comment). Retained and
  // consumed verbatim by `applyPreparedTreeSpeciesCorrection` far below,
  // after this function's own generic writes — re-planning at that point
  // would misread this operation's own write as drift against itself.
  const preparedSpeciesCorrection: PreparedSpeciesCorrection | null =
    hasOwnSpeciesCorrectionPlan && plan.speciesCorrection
      ? await prepareTreeSpeciesCorrection(
          cm,
          schema,
          {
            previewedCorrection: plan.speciesCorrection,
            editedCoreMeasurementID: coreMeasurementID,
            editedStemGUID: Number(beforeStemGUID)
          },
          txID
        )
      : null;

  // Start from a freshly-joined current snapshot and overlay the plan's new
  // values so downstream resolvers see the merged shape (the old PATCH code
  // worked on a mapped new-row, we synthesize it here from the DB + plan).
  // `current` is reassigned after stem resolution so unchanged fields reflect
  // the new stem rather than the previous one.
  let current = await loadCurrentJoinedRow(cm, schema, coreMeasurementID, txID, { forUpdate: correctionWritePolicyActive });
  const merged: LoadedCoreMeasurementRow = { ...current };
  for (const field of Object.keys(newValues)) {
    (merged as unknown as Record<string, unknown>)[field] = newValues[field];
  }

  // Own-correction path only — NOT `groupMemberContext`. A group member's
  // row-local write skips this: the executor already ran this exact guard
  // pre-batch; re-running it here would misread this same batch's own
  // just-written value as drift against itself.
  if (hasOwnSpeciesCorrectionPlan) {
    assertNoEditedFieldDriftForSpeciesCorrection(plan.fieldChanges, buildLockedEditedFieldValuesForSpeciesCorrection(current));
  }

  const normalizedMeasurementDate = normalizeMeasurementSummaryDate(merged.MeasurementDate ?? current.MeasurementDate ?? null);

  const previousTreeID = toPositiveNumber(current.TreeID);
  const shouldResolveTree = !correctionWritePolicyActive && (changedFields.has('SpeciesCode') || changedFields.has('TreeTag'));
  const needsFullStemResolution = changedFields.has('TreeTag') || changedFields.has('QuadratName') || changedFields.has('StemTag');

  let changesFound = false;

  // --- SpeciesCode change -> SpeciesID lookup (safety net; analyzer already
  // ensured the code is known). No mutation of species row — removing the
  // R1b SpeciesName side-effect that lived in the legacy PATCH handler.
  if (changedFields.has('SpeciesCode')) {
    changesFound = true;
    const speciesSearchResults = await cm.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT SpeciesID
       FROM ??.species
       WHERE LOWER(SpeciesCode) = LOWER(?)
         AND IsActive = 1
       ORDER BY SpeciesID
       LIMIT 1`
      ),
      [merged.SpeciesCode],
      txID
    );
    if (speciesSearchResults.length === 0) {
      throw new Error('Species not found');
    }
    merged.SpeciesID = speciesSearchResults[0].SpeciesID;
  }

  if (changedFields.has('TreeTag')) {
    changesFound = true;
  }

  if (changedFields.has('QuadratName')) {
    changesFound = true;
    merged.QuadratID = await resolveMeasurementSummaryQuadratID(
      cm,
      schema,
      {
        QuadratID: null,
        QuadratName: merged.QuadratName,
        PlotID: merged.PlotID ?? plotID
      },
      txID
    );
  }

  if (shouldResolveTree) {
    const existingTreeID = await findExistingTreeID(
      cm,
      schema,
      merged.TreeTag ?? current.TreeTag,
      merged.SpeciesID ?? current.SpeciesID,
      merged.CensusID ?? current.CensusID,
      txID
    );
    merged.TreeID = await resolveMeasurementSummaryTree(
      cm,
      schema,
      {
        TreeTag: merged.TreeTag ?? current.TreeTag,
        SpeciesID: merged.SpeciesID ?? current.SpeciesID,
        CensusID: merged.CensusID ?? current.CensusID
      },
      txID
    );
    const resolvedTreeIDForState = toPositiveNumber(merged.TreeID);
    if (existingTreeID === null && resolvedTreeIDForState !== null && !hasStateRow(beforeState, 'trees', resolvedTreeIDForState)) {
      beforeState.push(buildStateRow('trees', 'TreeID', resolvedTreeIDForState, null));
    }
  }

  const resolvedTreeID = toPositiveNumber(merged.TreeID ?? current.TreeID);
  const needsStemResolution = needsFullStemResolution || (resolvedTreeID !== null && resolvedTreeID !== previousTreeID);

  if (needsStemResolution) {
    changesFound = true;
    const resolvedQuadratID = await resolveMeasurementSummaryQuadratID(
      cm,
      schema,
      {
        QuadratID: (merged as any).QuadratID ?? null,
        QuadratName: merged.QuadratName ?? current.QuadratName,
        PlotID: merged.PlotID ?? plotID
      },
      txID
    );
    (merged as any).QuadratID = resolvedQuadratID;

    const existingStemGUID = await findExactActiveStemGUID(
      cm,
      schema,
      merged.TreeID ?? current.TreeID,
      merged.CensusID ?? current.CensusID,
      merged.StemTag ?? current.StemTag,
      resolvedQuadratID,
      txID
    );

    const resolvedStemGUID = await resolveMeasurementSummaryStem(
      cm,
      schema,
      {
        TreeID: merged.TreeID ?? current.TreeID,
        TreeTag: merged.TreeTag ?? current.TreeTag,
        CensusID: merged.CensusID ?? current.CensusID,
        StemTag: merged.StemTag ?? current.StemTag,
        QuadratID: resolvedQuadratID,
        StemLocalX: changedFields.has('StemLocalX') ? toOptionalNumber(newValues.StemLocalX) : toOptionalNumber(merged.StemLocalX),
        StemLocalY: changedFields.has('StemLocalY') ? toOptionalNumber(newValues.StemLocalY) : toOptionalNumber(merged.StemLocalY)
      },
      txID
    );
    if (existingStemGUID === null && !hasStateRow(beforeState, 'stems', resolvedStemGUID)) {
      beforeState.push(buildStateRow('stems', 'StemGUID', resolvedStemGUID, null));
    }

    if (resolvedStemGUID !== merged.StemGUID) {
      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.coremeasurements`, { StemGUID: resolvedStemGUID }, 'CoreMeasurementID', coreMeasurementID]),
        [],
        txID
      );
    }
    merged.StemGUID = resolvedStemGUID;

    // Recompute treestemstate — hard-failed rows never got this during
    // ingestion (they fail before Stage 4 classification), so corrected
    // rows would remain hidden in View Data without it.
    const resolvedTreeTag = String(merged.TreeTag ?? current.TreeTag ?? '');
    const resolvedStemTag = String(merged.StemTag ?? current.StemTag ?? '');
    const resolvedCensusID = toPositiveNumber(merged.CensusID ?? current.CensusID ?? censusID);
    const resolvedPlotID = toPositiveNumber(merged.PlotID ?? current.PlotID ?? plotID);

    if (resolvedTreeTag && resolvedStemTag && resolvedCensusID && resolvedPlotID) {
      const treeStemState = await computeTreeStemState(cm, schema, resolvedTreeTag, resolvedStemTag, resolvedCensusID, resolvedPlotID, txID);

      const existingUDFRows = await cm.executeQuery(
        safeFormatQuery(schema, `SELECT UserDefinedFields FROM ??.coremeasurements WHERE CoreMeasurementID = ?`),
        [coreMeasurementID],
        txID
      );
      const rawUDF = existingUDFRows?.[0]?.UserDefinedFields;
      const currentFields: Record<string, unknown> = rawUDF ? (typeof rawUDF === 'string' ? JSON.parse(rawUDF) : rawUDF) : {};
      currentFields.treestemstate = treeStemState;

      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [
          `${schema}.coremeasurements`,
          { UserDefinedFields: JSON.stringify(currentFields) },
          'CoreMeasurementID',
          coreMeasurementID
        ]),
        [],
        txID
      );
    }

    // Reload the joined snapshot so unchanged fields (StemLocalX/Y, QuadratName,
    // TreeTag, SpeciesCode, etc.) reflect the post-resolution stem rather than
    // the previous one. Overlay user-edited values back onto `merged` so the
    // downstream Raw* sync sees user input where the user changed something
    // and the new ground truth everywhere else.
    current = await loadCurrentJoinedRow(cm, schema, coreMeasurementID, txID);
    const mergedAsRecord = merged as unknown as Record<string, unknown>;
    const currentAsRecord = current as unknown as Record<string, unknown>;
    for (const field of Object.keys(currentAsRecord)) {
      if (!changedFields.has(field)) {
        mergedAsRecord[field] = currentAsRecord[field];
      }
    }
  }

  // --- StemLocalX / StemLocalY update: propagates to the shared stems row
  //     (affecting all measurements on that stem).
  if (changedFields.has('StemLocalX') || changedFields.has('StemLocalY')) {
    changesFound = true;
    // Only the edited axis is written — `stems` is shared with every other measurement on this stem.
    const stemLocalChanges: Record<string, number | null> = {};
    if (changedFields.has('StemLocalX')) stemLocalChanges.LocalX = toOptionalNumber(newValues.StemLocalX);
    if (changedFields.has('StemLocalY')) stemLocalChanges.LocalY = toOptionalNumber(newValues.StemLocalY);
    if (merged.StemGUID !== null && merged.StemGUID !== undefined) {
      await cm.executeQuery(format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, stemLocalChanges, 'StemGUID', merged.StemGUID]), [], txID);
    }
  }

  // --- StemPlotX / StemPlotY update: propagates to the shared stems row, and
  //     the Raw* sync below stamps RawPlotX/RawPlotY on this measurement so the
  //     COALESCE(cm.RawPlotX, s.PlotX) read model shows the edited value.
  if (changedFields.has('StemPlotX') || changedFields.has('StemPlotY')) {
    changesFound = true;
    const stemPlotChanges: Record<string, number | null> = {};
    if (changedFields.has('StemPlotX')) stemPlotChanges.PlotX = toOptionalNumber(newValues.StemPlotX);
    if (changedFields.has('StemPlotY')) stemPlotChanges.PlotY = toOptionalNumber(newValues.StemPlotY);
    if (merged.StemGUID !== null && merged.StemGUID !== undefined) {
      await cm.executeQuery(format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, stemPlotChanges, 'StemGUID', merged.StemGUID]), [], txID);
    }
  }

  // --- Numeric measurement fields on coremeasurements
  if (changedFields.has('MeasuredDBH') || changedFields.has('MeasuredHOM') || changedFields.has('MeasurementDate')) {
    changesFound = true;
    const measurementFieldChanges: Record<string, unknown> = {};
    if (changedFields.has('MeasuredDBH')) measurementFieldChanges.MeasuredDBH = toOptionalNumber(newValues.MeasuredDBH);
    if (changedFields.has('MeasuredHOM')) measurementFieldChanges.MeasuredHOM = toOptionalNumber(newValues.MeasuredHOM);
    if (changedFields.has('MeasurementDate')) measurementFieldChanges.MeasurementDate = normalizedMeasurementDate;
    await cm.executeQuery(
      format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.coremeasurements`, measurementFieldChanges, 'CoreMeasurementID', coreMeasurementID]),
      [],
      txID
    );
  }

  // --- Attributes change — rebuild cmattributes rows (DELETE + re-INSERT)
  if (changedFields.has('Attributes')) {
    changesFound = true;
    const parsedCodes = parseAttributeCodes(newValues.Attributes);
    await cm.executeQuery(safeFormatQuery(schema, `DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?`), [coreMeasurementID], txID);
    for (const code of parsedCodes) {
      await handleUpsert<CMAttributesResult>(
        cm,
        schema,
        'cmattributes',
        {
          CoreMeasurementID: coreMeasurementID,
          Code: code
        },
        'CMAID',
        txID
      );
    }
  }

  // --- Sync Raw* / measurement fields on coremeasurements whenever any
  //     user-visible editable field changed. Mirrors the legacy PATCH sync
  //     block so View Data and the failed-measurements explorer stay aligned.

  // For clearable fields we must distinguish "field was not changed — keep
  // current DB value" from "field was explicitly set to null — write NULL".
  // The ?? fallback used for identity fields (TreeTag etc.) conflates the two
  // cases, so clearable fields are routed through effective() instead.
  // Identity fields keep the ?? fallback because treestem rules reject identity
  // clears upstream — a null merged.TreeTag means the field was not changed.
  const effective = <K extends keyof LoadedCoreMeasurementRow>(field: K): LoadedCoreMeasurementRow[K] =>
    changedFields.has(field as string) ? (merged as LoadedCoreMeasurementRow)[field] : (current as LoadedCoreMeasurementRow)[field];

  // Assigns `key` only when `sourceField` is one of this edit's actual
  // changedFields — used below on the correction path so an unchanged raw
  // column is never rewritten with its own current (or a fabricated) value.
  const assignIfChanged = (target: Record<string, unknown>, sourceField: string, key: string, value: unknown): void => {
    if (changedFields.has(sourceField)) target[key] = value;
  };

  const shouldSyncRaw = Array.from(changedFields).some(f => RAW_SYNC_TRIGGER_FIELDS.has(f));
  if (shouldSyncRaw) {
    changesFound = true;
    const rawSyncValues: Record<string, unknown> = {};
    if (correctionWritePolicyActive) {
      // Sparse sync — only the fields the user actually edited. RawSpCode is
      // intentionally never written here: applyPreparedTreeSpeciesCorrection
      // below stamps the canonical species code on every attached member
      // (including this row).
      assignIfChanged(rawSyncValues, 'TreeTag', 'RawTreeTag', newValues.TreeTag ?? null);
      assignIfChanged(rawSyncValues, 'StemTag', 'RawStemTag', newValues.StemTag ?? null);
      assignIfChanged(rawSyncValues, 'QuadratName', 'RawQuadrat', newValues.QuadratName ?? null);
      assignIfChanged(rawSyncValues, 'StemLocalX', 'RawX', toOptionalNumber(newValues.StemLocalX));
      assignIfChanged(rawSyncValues, 'StemLocalY', 'RawY', toOptionalNumber(newValues.StemLocalY));
      assignIfChanged(rawSyncValues, 'Attributes', 'RawCodes', newValues.Attributes ?? null);
      assignIfChanged(rawSyncValues, 'Description', 'RawComments', newValues.Description ?? null);
      assignIfChanged(rawSyncValues, 'Description', 'Description', newValues.Description ?? null);
      assignIfChanged(rawSyncValues, 'MeasurementDate', 'MeasurementDate', normalizedMeasurementDate);
      assignIfChanged(rawSyncValues, 'MeasuredDBH', 'MeasuredDBH', toOptionalNumber(newValues.MeasuredDBH));
      assignIfChanged(rawSyncValues, 'MeasuredHOM', 'MeasuredHOM', toOptionalNumber(newValues.MeasuredHOM));
    } else {
      rawSyncValues.RawTreeTag = merged.TreeTag ?? current.TreeTag ?? null;
      rawSyncValues.RawStemTag = merged.StemTag ?? current.StemTag ?? null;
      rawSyncValues.RawSpCode = merged.SpeciesCode ?? current.SpeciesCode ?? null;
      rawSyncValues.RawQuadrat = merged.QuadratName ?? current.QuadratName ?? null;
      rawSyncValues.RawX = toOptionalNumber(effective('StemLocalX'));
      rawSyncValues.RawY = toOptionalNumber(effective('StemLocalY'));
      rawSyncValues.RawCodes = effective('Attributes') ?? null;
      rawSyncValues.RawComments = effective('Description') ?? null;
      rawSyncValues.Description = effective('Description') ?? null;
      rawSyncValues.MeasurementDate = normalizedMeasurementDate;
      rawSyncValues.MeasuredDBH = toOptionalNumber(effective('MeasuredDBH'));
      rawSyncValues.MeasuredHOM = toOptionalNumber(effective('MeasuredHOM'));
    }
    // RawPlotX/RawPlotY sync only on an actual plot-coordinate edit. The
    // loaded StemPlotX is COALESCE(cm.RawPlotX, s.PlotX), so unconditional
    // sync would stamp the stem's canonical value into a NULL raw column,
    // fabricating an "as uploaded" plot coordinate for a row whose file never
    // supplied one (and enrolling it in raw-axes-only validation 19).
    if (changedFields.has('StemPlotX')) rawSyncValues.RawPlotX = toOptionalNumber(newValues.StemPlotX);
    if (changedFields.has('StemPlotY')) rawSyncValues.RawPlotY = toOptionalNumber(newValues.StemPlotY);
    if (Object.keys(rawSyncValues).length > 0) {
      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.coremeasurements`, rawSyncValues, 'CoreMeasurementID', coreMeasurementID]),
        [],
        txID
      );
    }
  }

  // On the correction path the edited row's error state is owned by
  // `refreshCorrectionErrorsAndValidationPending` (called from
  // `applyPreparedTreeSpeciesCorrection` a few lines below, after all of
  // this writer's own local writes), which treats the target exactly like
  // every other attached member, retains history instead of hard-deleting
  // it, and resolves only occurrences a revalidation pass can genuinely
  // recompute.
  if (changesFound && !correctionWritePolicyActive) {
    const effectiveCensusID = Number(merged.CensusID ?? current.CensusID ?? censusID);

    if (coreMeasurementID > 0 && effectiveCensusID > 0) {
      await refreshIngestionErrorsForMeasurement(
        cm,
        schema,
        coreMeasurementID,
        effectiveCensusID,
        {
          Tag: merged.TreeTag ?? current.TreeTag ?? null,
          StemTag: merged.StemTag ?? current.StemTag ?? null,
          SpCode: merged.SpeciesCode ?? current.SpeciesCode ?? null,
          Quadrat: merged.QuadratName ?? current.QuadratName ?? null,
          X: toOptionalNumber(effective('StemLocalX')),
          Y: toOptionalNumber(effective('StemLocalY')),
          DBH: toOptionalNumber(effective('MeasuredDBH')),
          HOM: toOptionalNumber(effective('MeasuredHOM')),
          Date: normalizedMeasurementDate,
          Codes: effective('Attributes') ?? null,
          Comments: effective('Description') ?? null
        },
        txID
      );
    }

    const deleteErrorsQuery = format(
      `DELETE mel
       FROM ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation'`,
      [schema, schema]
    );
    await cm.executeQuery(deleteErrorsQuery, [coreMeasurementID], txID);

    const resetValidationQuery = format('/* skip_changelog */ UPDATE ?? SET ?? = ? WHERE ?? = ?', [
      `${schema}.coremeasurements`,
      'IsValidated',
      null,
      'CoreMeasurementID',
      coreMeasurementID
    ]);
    await cm.executeQuery(resetValidationQuery, [], txID);
  }

  // Applies the ALREADY-PREPARED (locked, drift-checked) correction result —
  // never re-plans — after the edited row's own Raw* sync and ingestion-error
  // refresh above, so the canonical species code (not the user's typed
  // spelling) ends up in RawSpCode. Sibling StateRows merge into this
  // writer's own before/afterState; the edited CM's rows are already owned
  // by the generic capture and are not duplicated. The undo `domainDiff`
  // below is built from real post-write snapshots — never a predicted
  // overlay.
  let siblingBeforeState: EditOperationStateRow[] = [];
  let siblingAfterState: EditOperationStateRow[] = [];
  let metadataBeforeState: EditOperationStateRow | null = null;
  let metadataAfterState: EditOperationStateRow | null = null;
  // Kept outside the `if` below so the view-refresh step further down can
  // read the correction's own verified member/error-refresh ids.
  let correctionResult: AppliedSpeciesCorrectionResult | null = null;
  if (correctionWritePolicyActive && preparedSpeciesCorrection) {
    correctionResult = await applyPreparedTreeSpeciesCorrection(cm, schema, preparedSpeciesCorrection, txID);
    siblingBeforeState = correctionResult.siblingBeforeState;
    siblingAfterState = correctionResult.siblingAfterState;
    beforeState.push(...siblingBeforeState);
  }

  // Capture after-state for exact-revert support. On the correction path
  // this is the FIRST point at which the edited row's post-write RawSpCode
  // (stamped by applyPreparedTreeSpeciesCorrection above) can be observed —
  // reading any earlier would corrupt the undo evidence built below.
  const afterCoreRow = await loadCoreMeasurementRow(cm, schema, coreMeasurementID, txID, { forUpdate: correctionWritePolicyActive });
  const afterStemGUID = (afterCoreRow?.StemGUID ?? null) as number | null;
  const afterStemRow = await loadStemRow(cm, schema, afterStemGUID, txID, { forUpdate: correctionWritePolicyActive });
  const afterTreeID = afterStemRow ? toPositiveNumber(afterStemRow.TreeID) : null;
  const afterTreeRow = await loadTreeRow(cm, schema, afterTreeID, txID, { forUpdate: correctionWritePolicyActive });
  const afterCmAttrRows = await loadCmAttributeRows(cm, schema, coreMeasurementID, txID, { forUpdate: correctionWritePolicyActive });

  if (correctionWritePolicyActive && correctionResult && preparedSpeciesCorrection) {
    const domainDiff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: beforeCoreRow,
      afterCoreMeasurement: afterCoreRow ?? {},
      beforeStem: beforeStemRow,
      afterStem: afterStemRow,
      attributeCodesBefore: beforeCmAttrRows.map(row => String(row.Code)),
      attributeCodesAfter: afterCmAttrRows.map(row => String(row.Code))
    });
    const metadataStateRows = buildSpeciesCorrectionMetadataStateRows(
      correctionResult.correction,
      preparedSpeciesCorrection.editedCoreMeasurementID,
      preparedSpeciesCorrection.editedStemGUID,
      domainDiff
    );
    metadataBeforeState = metadataStateRows.metadataBeforeState;
    metadataAfterState = metadataStateRows.metadataAfterState;
    beforeState.push(metadataBeforeState);
  }

  const afterState: EditOperationStateRow[] = [];
  afterState.push(buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, afterCoreRow));
  if (afterStemRow && afterStemGUID !== null) {
    afterState.push(buildStateRow('stems', 'StemGUID', afterStemGUID, afterStemRow));
  }
  if (afterTreeRow && afterTreeID !== null) {
    afterState.push(buildStateRow('trees', 'TreeID', afterTreeID, afterTreeRow));
  }
  if (changedFields.has('Attributes')) {
    for (const attrRow of afterCmAttrRows) {
      afterState.push(buildStateRow('cmattributes', 'CMAID', Number(attrRow.CMAID), attrRow));
    }
  }
  if (correctionWritePolicyActive && metadataAfterState) {
    afterState.push(...siblingAfterState, metadataAfterState);
  }

  // Must run AFTER the error-log mutations above (legacy block, or
  // `applyPreparedTreeSpeciesCorrection` on the correction path) — the
  // views' error-count join would otherwise read pre-mutation state.
  if (changesFound && input.refreshViews !== false) {
    const refreshCensusID = Number(merged.CensusID ?? current.CensusID ?? censusID);
    const refreshPlotID = Number(merged.PlotID ?? current.PlotID ?? plotID);
    if (refreshCensusID > 0 && refreshPlotID > 0) {
      const refreshTargets = await resolveMeasurementViewRefreshTargets(cm, schema, {
        coreMeasurementID,
        plotID: refreshPlotID,
        censusID: refreshCensusID,
        changedFields,
        beforeStemGUID: toPositiveNumber(beforeStemGUID),
        afterStemGUID: toPositiveNumber(afterStemGUID),
        transactionID: txID
      });

      if (refreshTargets.mode === 'targeted') {
        const affectedCoreMeasurementIDs = new Set<number>(refreshTargets.coreMeasurementIDs);
        if (correctionResult) {
          // The correction's own verified membership/error-refresh ids are
          // the complete set of OTHER rows it touched — never re-queried.
          for (const member of correctionResult.correction.measurements) affectedCoreMeasurementIDs.add(member.coreMeasurementID);
          for (const id of correctionResult.errorRefresh.ingestionRefreshedMeasurementIDs) affectedCoreMeasurementIDs.add(id);
          for (const id of correctionResult.errorRefresh.pendingMeasurementIDs) affectedCoreMeasurementIDs.add(id);
        }
        await refreshMeasurementViewsForCoreMeasurements(cm, schema, Array.from(affectedCoreMeasurementIDs), txID);
      } else {
        await refreshMeasurementViewsForScope(cm, schema, refreshPlotID, refreshCensusID, txID);
      }
    }
  }

  return {
    updatedIDs: { CoreMeasurementID: coreMeasurementID },
    beforeState,
    afterState,
    validationPending: true,
    postValidation: undefined
  };
}
