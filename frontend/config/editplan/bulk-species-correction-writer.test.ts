import { describe, it, expect, vi, beforeEach } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { EditPlan, SpeciesCorrectionGroup, SpeciesCorrectionSummary } from './types';

// ---------------------------------------------------------------------------
// Mocks for the two collaborators this module calls: the once-per-group
// tree correction (prepare/apply split) and the per-member row-local
// writer. Both are fully replaced — see tree-species-correction-writer.ts's
// own test file for the established `vi.hoisted` convention this mirrors.
// `callOrder` is shared mutable state every mock implementation below
// pushes onto, so a test can assert ACROSS collaborators (e.g. "every
// member write happened before the group's correction apply") rather than
// merely counting calls on each mock in isolation.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  prepareTreeSpeciesCorrectionMock: vi.fn(),
  applyPreparedTreeSpeciesCorrectionMock: vi.fn(),
  assertNoEditedFieldDriftForSpeciesCorrectionMock: vi.fn(),
  loadLockedEditedFieldValuesForSpeciesCorrectionMock: vi.fn(),
  writeMeasurementsSummaryMock: vi.fn(),
  callOrder: [] as string[]
}));

vi.mock('./tree-species-correction-writer', () => ({
  prepareTreeSpeciesCorrection: (...args: unknown[]) => mocks.prepareTreeSpeciesCorrectionMock(...args),
  applyPreparedTreeSpeciesCorrection: (...args: unknown[]) => mocks.applyPreparedTreeSpeciesCorrectionMock(...args),
  assertNoEditedFieldDriftForSpeciesCorrection: (...args: unknown[]) => mocks.assertNoEditedFieldDriftForSpeciesCorrectionMock(...args)
}));

vi.mock('./writers/measurementssummary', () => ({
  loadLockedEditedFieldValuesForSpeciesCorrection: (...args: unknown[]) => mocks.loadLockedEditedFieldValuesForSpeciesCorrectionMock(...args),
  writeMeasurementsSummary: (...args: unknown[]) => mocks.writeMeasurementsSummaryMock(...args),
  // The SUT imports this constant directly (to stamp `groupMemberContext.kind`).
  // `vi.mock` replaces the ENTIRE module — omitting it would silently hand
  // the SUT `undefined` for every group-member write's `kind` field.
  SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND: 'species-correction-group-member'
}));

import {
  prepareBulkSpeciesCorrections,
  applyPreparedBulkSpeciesCorrections,
  BulkSpeciesCorrectionInputError,
  BulkSpeciesCorrectionUnresolvedMeasurementError,
  BulkSpeciesCorrectionApplyScopeMismatchError,
  type BulkSpeciesCorrectionInput,
  type BulkSpeciesCorrectionMemberInput,
  type PreparedBulkSpeciesCorrectionGroup,
  type PreparedBulkSpeciesCorrectionMemberWrite,
  type PreparedBulkSpeciesCorrections,
  type BulkSpeciesCorrectionApplyScope
} from './bulk-species-correction-writer';

// ---------------------------------------------------------------------------
// Named constants — no magic numbers/strings in any fixture or assertion
// below. Reused verbatim in both fixture construction and expectations.
// ---------------------------------------------------------------------------
const TEST_SCHEMA = 'forestgeo_test';
const OTHER_SCHEMA = 'forestgeo_other';
const PLOT_ID = 3;
const CENSUS_ID = 7;
const TRANSACTION_ID = 'tx-427-bulk';
const OTHER_TRANSACTION_ID = 'tx-427-bulk-other';
const CREATED_BY = 'tester@example.com';

const TREE_ID_A = 101;
const TREE_TAG_A = 'T-101';
const OLD_SPECIES_ID = 1;
const OLD_SPECIES_CODE = 'ACERUB';
const NEW_SPECIES_ID = 2;
const NEW_SPECIES_CODE = 'QUEALB';

// Group A: a requester (CM_A1, has a row-local field change too) plus an
// "unchanged" sibling (CM_A2) pulled in by tree membership with no
// row-local field change of its own.
const CM_A1 = 1001;
const CM_A2 = 1002;
// Group B: a second, independent group's sole requester.
const CM_B1 = 2001;
// Attached to tree A but never submitted in this batch at all — an
// "additionally affected" measurement, never a group member.
const CM_SIBLING_NOT_SUBMITTED = 9999;
// Used only by the input-validation test: deliberately placed in TWO groups.
const DUPLICATE_GROUP_MEMBER_CM = 3001;

const STEM_GUID_A = 5001;
const STEM_GUID_B = 6001;

// Mirrors the SUT's own private `SPECIES_CODE_FIELD` constant (not exported
// — see final report for this drift from the task's approximation).
const SPECIES_CODE_FIELD = 'SpeciesCode';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildCorrectionSummary(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
  return {
    version: 1,
    targetTreeID: TREE_ID_A,
    treeTag: TREE_TAG_A,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    oldSpeciesID: OLD_SPECIES_ID,
    oldSpeciesCode: OLD_SPECIES_CODE,
    newSpeciesID: NEW_SPECIES_ID,
    newSpeciesCode: NEW_SPECIES_CODE,
    activeStemCount: 1,
    inactiveStemCount: 0,
    activeMeasurementCount: 1,
    inactiveMeasurementCount: 0,
    stems: [{ stemGUID: STEM_GUID_A, censusID: CENSUS_ID, quadratID: 1, isActive: true }],
    measurements: [{ coreMeasurementID: CM_A1, stemGUID: STEM_GUID_A, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE }],
    ...overrides
  };
}

function buildGroup(overrides: Partial<SpeciesCorrectionGroup> = {}): SpeciesCorrectionGroup {
  return {
    version: 1,
    treeID: TREE_ID_A,
    censusID: CENSUS_ID,
    correction: buildCorrectionSummary(),
    members: [{ rowIndex: 0, coreMeasurementID: CM_A1, requestedCorrection: true }],
    affectedCoreMeasurementIDs: [CM_A1],
    affectedStemGUIDs: [STEM_GUID_A],
    ...overrides
  };
}

/** A species-only plan: `prepareGroupMemberWrite` must treat this as needing NO row-local write. */
function buildSpeciesOnlyPlan(coreMeasurementID: number, overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID: coreMeasurementID,
    fieldChanges: [{ field: SPECIES_CODE_FIELD, from: OLD_SPECIES_CODE, to: NEW_SPECIES_CODE }],
    effects: [],
    maxSeverity: 'destructive',
    planHash: `hash-${coreMeasurementID}`,
    generatedAt: '2026-01-01T00:00:00.000Z',
    speciesCorrection: buildCorrectionSummary(),
    ...overrides
  };
}

/** A plan with a genuine row-local field change (never `SpeciesCode` itself — that field is group-owned). */
function buildRowLocalPlan(coreMeasurementID: number, overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    ...buildSpeciesOnlyPlan(coreMeasurementID),
    fieldChanges: [
      { field: SPECIES_CODE_FIELD, from: OLD_SPECIES_CODE, to: NEW_SPECIES_CODE },
      { field: 'MeasuredDBH', from: 10, to: 15 }
    ],
    ...overrides
  };
}

function buildMemberInput(overrides: Partial<BulkSpeciesCorrectionMemberInput> = {}): BulkSpeciesCorrectionMemberInput {
  return {
    rowIndex: 0,
    coreMeasurementID: CM_A1,
    plan: buildSpeciesOnlyPlan(CM_A1),
    newRow: {},
    ...overrides
  };
}

function buildInput(overrides: Partial<BulkSpeciesCorrectionInput> = {}): BulkSpeciesCorrectionInput {
  return {
    schema: TEST_SCHEMA,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    groups: [buildGroup()],
    members: [buildMemberInput()],
    createdBy: CREATED_BY,
    role: null,
    ...overrides
  };
}

function buildApplyInputFixture(coreMeasurementID: number) {
  return {
    dataType: 'measurementssummary' as const,
    schema: TEST_SCHEMA,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    targetID: coreMeasurementID,
    newRow: { MeasuredDBH: 15 },
    expectedPlanHash: null,
    operationType: 'bulk-revision-row' as const,
    revertable: false,
    writeLedger: false,
    refreshViews: false,
    createdBy: CREATED_BY,
    role: null,
    transactionID: TRANSACTION_ID,
    schemaEnsured: true
  };
}

function buildMemberWrite(overrides: Partial<PreparedBulkSpeciesCorrectionMemberWrite> = {}): PreparedBulkSpeciesCorrectionMemberWrite {
  const coreMeasurementID = overrides.coreMeasurementID ?? CM_A1;
  const rowIndex = overrides.rowIndex ?? 0;
  return {
    rowIndex,
    coreMeasurementID,
    applyInput: buildApplyInputFixture(coreMeasurementID),
    plan: buildRowLocalPlan(coreMeasurementID),
    groupMemberContext: {
      kind: 'species-correction-group-member',
      transactionID: TRANSACTION_ID,
      schema: TEST_SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      targetCoreMeasurementID: coreMeasurementID
    },
    ...overrides
  };
}

function buildPreparedSpeciesCorrection(overrides: { editedCoreMeasurementID?: number; editedStemGUID?: number } = {}) {
  return {
    transactionID: TRANSACTION_ID,
    editedCoreMeasurementID: overrides.editedCoreMeasurementID ?? CM_A1,
    editedStemGUID: overrides.editedStemGUID ?? STEM_GUID_A,
    correction: buildCorrectionSummary(),
    siblingBeforeState: []
  };
}

function buildAppliedResult(overrides: { measurements?: SpeciesCorrectionSummary['measurements'] } = {}) {
  return {
    correction: buildCorrectionSummary(overrides.measurements ? { measurements: overrides.measurements } : {}),
    siblingBeforeState: [],
    siblingAfterState: [],
    errorRefresh: { ingestionRefreshedMeasurementIDs: [], resolvedValidationOccurrenceCount: 0, pendingMeasurementIDs: [] }
  };
}

function buildPreparedGroup(
  overrides: Partial<PreparedBulkSpeciesCorrectionGroup> & { group?: SpeciesCorrectionGroup } = {}
): PreparedBulkSpeciesCorrectionGroup {
  const group = overrides.group ?? buildGroup();
  const representativeCoreMeasurementID = overrides.representativeCoreMeasurementID ?? group.members[0].coreMeasurementID;
  return {
    group,
    prepared: overrides.prepared ?? buildPreparedSpeciesCorrection({ editedCoreMeasurementID: representativeCoreMeasurementID }),
    representativeCoreMeasurementID,
    representativeEditedStemGUID: overrides.representativeEditedStemGUID ?? STEM_GUID_A,
    submittedMemberCoreMeasurementIDs: overrides.submittedMemberCoreMeasurementIDs ?? group.members.map(m => m.coreMeasurementID),
    memberWrites: overrides.memberWrites ?? []
  };
}

function buildPreparedBatch(
  groups: PreparedBulkSpeciesCorrectionGroup[],
  overrides: Partial<PreparedBulkSpeciesCorrections> = {}
): PreparedBulkSpeciesCorrections {
  return {
    transactionID: TRANSACTION_ID,
    schema: TEST_SCHEMA,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    groups,
    ...overrides
  };
}

const DEFAULT_SCOPE: BulkSpeciesCorrectionApplyScope = { schema: TEST_SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID };

/** A single `vi.fn()` connection stub that pattern-matches on SQL — compact per the task's mocking guidance. Only `prepareBulkSpeciesCorrections`'s own direct read (the representative's locked StemGUID) ever reaches this; every other read in prepare() happens inside the mocked `prepareTreeSpeciesCorrection`. */
function makeConnectionManager(stemGUIDByCoreMeasurementID: Record<number, number | null>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT StemGUID FROM')) {
      const coreMeasurementID = Number(params[0]);
      if (!(coreMeasurementID in stemGUIDByCoreMeasurementID)) return [];
      return [{ StemGUID: stemGUIDByCoreMeasurementID[coreMeasurementID] }];
    }
    throw new Error(`Unexpected executeQuery call in bulk-species-correction-writer.test.ts. SQL: ${sql}`);
  });
  return { cm: { executeQuery } as unknown as ConnectionManager, calls };
}

beforeEach(() => {
  mocks.callOrder.length = 0;
  mocks.prepareTreeSpeciesCorrectionMock.mockReset();
  mocks.applyPreparedTreeSpeciesCorrectionMock.mockReset();
  mocks.assertNoEditedFieldDriftForSpeciesCorrectionMock.mockReset();
  mocks.loadLockedEditedFieldValuesForSpeciesCorrectionMock.mockReset();
  mocks.writeMeasurementsSummaryMock.mockReset();

  mocks.prepareTreeSpeciesCorrectionMock.mockImplementation(
    async (_cm: unknown, _schema: string, input: { editedCoreMeasurementID: number; editedStemGUID: number }) => {
      mocks.callOrder.push(`prepare-correction:${input.editedCoreMeasurementID}`);
      return buildPreparedSpeciesCorrection({ editedCoreMeasurementID: input.editedCoreMeasurementID, editedStemGUID: input.editedStemGUID });
    }
  );
  mocks.applyPreparedTreeSpeciesCorrectionMock.mockImplementation(async (_cm: unknown, _schema: string, prepared: { editedCoreMeasurementID: number }) => {
    mocks.callOrder.push(`apply-correction:${prepared.editedCoreMeasurementID}`);
    return buildAppliedResult();
  });
  mocks.assertNoEditedFieldDriftForSpeciesCorrectionMock.mockImplementation(() => undefined);
  mocks.loadLockedEditedFieldValuesForSpeciesCorrectionMock.mockResolvedValue({});
  mocks.writeMeasurementsSummaryMock.mockImplementation(async (_cm: unknown, applyInput: { targetID: number }) => {
    mocks.callOrder.push(`write:${applyInput.targetID}`);
    return {} as unknown;
  });
});

describe('bulk-species-correction-writer', () => {
  describe('prepareBulkSpeciesCorrections input validation', () => {
    it('rejects a member assigned to two different groups with `member-not-in-exactly-one-group`, before issuing a single DB query', async () => {
      const groupA = buildGroup({
        treeID: TREE_ID_A,
        members: [{ rowIndex: 0, coreMeasurementID: DUPLICATE_GROUP_MEMBER_CM, requestedCorrection: true }],
        affectedCoreMeasurementIDs: [DUPLICATE_GROUP_MEMBER_CM]
      });
      const groupB = buildGroup({
        treeID: 999,
        members: [{ rowIndex: 1, coreMeasurementID: DUPLICATE_GROUP_MEMBER_CM, requestedCorrection: true }],
        affectedCoreMeasurementIDs: [DUPLICATE_GROUP_MEMBER_CM]
      });
      const input = buildInput({
        groups: [groupA, groupB],
        members: [buildMemberInput({ rowIndex: 0, coreMeasurementID: DUPLICATE_GROUP_MEMBER_CM })]
      });
      const alwaysThrowingExecuteQuery = vi.fn(async () => {
        throw new Error('prepareBulkSpeciesCorrections must not query the DB before input validation passes');
      });
      const cm = { executeQuery: alwaysThrowingExecuteQuery } as unknown as ConnectionManager;

      const promise = prepareBulkSpeciesCorrections(cm, input, TRANSACTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BulkSpeciesCorrectionInputError);
      await promise.catch(error =>
        expect(error.reason).toMatchObject({ kind: 'member-not-in-exactly-one-group', coreMeasurementID: DUPLICATE_GROUP_MEMBER_CM, groupCount: 2 })
      );

      expect(alwaysThrowingExecuteQuery).not.toHaveBeenCalled();
      expect(mocks.prepareTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
    });
  });

  describe('prepareBulkSpeciesCorrections', () => {
    it('is read-only end-to-end: a representative-lock failure in the SECOND group still leaves ZERO mutating calls, even though the FIRST group finished its own prepare step', async () => {
      // Group A's representative (CM_A1) resolves a StemGUID and its prepare
      // succeeds; Group B's representative (CM_B1) has no coremeasurements
      // row at all, so its locked StemGUID read returns zero rows.
      const { cm, calls } = makeConnectionManager({ [CM_A1]: STEM_GUID_A });
      const groupA = buildGroup({ treeID: TREE_ID_A, correction: buildCorrectionSummary({ targetTreeID: TREE_ID_A }) });
      const groupB = buildGroup({
        treeID: 999,
        correction: buildCorrectionSummary({ targetTreeID: 999 }),
        members: [{ rowIndex: 1, coreMeasurementID: CM_B1, requestedCorrection: true }],
        affectedCoreMeasurementIDs: [CM_B1],
        affectedStemGUIDs: [STEM_GUID_B]
      });
      const input = buildInput({
        groups: [groupA, groupB],
        members: [buildMemberInput({ rowIndex: 0, coreMeasurementID: CM_A1 }), buildMemberInput({ rowIndex: 1, coreMeasurementID: CM_B1 })]
      });

      const promise = prepareBulkSpeciesCorrections(cm, input, TRANSACTION_ID);
      await expect(promise).rejects.toBeInstanceOf(BulkSpeciesCorrectionUnresolvedMeasurementError);
      await promise.catch(error => {
        expect(error.coreMeasurementID).toBe(CM_B1);
        expect(error.reason).toBe('not-found');
      });

      // Group A's prepare genuinely ran (proves the failure is group-B-specific,
      // not a short-circuit before group A was even attempted)...
      expect(mocks.prepareTreeSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
      expect(mocks.callOrder).toContain(`prepare-correction:${CM_A1}`);
      // ...and that same successful group-A prepare produced NO mutation:
      // prepareBulkSpeciesCorrections never calls either mutating collaborator.
      expect(mocks.writeMeasurementsSummaryMock).not.toHaveBeenCalled();
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
      // Exactly two representative-lock reads total: group A's (found) and group B's (not found) — nothing further was attempted.
      expect(calls).toHaveLength(2);
    });
  });

  describe('applyPreparedBulkSpeciesCorrections', () => {
    it("writes every member's row-local change BEFORE the group's once-per-group tree correction, and applies that correction exactly once even with two submitted members", async () => {
      const memberWriteA1 = buildMemberWrite({ rowIndex: 0, coreMeasurementID: CM_A1 });
      const memberWriteA2 = buildMemberWrite({ rowIndex: 1, coreMeasurementID: CM_A2 });
      const groupA = buildPreparedGroup({
        group: buildGroup({
          members: [
            { rowIndex: 0, coreMeasurementID: CM_A1, requestedCorrection: true },
            { rowIndex: 1, coreMeasurementID: CM_A2, requestedCorrection: true }
          ]
        }),
        memberWrites: [memberWriteA1, memberWriteA2]
      });
      const prepared = buildPreparedBatch([groupA]);

      await applyPreparedBulkSpeciesCorrections({} as ConnectionManager, prepared, DEFAULT_SCOPE, TRANSACTION_ID);

      // Exactly this order: both member writes (in their stored order), THEN the correction — never interleaved or reversed.
      expect(mocks.callOrder).toEqual([`write:${CM_A1}`, `write:${CM_A2}`, `apply-correction:${CM_A1}`]);
      expect(mocks.writeMeasurementsSummaryMock).toHaveBeenCalledTimes(2);
      // One group, two submitted members -> the tree correction itself must still apply exactly once, not once per member.
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
    });

    it('excludes an unchanged, non-requesting sibling from the updated-member set, and reports a not-submitted attached measurement as additionally-affected rather than folding it into updates', async () => {
      // CM_A1: requester, has its own row-local write. CM_A2: submitted sibling
      // pulled in by tree membership, requestedCorrection=false, NO row-local
      // write (its plan had nothing to write besides the group-owned SpeciesCode).
      const memberWriteA1Only = [buildMemberWrite({ rowIndex: 0, coreMeasurementID: CM_A1 })];
      const groupA = buildPreparedGroup({
        group: buildGroup({
          members: [
            { rowIndex: 0, coreMeasurementID: CM_A1, requestedCorrection: true },
            { rowIndex: 1, coreMeasurementID: CM_A2, requestedCorrection: false }
          ]
        }),
        memberWrites: memberWriteA1Only,
        submittedMemberCoreMeasurementIDs: [CM_A1, CM_A2]
      });
      const prepared = buildPreparedBatch([groupA]);

      // The applied correction's real tree membership includes a THIRD
      // measurement that this batch never submitted at all.
      mocks.applyPreparedTreeSpeciesCorrectionMock.mockImplementationOnce(
        async (_cm: unknown, _schema: string, preparedCorrection: { editedCoreMeasurementID: number }) => {
          mocks.callOrder.push(`apply-correction:${preparedCorrection.editedCoreMeasurementID}`);
          return buildAppliedResult({
            measurements: [
              { coreMeasurementID: CM_A1, stemGUID: STEM_GUID_A, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE },
              { coreMeasurementID: CM_A2, stemGUID: STEM_GUID_A, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE },
              { coreMeasurementID: CM_SIBLING_NOT_SUBMITTED, stemGUID: STEM_GUID_A, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE }
            ]
          });
        }
      );

      const result = await applyPreparedBulkSpeciesCorrections({} as ConnectionManager, prepared, DEFAULT_SCOPE, TRANSACTION_ID);

      // Only CM_A1 ever got a row-local write — CM_A2 is genuinely unchanged.
      expect(mocks.writeMeasurementsSummaryMock).toHaveBeenCalledTimes(1);
      // One species correction per GROUP, not per member, despite two submitted members.
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
      expect(result.groups).toHaveLength(1);

      // CM_A2 requested nothing and received no write: it must NOT count as updated.
      expect(result.updatedMemberCoreMeasurementIDs).toEqual([CM_A1]);
      // CM_SIBLING_NOT_SUBMITTED was never part of this batch's input.members at
      // all, so it must be reported separately — never summed into the updated set.
      expect(result.additionalAffectedCoreMeasurementIDs).toEqual([CM_SIBLING_NOT_SUBMITTED]);
      expect(result.updatedMemberCoreMeasurementIDs).not.toContain(CM_SIBLING_NOT_SUBMITTED);
    });

    it('refuses to apply a prepared batch under a mismatched transactionID or a mismatched schema, performing ZERO writes in either case', async () => {
      const groupA = buildPreparedGroup({ memberWrites: [buildMemberWrite({ coreMeasurementID: CM_A1 })] });
      const prepared = buildPreparedBatch([groupA]);

      const transactionMismatch = applyPreparedBulkSpeciesCorrections({} as ConnectionManager, prepared, DEFAULT_SCOPE, OTHER_TRANSACTION_ID);
      await expect(transactionMismatch).rejects.toBeInstanceOf(BulkSpeciesCorrectionApplyScopeMismatchError);
      await transactionMismatch.catch(error =>
        expect(error.reason).toMatchObject({ kind: 'transaction', preparedTransactionID: TRANSACTION_ID, applyTransactionID: OTHER_TRANSACTION_ID })
      );
      expect(mocks.writeMeasurementsSummaryMock).not.toHaveBeenCalled();
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).not.toHaveBeenCalled();

      const schemaMismatch = applyPreparedBulkSpeciesCorrections(
        {} as ConnectionManager,
        prepared,
        { schema: OTHER_SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID },
        TRANSACTION_ID
      );
      await expect(schemaMismatch).rejects.toBeInstanceOf(BulkSpeciesCorrectionApplyScopeMismatchError);
      await schemaMismatch.catch(error => expect(error.reason).toMatchObject({ kind: 'schema', preparedSchema: TEST_SCHEMA, expectedSchema: OTHER_SCHEMA }));
      expect(mocks.writeMeasurementsSummaryMock).not.toHaveBeenCalled();
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
    });

    it("propagates a mid-apply member-write rejection unchanged — the helper never swallows, retries, or wraps it, and never reaches the group's tree correction", async () => {
      const downstreamWriteFailure = new Error('ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded on coremeasurements');
      const memberWriteA1 = buildMemberWrite({ rowIndex: 0, coreMeasurementID: CM_A1 });
      const memberWriteA2 = buildMemberWrite({ rowIndex: 1, coreMeasurementID: CM_A2 });
      const groupA = buildPreparedGroup({
        group: buildGroup({
          members: [
            { rowIndex: 0, coreMeasurementID: CM_A1, requestedCorrection: true },
            { rowIndex: 1, coreMeasurementID: CM_A2, requestedCorrection: true }
          ]
        }),
        memberWrites: [memberWriteA1, memberWriteA2]
      });
      const prepared = buildPreparedBatch([groupA]);

      // First member write succeeds normally; the second rejects with a raw,
      // unrelated SQL-style error the SUT has no special-case handling for.
      mocks.writeMeasurementsSummaryMock
        .mockImplementationOnce(async (_cm: unknown, applyInput: { targetID: number }) => {
          mocks.callOrder.push(`write:${applyInput.targetID}`);
          return {} as unknown;
        })
        .mockImplementationOnce(async () => {
          throw downstreamWriteFailure;
        });

      const promise = applyPreparedBulkSpeciesCorrections({} as ConnectionManager, prepared, DEFAULT_SCOPE, TRANSACTION_ID);
      // `.toBe` (identity), not merely `.toThrow` on message text: proves the
      // exact Error instance reaches the caller unwrapped, never re-thrown as
      // a different error type or downgraded to a generic failure.
      await expect(promise).rejects.toBe(downstreamWriteFailure);

      // Exactly the two member-write attempts scheduled before/at the failure — no retry.
      expect(mocks.writeMeasurementsSummaryMock).toHaveBeenCalledTimes(2);
      // The loop aborted on the member-write failure before ever reaching this group's correction apply.
      expect(mocks.applyPreparedTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
    });
  });
});
