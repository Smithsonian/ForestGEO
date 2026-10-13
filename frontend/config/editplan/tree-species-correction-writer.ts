// Transactional writer for a previewed tree-wide species correction (see
// tree-species-correction.ts for the preview/plan). Called only from
// writers/measurementssummary.ts when `plan.speciesCorrection` is present —
// never for an ordinary single-row edit.
//
// Runs INSIDE the caller's existing transaction and measurement-scope lock.
// Never begins, commits, or rolls back a transaction, never acquires the
// scope lock, and never creates a tree/stem — a correction only rewrites the
// existing tree's SpeciesID in its exact census.
//
// Locked-replan/drift precondition: the caller's earlier preview may be
// stale (a REPEATABLE READ snapshot fixed before any lock was taken, or a
// genuine race since review). Before any write, `planSpeciesCorrection` is
// re-run with `forUpdate: true` — locking every row it reads and forcing a
// current-committed read — and the result is compared field-by-field
// (including each member's `priorRawSpCode`, since a concurrently changed
// RawSpCode invalidates the undo "before" value, not merely a fresh value to
// capture) against the previewed correction. Any mismatch — including one
// that still independently resolves to `status: 'ok'` — is refused as a
// structured conflict rather than applied against an unreviewed scope.
//
// Two-phase API: `prepareTreeSpeciesCorrection` performs only the locked
// replan, drift check, and sibling "before" snapshot (itself a locking read
// — an earlier `FOR UPDATE` does not make a later plain `SELECT` current) —
// no write. The caller runs this before its own first write, so the
// captured state (including the edited row's own RawSpCode) predates the
// generic writer's Raw* sync. `applyPreparedTreeSpeciesCorrection` then
// mutates using exactly that prepared result — it never re-plans, so a write
// this module itself just made cannot be misread as drift against itself —
// and throws if run under a different transaction than the one that
// produced the prepared result. `writeTreeSpeciesCorrection` is prepare+apply
// in one call, for standalone callers with no reason to split the phases.
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { EditOperationStateRow } from '@/config/editoperations';
import { refreshIngestionErrorsForMeasurement, VALIDATION_ERROR_SOURCE, INGESTION_STAGE_ERROR_CODES } from '@/config/measurementerrors';
import { planSpeciesCorrection, SpeciesCorrectionPlanResult } from './tree-species-correction';
import { FieldChange, SpeciesCorrectionSummary, SpeciesCorrectionStemPrecondition } from './types';
import { fieldChanged, fieldChangedAtStoredPrecision } from './storedfieldcomparison';

export const SPECIES_CORRECTION_METADATA_TABLE = 'species_correction_metadata';
export const SPECIES_CORRECTION_METADATA_VERSION = 1 as const;

/**
 * Why a write was refused. Exactly one of three causes:
 *  - `replan`: the locked re-read of planSpeciesCorrection did not return
 *    `status: 'ok'` (missing/inactive/moved source, changed species/active
 *    state, a destination collision, or any other non-'ok' outcome —
 *    including `no_correction`, which here means the correction this write
 *    was asked to apply has already vanished since it was reviewed).
 *  - `drift`: the locked re-read *did* return 'ok', but its membership/scope
 *    (stem or measurement count, link, census, active flag) no longer
 *    matches what was previewed.
 *  - `unique-constraint`: the `trees` UPDATE itself raced the table's
 *    `(TreeTag, SpeciesID, CensusID)` unique constraint (ER_DUP_ENTRY /
 *    errno 1062) — translated here because it is the one known, expected
 *    race on this exact write; no other SQL error is reinterpreted.
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
  /** The RawSpCode this measurement carried in this metadata's species state (NULL and differing spellings preserved — never fabricated). */
  rawSpCode: string | null;
}

/**
 * Fixed undo-restore allowlist. No derived/bookkeeping column (IsValidated,
 * any validation/error status, any timestamp) ever belongs here, and the
 * full `coremeasurements`/`stems` rows are never duplicated — the ledger's
 * own before/after `EditOperationStateRow`s already carry those in full.
 * `SpeciesID`/`RawSpCode` are excluded too: already explicit elsewhere on
 * `SpeciesCorrectionMetadata`.
 */
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

/**
 * `fieldChanged` is keyed on PLAN field names (`StemLocalX`, `MeasuredDBH`,
 * ...) for decimal/date normalization, but the allowlists above are STORED
 * column names (`RawX`, `LocalX`, `RawPlotX`, `PlotX`, ...). This maps each
 * stored column to the plan field whose comparison semantics apply; an
 * unmapped column (e.g. `Description`, `RawCodes`) is plain text and needs
 * none, so it compares under its own name.
 */
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

/** Both sides of one changed column. NULL is preserved verbatim on either side — never coerced to '' or 0 — so a later undo can restore a raw NULL exactly. */
export interface SpeciesCorrectionColumnChange {
  before: unknown;
  after: unknown;
}

/**
 * Changed-only domain diff, embedded identically on both the before- and
 * after-state metadata rows (symmetric evidence, not two half-records).
 * `coremeasurements`/`stems` carry an entry ONLY for an allowlisted column
 * whose stored value actually differs — an untouched column is omitted
 * entirely, never present with `before === after`. `attributeCodes` is
 * ALWAYS present, even when both sides are empty: an empty array means a
 * provably empty association set; a missing/non-array value is malformed
 * evidence, never "no attributes".
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
  /** Null only when the edited row has no stem — no LocalX/Y/PlotX/Y diff is possible without one. */
  beforeStem: Record<string, unknown> | null;
  afterStem: Record<string, unknown> | null;
  attributeCodesBefore: readonly string[];
  attributeCodesAfter: readonly string[];
}

/**
 * Pure, DB-free: compares the allowlisted columns above using the exact
 * stored-value comparison the analyzer itself uses (`fieldChanged`, via
 * `SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD` for decimal/date
 * columns), and copies the attribute-code arrays verbatim. Callers MUST
 * pass real locked before/after DB snapshots — never requested write
 * parameters — so a MySQL-rounded persisted value is what this reports.
 */
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

/**
 * Versioned, self-describing correction record carried as an
 * `EditOperationStateRow` on both `beforeState` (old species / prior
 * RawSpCode per member) and `afterState` (new canonical species / canonical
 * RawSpCode on every member). `primaryKeyValue` is the corrected TreeID
 * explicitly, so a later undo stage can locate it without relying on state
 * array order. `stems`/`measurements` are the exact locked-read membership
 * the write was verified against — the precondition set a future drift
 * guard must re-check (never unrelated later DBH/comments edits).
 * `editedCoreMeasurementID`/`editedStemGUID` name the exact row the user
 * edited, by PK, so undo never has to infer it from array position.
 * `domainDiff` is identical on this metadata's before and after row (see
 * `buildSpeciesCorrectionMetadata`).
 */
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

/**
 * The subset `prepareTreeSpeciesCorrection` itself needs — the locked
 * replan/drift precondition plus the edited row's own PK. `domainDiff` is
 * deliberately absent: the caller does not yet know it at prepare() time
 * (see `measurementssummary.ts`, which computes it only after its own
 * write-site overrides accumulate, immediately before apply()).
 */
export interface SpeciesCorrectionPrepareInput {
  /** The correction the user reviewed (EditPlan.speciesCorrection from the pre-write analyzer pass). Used only for the drift comparison below — every actual write uses the freshly re-verified locked values. */
  previewedCorrection: SpeciesCorrectionSummary;
  editedCoreMeasurementID: number;
  editedStemGUID: number;
}

export interface WriteTreeSpeciesCorrectionInput extends SpeciesCorrectionPrepareInput {
  /** The allowlisted-column + attribute-code diff this edit produced outside the species correction itself, built by the caller via `buildSpeciesCorrectionDomainDiff`. A caller with no accompanying field edit passes `EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF` explicitly rather than omitting it. */
  domainDiff: SpeciesCorrectionDomainDiff;
}

/**
 * `applyPreparedTreeSpeciesCorrection`'s return value. No metadata state
 * rows here: this function mutates `RawSpCode` before the caller's own
 * post-write snapshots exist, so building `species_correction_metadata`'s
 * `domainDiff` at this point could only ever predict the after-side rather
 * than observe it. The caller builds both metadata rows itself, once it has
 * real after-snapshots, via `buildSpeciesCorrectionMetadataStateRows(result.correction, ...)`.
 */
export interface AppliedSpeciesCorrectionResult {
  /** The locked, re-verified correction actually applied (canonical DB code, current membership). */
  correction: SpeciesCorrectionSummary;
  /** Full before/after `coremeasurements` rows for every OTHER member of the tree (not the edited CM — the generic writer already owns that row's before/after StateRow). Empty when the tree has no other attached measurements. */
  siblingBeforeState: EditOperationStateRow[];
  siblingAfterState: EditOperationStateRow[];
  /** Result of `refreshCorrectionErrorsAndValidationPending` — which members' ingestion errors were re-derived, how many stale validation-source occurrences were resolved, and which active members were re-queued for validation. */
  errorRefresh: CorrectionErrorRefreshResult;
}

/** `writeTreeSpeciesCorrection`'s return value: `AppliedSpeciesCorrectionResult` plus the metadata state rows it builds itself, via `buildSpeciesCorrectionMetadataStateRows`, from the caller-supplied `domainDiff` once `correction` is known. */
export type WriteTreeSpeciesCorrectionResult = AppliedSpeciesCorrectionResult & {
  metadataBeforeState: EditOperationStateRow;
  metadataAfterState: EditOperationStateRow;
};

/**
 * The read-only result of `prepareTreeSpeciesCorrection`: the locked,
 * drift-checked correction plus the sibling "before" snapshot, both captured
 * before any mutation. Internal only — this is produced exclusively by
 * `prepareTreeSpeciesCorrection` inside an already-open transaction and
 * consumed exclusively by `applyPreparedTreeSpeciesCorrection` in that same
 * transaction; no request/route/serialized input may construct or carry one.
 * `transactionID` records which transaction it was captured under, so
 * `applyPreparedTreeSpeciesCorrection` can refuse to apply a prepared result
 * under a different transaction than the one that locked and verified it.
 */
export interface PreparedSpeciesCorrection {
  readonly transactionID: string;
  readonly editedCoreMeasurementID: number;
  readonly editedStemGUID: number;
  /** The locked, drift-checked correction `applyPreparedTreeSpeciesCorrection` must act on verbatim — never re-planned. */
  readonly correction: SpeciesCorrectionSummary;
  /** Every OTHER attached `coremeasurements` row, read under lock before any mutation. */
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

function buildInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

const ER_DUP_ENTRY_ERRNO = 1062;

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === 'ER_DUP_ENTRY' || candidate.errno === ER_DUP_ENTRY_ERRNO;
}

/**
 * Compares the previewed correction's entire precondition contract against
 * the locked re-read, field-by-field (no JSON.stringify — a reordered-but-
 * equal array must not be reported as drift, and this project's planner
 * always returns `stems`/`measurements` pre-sorted ascending, so position-
 * wise comparison is exact). Every measurement's `priorRawSpCode` IS part of
 * this comparison: if another transaction changed a member's RawSpCode
 * between preview and this locked re-read, the undo "before" value the
 * caller reviewed no longer matches reality, and applying anyway would bake
 * a wrong restore value into `species_correction_metadata`. This check runs
 * from `prepareTreeSpeciesCorrection`, before the main writer's own first
 * write, so it is comparing against the row's genuinely pre-mutation state —
 * never against a value this same operation just wrote.
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

/**
 * `findSpeciesCorrectionDrift` above verifies only the species/membership
 * preconditions `planSpeciesCorrection` itself returns — it never looks at
 * any OTHER field (`MeasuredDBH`, `StemLocalX`, `Description`, `Attributes`,
 * ...) the user may have edited in the same submit, so a stale `from` for
 * one of those would silently overwrite another user's committed change.
 * `assertNoEditedFieldDriftForSpeciesCorrection` below closes that gap by
 * checking every actually-edited field (`plan.fieldChanges` entries only)
 * against the locked current row. It is a raw-column precondition: every
 * field, `Attributes` included, is compared as the exact stored
 * representation the analyzer itself diffed from (`cm.RawCodes` for
 * `Attributes`), never a derived/materialized shape. `SpeciesCode` is
 * excluded here — that precondition already belongs to the locked replan
 * comparison above.
 */
export const SPECIES_CORRECTION_FIELD_DRIFT_EXCLUDED_FIELDS: ReadonlySet<string> = new Set(['SpeciesCode']);

/**
 * Throws `SpeciesCorrectionWriteConflictError({ kind: 'drift' })` on the
 * first actually-edited field (`SpeciesCode` excluded) whose previewed
 * `from` no longer matches its locked, current, pre-mutation RAW value.
 * Issues NO write and NO DB read itself — `lockedCurrentFieldValues` must
 * already have been loaded, under lock, by the caller. Uses
 * `fieldChangedAtStoredPrecision` from `storedfieldcomparison.ts`: numeric
 * fields compare at the full stored DECIMAL(12,6) scale, not the analyzer's
 * coarser UI-rounding precision, so a sub-UI-precision concurrent write
 * (e.g. 10.000000 -> 10.000001) is never missed here. Deliberately does NOT
 * route through the input-oriented
 * `normalizeFieldValue`/clear-policy machinery in `fieldpolicy.ts`: that
 * machinery exists to interpret a user's freshly typed input (e.g. collapsing
 * `''`/whitespace/the literal string `'NULL'` to a clear), which is the wrong
 * question here — a concurrent change from `'NULL'` to `'null'`, or a
 * whitespace-only edit, is a genuine stored-value difference and must drift.
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
 * `forUpdate` is required for the sibling "before" snapshot (taken from
 * `prepareTreeSpeciesCorrection`, before any mutation): without it, this
 * plain `SELECT` would still observe whatever REPEATABLE READ snapshot an
 * earlier read in this same transaction established, not necessarily the
 * current committed row — the same staleness `planSpeciesCorrection`'s own
 * `forUpdate` option exists to defeat. The sibling "after" snapshot (taken
 * post-mutation) is read with `forUpdate` for the same reason: a sibling
 * already carrying the destination canonical RawSpCode makes that RawSpCode
 * UPDATE a matched-but-0-rows no-op, and an inactive sibling receives no
 * validation-state UPDATE — so neither advances this transaction's
 * REPEATABLE READ view, and a plain read there could still return a
 * pre-correction value that contradicts both the stored row and the before
 * ledger.
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

/** Updates ONLY trees.SpeciesID for this exact (TreeID, CensusID) — no tree/stem creation, no other column. Translates the one known uniqueness race; every other error propagates unchanged. */
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

/** Single flat UPDATE stamping the canonical species code onto every attached CM's RawSpCode — edited row included, active and inactive members alike. Must run after the generic writer's own Raw* sync so the canonical code wins over the user's typed spelling. No other column is touched. */
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

/** Locked (FOR UPDATE) single joined read of every given member's current effective fields for #307's checker, guaranteeing a current read instead of this transaction's REPEATABLE READ snapshot. */
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

/**
 * Re-derives #307's ingestion-error state for every attached member — active,
 * inactive, and the edited target row alike — each against that member's own
 * current, post-write effective values. A tree-wide RawSpCode/species change
 * can flip the ingestion verdict for any attached row (e.g. an inactive
 * measurement's SpCode-derived finding is just as stale as an active one's),
 * so scope is never limited to active siblings. Reuses #307's
 * `refreshIngestionErrorsForMeasurement` verbatim; resolution policy is
 * entirely that helper's own decision.
 */
async function refreshIngestionErrorsForAllMembers(
  cm: ConnectionManager,
  schema: string,
  censusID: number,
  memberIDs: number[],
  transactionID: string
): Promise<number[]> {
  const rows = await selectEffectiveFieldsForMeasurements(cm, schema, memberIDs, transactionID);
  for (const row of rows) {
    await refreshIngestionErrorsForMeasurement(
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

/** Sets affected active members pending re-validation (IsValidated = NULL). No member — including the edited row — ever gets a hard DELETE on this path: history is retained for every affected member, nothing is reactivated, and no science validation runs synchronously. */
async function resetValidationPending(cm: ConnectionManager, schema: string, coreMeasurementIDs: number[], transactionID: string): Promise<void> {
  const placeholders = buildInPlaceholders(coreMeasurementIDs.length);
  await cm.executeQuery(
    safeFormatQuery(schema, `/* skip_changelog */ UPDATE ??.coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID IN (${placeholders})`),
    [...coreMeasurementIDs],
    transactionID
  );
}

/**
 * Resolves only the validation-source `measurement_error_log` occurrences a
 * later revalidation pass can genuinely recompute: the ErrorCode must join
 * to an enabled, non-blank-Definition `sitespecificvalidations` row, and
 * `INGESTION_STAGE_ERROR_CODES` are excluded explicitly by code — not by an
 * assumed-missing join row — since those codes have no runnable Definition.
 * Already-resolved rows are never rewritten; nothing is ever deleted or
 * reactivated; no validation SQL is executed here.
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
         ON me.ErrorCode = CAST(ssv.ValidationID AS CHAR) COLLATE utf8mb4_0900_ai_ci
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
 * Owns the error-state half of a species correction, inside the caller's
 * already-open transaction/lock. The member-class policy:
 *  - Ingestion-error refresh runs over `allMemberIDs` — every attached
 *    member, active or inactive, edited target included — each re-checked
 *    against its own current effective values.
 *  - The supported-validation-occurrence resolution and the
 *    pending-revalidation reset (`IsValidated = NULL`) run over
 *    `activeMemberIDs` only. An inactive member's validation state is
 *    deliberately left exactly as it was — it belongs to the census
 *    snapshot the member was measured in, not to a correction reached only
 *    through tree membership — while an active member is re-queued for
 *    validation rather than having any override inferred for it.
 *
 * Each statement is skipped (no `IN ()`) when its own id list is empty.
 * Returned id arrays list exactly the members actually processed.
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

/**
 * Phase 1 (read-only): locked re-read, complete precondition comparison
 * (including `priorRawSpCode` — see `findSpeciesCorrectionDrift`), and the
 * sibling "before" snapshot — also a locking read, for the same reason the
 * replan itself needs `forUpdate: true` (see module doc comment above).
 * Issues NO write. Must be called before the caller's (main writer's) own
 * first write, so the prepared `correction`/`siblingBeforeState` — and in
 * particular every member's `priorRawSpCode`, including the edited
 * measurement's own prior value used for `species_correction_metadata`'s
 * before-state — reflect genuinely pre-mutation data, not a value the
 * caller's generic Raw* sync already overwrote.
 */
export async function prepareTreeSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  input: SpeciesCorrectionPrepareInput,
  transactionID: string
): Promise<PreparedSpeciesCorrection> {
  const { previewedCorrection } = input;

  // --- Locked re-read; compare the ENTIRE previewed precondition contract
  // before any write. -------------------------------------------------
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

  // --- Sibling "before" snapshot, prior to any mutation — locking read,
  // same deterministic (ascending CoreMeasurementID) order as the planner's
  // own measurements read. ------------------------------------------------
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
 * Phase 2 (mutating): applies exactly the prepared, locked, drift-checked
 * correction — never re-plans. Re-planning here would be unsafe: by the time
 * the caller reaches this call, its own generic Raw* sync has already
 * overwritten the edited row's RawSpCode with the user's typed spelling, so
 * a fresh replan would observe that write and (once `priorRawSpCode` is part
 * of the drift comparison) misreport the operation's own prior write as
 * "drift" against itself. Throws `SpeciesCorrectionTransactionMismatchError`
 * if `prepared` was not captured under this exact `transactionID` — a
 * prepared result from one transaction must never be applied in another.
 * Builds no metadata state rows: see `AppliedSpeciesCorrectionResult`'s doc
 * comment. The caller builds them via `buildSpeciesCorrectionMetadataStateRows`
 * once it has its own real post-write snapshots.
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

  // --- The actual correction: ONLY trees.SpeciesID, in its exact census.
  // No tree/stem creation, no other column, no other tree touched. --------
  await updateTreeSpeciesWithConflictTranslation(cm, schema, verified, transactionID);

  // --- Canonical RawSpCode on every attached CM, active or inactive,
  // including the edited row (overriding its generic Raw* sync, which
  // stamped the user's typed — possibly non-canonical — spelling). No
  // other column changes for any sibling. ----------------------------------
  await syncCanonicalRawSpCode(cm, schema, allMemberIDs, verified.newSpeciesCode, transactionID);

  // --- Error-state refresh; see `refreshCorrectionErrorsAndValidationPending`'s
  // own doc comment for the full member-class policy. ----------------------
  const activeMemberIDs = verified.measurements.filter(m => m.isActive).map(m => m.coreMeasurementID);
  const errorRefresh = await refreshCorrectionErrorsAndValidationPending(cm, schema, verified.censusID, allMemberIDs, activeMemberIDs, transactionID);

  // --- Sibling "after" snapshot, reflecting the RawSpCode sync and
  // pending-revalidation reset above. Locking read: a sibling already
  // carrying the destination canonical RawSpCode makes that RawSpCode
  // UPDATE a matched-but-0-rows no-op, and an inactive sibling receives no
  // validation-state UPDATE — neither advances this transaction's
  // REPEATABLE READ view, so a plain read here could still return the
  // pre-correction value. -----------
  const siblingAfterRows = siblingMemberIDs.length > 0 ? await selectCoreMeasurementRows(cm, schema, siblingMemberIDs, transactionID, { forUpdate: true }) : [];
  const siblingAfterState = siblingAfterRows.map(buildCoreMeasurementStateRow);

  return {
    correction: verified,
    siblingBeforeState,
    siblingAfterState,
    errorRefresh
  };
}

/**
 * Pure: builds both `species_correction_metadata` state rows from an
 * already-applied `correction` and a caller-supplied `domainDiff` — no DB
 * I/O. Called by `writeTreeSpeciesCorrection` immediately after apply (its
 * `domainDiff` is known upfront), and by `writers/measurementssummary.ts`
 * only once it has loaded its own real post-write snapshots to build that
 * `domainDiff` from (see `buildSpeciesCorrectionDomainDiff`).
 */
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

/**
 * Single-call convenience wrapper over `prepareTreeSpeciesCorrection` +
 * `applyPreparedTreeSpeciesCorrection`, for standalone callers/tests that
 * have no reason to hold the prepared result across an intervening write
 * (unlike `writers/measurementssummary.ts`, which must — see module doc
 * comment above). Since `input.domainDiff` is known upfront here, this
 * wrapper also builds the metadata state rows itself, right after apply.
 */
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
