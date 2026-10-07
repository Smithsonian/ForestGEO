// Batch/bulk ANALYSIS stage for #427 tree-wide species corrections.
//
// `analyzeEdit` plans one row at a time: when a revision upload contains
// several sibling rows that all belong to the same tree (same TreeID +
// CensusID) and all request a species correction, each row independently
// produces its own `EditPlan.speciesCorrection` carrying the FULL tree
// membership (every attached stem/measurement). This module collapses those
// N identical/near-identical per-row corrections into ONE canonical
// `SpeciesCorrectionGroup` per (treeID, censusID), without hiding a genuine
// disagreement between siblings and without ever letting file/query order
// decide which row "wins" — the lowest `rowIndex` is always canonical, and
// membership/affected-ID sets are always re-sorted so enumeration order is
// never load-bearing (the same reasoning `planhash.ts` applies to
// `SpeciesCorrectionSummary.stems`/`measurements`).
//
// Pure, synchronous, in-memory: no DB access, no ConnectionManager, no I/O.
// A later slice (batch WRITER stage) wires this module's output into
// `analyzeBulk`'s `BulkEditPlan.speciesCorrectionGroups`.
import {
  DuplicateDeletion,
  Effect,
  EditPlan,
  RowPlan,
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
 * Canonical fields stored on the `stems` row (not on `coremeasurements`), so
 * two batch rows targeting two DIFFERENT measurements of the SAME stem both
 * write the same physical column. Whichever row is applied last silently
 * wins, which is exactly the order-dependent outcome #427 must refuse.
 *
 * Identity fields (`TreeTag`, `StemTag`, `QuadratName`) are deliberately NOT
 * in this list — a row changing one of those is caught by the stronger
 * `group_identity_overlap` check (another row re-pointing a sibling's
 * identity entirely), not by a same-column-write comparison.
 */
const SHARED_STEM_FIELDS = ['StemLocalX', 'StemLocalY', 'StemPlotX', 'StemPlotY'] as const;

/**
 * Identity fields that, when actually changed on a row OTHER than the one
 * requesting the species correction, mean a sibling batch row is re-pointing
 * this tree's identity while the batch is also correcting its species. This
 * is the batch-level counterpart of `rules/species.ts`'s `MIXED_IDENTITY_FIELDS`
 * gate: that one blocks species + identity changed together in the SAME row;
 * this one blocks a DIFFERENT row moving a sibling's identity.
 */
const GROUP_IDENTITY_OVERLAP_FIELDS = ['TreeTag', 'StemTag', 'QuadratName'] as const;

/**
 * The single ordering rule for every `group_*` `TreeStemResolutionPreviewError`
 * this module produces: by `treeID`, then `reason`, then the lowest involved
 * `rowIndex`. Shared by `buildSpeciesCorrectionGroups`, `detectSpeciesGroupConflicts`,
 * and `analyzeBulkSpeciesCorrections` so there is exactly one sort comparator,
 * not three copies that could silently drift apart.
 */
export function compareTreeStemResolutionErrors(a: TreeStemResolutionPreviewError, b: TreeStemResolutionPreviewError): number {
  return (a.treeID ?? 0) - (b.treeID ?? 0) || a.reason.localeCompare(b.reason) || (a.rowIndex ?? 0) - (b.rowIndex ?? 0);
}

/**
 * Re-sorts `stems`/`measurements` ascending the same way `planhash.ts`'s
 * `normalizeSpeciesCorrection` does, and always returns a NEW object/arrays
 * so the caller's correction (and its own `stems`/`measurements` arrays) are
 * never mutated. Every other field is a reference copy of a plain
 * primitive, so no further cloning is needed.
 */
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
 * Compares two (already-normalized, i.e. sorted) corrections for the SAME
 * (treeID, censusID) key field by field — never by `JSON.stringify` and
 * never by reaching into `planhash.ts` (that module canonicalizes a whole
 * plan for hashing; this stage needs a classified reason, not a hash).
 *
 * - `destination`: the requested destination disagrees — `newSpeciesID`
 *   differs, or `newSpeciesCode` differs by more than case. A case-only
 *   `newSpeciesCode` spelling difference with the SAME `newSpeciesID` is
 *   tolerated, not reported: species resolution is case-insensitive
 *   (`rules/species.ts`/`resolveSpeciesByCode`) and the planner reads back
 *   the DB-canonical spelling, so two consistent requests should never
 *   actually disagree on casing — but if they did, blocking a no-op
 *   destination would be worse than tolerating it.
 * - `membership`: everything else that describes tree state/membership
 *   disagrees — `version`, `treeTag`, `plotID`, `oldSpeciesID`,
 *   `oldSpeciesCode`, any of the four counts, or the sorted
 *   `stems`/`measurements` records themselves (every field of every
 *   record, not just ID lists/lengths, so an equal-count activity swap or a
 *   measurement moved between two already-attached sibling stems is
 *   detected — the same drift `planhash.ts` is built to catch).
 * - `none`: the two corrections agree in every field that matters.
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

      // Defensive, honest check (do not silently hide a violation): the
      // planner guarantees a requesting row's own targetID (CoreMeasurementID)
      // is among its correction's measurements. If the CANONICAL correction's
      // measurements for this key do not include it, membership disagrees
      // for this key — report it rather than accepting the row anyway.
      const targetIDIsInCanonicalMeasurements = canonicalCorrection.measurements.some(measurement => measurement.coreMeasurementID === requesting.targetID);
      if (!targetIDIsInCanonicalMeasurements) hasMembershipConflict = true;
    }

    // Destination disagreement takes priority: if the destinations
    // genuinely differ, the corrections' state fields are not comparable in
    // a meaningful way (they describe correcting to two different species),
    // so one error per key is reported, not two.
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
      // `members` is hashed and describes rows the correction will actually
      // cover; a row that can never apply must not change the plan hash (B2).
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
      version: 1,
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
 * Identifies the single per-row species-correction `Effect` that
 * `rules/species.ts#applySpeciesRules` attaches to a row's `EditPlan`, so a
 * later batch-aggregation stage can keep ONE copy per group instead of
 * summing one per sibling row (which would over-report the downstream row
 * count in the aggregated effect).
 *
 * Matched by the effect's SHAPE — `category`, `affectedTable`, and
 * `references` — not by the rule ID literal (`'R1a'`), which lives in
 * `rules/species.ts` and this stage does not own. A false negative here
 * (e.g. the rule ID or shape changes upstream) only costs a duplicate-
 * counted downstream row in the aggregate; it cannot corrupt data, so
 * coupling to a string this module does not control is not worth the
 * fragility.
 */
export function isSpeciesCorrectionEffect(effect: Effect, correction: SpeciesCorrectionSummary): boolean {
  if (effect.category !== 'identity' || effect.affectedTable !== 'trees') return false;
  const treeIDs = effect.references?.treeIDs;
  if (!treeIDs || treeIDs.length !== 1 || treeIDs[0] !== correction.targetTreeID) return false;
  return effect.references?.speciesID === correction.newSpeciesID;
}

// --- Batch-level integrity checks (detectSpeciesGroupConflicts, below) ----
//
// `buildSpeciesCorrectionGroups` only compares requesting rows' OWN
// corrections against each other. The checks below additionally look at
// every other batch row touching a group's membership (any status,
// including a row that produced no `speciesCorrection` at all) and at the
// batch's `duplicateDeletions`, to catch contradictions that never show up
// inside a `SpeciesCorrectionSummary`.

function buildRequestedValue(rowIndex: number, field: string, to: unknown): RequestedValue {
  return { rowIndex, raw: to, normalized: normalizeFieldValueForComparison(field, to) };
}

interface RequestedValue {
  rowIndex: number;
  raw: unknown;
  normalized: unknown;
}

/**
 * Equal if strictly equal, or both sides are null/undefined (a cleared
 * value), or their string renderings match (tolerates a value requested as a
 * `number` on one row and the equivalent `string` on another — the two are
 * the same request, not a conflict).
 */
function requestedValuesAreEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
  return String(left) === String(right);
}

/**
 * Collapses a list of (rowIndex, requested value) pairs for the SAME field
 * into one entry per distinct value, each keeping the first rowIndex/raw
 * spelling that supplied it. Consistent duplicate requests (every value
 * equivalent) collapse to a single entry, so they never read as a conflict.
 */
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
  /** Every distinct requested value, in first-seen (lowest-rowIndex) order. */
  values: RequestedValue[];
  /** Every row that contributed any of the requests above. */
  rowIndexes: number[];
}

/**
 * Check D1 (defensive): two in-group rows sharing the same `targetID`
 * (CoreMeasurementID) requesting different values for the same canonical
 * field. Duplicate `targetID`s are rejected upstream of this module today,
 * so in practice `sameTargetRows.length` is never >1 — but if that upstream
 * guarantee ever broke, this must actually fire rather than silently trust
 * it, so it is implemented honestly rather than treated as unreachable.
 */
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
    // Sorted ascending by rowIndex BEFORE any value is collected: `values`
    // (and therefore `collectDistinctRequestedValues`' first-seen entry and
    // the rendered message) must be identical regardless of which order the
    // conflicting rows arrive in `inGroupRows`.
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

/**
 * Check D2: two in-group rows whose `targetID`s resolve (via
 * `group.correction.measurements`) to the SAME `stemGUID` requesting
 * different values for a `SHARED_STEM_FIELDS` column — the two measurements
 * are different rows, but the column they write is the same `stems` row, so
 * whichever request is applied last would silently overwrite the other.
 */
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
    // Same ordering guarantee as `collectSameMeasurementConflicts`: sort by
    // rowIndex BEFORE collecting values so the result never depends on the
    // order the sharing rows happen to appear in `inGroupRows`.
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

/**
 * Check A: a row with a non-null `explicitSpeciesCode` that disagrees
 * (case-insensitively, after trimming) with the group's canonical
 * destination — even when that row's own `status` is `'unchanged'` and it
 * produced no `fieldChange`, because the row still explicitly asked for a
 * species the group's destination contradicts. A null/absent
 * `explicitSpeciesCode` is "unspecified" and never manufactures a request.
 */
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

/**
 * Check B: another batch row (any status) whose `plan.fieldChanges` actually
 * changes `TreeTag`, `StemTag`, or `QuadratName` — re-pointing identity on a
 * tree this group is also correcting. This is the batch-level counterpart of
 * the per-row `mixed_identity` gate in `rules/species.ts`: that one catches
 * species+identity changed together in the SAME row; this one catches a
 * DIFFERENT row moving a sibling's identity.
 */
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

/**
 * Check C: the batch's `duplicateDeletions` also delete a measurement this
 * group's correction affects — the correction's membership (and its undo
 * contract) was computed over measurements the same batch would destroy.
 * A `DuplicateDeletion` has no `rowIndex` of its own; `rowIndexes` is derived
 * by mapping each offending deletion's `survivorCoreMeasurementID` back to a
 * row's `targetID`. When no row matches a survivor, that deletion's
 * `rowIndex` is simply omitted — the error still fires rather than being
 * dropped for lack of a row to blame.
 */
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

/**
 * Check D: two in-group rows requesting contradictory values for the same
 * stored column — either the same measurement (D1, defensive) or the same
 * shared `stems` column via `SHARED_STEM_FIELDS` (D2). The `field` union has
 * no member for an arbitrary coordinate column, so this reuses
 * `subject: 'stem'` / `field: 'StemTag'` — the same precedent
 * `rules/species.ts`'s edited-stem/edited-measurement failures already
 * establish (distinguished by `reason` and message text, not by adding a new
 * union member per column). Consistent duplicate requests (every row wants
 * the same value) never reach here: `collectDistinctRequestedValues`
 * collapses them before a conflict is recorded.
 */
function detectFieldConflicts(group: SpeciesCorrectionGroup, inGroupRows: BulkSpeciesGroupRow[]): TreeStemResolutionPreviewError | null {
  // Sorted by field name (not left as insertion order): `collectSameMeasurementConflicts`
  // and `collectSharedStemConflicts` each group rows by a Map keyed off
  // whichever distinct targetID/stemGUID is FIRST seen in `inGroupRows`, so
  // without this sort the merged list — and the message text built from it
  // below — could vary with input row order whenever a group has more than
  // one conflicting field. Alphabetical by field name is itself
  // order-independent, unlike "whichever conflict's row happened first".
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
 * Runs checks A–D for every group, aggregating ALL involved rows into AT
 * MOST ONE error per (group, check) — a 50-row batch cannot produce 50
 * copies of the same blocker. Considers every row in `rows` regardless of
 * `status` (including `'unchanged'`/`'invalid'`) whose `targetID` is among
 * `group.affectedCoreMeasurementIDs`, since a sibling that produced no
 * `EditPlan.fieldChanges` at all can still carry a disqualifying
 * `explicitSpeciesCode` (check A) or be the deletion survivor named in a
 * `DuplicateDeletion` (check C).
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

/**
 * The one function `analyzeBulk` calls: group the batch's per-row species
 * corrections, then run every batch-level integrity check over the same rows,
 * merging both error sets into one deterministically ordered list.
 */
export function analyzeBulkSpeciesCorrections(rows: BulkSpeciesGroupRow[], duplicateDeletions: DuplicateDeletion[]): SpeciesCorrectionGroupingResult {
  const grouping = buildSpeciesCorrectionGroups(rows);
  const conflictErrors = detectSpeciesGroupConflicts(rows, grouping.groups, duplicateDeletions);
  const errors = [...grouping.errors, ...conflictErrors].sort(compareTreeStemResolutionErrors);
  return { groups: grouping.groups, errors };
}
