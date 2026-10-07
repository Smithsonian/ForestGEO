// Read-only current-state preflight for undoing a recorded tree-species
// correction. Runs inside the caller's already-open transaction/scope lock
// and never writes a row; `parseSpeciesCorrectionUndoMetadata` has already
// validated the stored marker's shape and before/after agreement.
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { EditOperationRecord } from '@/config/editoperations';
import { planSpeciesCorrection, SpeciesCorrectionPlanResult } from './tree-species-correction';
import type { SpeciesCorrectionMeasurementPrecondition, SpeciesCorrectionStemPrecondition, SpeciesCorrectionSummary } from './types';
import type { SpeciesCorrectionUndoMetadataPair } from './species-correction-undo-metadata';
import {
  SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS,
  SPECIES_CORRECTION_DIFF_STEMS_COLUMNS,
  type SpeciesCorrectionColumnChange,
  type SpeciesCorrectionDiffCoreMeasurementColumn,
  type SpeciesCorrectionDiffStemColumn,
  type SpeciesCorrectionMetadataMeasurement
} from './tree-species-correction-writer';
import { SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD, type SpeciesCorrectionDomainDiff } from './tree-species-correction-writer';
import type { UserAuthRoles } from '@/config/macros';
import type { EditPlan, Effect, FieldChange, Severity } from './types';
import { SEVERITY_RANK } from './types';
import { hashPlan } from './planhash';
import { isFieldEditableByRole } from './fieldpolicy';
import { RoleForbiddenFieldError } from './analyzer';

const COREMEASUREMENTS_TABLE = 'coremeasurements';
const STEMS_TABLE = 'stems';
const CMATTRIBUTES_TABLE = 'cmattributes';
const ATTRIBUTES_TABLE = 'attributes';

/**
 * Stored-precision kind for each allowlisted column this file re-compares
 * against the recorded afterState. Keyed by the UNION of both writer
 * allowlists so a future addition to either is a compile error here.
 */
type SpeciesCorrectionUndoColumnKind = 'decimal' | 'date' | 'text';

const SPECIES_CORRECTION_UNDO_STORED_COLUMN_KINDS: Record<
  SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn,
  SpeciesCorrectionUndoColumnKind
> = {
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

const STORED_DECIMAL_COMPARISON_SCALE = 6;
const CALENDAR_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}/;

// DECIMAL(12,6) stored precision: null is distinct from any value; a
// non-finite/unparseable side always counts as different, never equal.
function decimalColumnValuesDiffer(current: unknown, recorded: unknown): boolean {
  if (current === null || recorded === null) return current !== recorded;
  const currentNumber = typeof current === 'number' ? current : typeof current === 'string' ? Number(current) : NaN;
  const recordedNumber = typeof recorded === 'number' ? recorded : typeof recorded === 'string' ? Number(recorded) : NaN;
  if (!Number.isFinite(currentNumber) || !Number.isFinite(recordedNumber)) return true;
  return currentNumber.toFixed(STORED_DECIMAL_COMPARISON_SCALE) !== recordedNumber.toFixed(STORED_DECIMAL_COMPARISON_SCALE);
}

// mysql2 may return a Date instance or a 'YYYY-MM-DD...' string for the
// current side; the recorded side is always parsed JSON. Both are
// normalized to a calendar date before comparing.
function toCalendarDateString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const match = value.match(CALENDAR_DATE_PREFIX_PATTERN);
    if (!match || Number.isNaN(new Date(match[0]).getTime())) return null;
    return match[0];
  }
  return null;
}

function dateColumnValuesDiffer(current: unknown, recorded: unknown): boolean {
  if (current === null || recorded === null) return current !== recorded;
  const currentDate = toCalendarDateString(current);
  const recordedDate = toCalendarDateString(recorded);
  if (currentDate === null || recordedDate === null) return true;
  return currentDate !== recordedDate;
}

function storedColumnValueChanged(kind: SpeciesCorrectionUndoColumnKind, current: unknown, recorded: unknown): boolean {
  if (kind === 'decimal') return decimalColumnValuesDiffer(current, recorded);
  if (kind === 'date') return dateColumnValuesDiffer(current, recorded);
  return !Object.is(current, recorded);
}

export const SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE =
  "This correction can no longer be undone automatically because the affected tree's data changed after the correction was applied. Review the tree's current measurements and apply the needed change directly.";

export type SpeciesCorrectionUndoConflictKind =
  | 'tree-species'
  | 'tree-tag'
  | 'stem-membership'
  | 'measurement-membership'
  | 'raw-species-code'
  | 'changed-stored-field'
  | 'attribute-associations'
  | 'missing-attribute-reference'
  | 'destination-collision';

export interface SpeciesCorrectionUndoConflict {
  kind: SpeciesCorrectionUndoConflictKind;
  detail: string;
}

export class SpeciesCorrectionUndoUnapplicableError extends Error {
  constructor(
    public readonly editOperationID: number,
    public readonly reason: string
  ) {
    super(`SpeciesCorrectionUndoUnapplicableError: EditOperationID=${editOperationID}: ${reason}`);
    this.name = 'SpeciesCorrectionUndoUnapplicableError';
  }
}

export class SpeciesCorrectionUndoCurrentStateConflictError extends Error {
  constructor(
    public readonly editOperationID: number,
    public readonly conflicts: readonly SpeciesCorrectionUndoConflict[]
  ) {
    super(SPECIES_CORRECTION_UNDO_CONFLICT_GUIDANCE);
    this.name = 'SpeciesCorrectionUndoCurrentStateConflictError';
  }
}

export interface SpeciesCorrectionUndoPreflight {
  readonly editOperationID: number;
  readonly transactionID: string;
  readonly metadata: SpeciesCorrectionUndoMetadataPair;
  readonly reverseCorrection: SpeciesCorrectionSummary;
  readonly currentEditedCoreMeasurement: Readonly<Record<SpeciesCorrectionDiffCoreMeasurementColumn, unknown>>;
  readonly currentEditedStem: Readonly<Record<SpeciesCorrectionDiffStemColumn, unknown>> | null;
  readonly currentAttributeCodes: readonly string[];
}

type ReversePlanOutcome =
  | { kind: 'ok'; correction: SpeciesCorrectionSummary }
  | { kind: 'conflict'; conflict: SpeciesCorrectionUndoConflict }
  | { kind: 'unapplicable'; reason: string };

function assertNeverPlanResult(value: never): never {
  throw new Error(`preflightSpeciesCorrectionUndo: unhandled planSpeciesCorrection status (${JSON.stringify(value)})`);
}

function classifyReversePlanResult(result: SpeciesCorrectionPlanResult): ReversePlanOutcome {
  switch (result.status) {
    case 'ok':
      return { kind: 'ok', correction: result.correction };
    case 'destination_exists':
      return {
        kind: 'conflict',
        conflict: {
          kind: 'destination-collision',
          detail: `reverse target already exists as TreeID ${result.destinationTreeID} (isActive=${result.destinationIsActive})`
        }
      };
    case 'no_correction':
      return {
        kind: 'conflict',
        conflict: { kind: 'tree-species', detail: `tree is no longer on the corrected species; nothing left of this correction to reverse (${result.message})` }
      };
    case 'edited_measurement_moved':
      return {
        kind: 'conflict',
        conflict: {
          kind: 'measurement-membership',
          detail: `edited measurement ${result.coreMeasurementID} moved from stem ${result.expectedStemGUID} to stem ${result.actualStemGUID}`
        }
      };
    case 'source_missing':
    case 'source_inactive':
    case 'destination_species_missing':
    case 'destination_species_inactive':
    case 'scope_inconsistent':
    case 'source_identity_invalid':
    case 'destination_species_code_missing':
    case 'edited_stem_missing':
    case 'edited_stem_inactive':
    case 'edited_measurement_missing':
    case 'edited_measurement_inactive':
      return { kind: 'unapplicable', reason: `reverse replan returned "${result.status}": ${result.message}` };
    default:
      return assertNeverPlanResult(result);
  }
}

// Keyed by stemGUID, never array position.
function collectStemMembershipConflicts(
  current: readonly SpeciesCorrectionStemPrecondition[],
  recorded: readonly SpeciesCorrectionStemPrecondition[]
): SpeciesCorrectionUndoConflict[] {
  const conflicts: SpeciesCorrectionUndoConflict[] = [];
  const currentByGUID = new Map(current.map(stem => [stem.stemGUID, stem]));
  const recordedByGUID = new Map(recorded.map(stem => [stem.stemGUID, stem]));
  for (const [stemGUID, recordedStem] of recordedByGUID) {
    const currentStem = currentByGUID.get(stemGUID);
    if (!currentStem) {
      conflicts.push({ kind: 'stem-membership', detail: `recorded stem ${stemGUID} is no longer attached to the tree` });
    } else if (
      currentStem.censusID !== recordedStem.censusID ||
      currentStem.quadratID !== recordedStem.quadratID ||
      currentStem.isActive !== recordedStem.isActive
    ) {
      conflicts.push({
        kind: 'stem-membership',
        detail: `stem ${stemGUID} current (censusID=${currentStem.censusID}, quadratID=${currentStem.quadratID}, isActive=${currentStem.isActive}) differs from recorded afterState (censusID=${recordedStem.censusID}, quadratID=${recordedStem.quadratID}, isActive=${recordedStem.isActive})`
      });
    }
  }
  for (const stemGUID of currentByGUID.keys()) {
    if (!recordedByGUID.has(stemGUID))
      conflicts.push({ kind: 'stem-membership', detail: `stem ${stemGUID} is attached now but was not recorded in the undo's afterState membership` });
  }
  return conflicts;
}

// Keyed by coreMeasurementID.
function collectMeasurementMembershipConflicts(
  current: readonly SpeciesCorrectionMeasurementPrecondition[],
  recorded: readonly SpeciesCorrectionMetadataMeasurement[]
): SpeciesCorrectionUndoConflict[] {
  const conflicts: SpeciesCorrectionUndoConflict[] = [];
  const currentByID = new Map(current.map(m => [m.coreMeasurementID, m]));
  const recordedByID = new Map(recorded.map(m => [m.coreMeasurementID, m]));
  for (const [coreMeasurementID, recordedMeasurement] of recordedByID) {
    const currentMeasurement = currentByID.get(coreMeasurementID);
    if (!currentMeasurement) {
      conflicts.push({ kind: 'measurement-membership', detail: `recorded measurement ${coreMeasurementID} is no longer attached to the tree` });
    } else if (
      currentMeasurement.stemGUID !== recordedMeasurement.stemGUID ||
      currentMeasurement.censusID !== recordedMeasurement.censusID ||
      currentMeasurement.isActive !== recordedMeasurement.isActive
    ) {
      conflicts.push({
        kind: 'measurement-membership',
        detail: `measurement ${coreMeasurementID} current (stemGUID=${currentMeasurement.stemGUID}, censusID=${currentMeasurement.censusID}, isActive=${currentMeasurement.isActive}) differs from recorded afterState (stemGUID=${recordedMeasurement.stemGUID}, censusID=${recordedMeasurement.censusID}, isActive=${recordedMeasurement.isActive})`
      });
    }
  }
  for (const coreMeasurementID of currentByID.keys()) {
    if (!recordedByID.has(coreMeasurementID))
      conflicts.push({
        kind: 'measurement-membership',
        detail: `measurement ${coreMeasurementID} is attached now but was not recorded in the undo's afterState membership`
      });
  }
  return conflicts;
}

// Exact identity (Object.is), only for members present on both sides — a
// membership mismatch is already reported by the function above.
function collectRawSpCodeDriftConflicts(
  current: readonly SpeciesCorrectionMeasurementPrecondition[],
  recorded: readonly SpeciesCorrectionMetadataMeasurement[]
): SpeciesCorrectionUndoConflict[] {
  const conflicts: SpeciesCorrectionUndoConflict[] = [];
  const recordedByID = new Map(recorded.map(m => [m.coreMeasurementID, m]));
  for (const currentMeasurement of current) {
    const recordedMeasurement = recordedByID.get(currentMeasurement.coreMeasurementID);
    if (recordedMeasurement && !Object.is(currentMeasurement.priorRawSpCode, recordedMeasurement.rawSpCode)) {
      conflicts.push({
        kind: 'raw-species-code',
        detail: `measurement ${currentMeasurement.coreMeasurementID} current RawSpCode ${JSON.stringify(currentMeasurement.priorRawSpCode)} does not match recorded afterState RawSpCode ${JSON.stringify(recordedMeasurement.rawSpCode)}`
      });
    }
  }
  return conflicts;
}

// Only columns the original correction actually declared in domainDiff;
// every other column is ignored entirely. Compares at STORED precision
// (SPECIES_CORRECTION_UNDO_STORED_COLUMN_KINDS), not UI display precision.
function collectChangedStoredFieldConflicts<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  currentRow: Record<string, unknown>,
  tableName: string,
  primaryKeyValue: number
): SpeciesCorrectionUndoConflict[] {
  const conflicts: SpeciesCorrectionUndoConflict[] = [];
  for (const column of Object.keys(changes) as TColumn[]) {
    const change = changes[column];
    if (!change) continue;
    const kind = SPECIES_CORRECTION_UNDO_STORED_COLUMN_KINDS[column];
    const currentValue = currentRow[column];
    if (storedColumnValueChanged(kind, currentValue, change.after)) {
      conflicts.push({
        kind: 'changed-stored-field',
        detail: `${tableName} pk=${primaryKeyValue} column "${column}" current value ${JSON.stringify(currentValue)} does not match recorded afterState value ${JSON.stringify(change.after)}`
      });
    }
  }
  return conflicts;
}

function areAttributeCodeSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((code, index) => code === sortedB[index]);
}

export async function preflightSpeciesCorrectionUndo(
  cm: ConnectionManager,
  schema: string,
  record: EditOperationRecord,
  metadata: SpeciesCorrectionUndoMetadataPair,
  transactionID: string
): Promise<SpeciesCorrectionUndoPreflight> {
  const editOperationID = record.editOperationID;

  // Reverse replan: current whole-tree membership, current taxonomy, and
  // the destination-collision check in one call.
  const reversePlanResult = await planSpeciesCorrection(
    cm,
    schema,
    {
      treeID: metadata.after.targetTreeID,
      plotID: metadata.after.plotID,
      censusID: metadata.after.censusID,
      newSpeciesID: metadata.before.speciesID,
      editedStemGUID: metadata.after.editedStemGUID,
      editedCoreMeasurementID: metadata.after.editedCoreMeasurementID
    },
    transactionID,
    { forUpdate: true }
  );

  const outcome = classifyReversePlanResult(reversePlanResult);
  if (outcome.kind === 'unapplicable') {
    throw new SpeciesCorrectionUndoUnapplicableError(editOperationID, outcome.reason);
  }
  if (outcome.kind === 'conflict') {
    throw new SpeciesCorrectionUndoCurrentStateConflictError(editOperationID, [outcome.conflict]);
  }
  const reverseCorrection = outcome.correction;

  // The reverse destination taxon (metadata.before) must match BOTH ID and
  // canonical code: a later rename of that taxon would otherwise restore
  // per-member RawSpCode strings that no longer match it. This is refused
  // as unapplicable, not a drift conflict, since no later edit caused it.
  if (reverseCorrection.newSpeciesID !== metadata.before.speciesID || reverseCorrection.newSpeciesCode !== metadata.before.speciesCode) {
    throw new SpeciesCorrectionUndoUnapplicableError(
      editOperationID,
      `reverse destination species (ID=${reverseCorrection.newSpeciesID}, code=${JSON.stringify(reverseCorrection.newSpeciesCode)}) no longer matches the recorded beforeState species (ID=${metadata.before.speciesID}, code=${JSON.stringify(metadata.before.speciesCode)}) on tree ${metadata.after.targetTreeID}`
    );
  }

  const conflicts: SpeciesCorrectionUndoConflict[] = [];

  // Current species (recorded afterState) identity.
  if (reverseCorrection.oldSpeciesID !== metadata.after.speciesID || reverseCorrection.oldSpeciesCode !== metadata.after.speciesCode) {
    conflicts.push({
      kind: 'tree-species',
      detail: `current species (ID=${reverseCorrection.oldSpeciesID}, code=${JSON.stringify(reverseCorrection.oldSpeciesCode)}) does not match the recorded afterState species (ID=${metadata.after.speciesID}, code=${JSON.stringify(metadata.after.speciesCode)}) on tree ${metadata.after.targetTreeID}`
    });
  }

  if (reverseCorrection.treeTag !== metadata.after.treeTag) {
    conflicts.push({
      kind: 'tree-tag',
      detail: `tree ${metadata.after.targetTreeID} current TreeTag ${JSON.stringify(reverseCorrection.treeTag)} does not match recorded afterState TreeTag ${JSON.stringify(metadata.after.treeTag)}`
    });
  }

  conflicts.push(...collectStemMembershipConflicts(reverseCorrection.stems, metadata.after.stems));
  conflicts.push(...collectMeasurementMembershipConflicts(reverseCorrection.measurements, metadata.after.measurements));
  conflicts.push(...collectRawSpCodeDriftConflicts(reverseCorrection.measurements, metadata.after.measurements));

  // Read the edited rows BY PRIMARY KEY with a fixed, hardcoded column
  // list (never metadata-derived), FOR UPDATE since this transaction is
  // about to write these rows.
  const domainDiff = metadata.after.domainDiff;

  const coreMeasurementQueryResult = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT ${SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS.join(', ')}
       FROM ??.${COREMEASUREMENTS_TABLE}
       WHERE CoreMeasurementID = ?
       LIMIT 1
       FOR UPDATE`
    ),
    [metadata.after.editedCoreMeasurementID],
    transactionID
  );
  const coreMeasurementRows: Array<Record<string, unknown>> = Array.isArray(coreMeasurementQueryResult) ? coreMeasurementQueryResult : [];

  if (coreMeasurementRows.length === 0) {
    throw new SpeciesCorrectionUndoUnapplicableError(
      editOperationID,
      `coremeasurements row for pk=${metadata.after.editedCoreMeasurementID} (the edited measurement) no longer exists`
    );
  }
  const coreMeasurementRow = coreMeasurementRows[0];
  conflicts.push(
    ...collectChangedStoredFieldConflicts(domainDiff.coremeasurements, coreMeasurementRow, COREMEASUREMENTS_TABLE, metadata.after.editedCoreMeasurementID)
  );

  const stemQueryResult = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT ${SPECIES_CORRECTION_DIFF_STEMS_COLUMNS.join(', ')}
       FROM ??.${STEMS_TABLE}
       WHERE StemGUID = ?
       LIMIT 1
       FOR UPDATE`
    ),
    [metadata.after.editedStemGUID],
    transactionID
  );
  const stemRows: Array<Record<string, unknown>> = Array.isArray(stemQueryResult) ? stemQueryResult : [];

  let stemRow: Record<string, unknown> | null = null;
  if (stemRows.length === 0) {
    const stemColumnsDeclared = Object.keys(domainDiff.stems).length > 0;
    if (stemColumnsDeclared) {
      throw new SpeciesCorrectionUndoUnapplicableError(
        editOperationID,
        `stems row for pk=${metadata.after.editedStemGUID} (the edited stem) no longer exists, but domainDiff.stems declares column(s) to restore on it`
      );
    }
  } else {
    stemRow = stemRows[0];
    conflicts.push(...collectChangedStoredFieldConflicts(domainDiff.stems, stemRow, STEMS_TABLE, metadata.after.editedStemGUID));
  }

  // Semantic Code column (never CMAID). FOR UPDATE, without DISTINCT (which
  // would make the locking scope ambiguous) — dedupe/sort in JS instead.
  const attributeQueryResult = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT Code FROM ??.${CMATTRIBUTES_TABLE} WHERE CoreMeasurementID = ? FOR UPDATE`),
    [metadata.after.editedCoreMeasurementID],
    transactionID
  );
  const attributeRows: Array<{ Code: string | null }> = Array.isArray(attributeQueryResult) ? attributeQueryResult : [];
  const currentAttributeCodes = Array.from(new Set(attributeRows.map(row => row.Code).filter((code): code is string => code !== null))).sort();

  const attributeCodesChanged = !areAttributeCodeSetsEqual(domainDiff.attributeCodes.before, domainDiff.attributeCodes.after);
  if (attributeCodesChanged) {
    const recordedAfterSorted = [...domainDiff.attributeCodes.after].sort();
    if (!areAttributeCodeSetsEqual(currentAttributeCodes, recordedAfterSorted)) {
      conflicts.push({
        kind: 'attribute-associations',
        detail: `measurement ${metadata.after.editedCoreMeasurementID} current attribute codes [${currentAttributeCodes.join(', ')}] do not match recorded afterState attribute codes [${recordedAfterSorted.join(', ')}]`
      });
    }

    const codesToRestore = domainDiff.attributeCodes.before;
    if (codesToRestore.length > 0) {
      const placeholders = codesToRestore.map(() => '?').join(', ');
      const activeAttributeQueryResult = await cm.executeQuery(
        safeFormatQuery(schema, `SELECT Code FROM ??.${ATTRIBUTES_TABLE} WHERE Code IN (${placeholders}) AND IsActive = 1 FOR UPDATE`),
        [...codesToRestore],
        transactionID
      );
      const activeAttributeRows: Array<{ Code: string }> = Array.isArray(activeAttributeQueryResult) ? activeAttributeQueryResult : [];
      const activeCodes = new Set(activeAttributeRows.map(row => row.Code));
      const missingCodes = codesToRestore.filter(code => !activeCodes.has(code));
      if (missingCodes.length > 0) {
        conflicts.push({
          kind: 'missing-attribute-reference',
          detail: `attribute code(s) [${missingCodes.join(', ')}] required to restore measurement ${metadata.after.editedCoreMeasurementID}'s prior attributes are missing or inactive`
        });
      }
    }
  }

  if (conflicts.length > 0) {
    throw new SpeciesCorrectionUndoCurrentStateConflictError(editOperationID, conflicts);
  }

  return {
    editOperationID,
    transactionID,
    metadata,
    reverseCorrection,
    currentEditedCoreMeasurement: coreMeasurementRow as Readonly<Record<SpeciesCorrectionDiffCoreMeasurementColumn, unknown>>,
    currentEditedStem: stemRow as Readonly<Record<SpeciesCorrectionDiffStemColumn, unknown>> | null,
    currentAttributeCodes
  };
}

// --- Reverse-correction preview plan ----------------------------------

// One logical UI field per stored column. `RawComments` self-mirrors
// `Description` (both coremeasurements columns, kept in sync by the
// generic writer); `RawCodes` is the stored column behind `Attributes`.
// Every other column already has a comparison-field mapping above.
function logicalFieldForStoredColumn(column: SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn): string {
  if (column === 'RawComments') return 'Description';
  if (column === 'RawCodes') return 'Attributes';
  return SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD[column] ?? column;
}

// When two stored columns mirror one logical field (e.g. RawX/LocalX), the
// non-"Raw"-prefixed canonical column wins as the single displayed
// FieldChange; both columns are still restored in full via
// restoredCoreMeasurementColumns/restoredStemColumns regardless.
function columnRestorePriority(column: string): number {
  return column.startsWith('Raw') ? 1 : 0;
}

interface ColumnRestoreCandidate {
  column: string;
  currentValue: unknown;
  restoreValue: unknown;
  kind: SpeciesCorrectionUndoColumnKind;
}

function collectColumnRestoreCandidates<TColumn extends SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn>(
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>,
  currentRow: Readonly<Record<TColumn, unknown>> | null
): ColumnRestoreCandidate[] {
  if (!currentRow) return [];
  const candidates: ColumnRestoreCandidate[] = [];
  for (const column of Object.keys(changes) as TColumn[]) {
    const change = changes[column];
    if (!change) continue;
    candidates.push({
      column,
      currentValue: currentRow[column],
      restoreValue: change.before,
      kind: SPECIES_CORRECTION_UNDO_STORED_COLUMN_KINDS[column]
    });
  }
  return candidates;
}

// Every allowlisted column the original correction actually changed, with
// the exact value to write back — independent of the deduped FieldChange
// display list above (both mirror columns in a pair are restored here).
function buildColumnRestorations<TColumn extends string>(
  changes: Partial<Record<TColumn, SpeciesCorrectionColumnChange>>
): Array<{ column: string; value: unknown }> {
  return (Object.keys(changes) as TColumn[]).map(column => ({ column, value: changes[column]!.before })).sort((a, b) => a.column.localeCompare(b.column));
}

function roleOrUnknown(role: UserAuthRoles | undefined): UserAuthRoles | 'unknown' {
  return role ?? 'unknown';
}

const SPECIES_CORRECTION_UNDO_EFFECT_SPECIES_ID = 'SpeciesCorrectionUndoSpecies';
const SPECIES_CORRECTION_UNDO_EFFECT_IMPACT_ID = 'SpeciesCorrectionUndoImpact';
const SPECIES_CORRECTION_UNDO_EFFECT_LOCAL_ID = 'SpeciesCorrectionUndoLocalRestore';

/**
 * Pure, DB-free: builds the researcher-facing preview `EditPlan` for
 * reversing a recorded tree-species correction, from an already-verified
 * `preflight`. Mirrors `rules/species.ts`'s forward preview conventions
 * (effect wording, references, `speciesCorrection` population) and
 * `analyzer.ts`'s plan assembly (`maxSeverity`, `generatedAt`, `planHash`).
 * Throws `RoleForbiddenFieldError` — never silently drops a field — when
 * `role` cannot edit every logical field this undo would change, the
 * species field included.
 */
export function buildSpeciesCorrectionUndoPlan(preflight: SpeciesCorrectionUndoPreflight, role: UserAuthRoles | undefined): EditPlan {
  const { metadata, reverseCorrection, currentEditedCoreMeasurement, currentEditedStem } = preflight;
  const domainDiff: SpeciesCorrectionDomainDiff = metadata.after.domainDiff;

  const coreCandidates = collectColumnRestoreCandidates(domainDiff.coremeasurements, currentEditedCoreMeasurement);
  const stemCandidates = collectColumnRestoreCandidates(domainDiff.stems, currentEditedStem);

  const winnerByField = new Map<string, ColumnRestoreCandidate>();
  for (const candidate of [...coreCandidates, ...stemCandidates]) {
    const field = logicalFieldForStoredColumn(candidate.column as SpeciesCorrectionDiffCoreMeasurementColumn | SpeciesCorrectionDiffStemColumn);
    const existing = winnerByField.get(field);
    if (!existing || columnRestorePriority(candidate.column) < columnRestorePriority(existing.column)) {
      winnerByField.set(field, candidate);
    }
  }

  const fieldChanges: FieldChange[] = [{ field: 'SpeciesCode', from: reverseCorrection.oldSpeciesCode, to: reverseCorrection.newSpeciesCode }];
  for (const [field, candidate] of winnerByField) {
    if (storedColumnValueChanged(candidate.kind, candidate.currentValue, candidate.restoreValue)) {
      fieldChanges.push({ field, from: candidate.currentValue, to: candidate.restoreValue });
    }
  }

  const forbiddenFields = Array.from(new Set(fieldChanges.map(change => change.field))).filter(field => !isFieldEditableByRole(field, role));
  if (forbiddenFields.length > 0) {
    throw new RoleForbiddenFieldError(forbiddenFields, roleOrUnknown(role));
  }

  const restoredCoreMeasurementColumns = buildColumnRestorations(domainDiff.coremeasurements);
  const restoredStemColumns = buildColumnRestorations(domainDiff.stems);
  const attributeCodesChanged = !areAttributeCodeSetsEqual(domainDiff.attributeCodes.before, domainDiff.attributeCodes.after);
  const restoredAttributeCodes = attributeCodesChanged ? [...domainDiff.attributeCodes.before].sort() : null;

  const restoredMemberRawSpCodes = [...metadata.before.measurements]
    .sort((a, b) => a.coreMeasurementID - b.coreMeasurementID)
    .map(member => ({ coreMeasurementID: member.coreMeasurementID, rawSpCode: member.rawSpCode }));

  const totalStems = reverseCorrection.activeStemCount + reverseCorrection.inactiveStemCount;
  const totalMeasurements = reverseCorrection.activeMeasurementCount + reverseCorrection.inactiveMeasurementCount;

  const speciesEffect: Effect = {
    id: SPECIES_CORRECTION_UNDO_EFFECT_SPECIES_ID,
    severity: 'warn',
    category: 'identity',
    title: 'Tree species correction will be undone',
    detail: `Tree T#${reverseCorrection.targetTreeID} (TreeTag "${reverseCorrection.treeTag}") species will revert from "${reverseCorrection.oldSpeciesCode}" back to "${reverseCorrection.newSpeciesCode}".`,
    affectedTable: 'trees',
    affectedRowCount: 1,
    references: {
      treeIDs: [reverseCorrection.targetTreeID],
      speciesID: reverseCorrection.newSpeciesID,
      coreMeasurementIDs: reverseCorrection.measurements.map(measurement => measurement.coreMeasurementID),
      stemGUIDs: reverseCorrection.stems.map(stem => stem.stemGUID)
    }
  };

  const impactEffect: Effect = {
    id: SPECIES_CORRECTION_UNDO_EFFECT_IMPACT_ID,
    severity: 'warn',
    category: 'cross-row',
    title: 'Every stem and measurement on this tree will show the original species again',
    detail:
      `${totalStems} stem(s) (${reverseCorrection.activeStemCount} active, ${reverseCorrection.inactiveStemCount} inactive) and ` +
      `${totalMeasurements} measurement(s) (${reverseCorrection.activeMeasurementCount} active, ${reverseCorrection.inactiveMeasurementCount} inactive) ` +
      `on this tree will return to the original species.`,
    affectedTable: 'coremeasurements',
    affectedRowCount: totalMeasurements,
    references: {
      treeIDs: [reverseCorrection.targetTreeID],
      coreMeasurementIDs: reverseCorrection.measurements.map(measurement => measurement.coreMeasurementID),
      stemGUIDs: reverseCorrection.stems.map(stem => stem.stemGUID)
    }
  };

  const effects: Effect[] = [speciesEffect, impactEffect];

  const localRestorationClauses: string[] = [];
  if (restoredCoreMeasurementColumns.length > 0) localRestorationClauses.push('its own recorded measurement details');
  if (restoredStemColumns.length > 0) localRestorationClauses.push("its stem's recorded location");
  if (restoredAttributeCodes !== null) localRestorationClauses.push('its attribute associations');

  if (localRestorationClauses.length > 0) {
    effects.push({
      id: SPECIES_CORRECTION_UNDO_EFFECT_LOCAL_ID,
      severity: 'warn',
      category: 'field',
      title: "The edited measurement's own recorded values will be restored",
      detail: `For the measurement that was originally edited, ${localRestorationClauses.join(', ')} will be restored to the values recorded before the correction.`,
      affectedTable: 'coremeasurements',
      affectedRowCount: 1,
      references: {
        treeIDs: [metadata.after.targetTreeID],
        coreMeasurementIDs: [metadata.after.editedCoreMeasurementID],
        stemGUIDs: [metadata.after.editedStemGUID]
      }
    });
  }

  const maxSeverity = effects.reduce<Severity>((max, effect) => (SEVERITY_RANK[effect.severity] > SEVERITY_RANK[max] ? effect.severity : max), 'info');

  const plan: EditPlan = {
    dataType: 'measurementssummary',
    targetID: metadata.after.editedCoreMeasurementID,
    fieldChanges,
    effects,
    canApply: true,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString(),
    speciesCorrection: reverseCorrection,
    speciesCorrectionUndo: {
      version: 1,
      targetTreeID: metadata.after.targetTreeID,
      restoredSpeciesID: metadata.before.speciesID,
      restoredSpeciesCode: metadata.before.speciesCode,
      replacedSpeciesID: metadata.after.speciesID,
      replacedSpeciesCode: metadata.after.speciesCode,
      restoredMemberRawSpCodes,
      restoredCoreMeasurementColumns,
      restoredStemColumns,
      restoredAttributeCodes
    }
  };
  plan.planHash = hashPlan(plan);
  return plan;
}
