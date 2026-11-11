// Prepare/apply phases for tree-wide species corrections spanning several rows of a revision batch.
// The batch route must not re-run `analyzeEdit` per member: that would reapply the correction per
// sibling, misread the batch's own writes as drift, and hard-delete validation history via the
// single-row legacy path. Prepare issues no writes; apply writes member rows, then each correction once.
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { UserAuthRoles } from '@/config/macros';
import type { ApplyInTransactionInput } from './apply';
import {
  AppliedSpeciesCorrectionBatchSummary,
  AppliedSpeciesCorrectionGroupSummary,
  EditPlan,
  SpeciesCorrectionGroup,
  SpeciesCorrectionGroupMember
} from './types';
import {
  prepareTreeSpeciesCorrection,
  applyPreparedTreeSpeciesCorrection,
  assertNoEditedFieldDriftForSpeciesCorrection,
  PreparedSpeciesCorrection,
  AppliedSpeciesCorrectionResult
} from './tree-species-correction-writer';
import {
  loadLockedEditedFieldValuesForSpeciesCorrection,
  writeMeasurementsSummary,
  SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND,
  SpeciesCorrectionGroupMemberWriteContext
} from './writers/measurementssummary';

/** The group correction exclusively owns this field; a member's row-local write never resubmits it. */
const SPECIES_CODE_FIELD = 'SpeciesCode';

export interface BulkSpeciesCorrectionMemberInput {
  /** `BulkInput.matched[]` index, not a CSV line number. */
  rowIndex: number;
  coreMeasurementID: number;
  /** Authorized, hash-verified row plan. */
  plan: EditPlan;
  /** Server-computed from computeDiff. */
  newRow: Record<string, unknown>;
}

export interface BulkSpeciesCorrectionInput {
  schema: string;
  plotID: number;
  censusID: number;
  /** From the authorized, hash-verified BulkEditPlan. */
  groups: readonly SpeciesCorrectionGroup[];
  members: readonly BulkSpeciesCorrectionMemberInput[];
  createdBy: string;
  role?: UserAuthRoles | null;
}

/** Always a caller assembly bug, never a DB-state conflict. */
export type BulkSpeciesCorrectionInputErrorReason =
  | { kind: 'group-member-not-submitted'; treeID: number; censusID: number; coreMeasurementID: number }
  | { kind: 'member-not-in-exactly-one-group'; coreMeasurementID: number; groupCount: number }
  | { kind: 'group-missing-requester'; treeID: number; censusID: number }
  | { kind: 'duplicate-member'; coreMeasurementID: number };

export class BulkSpeciesCorrectionInputError extends Error {
  constructor(public readonly reason: BulkSpeciesCorrectionInputErrorReason) {
    super(BulkSpeciesCorrectionInputError.describe(reason));
    this.name = 'BulkSpeciesCorrectionInputError';
  }

  private static describe(reason: BulkSpeciesCorrectionInputErrorReason): string {
    switch (reason.kind) {
      case 'group-member-not-submitted':
        return `prepareBulkSpeciesCorrections: tree T#${reason.treeID} (census ${reason.censusID})'s correction group names CoreMeasurementID ${reason.coreMeasurementID} as a member, but no matching entry was submitted in input.members; the caller mis-assembled the batch.`;
      case 'member-not-in-exactly-one-group':
        return `prepareBulkSpeciesCorrections: submitted member CoreMeasurementID ${reason.coreMeasurementID} belongs to ${reason.groupCount} species-correction groups; it must belong to exactly one.`;
      case 'group-missing-requester':
        return `prepareBulkSpeciesCorrections: tree T#${reason.treeID} (census ${reason.censusID})'s correction group has no member with requestedCorrection === true.`;
      case 'duplicate-member':
        return `prepareBulkSpeciesCorrections: CoreMeasurementID ${reason.coreMeasurementID} appears more than once in input.members.`;
    }
  }
}

export type BulkSpeciesCorrectionUnresolvedMeasurementReason = 'not-found' | 'missing-stem-guid';

/** A failed/unresolved measurement cannot anchor a group's correction. */
export class BulkSpeciesCorrectionUnresolvedMeasurementError extends Error {
  constructor(
    public readonly coreMeasurementID: number,
    public readonly reason: BulkSpeciesCorrectionUnresolvedMeasurementReason
  ) {
    super(
      reason === 'not-found'
        ? `prepareBulkSpeciesCorrections: coremeasurements row ${coreMeasurementID} (the group's representative) was not found.`
        : `prepareBulkSpeciesCorrections: coremeasurements row ${coreMeasurementID} (the group's representative) has a NULL StemGUID; a failed/unresolved measurement cannot anchor a species correction.`
    );
    this.name = 'BulkSpeciesCorrectionUnresolvedMeasurementError';
  }
}

export interface PreparedBulkSpeciesCorrectionMemberWrite {
  readonly rowIndex: number;
  readonly coreMeasurementID: number;
  readonly applyInput: ApplyInTransactionInput;
  readonly plan: EditPlan;
  readonly groupMemberContext: SpeciesCorrectionGroupMemberWriteContext;
}

export interface PreparedBulkSpeciesCorrectionGroup {
  readonly group: SpeciesCorrectionGroup;
  readonly prepared: PreparedSpeciesCorrection;
  readonly representativeCoreMeasurementID: number;
  readonly representativeEditedStemGUID: number;
  readonly submittedMemberCoreMeasurementIDs: readonly number[];
  readonly memberWrites: readonly PreparedBulkSpeciesCorrectionMemberWrite[];
}

export interface PreparedBulkSpeciesCorrections {
  readonly transactionID: string;
  readonly schema: string;
  readonly plotID: number;
  readonly censusID: number;
  readonly groups: readonly PreparedBulkSpeciesCorrectionGroup[];
}

function indexSubmittedMembers(members: readonly BulkSpeciesCorrectionMemberInput[]): Map<number, BulkSpeciesCorrectionMemberInput> {
  const index = new Map<number, BulkSpeciesCorrectionMemberInput>();
  for (const member of members) {
    if (index.has(member.coreMeasurementID)) {
      throw new BulkSpeciesCorrectionInputError({ kind: 'duplicate-member', coreMeasurementID: member.coreMeasurementID });
    }
    index.set(member.coreMeasurementID, member);
  }
  return index;
}

function countGroupMembershipsByCoreMeasurementID(groups: readonly SpeciesCorrectionGroup[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const group of groups) {
    for (const member of group.members) {
      counts.set(member.coreMeasurementID, (counts.get(member.coreMeasurementID) ?? 0) + 1);
    }
  }
  return counts;
}

function validateBulkSpeciesCorrectionInput(input: BulkSpeciesCorrectionInput): Map<number, BulkSpeciesCorrectionMemberInput> {
  const submittedByID = indexSubmittedMembers(input.members);

  for (const group of input.groups) {
    for (const member of group.members) {
      if (!submittedByID.has(member.coreMeasurementID)) {
        throw new BulkSpeciesCorrectionInputError({
          kind: 'group-member-not-submitted',
          treeID: group.treeID,
          censusID: group.censusID,
          coreMeasurementID: member.coreMeasurementID
        });
      }
    }
    if (!group.members.some(member => member.requestedCorrection)) {
      throw new BulkSpeciesCorrectionInputError({ kind: 'group-missing-requester', treeID: group.treeID, censusID: group.censusID });
    }
  }

  const groupCounts = countGroupMembershipsByCoreMeasurementID(input.groups);
  for (const member of input.members) {
    const groupCount = groupCounts.get(member.coreMeasurementID) ?? 0;
    if (groupCount !== 1) {
      throw new BulkSpeciesCorrectionInputError({ kind: 'member-not-in-exactly-one-group', coreMeasurementID: member.coreMeasurementID, groupCount });
    }
  }

  return submittedByID;
}

/** Lowest rowIndex, so the choice is independent of input.members order. */
function selectGroupRepresentative(group: SpeciesCorrectionGroup): SpeciesCorrectionGroupMember {
  const requesters = group.members.filter(member => member.requestedCorrection);
  return requesters.reduce((lowest, candidate) => (candidate.rowIndex < lowest.rowIndex ? candidate : lowest));
}

interface LockedStemGUIDRow {
  StemGUID: number | null;
}

async function lockRepresentativeStemGUID(cm: ConnectionManager, schema: string, coreMeasurementID: number, transactionID: string): Promise<number> {
  const rows = (await cm.executeQuery(
    safeFormatQuery(schema, `SELECT StemGUID FROM ??.coremeasurements WHERE CoreMeasurementID = ? LIMIT 1 FOR UPDATE`),
    [coreMeasurementID],
    transactionID
  )) as LockedStemGUIDRow[];

  if (rows.length === 0) {
    throw new BulkSpeciesCorrectionUnresolvedMeasurementError(coreMeasurementID, 'not-found');
  }
  const stemGUID = rows[0].StemGUID;
  if (stemGUID === null) {
    throw new BulkSpeciesCorrectionUnresolvedMeasurementError(coreMeasurementID, 'missing-stem-guid');
  }
  return stemGUID;
}

function buildGroupMemberContext(
  input: BulkSpeciesCorrectionInput,
  transactionID: string,
  targetCoreMeasurementID: number
): SpeciesCorrectionGroupMemberWriteContext {
  return {
    kind: SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND,
    transactionID,
    schema: input.schema,
    plotID: input.plotID,
    censusID: input.censusID,
    targetCoreMeasurementID
  };
}

function buildApplyInput(input: BulkSpeciesCorrectionInput, transactionID: string, member: BulkSpeciesCorrectionMemberInput): ApplyInTransactionInput {
  return {
    dataType: 'measurementssummary',
    schema: input.schema,
    plotID: input.plotID,
    censusID: input.censusID,
    targetID: member.coreMeasurementID,
    newRow: member.newRow,
    expectedPlanHash: null,
    operationType: 'bulk-revision-row',
    revertable: false,
    writeLedger: false,
    refreshViews: false,
    createdBy: input.createdBy,
    role: input.role,
    transactionID,
    schemaEnsured: true
  };
}

/** Returns null when SpeciesCode was the member's only change, since the group correction owns it. */
async function prepareGroupMemberWrite(
  cm: ConnectionManager,
  input: BulkSpeciesCorrectionInput,
  transactionID: string,
  member: BulkSpeciesCorrectionMemberInput
): Promise<PreparedBulkSpeciesCorrectionMemberWrite | null> {
  const rowLocalFieldChanges = member.plan.fieldChanges.filter(change => change.field !== SPECIES_CODE_FIELD);
  if (rowLocalFieldChanges.length === 0) return null;

  const lockedCurrentFieldValues = await loadLockedEditedFieldValuesForSpeciesCorrection(cm, input.schema, member.coreMeasurementID, transactionID);
  assertNoEditedFieldDriftForSpeciesCorrection(rowLocalFieldChanges, lockedCurrentFieldValues);

  const { speciesCorrection: _speciesCorrection, ...planWithoutCorrection } = member.plan;
  const rowLocalPlan: EditPlan = { ...planWithoutCorrection, fieldChanges: rowLocalFieldChanges };

  return {
    rowIndex: member.rowIndex,
    coreMeasurementID: member.coreMeasurementID,
    applyInput: buildApplyInput(input, transactionID, member),
    plan: rowLocalPlan,
    groupMemberContext: buildGroupMemberContext(input, transactionID, member.coreMeasurementID)
  };
}

/** Member writes inherit `group.members`' ascending-rowIndex order, which the analyzer guarantees. */
async function prepareGroup(
  cm: ConnectionManager,
  input: BulkSpeciesCorrectionInput,
  transactionID: string,
  submittedByID: Map<number, BulkSpeciesCorrectionMemberInput>,
  group: SpeciesCorrectionGroup
): Promise<PreparedBulkSpeciesCorrectionGroup> {
  const representative = selectGroupRepresentative(group);
  const representativeEditedStemGUID = await lockRepresentativeStemGUID(cm, input.schema, representative.coreMeasurementID, transactionID);

  const prepared = await prepareTreeSpeciesCorrection(
    cm,
    input.schema,
    {
      previewedCorrection: group.correction,
      editedCoreMeasurementID: representative.coreMeasurementID,
      editedStemGUID: representativeEditedStemGUID
    },
    transactionID
  );

  const memberWrites: PreparedBulkSpeciesCorrectionMemberWrite[] = [];
  for (const groupMember of group.members) {
    const memberInput = submittedByID.get(groupMember.coreMeasurementID);
    if (!memberInput) continue;
    const write = await prepareGroupMemberWrite(cm, input, transactionID, memberInput);
    if (write) memberWrites.push(write);
  }

  return {
    group,
    prepared,
    representativeCoreMeasurementID: representative.coreMeasurementID,
    representativeEditedStemGUID,
    submittedMemberCoreMeasurementIDs: group.members.map(member => member.coreMeasurementID),
    memberWrites
  };
}

/**
 * Read-only. Same-field conflicts between members are not re-checked here: the analyzer's
 * `group_field_conflict` blocker refuses them before apply is reachable.
 */
export async function prepareBulkSpeciesCorrections(
  cm: ConnectionManager,
  input: BulkSpeciesCorrectionInput,
  transactionID: string
): Promise<PreparedBulkSpeciesCorrections> {
  const submittedByID = validateBulkSpeciesCorrectionInput(input);

  const groups: PreparedBulkSpeciesCorrectionGroup[] = [];
  for (const group of input.groups) {
    groups.push(await prepareGroup(cm, input, transactionID, submittedByID, group));
  }

  return {
    transactionID,
    schema: input.schema,
    plotID: input.plotID,
    censusID: input.censusID,
    groups
  };
}

// --- APPLY phase: consumes only the prepared result; never re-plans or re-reads a guard.

export interface BulkSpeciesCorrectionApplyScope {
  readonly schema: string;
  readonly plotID: number;
  readonly censusID: number;
}

export type BulkSpeciesCorrectionApplyScopeMismatchReason =
  | { kind: 'transaction'; preparedTransactionID: string; applyTransactionID: string }
  | { kind: 'schema'; preparedSchema: string; expectedSchema: string }
  | { kind: 'plotID'; preparedPlotID: number; expectedPlotID: number }
  | { kind: 'censusID'; preparedCensusID: number; expectedCensusID: number };

export class BulkSpeciesCorrectionApplyScopeMismatchError extends Error {
  constructor(public readonly reason: BulkSpeciesCorrectionApplyScopeMismatchReason) {
    super(BulkSpeciesCorrectionApplyScopeMismatchError.describe(reason));
    this.name = 'BulkSpeciesCorrectionApplyScopeMismatchError';
  }

  private static describe(reason: BulkSpeciesCorrectionApplyScopeMismatchReason): string {
    switch (reason.kind) {
      case 'transaction':
        return `applyPreparedBulkSpeciesCorrections: prepared batch was captured under transaction "${reason.preparedTransactionID}" but is being applied under transaction "${reason.applyTransactionID}"; a locked preparation can only be applied inside the exact transaction that captured it.`;
      case 'schema':
        return `applyPreparedBulkSpeciesCorrections: prepared batch was captured under schema "${reason.preparedSchema}" but is being applied for schema "${reason.expectedSchema}".`;
      case 'plotID':
        return `applyPreparedBulkSpeciesCorrections: prepared batch was captured under plotID ${reason.preparedPlotID} but is being applied for plotID ${reason.expectedPlotID}.`;
      case 'censusID':
        return `applyPreparedBulkSpeciesCorrections: prepared batch was captured under censusID ${reason.preparedCensusID} but is being applied for censusID ${reason.expectedCensusID}.`;
    }
  }
}

function assertAppliedScopeMatchesPrepared(prepared: PreparedBulkSpeciesCorrections, scope: BulkSpeciesCorrectionApplyScope, txID: string): void {
  if (prepared.transactionID !== txID) {
    throw new BulkSpeciesCorrectionApplyScopeMismatchError({ kind: 'transaction', preparedTransactionID: prepared.transactionID, applyTransactionID: txID });
  }
  if (prepared.schema !== scope.schema) {
    throw new BulkSpeciesCorrectionApplyScopeMismatchError({ kind: 'schema', preparedSchema: prepared.schema, expectedSchema: scope.schema });
  }
  if (Number(prepared.plotID) !== Number(scope.plotID)) {
    throw new BulkSpeciesCorrectionApplyScopeMismatchError({ kind: 'plotID', preparedPlotID: Number(prepared.plotID), expectedPlotID: Number(scope.plotID) });
  }
  if (Number(prepared.censusID) !== Number(scope.censusID)) {
    throw new BulkSpeciesCorrectionApplyScopeMismatchError({
      kind: 'censusID',
      preparedCensusID: Number(prepared.censusID),
      expectedCensusID: Number(scope.censusID)
    });
  }
}

/** Derived from the applied correction, never the previewed group. */
export type BulkSpeciesCorrectionGroupResult = AppliedSpeciesCorrectionGroupSummary;

export type BulkSpeciesCorrectionResult = AppliedSpeciesCorrectionBatchSummary;

function dedupeSortedAscending(ids: Iterable<number>): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function collectGroupUpdatedMemberCoreMeasurementIDs(preparedGroup: PreparedBulkSpeciesCorrectionGroup): number[] {
  const memberWriteIDs = new Set(preparedGroup.memberWrites.map(write => write.coreMeasurementID));
  const updated = new Set<number>();
  for (const member of preparedGroup.group.members) {
    if (member.requestedCorrection || memberWriteIDs.has(member.coreMeasurementID)) {
      updated.add(member.coreMeasurementID);
    }
  }
  return Array.from(updated);
}

function buildGroupResult(preparedGroup: PreparedBulkSpeciesCorrectionGroup, applied: AppliedSpeciesCorrectionResult): BulkSpeciesCorrectionGroupResult {
  const { correction, errorRefresh } = applied;

  const activeCoreMeasurementIDs = dedupeSortedAscending(correction.measurements.filter(m => m.isActive).map(m => m.coreMeasurementID));
  const inactiveCoreMeasurementIDs = dedupeSortedAscending(correction.measurements.filter(m => !m.isActive).map(m => m.coreMeasurementID));
  const affectedCoreMeasurementIDs = dedupeSortedAscending([
    ...correction.measurements.map(m => m.coreMeasurementID),
    ...errorRefresh.ingestionRefreshedMeasurementIDs,
    ...errorRefresh.pendingMeasurementIDs
  ]);
  const affectedStemGUIDs = dedupeSortedAscending(correction.stems.map(s => s.stemGUID));

  return {
    treeID: correction.targetTreeID,
    censusID: correction.censusID,
    treeTag: correction.treeTag,
    oldSpeciesID: correction.oldSpeciesID,
    oldSpeciesCode: correction.oldSpeciesCode,
    newSpeciesID: correction.newSpeciesID,
    newSpeciesCode: correction.newSpeciesCode,
    activeCoreMeasurementIDs,
    inactiveCoreMeasurementIDs,
    affectedCoreMeasurementIDs,
    affectedStemGUIDs,
    submittedMemberCoreMeasurementIDs: dedupeSortedAscending(preparedGroup.submittedMemberCoreMeasurementIDs)
  };
}

/** Errors propagate unchanged so the caller's outer transaction rolls back the whole batch. */
export async function applyPreparedBulkSpeciesCorrections(
  cm: ConnectionManager,
  prepared: PreparedBulkSpeciesCorrections,
  scope: BulkSpeciesCorrectionApplyScope,
  txID: string
): Promise<BulkSpeciesCorrectionResult> {
  assertAppliedScopeMatchesPrepared(prepared, scope, txID);

  const groups: BulkSpeciesCorrectionGroupResult[] = [];
  // Deliberately not deduplicated: corrections are counted per group, even for a shared treeID.
  const correctedTreeIDs: number[] = [];
  const updatedMemberIDsAcrossGroups: number[] = [];
  const submittedMemberIDsAcrossGroups: number[] = [];

  for (const preparedGroup of prepared.groups) {
    // Members first: the correction's closing revalidation must observe each row's final values.
    for (const write of preparedGroup.memberWrites) {
      await writeMeasurementsSummary(cm, write.applyInput, write.plan, txID, write.groupMemberContext);
    }

    const applied = await applyPreparedTreeSpeciesCorrection(cm, prepared.schema, preparedGroup.prepared, txID);

    correctedTreeIDs.push(applied.correction.targetTreeID);
    updatedMemberIDsAcrossGroups.push(...collectGroupUpdatedMemberCoreMeasurementIDs(preparedGroup));
    submittedMemberIDsAcrossGroups.push(...preparedGroup.submittedMemberCoreMeasurementIDs);
    groups.push(buildGroupResult(preparedGroup, applied));
  }

  const updatedMemberCoreMeasurementIDs = dedupeSortedAscending(updatedMemberIDsAcrossGroups);
  const submittedMemberCoreMeasurementIDs = new Set(dedupeSortedAscending(submittedMemberIDsAcrossGroups));
  const allAffectedCoreMeasurementIDs = dedupeSortedAscending([...groups.flatMap(g => g.affectedCoreMeasurementIDs), ...updatedMemberCoreMeasurementIDs]);
  const additionalAffectedCoreMeasurementIDs = allAffectedCoreMeasurementIDs.filter(id => !submittedMemberCoreMeasurementIDs.has(id));

  return {
    correctedTreeIDs,
    updatedMemberCoreMeasurementIDs,
    additionalAffectedCoreMeasurementIDs,
    allAffectedCoreMeasurementIDs,
    groups
  };
}
