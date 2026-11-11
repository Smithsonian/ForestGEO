import type { UserAuthRoles } from '@/config/macros';

export type Severity = 'info' | 'warn' | 'destructive';

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  destructive: 2
};

export const SPECIES_CORRECTION_SUMMARY_VERSION = 1 as const;
export const SPECIES_CORRECTION_GROUP_VERSION = 1 as const;
export const SPECIES_CORRECTION_UNDO_RESTORATION_VERSION = 1 as const;

export type EffectCategory = 'field' | 'cross-row' | 'identity' | 'destructive' | 'validation';

export interface Effect {
  id: string;
  severity: Severity;
  category: EffectCategory;
  title: string;
  detail: string;
  affectedTable: string;
  affectedRowCount: number;
  references?: {
    coreMeasurementIDs?: number[];
    speciesID?: number;
    stemGUIDs?: number[];
    treeIDs?: number[];
  };
}

export type EditPlanDataType = 'measurementssummary' | 'failedmeasurements';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface RoleForbiddenFieldPreviewError {
  kind: 'RoleForbiddenField';
  field: string;
  role: UserAuthRoles | 'unknown';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export interface TreeStemResolutionPreviewError {
  kind: 'TreeStemResolution';
  subject: 'species' | 'quadrat' | 'tree' | 'stem';
  // 'mixed_identity': species was actually changed together with a
  // TreeTag/StemTag/QuadratName identity change in the same edit (#427 keeps
  // these mutually exclusive). 'destination_exists': the species correction's
  // destination (TreeTag, newSpeciesID, CensusID) already names another tree.
  // 'inconsistent_scope': an attached stem/measurement's own CensusID/plot/
  // quadrat link does not agree with the tree being corrected — a data
  // integrity problem, not a normal "can't apply this edit" outcome, so it
  // is never silently filtered out of membership.
  // 'group_species_conflict' (#427): two batch rows request different
  // destination species for the same tree+census, or a row explicitly
  // supplies a species code that disagrees with the group's canonical
  // destination, or two rows' corrections for the same tree disagree on
  // membership/state.
  // 'group_identity_overlap' (#427): another batch row (matched or new)
  // changes identity in a way that touches a tree being corrected.
  // 'group_member_deletion' (#427): the batch also deletes a measurement
  // that a tree correction affects.
  // 'group_field_conflict' (#427): two batch rows request contradictory
  // values for the same measurement field or the same shared stem column.
  // 'group_new_rows_require_separate_batch' (#427): the batch carries both a
  // tree-wide species correction and one or more brand-new measurement rows.
  // The two cannot be applied atomically together, so they must be
  // submitted as separate uploads.
  reason:
    | 'missing'
    | 'inactive'
    | 'different_quadrat'
    | 'cannot_create'
    | 'mixed_identity'
    | 'destination_exists'
    | 'inconsistent_scope'
    | 'group_species_conflict'
    | 'group_identity_overlap'
    | 'group_member_deletion'
    | 'group_field_conflict'
    | 'group_new_rows_require_separate_batch';
  field: 'SpeciesCode' | 'QuadratName' | 'TreeTag' | 'StemTag';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
  /** The tree a batch-level group blocker is about (#427 group reasons only). */
  treeID?: number;
  /** Every bulk `rowIndex` involved in a batch-level group blocker, sorted ascending (#427 group reasons only). */
  rowIndexes?: number[];
  /** Every bulk NEW-row `rowIndex` in a batch-level group blocker (#427). Kept separate from `rowIndexes` because the match route numbers matched rows by array position and new rows by CSV index, so the two spaces collide. */
  newRowIndexes?: number[];
}

export type PreviewError = RoleForbiddenFieldPreviewError | TreeStemResolutionPreviewError;

/**
 * A stem attached to the tree being corrected, carrying exactly the state a
 * hash/undo/writer stage needs to detect drift: which census/quadrat it is
 * actually linked to (not merely counted), and its own activity — never
 * assumed from sibling membership.
 */
export interface SpeciesCorrectionStemPrecondition {
  stemGUID: number;
  censusID: number;
  quadratID: number;
  isActive: boolean;
}

/**
 * A measurement attached to one of those stems, carrying its own link
 * (stemGUID — so a measurement moved between two already-attached stems is
 * visible even when the set of stem/measurement IDs is unchanged), scope,
 * activity, and the exact prior RawSpCode (including NULL and differing
 * spellings) for undo.
 */
export interface SpeciesCorrectionMeasurementPrecondition {
  coreMeasurementID: number;
  stemGUID: number;
  censusID: number;
  isActive: boolean;
  priorRawSpCode: string | null;
}

/**
 * Describes a #427 tree-wide species correction: an actual species change on
 * a measurement linked to an existing tree corrects that tree's SpeciesID in
 * this census rather than re-linking/reassigning the single measurement.
 * Produced by `planSpeciesCorrection` (read-only; preview and the future
 * writer share it) and carried on `EditPlan.speciesCorrection` so the plan
 * hash covers exact membership (including per-member links/activity, not
 * just counts), and so a later writer stage can act on the same membership
 * the user previewed without re-deriving it.
 */
export interface SpeciesCorrectionSummary {
  version: typeof SPECIES_CORRECTION_SUMMARY_VERSION;
  targetTreeID: number;
  treeTag: string;
  plotID: number;
  censusID: number;
  oldSpeciesID: number;
  oldSpeciesCode: string;
  newSpeciesID: number;
  newSpeciesCode: string;
  activeStemCount: number;
  inactiveStemCount: number;
  activeMeasurementCount: number;
  inactiveMeasurementCount: number;
  /** Every stem attached to the target tree, active or inactive, sorted ascending by stemGUID. */
  stems: SpeciesCorrectionStemPrecondition[];
  /** Every measurement attached to those stems, active or inactive, sorted ascending by coreMeasurementID. */
  measurements: SpeciesCorrectionMeasurementPrecondition[];
}

export interface SpeciesCorrectionGroupMember {
  /** `BulkInput.matched[]` index — the existing bulk `rowIndex` contract, not a CSV line number. */
  rowIndex: number;
  coreMeasurementID: number;
  /** True when this row's own plan carried the correction; false for a sibling pulled in by tree membership. */
  requestedCorrection: boolean;
}

export interface SpeciesCorrectionGroup {
  version: typeof SPECIES_CORRECTION_GROUP_VERSION;
  treeID: number;
  censusID: number;
  /** One canonical correction per (treeID, censusID); consistent duplicate requests collapse into this. */
  correction: SpeciesCorrectionSummary;
  /** Sorted ascending by rowIndex. */
  members: SpeciesCorrectionGroupMember[];
  /** Unique, sorted ascending: every measurement the correction touches (active and inactive). */
  affectedCoreMeasurementIDs: number[];
  /** Unique, sorted ascending. */
  affectedStemGUIDs: number[];
}

/** One tree's APPLIED #427 correction as reported back to the client; derived from what actually happened, not from the previewed plan. */
export interface AppliedSpeciesCorrectionGroupSummary {
  readonly treeID: number;
  readonly censusID: number;
  readonly treeTag: string;
  readonly oldSpeciesID: number;
  readonly oldSpeciesCode: string;
  readonly newSpeciesID: number;
  readonly newSpeciesCode: string;
  readonly activeCoreMeasurementIDs: readonly number[];
  readonly inactiveCoreMeasurementIDs: readonly number[];
  readonly affectedCoreMeasurementIDs: readonly number[];
  readonly affectedStemGUIDs: readonly number[];
  readonly submittedMemberCoreMeasurementIDs: readonly number[];
}

/** Whole-batch #427 correction outcome. Never revertable through the single-row revert path. */
export interface AppliedSpeciesCorrectionBatchSummary {
  readonly correctedTreeIDs: readonly number[];
  readonly updatedMemberCoreMeasurementIDs: readonly number[];
  /** Measurements the corrections touched that the batch did NOT submit — reported separately so they are never counted as submitted updates. */
  readonly additionalAffectedCoreMeasurementIDs: readonly number[];
  readonly allAffectedCoreMeasurementIDs: readonly number[];
  readonly groups: readonly AppliedSpeciesCorrectionGroupSummary[];
}

/**
 * The exact evidence a #427 species-correction undo will restore, carried on
 * `EditPlan.speciesCorrectionUndo` so the plan hash covers it (a confirmation
 * covers exactly what will be written back) without stringifying it into
 * `Effect.detail`, which stays human-readable UI copy.
 */
export interface SpeciesCorrectionUndoRestoration {
  version: typeof SPECIES_CORRECTION_UNDO_RESTORATION_VERSION;
  targetTreeID: number;
  /** SpeciesID/canonical code the undo restores (the pre-correction taxon). */
  restoredSpeciesID: number;
  restoredSpeciesCode: string;
  /** SpeciesID/canonical code the correction had applied, which the undo replaces. */
  replacedSpeciesID: number;
  replacedSpeciesCode: string;
  /** Exact prior `coremeasurements.RawSpCode` per member, NULL preserved; one entry per member, ascending by coreMeasurementID. */
  restoredMemberRawSpCodes: Array<{ coreMeasurementID: number; rawSpCode: string | null }>;
  /** Only the stored columns the original correction actually changed, with the exact value to write back; ascending by column. */
  restoredCoreMeasurementColumns: Array<{ column: string; value: unknown }>;
  restoredStemColumns: Array<{ column: string; value: unknown }>;
  /** Semantic attribute codes to re-establish, ascending; `null` when the original correction did not change associations, so the undo touches none. */
  restoredAttributeCodes: string[] | null;
}

export interface EditPlan {
  dataType: EditPlanDataType;
  targetID: number;
  fieldChanges: FieldChange[];
  effects: Effect[];
  errors?: PreviewError[];
  canApply?: boolean;
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
  /** Present only when this edit is an actual species correction on a linked tree (#427). */
  speciesCorrection?: SpeciesCorrectionSummary;
  /** Present only on a #427 species-correction undo plan. */
  speciesCorrectionUndo?: SpeciesCorrectionUndoRestoration;
}

export interface DuplicateDeletion {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

export interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
  canonicalNewRow?: Record<string, unknown>;
}

export interface BulkEditPlan {
  dataType: EditPlanDataType;
  rowCount: number;
  rowPlans: RowPlan[];
  aggregateEffects: Effect[];
  errors?: PreviewError[];
  canApply?: boolean;
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
  duplicateDeletions: DuplicateDeletion[];
  /** Present only when the batch contains tree-wide species corrections (#427); sorted by treeID then censusID and included in the plan hash. */
  speciesCorrectionGroups?: SpeciesCorrectionGroup[];
}

export interface ApplyResult {
  updatedIDs: Record<string, number>;
  applyErrors: Array<{ ruleID?: string; coreMeasurementID?: number; csvIndex?: number; reason: string }>;
  editOperationID: number | null;
  validationPending: boolean;
  postValidation?: { newErrors: number; clearedErrors: number };
}
