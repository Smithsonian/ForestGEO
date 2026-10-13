// Applies a previewed tree-wide species correction inside the caller's transaction and scope lock;
// it never manages the transaction and never creates a tree or stem.
//
// The preview may be stale (a REPEATABLE READ snapshot taken before any lock, or a real race), so the
// plan is re-run with `forUpdate: true` and any difference from the preview is refused as a conflict.
// Prepare and apply are split so the caller can prepare before its own first write and apply after it
// without the apply step misreading that write as drift.
import ConnectionManager from '@/lib/db/connectionmanager';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { EditOperationStateRow } from '@/config/editoperations';
import { reconcileIngestionErrorsForMeasurement, VALIDATION_ERROR_SOURCE, INGESTION_STAGE_ERROR_CODES } from '@/config/measurementerrors';
import { planSpeciesCorrection, SpeciesCorrectionPlanResult } from './tree-species-correction';
import { FieldChange, SpeciesCorrectionSummary, SpeciesCorrectionStemPrecondition } from './types';
import { TARGET_TEXT_COLLATION } from '@/lib/db/schema-contract';
import { fieldChanged, fieldChangedAtStoredPrecision } from './storedfieldcomparison';

export const SPECIES_CORRECTION_METADATA_TABLE = 'species_correction_metadata';
export const SPECIES_CORRECTION_METADATA_VERSION = 1 as const;

/**
 * `unique-constraint` is the one expected race on the trees UPDATE (ER_DUP_ENTRY); no other SQL error
 * is reinterpreted. A `replan` of `no_correction` means the reviewed correction has since vanished.
 */
export type SpeciesCorrectionWriteConflictReason =
  | { kind: 'replan'; result: Exclude<SpeciesCorrectionPlanResult, { status: 'ok' }> }
  | { kind: 'drift'; message: string }
  | { kind: 'unique-constraint'; message: string };

// The conflict reason carries SQL/plan internals in its `message`; API routes
// return only this fixed code and message to the client.
export const SPECIES_CORRECTION_CONFLICT_CODE = 'species-correction-conflict';
export const SPECIES_CORRECTION_CONFLICT_MESSAGE =
  "This tree's species state changed since this edit was previewed. Refresh and preview the edit again before applying.";

export class SpeciesCorrectionWriteConflictError extends Error {
  constructor(public readonly reason: SpeciesCorrectionWriteConflictReason) {
    super(SpeciesCorrectionWriteConflictError.describe(reason));
    this.name = 'SpeciesCorrectionWriteConflictError';
  }

  private static describe(reason: SpeciesCorrectionWriteConflictReason): string {
    if (reason.kind === 'replan') {
      return `writeTreeSpeciesCorrection: locked replan returned "${reason.result.status}" — ${reason.result.message}`;
    }
    return `writeTreeSpeciesCorrection: ${reason.message}`;
  }
}

export interface SpeciesCorrectionMetadataMeasurement {
  coreMeasurementID: number;
  stemGUID: number;
  censusID: number;
  isActive: boolean;
  /** NULL and differing spellings are preserved, never fabricated. */
  rawSpCode: string | null;
}

/** Undo-restore allowlist. Derived/bookkeeping columns (IsValidated, timestamps) must never be added. */
export const SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS = [
  'MeasuredDBH',
  'MeasuredHOM',
  'MeasurementDate',
  'Description',
  'RawComments',
  'RawCodes',
  'RawX',
  'RawY',
  'RawPlotX',
  'RawPlotY'
] as const;
export const SPECIES_CORRECTION_DIFF_STEMS_COLUMNS = ['LocalX', 'LocalY', 'PlotX', 'PlotY'] as const;

export type SpeciesCorrectionDiffCoreMeasurementColumn = (typeof SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS)[number];
export type SpeciesCorrectionDiffStemColumn = (typeof SPECIES_CORRECTION_DIFF_STEMS_COLUMNS)[number];

/** Maps stored column names to the plan field whose decimal/date comparison applies; unmapped columns compare as text. */
export const SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD: Readonly<Record<string, string>> = {
  RawX: 'StemLocalX',
  LocalX: 'StemLocalX',
  RawY: 'StemLocalY',
  LocalY: 'StemLocalY',
  RawPlotX: 'StemPlotX',
  PlotX: 'StemPlotX',
  RawPlotY: 'StemPlotY',
  PlotY: 'StemPlotY',
  MeasuredDBH: 'MeasuredDBH',
  MeasuredHOM: 'MeasuredHOM',
  MeasurementDate: 'MeasurementDate'
};

/** NULL is preserved verbatim so an undo can restore a raw NULL exactly. */
export interface SpeciesCorrectionColumnChange {
  before: unknown;
  after: unknown;
}

/**
 * Lists only allowlisted columns whose stored value changed. `attributeCodes` is always present:
 * an empty array means no attributes, while a missing value is malformed evidence.
 */
export interface SpeciesCorrectionDomainDiff {
  coremeasurements: Partial<Record<SpeciesCorrectionDiffCoreMeasurementColumn, SpeciesCorrectionColumnChange>>;
  stems: Partial<Record<SpeciesCorrectionDiffStemColumn, SpeciesCorrectionColumnChange>>;
  attributeCodes: { before: string[]; after: string[] };
}

export const EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF: SpeciesCorrectionDomainDiff = {
  coremeasurements: {},
  stems: {},
  attributeCodes: { before: [], after: [] }
};

export interface SpeciesCorrectionDomainDiffInput {
  beforeCoreMeasurement: Record<string, unknown>;
  afterCoreMeasurement: Record<string, unknown>;
  beforeStem: Record<string, unknown> | null;
  afterStem: Record<string, unknown> | null;
  attributeCodesBefore: readonly string[];
  attributeCodesAfter: readonly string[];
}

/** Callers must pass real locked DB snapshots, not requested write values, so MySQL-rounded values are reported. */
export function buildSpeciesCorrectionDomainDiff(input: SpeciesCorrectionDomainDiffInput): SpeciesCorrectionDomainDiff {
  const coremeasurements: SpeciesCorrectionDomainDiff['coremeasurements'] = {};
  for (const column of SPECIES_CORRECTION_DIFF_COREMEASUREMENTS_COLUMNS) {
    const before = input.beforeCoreMeasurement[column];
    const after = input.afterCoreMeasurement[column];
    const comparisonField = SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD[column] ?? column;
    if (fieldChanged(comparisonField, before, after)) {
      coremeasurements[column] = { before, after };
    }
  }

  const stems: SpeciesCorrectionDomainDiff['stems'] = {};
  if (input.beforeStem && input.afterStem) {
    for (const column of SPECIES_CORRECTION_DIFF_STEMS_COLUMNS) {
      const before = input.beforeStem[column];
      const after = input.afterStem[column];
      const comparisonField = SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD[column] ?? column;
      if (fieldChanged(comparisonField, before, after)) {
        stems[column] = { before, after };
      }
    }
  }

  return {
    coremeasurements,
    stems,
    attributeCodes: { before: [...input.attributeCodesBefore], after: [...input.attributeCodesAfter] }
  };
}

/** Versioned correction record stored on both before- and after-state, keyed by the corrected TreeID. */
export interface SpeciesCorrectionMetadata {
  version: typeof SPECIES_CORRECTION_METADATA_VERSION;
  operation: 'tree-species-correction';
  targetTreeID: number;
  treeTag: string;
  plotID: number;
  censusID: number;
  speciesID: number;
  speciesCode: string;
  stems: SpeciesCorrectionStemPrecondition[];
  measurements: SpeciesCorrectionMetadataMeasurement[];
  editedCoreMeasurementID: number;
  editedStemGUID: number;
  domainDiff: SpeciesCorrectionDomainDiff;
}

export interface SpeciesCorrectionPrepareInput {
  /** Used only for the drift comparison; every write uses the locked, re-verified values. */
  previewedCorrection: SpeciesCorrectionSummary;
  editedCoreMeasurementID: number;
  editedStemGUID: number;
}

export interface WriteTreeSpeciesCorrectionInput extends SpeciesCorrectionPrepareInput {
  /** Pass EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF when there is no accompanying field edit. */
  domainDiff: SpeciesCorrectionDomainDiff;
}

/**
 * Carries no metadata rows: the caller builds them from real post-write snapshots so the
 * domainDiff observes, rather than predicts, the after-state.
 */
export interface AppliedSpeciesCorrectionResult {
  correction: SpeciesCorrectionSummary;
  /** Every OTHER member's coremeasurements rows; the edited row's state is captured by the generic writer. */
  siblingBeforeState: EditOperationStateRow[];
  siblingAfterState: EditOperationStateRow[];
  errorRefresh: CorrectionErrorRefreshResult;
}

export type WriteTreeSpeciesCorrectionResult = AppliedSpeciesCorrectionResult & {
  metadataBeforeState: EditOperationStateRow;
  metadataAfterState: EditOperationStateRow;
};

/** Produced by prepare and consumed by apply in the same transaction; never built from request input. */
export interface PreparedSpeciesCorrection {
  readonly transactionID: string;
  readonly editedCoreMeasurementID: number;
  readonly editedStemGUID: number;
  readonly correction: SpeciesCorrectionSummary;
  readonly siblingBeforeState: EditOperationStateRow[];
}

export class SpeciesCorrectionTransactionMismatchError extends Error {
  constructor(
    public readonly preparedTransactionID: string,
    public readonly applyTransactionID: string
  ) {
    super(
      `applyPreparedTreeSpeciesCorrection: prepared correction was captured under transaction "${preparedTransactionID}" but is being applied under transaction "${applyTransactionID}"; a locked preparation can only be applied inside the exact transaction that captured it.`
    );
    this.name = 'SpeciesCorrectionTransactionMismatchError';
  }
}

const ER_DUP_ENTRY_ERRNO = 1062;

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === 'ER_DUP_ENTRY' || candidate.errno === ER_DUP_ENTRY_ERRNO;
}

/**
 * Position-wise comparison is exact because the planner returns stems/measurements sorted by ID.
 * priorRawSpCode is compared too: a concurrent change would bake a wrong undo value into the metadata.
 */
function findSpeciesCorrectionDrift(previewed: SpeciesCorrectionSummary, verified: SpeciesCorrectionSummary): string | null {
  const scalarFields: Array<keyof SpeciesCorrectionSummary> = [
    'targetTreeID',
    'treeTag',
    'plotID',
    'censusID',
    'oldSpeciesID',
    'oldSpeciesCode',
    'newSpeciesID',
    'newSpeciesCode',
    'activeStemCount',
    'inactiveStemCount',
    'activeMeasurementCount',
    'inactiveMeasurementCount'
  ];
  for (const field of scalarFields) {
    if (previewed[field] !== verified[field]) {
      return `previewed ${field} (${String(previewed[field])}) no longer matches the locked current value (${String(verified[field])}); refusing to apply against a stale preview`;
    }
  }

  if (previewed.stems.length !== verified.stems.length) {
    return `previewed stem membership (${previewed.stems.length}) no longer matches the locked current membership (${verified.stems.length}); refusing to apply against a stale preview`;
  }
  for (let i = 0; i < previewed.stems.length; i++) {
    const before = previewed.stems[i];
    const after = verified.stems[i];
    if (
      before.stemGUID !== after.stemGUID ||
      before.censusID !== after.censusID ||
      before.quadratID !== after.quadratID ||
      before.isActive !== after.isActive
    ) {
      return `previewed stem ${before.stemGUID} no longer matches its locked current link/scope/activity; refusing to apply against a stale preview`;
    }
  }

  if (previewed.measurements.length !== verified.measurements.length) {
    return `previewed measurement membership (${previewed.measurements.length}) no longer matches the locked current membership (${verified.measurements.length}); refusing to apply against a stale preview`;
  }
  for (let i = 0; i < previewed.measurements.length; i++) {
    const before = previewed.measurements[i];
    const after = verified.measurements[i];
    if (
      before.coreMeasurementID !== after.coreMeasurementID ||
      before.stemGUID !== after.stemGUID ||
      before.censusID !== after.censusID ||
      before.isActive !== after.isActive ||
      before.priorRawSpCode !== after.priorRawSpCode
    ) {
      return `previewed measurement ${before.coreMeasurementID} no longer matches its locked current link/scope/activity/RawSpCode; refusing to apply against a stale preview`;
    }
  }

  return null;
}

// SpeciesCode drift is already covered by the locked replan comparison.
export const SPECIES_CORRECTION_FIELD_DRIFT_EXCLUDED_FIELDS: ReadonlySet<string> = new Set(['SpeciesCode']);

/**
 * Compares at full stored DECIMAL scale and deliberately bypasses fieldpolicy's input normalization
 * (e.g. 'NULL' -> clear): any stored-value difference, however small, is drift.
 */
export function assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges: readonly FieldChange[], lockedCurrentFieldValues: Record<string, unknown>): void {
  for (const change of fieldChanges) {
    if (SPECIES_CORRECTION_FIELD_DRIFT_EXCLUDED_FIELDS.has(change.field)) continue;

    if (fieldChangedAtStoredPrecision(change.field, change.from, lockedCurrentFieldValues[change.field])) {
      throw new SpeciesCorrectionWriteConflictError({
        kind: 'drift',
        message: `field "${change.field}" no longer matches its locked current value; refusing to apply this edit against a stale snapshot`
      });
    }
  }
}

/**
 * Both sibling snapshots need `forUpdate`: an earlier read fixed a REPEATABLE READ snapshot, and a
 * matched-but-0-rows RawSpCode UPDATE does not advance it, so a plain read can return stale values.
 */
async function selectCoreMeasurementRows(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementIDs: number[],
  transactionID: string,
  options: { forUpdate?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const placeholders = buildInPlaceholders(coreMeasurementIDs.length);
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.coremeasurements WHERE CoreMeasurementID IN (${placeholders}) ORDER BY CoreMeasurementID${lockClause}`),
    [...coreMeasurementIDs],
    transactionID
  );
  return rows as Array<Record<string, unknown>>;
}

function buildCoreMeasurementStateRow(row: Record<string, unknown>): EditOperationStateRow {
  return { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: Number(row.CoreMeasurementID), row };
}

/** Translates only the known (TreeTag, SpeciesID, CensusID) uniqueness race; every other error propagates. */
async function updateTreeSpeciesWithConflictTranslation(
  cm: ConnectionManager,
  schema: string,
  verified: SpeciesCorrectionSummary,
  transactionID: string
): Promise<void> {
  try {
    await cm.executeQuery(
      safeFormatQuery(schema, `UPDATE ??.trees SET SpeciesID = ? WHERE TreeID = ? AND CensusID = ?`),
      [verified.newSpeciesID, verified.targetTreeID, verified.censusID],
      transactionID
    );
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new SpeciesCorrectionWriteConflictError({
        kind: 'unique-constraint',
        message: `Tree ${verified.targetTreeID} (TreeTag "${verified.treeTag}") could not be corrected to species ${verified.newSpeciesID} in census ${verified.censusID}: another tree now owns that (TreeTag, SpeciesID, CensusID) combination`
      });
    }
    throw error;
  }
}

/** Must run after the generic writer's Raw* sync so the canonical code wins over the typed spelling. */
async function syncCanonicalRawSpCode(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementIDs: number[],
  canonicalSpeciesCode: string,
  transactionID: string
): Promise<void> {
  const placeholders = buildInPlaceholders(coreMeasurementIDs.length);
  await cm.executeQuery(
    safeFormatQuery(schema, `UPDATE ??.coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID IN (${placeholders})`),
    [canonicalSpeciesCode, ...coreMeasurementIDs],
    transactionID
  );
}

interface EffectiveMeasurementFieldsRow {
  CoreMeasurementID: number;
  Tag: string | null;
  StemTag: string | null;
  SpCode: string | null;
  Quadrat: string | null;
  X: number | string | null;
  Y: number | string | null;
  DBH: number | string | null;
  HOM: number | string | null;
  Date: string | Date | null;
  Codes: string | null;
  Comments: string | null;
}

/** Locking read so the checker sees current values, not this transaction's REPEATABLE READ snapshot. */
async function selectEffectiveFieldsForMeasurements(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementIDs: number[],
  transactionID: string
): Promise<EffectiveMeasurementFieldsRow[]> {
  const placeholders = buildInPlaceholders(coreMeasurementIDs.length);
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT cm.CoreMeasurementID,
              t.TreeTag AS Tag,
              s.StemTag AS StemTag,
              sp.SpeciesCode AS SpCode,
              q.QuadratName AS Quadrat,
              s.LocalX AS X,
              s.LocalY AS Y,
              cm.MeasuredDBH AS DBH,
              cm.MeasuredHOM AS HOM,
              cm.MeasurementDate AS Date,
              cm.RawCodes AS Codes,
              cm.Description AS Comments
       FROM ??.coremeasurements cm
       LEFT JOIN ??.stems s ON s.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = s.TreeID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
       WHERE cm.CoreMeasurementID IN (${placeholders})
       ORDER BY cm.CoreMeasurementID
       FOR UPDATE`
    ),
    [...coreMeasurementIDs],
    transactionID
  );
  return rows as EffectiveMeasurementFieldsRow[];
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnlyString(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString().split('T')[0];
  if (typeof value === 'string') return value.includes('T') ? value.split('T')[0] : value;
  return null;
}

// Inactive members are included: a tree-wide species change can flip any member's ingestion verdict.
async function refreshIngestionErrorsForAllMembers(
  cm: ConnectionManager,
  schema: string,
  censusID: number,
  memberIDs: number[],
  transactionID: string
): Promise<number[]> {
  const rows = await selectEffectiveFieldsForMeasurements(cm, schema, memberIDs, transactionID);
  for (const row of rows) {
    await reconcileIngestionErrorsForMeasurement(
      cm,
      schema,
      Number(row.CoreMeasurementID),
      censusID,
      {
        Tag: row.Tag ?? null,
        StemTag: row.StemTag ?? null,
        SpCode: row.SpCode ?? null,
        Quadrat: row.Quadrat ?? null,
        X: toOptionalNumber(row.X),
        Y: toOptionalNumber(row.Y),
        DBH: toOptionalNumber(row.DBH),
        HOM: toOptionalNumber(row.HOM),
        Date: toDateOnlyString(row.Date),
        Codes: row.Codes ?? null,
        Comments: row.Comments ?? null
      },
      transactionID
    );
  }
  return rows.map(row => Number(row.CoreMeasurementID));
}

async function resetValidationPending(cm: ConnectionManager, schema: string, coreMeasurementIDs: number[], transactionID: string): Promise<void> {
  const placeholders = buildInPlaceholders(coreMeasurementIDs.length);
  await cm.executeQuery(
    safeFormatQuery(schema, `/* skip_changelog */ UPDATE ??.coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID IN (${placeholders})`),
    [...coreMeasurementIDs],
    transactionID
  );
}

/**
 * Resolves only occurrences a revalidation pass can recompute (enabled rule with a Definition).
 * Ingestion-stage codes are excluded by code because they have no runnable Definition.
 */
async function resolveSupportedValidationOccurrences(cm: ConnectionManager, schema: string, measurementIDs: number[], transactionID: string): Promise<number> {
  const placeholders = buildInPlaceholders(measurementIDs.length);
  const excludedCodePlaceholders = buildInPlaceholders(INGESTION_STAGE_ERROR_CODES.length);
  const result = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN ??.sitespecificvalidations ssv
         ON me.ErrorCode = CAST(ssv.ValidationID AS CHAR) COLLATE ${TARGET_TEXT_COLLATION}
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE mel.MeasurementID IN (${placeholders})
         AND me.ErrorSource = ?
         AND me.ErrorCode NOT IN (${excludedCodePlaceholders})
         AND mel.IsResolved = FALSE
         AND ssv.IsEnabled = 1
         AND TRIM(COALESCE(ssv.Definition, '')) <> ''`
    ),
    [...measurementIDs, VALIDATION_ERROR_SOURCE, ...INGESTION_STAGE_ERROR_CODES],
    transactionID
  );
  return Number((result as { affectedRows?: unknown } | undefined)?.affectedRows ?? 0);
}

export interface CorrectionErrorRefreshResult {
  ingestionRefreshedMeasurementIDs: number[];
  resolvedValidationOccurrenceCount: number;
  pendingMeasurementIDs: number[];
}

/**
 * Ingestion errors are re-derived for every member; validation resolution and the pending reset touch
 * active members only, because an inactive member's validation state belongs to its own census snapshot.
 */
export async function refreshCorrectionErrorsAndValidationPending(
  cm: ConnectionManager,
  schema: string,
  censusID: number,
  allMemberIDs: readonly number[],
  activeMemberIDs: readonly number[],
  transactionID: string
): Promise<CorrectionErrorRefreshResult> {
  const ingestionRefreshedMeasurementIDs =
    allMemberIDs.length > 0 ? await refreshIngestionErrorsForAllMembers(cm, schema, censusID, [...allMemberIDs], transactionID) : [];

  let resolvedValidationOccurrenceCount = 0;
  const pendingMeasurementIDs: number[] = [];
  if (activeMemberIDs.length > 0) {
    resolvedValidationOccurrenceCount = await resolveSupportedValidationOccurrences(cm, schema, [...activeMemberIDs], transactionID);
    await resetValidationPending(cm, schema, [...activeMemberIDs], transactionID);
    pendingMeasurementIDs.push(...activeMemberIDs);
  }

  return { ingestionRefreshedMeasurementIDs, resolvedValidationOccurrenceCount, pendingMeasurementIDs };
}

function buildSpeciesCorrectionMetadata(
  verified: SpeciesCorrectionSummary,
  speciesID: number,
  speciesCode: string,
  rawSpCodeFor: (measurement: SpeciesCorrectionSummary['measurements'][number]) => string | null,
  editedCoreMeasurementID: number,
  editedStemGUID: number,
  domainDiff: SpeciesCorrectionDomainDiff
): SpeciesCorrectionMetadata {
  return {
    version: SPECIES_CORRECTION_METADATA_VERSION,
    operation: 'tree-species-correction',
    targetTreeID: verified.targetTreeID,
    treeTag: verified.treeTag,
    plotID: verified.plotID,
    censusID: verified.censusID,
    speciesID,
    speciesCode,
    stems: verified.stems,
    measurements: verified.measurements.map(m => ({
      coreMeasurementID: m.coreMeasurementID,
      stemGUID: m.stemGUID,
      censusID: m.censusID,
      isActive: m.isActive,
      rawSpCode: rawSpCodeFor(m)
    })),
    editedCoreMeasurementID,
    editedStemGUID,
    domainDiff
  };
}

function buildMetadataStateRow(metadata: SpeciesCorrectionMetadata): EditOperationStateRow {
  return {
    table: SPECIES_CORRECTION_METADATA_TABLE,
    primaryKey: 'TreeID',
    primaryKeyValue: metadata.targetTreeID,
    row: metadata as unknown as Record<string, unknown>
  };
}

/** Read-only. Must run before the caller's first write so every member's priorRawSpCode is genuinely pre-mutation. */
export async function prepareTreeSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  input: SpeciesCorrectionPrepareInput,
  transactionID: string
): Promise<PreparedSpeciesCorrection> {
  const { previewedCorrection } = input;

  const replanResult = await planSpeciesCorrection(
    cm,
    schema,
    {
      treeID: previewedCorrection.targetTreeID,
      plotID: previewedCorrection.plotID,
      censusID: previewedCorrection.censusID,
      newSpeciesID: previewedCorrection.newSpeciesID,
      editedStemGUID: input.editedStemGUID,
      editedCoreMeasurementID: input.editedCoreMeasurementID
    },
    transactionID,
    { forUpdate: true }
  );

  if (replanResult.status !== 'ok') {
    throw new SpeciesCorrectionWriteConflictError({ kind: 'replan', result: replanResult });
  }

  const verified = replanResult.correction;
  const driftMessage = findSpeciesCorrectionDrift(previewedCorrection, verified);
  if (driftMessage) {
    throw new SpeciesCorrectionWriteConflictError({ kind: 'drift', message: driftMessage });
  }

  const allMemberIDs = verified.measurements.map(m => m.coreMeasurementID);
  const siblingMemberIDs = allMemberIDs.filter(id => id !== input.editedCoreMeasurementID);

  const siblingBeforeRows =
    siblingMemberIDs.length > 0 ? await selectCoreMeasurementRows(cm, schema, siblingMemberIDs, transactionID, { forUpdate: true }) : [];
  const siblingBeforeState = siblingBeforeRows.map(buildCoreMeasurementStateRow);

  return {
    transactionID,
    editedCoreMeasurementID: input.editedCoreMeasurementID,
    editedStemGUID: input.editedStemGUID,
    correction: verified,
    siblingBeforeState
  };
}

/**
 * Never re-plans: the caller's Raw* sync has already overwritten the edited row's RawSpCode,
 * so a fresh replan would report this operation's own write as drift.
 */
export async function applyPreparedTreeSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  prepared: PreparedSpeciesCorrection,
  transactionID: string
): Promise<AppliedSpeciesCorrectionResult> {
  if (prepared.transactionID !== transactionID) {
    throw new SpeciesCorrectionTransactionMismatchError(prepared.transactionID, transactionID);
  }

  const verified = prepared.correction;
  const { editedCoreMeasurementID, editedStemGUID, siblingBeforeState } = prepared;
  const allMemberIDs = verified.measurements.map(m => m.coreMeasurementID);
  const siblingMemberIDs = allMemberIDs.filter(id => id !== editedCoreMeasurementID);

  await updateTreeSpeciesWithConflictTranslation(cm, schema, verified, transactionID);

  // Includes the edited row, overriding the typed spelling its generic Raw* sync wrote.
  await syncCanonicalRawSpCode(cm, schema, allMemberIDs, verified.newSpeciesCode, transactionID);

  const activeMemberIDs = verified.measurements.filter(m => m.isActive).map(m => m.coreMeasurementID);
  const errorRefresh = await refreshCorrectionErrorsAndValidationPending(cm, schema, verified.censusID, allMemberIDs, activeMemberIDs, transactionID);

  // Locking read: a no-op RawSpCode UPDATE, or an inactive sibling with no validation UPDATE, does not
  // advance this transaction's REPEATABLE READ view, so a plain read could return pre-correction values.
  const siblingAfterRows = siblingMemberIDs.length > 0 ? await selectCoreMeasurementRows(cm, schema, siblingMemberIDs, transactionID, { forUpdate: true }) : [];
  const siblingAfterState = siblingAfterRows.map(buildCoreMeasurementStateRow);

  return {
    correction: verified,
    siblingBeforeState,
    siblingAfterState,
    errorRefresh
  };
}

export function buildSpeciesCorrectionMetadataStateRows(
  correction: SpeciesCorrectionSummary,
  editedCoreMeasurementID: number,
  editedStemGUID: number,
  domainDiff: SpeciesCorrectionDomainDiff
): { metadataBeforeState: EditOperationStateRow; metadataAfterState: EditOperationStateRow } {
  const metadataBefore = buildSpeciesCorrectionMetadata(
    correction,
    correction.oldSpeciesID,
    correction.oldSpeciesCode,
    m => m.priorRawSpCode,
    editedCoreMeasurementID,
    editedStemGUID,
    domainDiff
  );
  const metadataAfter = buildSpeciesCorrectionMetadata(
    correction,
    correction.newSpeciesID,
    correction.newSpeciesCode,
    () => correction.newSpeciesCode,
    editedCoreMeasurementID,
    editedStemGUID,
    domainDiff
  );

  return {
    metadataBeforeState: buildMetadataStateRow(metadataBefore),
    metadataAfterState: buildMetadataStateRow(metadataAfter)
  };
}

/** Prepare + apply in one call, for callers with no intervening write of their own. */
export async function writeTreeSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  input: WriteTreeSpeciesCorrectionInput,
  transactionID: string
): Promise<WriteTreeSpeciesCorrectionResult> {
  const prepared = await prepareTreeSpeciesCorrection(cm, schema, input, transactionID);
  const applied = await applyPreparedTreeSpeciesCorrection(cm, schema, prepared, transactionID);
  const { metadataBeforeState, metadataAfterState } = buildSpeciesCorrectionMetadataStateRows(
    applied.correction,
    prepared.editedCoreMeasurementID,
    prepared.editedStemGUID,
    input.domainDiff
  );
  return { ...applied, metadataBeforeState, metadataAfterState };
}
