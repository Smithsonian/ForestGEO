// Batch analysis for tree-wide species corrections. Each sibling row of one tree carries the full
// tree correction, so this collapses them into one SpeciesCorrectionGroup per (treeID, censusID).
// Genuine disagreements are reported, the lowest rowIndex is canonical, and every membership set is
// re-sorted so file/query order never decides the outcome. Pure and synchronous: no DB access.
import {
  DuplicateDeletion,
  Effect,
  EditPlan,
  RowPlan,
  SPECIES_CORRECTION_GROUP_VERSION,
  SpeciesCorrectionGroup,
  SpeciesCorrectionGroupMember,
  SpeciesCorrectionMeasurementPrecondition,
  SpeciesCorrectionStemPrecondition,
  SpeciesCorrectionSummary,
  TreeStemResolutionPreviewError
} from './types';
import { normalizeFieldValueForComparison } from './planhash';

export interface BulkSpeciesGroupRow {
  /** `BulkInput.matched[]` index — the existing bulk rowIndex contract. */
  rowIndex: number;
  targetID: number;
  status: RowPlan['status'];
  plan?: EditPlan;
  explicitSpeciesCode?: string | null;
}

export interface SpeciesCorrectionGroupingResult {
  /** Sorted by treeID, then censusID. */
  groups: SpeciesCorrectionGroup[];
  /** Deterministically ordered batch-level blockers found while grouping. */
  errors: TreeStemResolutionPreviewError[];
}

interface RequestingRow {
  rowIndex: number;
  targetID: number;
  correction: SpeciesCorrectionSummary;
}

type DisagreementKind = 'none' | 'destination' | 'membership';

function buildGroupKey(treeID: number, censusID: number): string {
  return `${treeID}:${censusID}`;
}

/**
 * Stored on the shared stems row, so two rows editing different measurements of one stem write the
 * same column and the last write silently wins. Identity fields are handled by group_identity_overlap.
 */
const SHARED_STEM_FIELDS = ['StemLocalX', 'StemLocalY', 'StemPlotX', 'StemPlotY'] as const;

const GROUP_IDENTITY_OVERLAP_FIELDS = ['TreeTag', 'StemTag', 'QuadratName'] as const;

/** Shared ordering for every group_* error: treeID, then reason, then lowest rowIndex. */
export function compareTreeStemResolutionErrors(a: TreeStemResolutionPreviewError, b: TreeStemResolutionPreviewError): number {
  return (a.treeID ?? 0) - (b.treeID ?? 0) || a.reason.localeCompare(b.reason) || (a.rowIndex ?? 0) - (b.rowIndex ?? 0);
}

function normalizeCorrection(correction: SpeciesCorrectionSummary): SpeciesCorrectionSummary {
  return {
    ...correction,
    stems: [...correction.stems].sort((a, b) => a.stemGUID - b.stemGUID),
    measurements: [...correction.measurements].sort((a, b) => a.coreMeasurementID - b.coreMeasurementID)
  };
}

function stemsEqual(a: SpeciesCorrectionStemPrecondition[], b: SpeciesCorrectionStemPrecondition[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (left.stemGUID !== right.stemGUID || left.censusID !== right.censusID || left.quadratID !== right.quadratID || left.isActive !== right.isActive) {
      return false;
    }
  }
  return true;
}

function measurementsEqual(a: SpeciesCorrectionMeasurementPrecondition[], b: SpeciesCorrectionMeasurementPrecondition[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (
      left.coreMeasurementID !== right.coreMeasurementID ||
      left.stemGUID !== right.stemGUID ||
      left.censusID !== right.censusID ||
      left.isActive !== right.isActive ||
      left.priorRawSpCode !== right.priorRawSpCode
    ) {
      return false;
    }
  }
  return true;
}

/**
 * A case-only newSpeciesCode difference with the same newSpeciesID is tolerated because species
 * resolution is case-insensitive. Every stem/measurement field is compared, not just IDs.
 */
function classifyDisagreement(canonical: SpeciesCorrectionSummary, other: SpeciesCorrectionSummary): DisagreementKind {
  const sameSpeciesCode = canonical.newSpeciesCode === other.newSpeciesCode || canonical.newSpeciesCode.toLowerCase() === other.newSpeciesCode.toLowerCase();
  if (canonical.newSpeciesID !== other.newSpeciesID || !sameSpeciesCode) {
    return 'destination';
  }

  const membershipDisagrees =
    canonical.version !== other.version ||
    canonical.treeTag !== other.treeTag ||
    canonical.plotID !== other.plotID ||
    canonical.oldSpeciesID !== other.oldSpeciesID ||
    canonical.oldSpeciesCode !== other.oldSpeciesCode ||
    canonical.activeStemCount !== other.activeStemCount ||
    canonical.inactiveStemCount !== other.inactiveStemCount ||
    canonical.activeMeasurementCount !== other.activeMeasurementCount ||
    canonical.inactiveMeasurementCount !== other.inactiveMeasurementCount ||
    !stemsEqual(canonical.stems, other.stems) ||
    !measurementsEqual(canonical.measurements, other.measurements);

  return membershipDisagrees ? 'membership' : 'none';
}

function buildConflictError(
  treeID: number,
  treeTag: string,
  kind: 'destination' | 'membership',
  requestingRows: RequestingRow[],
  destinationCodesInRowIndexOrder: string[]
): TreeStemResolutionPreviewError {
  const rowIndexes = Array.from(new Set(requestingRows.map(row => row.rowIndex))).sort((a, b) => a - b);
  const message =
    kind === 'destination'
      ? `Tree T#${treeID} (TreeTag "${treeTag}") has conflicting species corrections requested in this batch: ${destinationCodesInRowIndexOrder.map(code => `"${code}"`).join(', ')}. Submit one species per tree in a single batch.`
      : `Tree T#${treeID} (TreeTag "${treeTag}")'s attached stems/measurements changed while this batch was being analyzed; re-review the upload before applying.`;

  return {
    kind: 'TreeStemResolution',
    subject: 'species',
    reason: 'group_species_conflict',
    field: 'SpeciesCode',
    message,
    severity: 'destructive',
    blocking: true,
    treeID,
    rowIndex: rowIndexes[0],
    rowIndexes
  };
}

export function buildSpeciesCorrectionGroups(rows: BulkSpeciesGroupRow[]): SpeciesCorrectionGroupingResult {
  const requestingByKey = new Map<string, RequestingRow[]>();

  for (const row of rows) {
    const correction = row.plan?.speciesCorrection;
    if (!correction) continue;
    const key = buildGroupKey(correction.targetTreeID, correction.censusID);
    const list = requestingByKey.get(key) ?? [];
    list.push({ rowIndex: row.rowIndex, targetID: row.targetID, correction });
    requestingByKey.set(key, list);
  }

  const groups: SpeciesCorrectionGroup[] = [];
  const errors: TreeStemResolutionPreviewError[] = [];

  for (const requestingRows of requestingByKey.values()) {
    requestingRows.sort((a, b) => a.rowIndex - b.rowIndex);

    const canonicalCorrection = normalizeCorrection(requestingRows[0].correction);

    let hasDestinationConflict = false;
    let hasMembershipConflict = false;
    const destinationCodesInRowIndexOrder: string[] = [];
    const seenDestinationCodes = new Set<string>();

    for (const requesting of requestingRows) {
      if (!seenDestinationCodes.has(requesting.correction.newSpeciesCode)) {
        seenDestinationCodes.add(requesting.correction.newSpeciesCode);
        destinationCodesInRowIndexOrder.push(requesting.correction.newSpeciesCode);
      }

      const normalized = normalizeCorrection(requesting.correction);
      const kind = classifyDisagreement(canonicalCorrection, normalized);
      if (kind === 'destination') hasDestinationConflict = true;
      else if (kind === 'membership') hasMembershipConflict = true;

      const targetIDIsInCanonicalMeasurements = canonicalCorrection.measurements.some(measurement => measurement.coreMeasurementID === requesting.targetID);
      if (!targetIDIsInCanonicalMeasurements) hasMembershipConflict = true;
    }

    // One error per key: corrections to two different species have no comparable membership.
    if (hasDestinationConflict) {
      errors.push(
        buildConflictError(canonicalCorrection.targetTreeID, canonicalCorrection.treeTag, 'destination', requestingRows, destinationCodesInRowIndexOrder)
      );
    } else if (hasMembershipConflict) {
      errors.push(
        buildConflictError(canonicalCorrection.targetTreeID, canonicalCorrection.treeTag, 'membership', requestingRows, destinationCodesInRowIndexOrder)
      );
    }

    const requestingRowIndexes = new Set(requestingRows.map(row => row.rowIndex));
    const members: SpeciesCorrectionGroupMember[] = requestingRows.map(requesting => ({
      rowIndex: requesting.rowIndex,
      coreMeasurementID: requesting.targetID,
      requestedCorrection: true
    }));

    for (const row of rows) {
      if (requestingRowIndexes.has(row.rowIndex)) continue;
      // Invalid rows never apply, so they must not change the hashed members list.
      if (row.status === 'invalid') continue;
      const isAttachedMeasurement = canonicalCorrection.measurements.some(measurement => measurement.coreMeasurementID === row.targetID);
      if (!isAttachedMeasurement) continue;
      members.push({ rowIndex: row.rowIndex, coreMeasurementID: row.targetID, requestedCorrection: false });
    }
    members.sort((a, b) => a.rowIndex - b.rowIndex);

    const affectedCoreMeasurementIDs = Array.from(new Set(canonicalCorrection.measurements.map(measurement => measurement.coreMeasurementID))).sort(
      (a, b) => a - b
    );
    const affectedStemGUIDs = Array.from(new Set(canonicalCorrection.stems.map(stem => stem.stemGUID))).sort((a, b) => a - b);

    groups.push({
      version: SPECIES_CORRECTION_GROUP_VERSION,
      treeID: canonicalCorrection.targetTreeID,
      censusID: canonicalCorrection.censusID,
      correction: canonicalCorrection,
      members,
      affectedCoreMeasurementIDs,
      affectedStemGUIDs
    });
  }

  groups.sort((a, b) => a.treeID - b.treeID || a.censusID - b.censusID);
  errors.sort(compareTreeStemResolutionErrors);

  return { groups, errors };
}

/**
 * Matched by shape rather than rule ID ('R1a'), which this module does not own. A false negative
 * only double-counts a downstream row in the aggregate; it cannot corrupt data.
 */
export function isSpeciesCorrectionEffect(effect: Effect, correction: SpeciesCorrectionSummary): boolean {
  if (effect.category !== 'identity' || effect.affectedTable !== 'trees') return false;
  const treeIDs = effect.references?.treeIDs;
  if (!treeIDs || treeIDs.length !== 1 || treeIDs[0] !== correction.targetTreeID) return false;
  return effect.references?.speciesID === correction.newSpeciesID;
}

// --- Batch-level integrity checks: compare against every row touching a group's membership
// (any status) and against duplicateDeletions, not just the requesting rows' own corrections.

function buildRequestedValue(rowIndex: number, field: string, to: unknown): RequestedValue {
  return { rowIndex, raw: to, normalized: normalizeFieldValueForComparison(field, to) };
}

interface RequestedValue {
  rowIndex: number;
  raw: unknown;
  normalized: unknown;
}

/** String comparison treats a number and its equivalent string as the same request. */
function requestedValuesAreEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
  return String(left) === String(right);
}

function collectDistinctRequestedValues(values: RequestedValue[]): RequestedValue[] {
  const distinct: RequestedValue[] = [];
  for (const value of values) {
    if (!distinct.some(existing => requestedValuesAreEquivalent(existing.normalized, value.normalized))) {
      distinct.push(value);
    }
  }
  return distinct;
}

interface FieldConflict {
  field: string;
  /** In first-seen (lowest-rowIndex) order. */
  values: RequestedValue[];
  rowIndexes: number[];
}

function collectSameMeasurementConflicts(inGroupRows: BulkSpeciesGroupRow[]): FieldConflict[] {
  const rowsByTargetID = new Map<number, BulkSpeciesGroupRow[]>();
  for (const row of inGroupRows) {
    const list = rowsByTargetID.get(row.targetID) ?? [];
    list.push(row);
    rowsByTargetID.set(row.targetID, list);
  }

  const conflicts: FieldConflict[] = [];
  for (const sameTargetRows of rowsByTargetID.values()) {
    if (sameTargetRows.length < 2) continue;
    // Sort before collecting so the first-seen value and the message do not depend on input order.
    sameTargetRows.sort((a, b) => a.rowIndex - b.rowIndex);

    const valuesByField = new Map<string, RequestedValue[]>();
    for (const row of sameTargetRows) {
      for (const change of row.plan?.fieldChanges ?? []) {
        const list = valuesByField.get(change.field) ?? [];
        list.push(buildRequestedValue(row.rowIndex, change.field, change.to));
        valuesByField.set(change.field, list);
      }
    }

    for (const [field, values] of valuesByField) {
      const distinct = collectDistinctRequestedValues(values);
      if (distinct.length > 1) {
        conflicts.push({ field, values: distinct, rowIndexes: values.map(value => value.rowIndex) });
      }
    }
  }
  return conflicts;
}

/** Different measurements on the same stem write the same stems row, so the last write would silently win. */
function collectSharedStemConflicts(group: SpeciesCorrectionGroup, inGroupRows: BulkSpeciesGroupRow[]): FieldConflict[] {
  const stemGUIDByTargetID = new Map<number, number>();
  for (const measurement of group.correction.measurements) {
    stemGUIDByTargetID.set(measurement.coreMeasurementID, measurement.stemGUID);
  }

  const rowsByStemGUID = new Map<number, BulkSpeciesGroupRow[]>();
  for (const row of inGroupRows) {
    const stemGUID = stemGUIDByTargetID.get(row.targetID);
    if (stemGUID === undefined) continue;
    const list = rowsByStemGUID.get(stemGUID) ?? [];
    list.push(row);
    rowsByStemGUID.set(stemGUID, list);
  }

  const conflicts: FieldConflict[] = [];
  for (const sameStemRows of rowsByStemGUID.values()) {
    if (sameStemRows.length < 2) continue;
    sameStemRows.sort((a, b) => a.rowIndex - b.rowIndex);

    for (const field of SHARED_STEM_FIELDS) {
      const values: RequestedValue[] = [];
      for (const row of sameStemRows) {
        const change = row.plan?.fieldChanges?.find(fieldChange => fieldChange.field === field);
        if (!change) continue;
        values.push(buildRequestedValue(row.rowIndex, field, change.to));
      }
      if (values.length < 2) continue;

      const distinct = collectDistinctRequestedValues(values);
      if (distinct.length > 1) {
        conflicts.push({ field, values: distinct, rowIndexes: values.map(value => value.rowIndex) });
      }
    }
  }
  return conflicts;
}

/** Fires even for an 'unchanged' row; a null explicitSpeciesCode is unspecified and never counts as a request. */
function detectSpeciesDisagreement(group: SpeciesCorrectionGroup, inGroupRows: BulkSpeciesGroupRow[]): TreeStemResolutionPreviewError | null {
  const destinationKey = group.correction.newSpeciesCode.trim().toLowerCase();
  const contradictionsByKey = new Map<string, { displayCode: string; minRowIndex: number; rowIndexes: number[] }>();

  for (const row of inGroupRows) {
    const explicit = row.explicitSpeciesCode;
    if (explicit === null || explicit === undefined) continue;
    const trimmed = explicit.trim();
    const key = trimmed.toLowerCase();
    if (key === destinationKey) continue;

    const existing = contradictionsByKey.get(key);
    if (existing) {
      existing.rowIndexes.push(row.rowIndex);
      if (row.rowIndex < existing.minRowIndex) {
        existing.minRowIndex = row.rowIndex;
        existing.displayCode = trimmed;
      }
    } else {
      contradictionsByKey.set(key, { displayCode: trimmed, minRowIndex: row.rowIndex, rowIndexes: [row.rowIndex] });
    }
  }

  if (contradictionsByKey.size === 0) return null;

  const orderedContradictions = Array.from(contradictionsByKey.values()).sort((a, b) => a.minRowIndex - b.minRowIndex);
  const rowIndexes = Array.from(new Set(orderedContradictions.flatMap(entry => entry.rowIndexes))).sort((a, b) => a - b);
  const contradictingCodesText = orderedContradictions.map(entry => `"${entry.displayCode}"`).join(', ');

  return {
    kind: 'TreeStemResolution',
    subject: 'species',
    reason: 'group_species_conflict',
    field: 'SpeciesCode',
    message:
      `Tree T#${group.treeID} (TreeTag "${group.correction.treeTag}") is being corrected to species "${group.correction.newSpeciesCode}" in this batch, ` +
      `but ${contradictingCodesText} ${orderedContradictions.length > 1 ? 'were' : 'was'} also explicitly requested for it. ` +
      `All rows for one tree must agree on its species in a single batch.`,
    severity: 'destructive',
    blocking: true,
    treeID: group.treeID,
    rowIndex: rowIndexes[0],
    rowIndexes
  };
}

/** Batch-level counterpart of rules/species.ts's per-row mixed_identity gate: a different row moving a sibling's identity. */
function detectIdentityOverlap(group: SpeciesCorrectionGroup, inGroupRows: BulkSpeciesGroupRow[]): TreeStemResolutionPreviewError | null {
  const identityFields: ReadonlySet<string> = new Set(GROUP_IDENTITY_OVERLAP_FIELDS);
  const rowIndexes = new Set<number>();
  const changedFields = new Set<string>();

  for (const row of inGroupRows) {
    for (const change of row.plan?.fieldChanges ?? []) {
      if (identityFields.has(change.field)) {
        rowIndexes.add(row.rowIndex);
        changedFields.add(change.field);
      }
    }
  }

  if (rowIndexes.size === 0) return null;

  const sortedRowIndexes = Array.from(rowIndexes).sort((a, b) => a - b);
  const sortedFields = Array.from(changedFields).sort((a, b) => a.localeCompare(b));

  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'group_identity_overlap',
    field: 'TreeTag',
    message:
      `Tree T#${group.treeID} (TreeTag "${group.correction.treeTag}") is being corrected in this batch while another row in the same batch ` +
      `changes its ${sortedFields.join('/')}. Submit identity changes (TreeTag/StemTag/QuadratName) separately from a species correction for the same tree.`,
    severity: 'destructive',
    blocking: true,
    treeID: group.treeID,
    rowIndex: sortedRowIndexes[0],
    rowIndexes: sortedRowIndexes
  };
}

/** A deletion with no matching survivor row still fires the error, just without a rowIndex. */
function detectMemberDeletion(
  group: SpeciesCorrectionGroup,
  rows: BulkSpeciesGroupRow[],
  duplicateDeletions: DuplicateDeletion[]
): TreeStemResolutionPreviewError | null {
  const affected: ReadonlySet<number> = new Set(group.affectedCoreMeasurementIDs);
  const offending = duplicateDeletions.filter(deletion => affected.has(deletion.coreMeasurementID));
  if (offending.length === 0) return null;

  const rowIndexByTargetID = new Map<number, number>();
  for (const row of rows) rowIndexByTargetID.set(row.targetID, row.rowIndex);

  const rowIndexes = new Set<number>();
  for (const deletion of offending) {
    const rowIndex = rowIndexByTargetID.get(deletion.survivorCoreMeasurementID);
    if (rowIndex !== undefined) rowIndexes.add(rowIndex);
  }

  const sortedRowIndexes = Array.from(rowIndexes).sort((a, b) => a - b);
  const deletedCoreMeasurementIDs = Array.from(new Set(offending.map(deletion => deletion.coreMeasurementID))).sort((a, b) => a - b);

  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'group_member_deletion',
    field: 'TreeTag',
    message:
      `Tree T#${group.treeID} (TreeTag "${group.correction.treeTag}")'s species correction covers CoreMeasurementID(s) ${deletedCoreMeasurementIDs.join(', ')}, ` +
      `which this same batch also deletes as duplicate(s). Resolve the duplicate deletion or drop the species correction for this tree before re-submitting.`,
    severity: 'destructive',
    blocking: true,
    treeID: group.treeID,
    rowIndex: sortedRowIndexes[0],
    rowIndexes: sortedRowIndexes
  };
}

/** Reuses subject 'stem' / field 'StemTag' because the field union has no member per coordinate column. */
function detectFieldConflicts(group: SpeciesCorrectionGroup, inGroupRows: BulkSpeciesGroupRow[]): TreeStemResolutionPreviewError | null {
  // Sort by field so the message text does not depend on input row order.
  const conflicts = [...collectSameMeasurementConflicts(inGroupRows), ...collectSharedStemConflicts(group, inGroupRows)].sort((a, b) =>
    a.field.localeCompare(b.field)
  );
  if (conflicts.length === 0) return null;

  const rowIndexes = Array.from(new Set(conflicts.flatMap(conflict => conflict.rowIndexes))).sort((a, b) => a - b);
  const conflictDescriptions = conflicts.map(conflict => `${conflict.field} (${conflict.values.map(value => `"${String(value.raw)}"`).join(' vs ')})`);

  return {
    kind: 'TreeStemResolution',
    subject: 'stem',
    reason: 'group_field_conflict',
    field: 'StemTag',
    message:
      `Tree T#${group.treeID} (TreeTag "${group.correction.treeTag}") has rows in this batch requesting different values for the same stored column: ` +
      `${conflictDescriptions.join('; ')}. These rows write the same underlying record, so only one requested value can be applied.`,
    severity: 'destructive',
    blocking: true,
    treeID: group.treeID,
    rowIndex: rowIndexes[0],
    rowIndexes
  };
}

/**
 * At most one error per (group, check). Rows of any status are considered, since an unchanged sibling
 * can still carry a contradicting explicitSpeciesCode or be a duplicate-deletion survivor.
 */
export function detectSpeciesGroupConflicts(
  rows: BulkSpeciesGroupRow[],
  groups: SpeciesCorrectionGroup[],
  duplicateDeletions: DuplicateDeletion[]
): TreeStemResolutionPreviewError[] {
  const errors: TreeStemResolutionPreviewError[] = [];

  for (const group of groups) {
    const affected: ReadonlySet<number> = new Set(group.affectedCoreMeasurementIDs);
    const inGroupRows = rows.filter(row => affected.has(row.targetID));

    const speciesError = detectSpeciesDisagreement(group, inGroupRows);
    if (speciesError) errors.push(speciesError);

    const identityError = detectIdentityOverlap(group, inGroupRows);
    if (identityError) errors.push(identityError);

    const deletionError = detectMemberDeletion(group, rows, duplicateDeletions);
    if (deletionError) errors.push(deletionError);

    const fieldConflictError = detectFieldConflicts(group, inGroupRows);
    if (fieldConflictError) errors.push(fieldConflictError);
  }

  return errors.sort(compareTreeStemResolutionErrors);
}

export function analyzeBulkSpeciesCorrections(rows: BulkSpeciesGroupRow[], duplicateDeletions: DuplicateDeletion[]): SpeciesCorrectionGroupingResult {
  const grouping = buildSpeciesCorrectionGroups(rows);
  const conflictErrors = detectSpeciesGroupConflicts(rows, grouping.groups, duplicateDeletions);
  const errors = [...grouping.errors, ...conflictErrors].sort(compareTreeStemResolutionErrors);
  return { groups: grouping.groups, errors };
}
