import { beforeEach, describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { analyzeBulk, type BulkInput } from './bulkanalyzer';
import { hashPlan } from './planhash';
import type {
  DuplicateDeletion,
  Effect,
  EditPlan,
  EditPlanDataType,
  PreviewError,
  SpeciesCorrectionGroup,
  SpeciesCorrectionSummary,
  TreeStemResolutionPreviewError
} from './types';

vi.mock('./analyzer', async importOriginal => {
  const actual = await importOriginal<typeof import('./analyzer')>();
  return { ...actual, analyzeEdit: vi.fn() };
});

import { analyzeEdit, TargetNotFoundError } from './analyzer';
import { SpeciesNotFoundError } from './rules/context';

const mockedAnalyzeEdit = vi.mocked(analyzeEdit);

// --- Named constants (no magic numbers/strings) -----------------------------

const SCHEMA = 'forestgeo_testing';
const DATA_TYPE: EditPlanDataType = 'measurementssummary';
const PLOT_ID = 3;
const CENSUS_ID = 7;
const PLAN_GENERATED_AT = '2026-10-07T00:00:00.000Z';

const NO_DB_ACCESS_EXPECTED = 'analyzeBulk must not access the database when analyzeEdit is mocked';
const UNREGISTERED_TARGET_ID_PREFIX = 'bulkanalyzer.test.ts: no analyzeEdit fixture registered for targetID ';

// --- Leaked-SQL / internal-detail guard (real SQL syntax, never ordinary English prose) ---
const LEAKED_SQL_LABEL_SELECT_FROM = 'SELECT...FROM co-occurrence';
const LEAKED_SQL_LABEL_INSERT_INTO = 'INSERT INTO';
const LEAKED_SQL_LABEL_DELETE_FROM = 'DELETE FROM';
const LEAKED_SQL_LABEL_UPDATE_SET = 'UPDATE <ident> SET';
const LEAKED_SQL_LABEL_JOIN_ON = 'JOIN...ON';
const LEAKED_SQL_LABEL_BACKTICK = 'backtick schema-identifier quote';
const LEAKED_SQL_LABEL_SCHEMA_PLACEHOLDER = '?? schema placeholder';
const LEAKED_SQL_LABEL_BOUND_PARAM = 'bound-parameter comparison (= ?)';

// SELECT...FROM now requires a real table ref right after FROM (`??`,
// backtick, or `schema.table`) within a bounded gap, never bare prose.
// A bare `;` pattern was removed: two real messages legitimately end a clause with one.
const LEAKED_SQL_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: LEAKED_SQL_LABEL_SELECT_FROM, pattern: /\bSELECT\b[\s\S]{0,200}?\bFROM\b\s+(?:\?\?|`|[A-Za-z_]\w*\.[A-Za-z_]\w*)/i },
  { label: LEAKED_SQL_LABEL_INSERT_INTO, pattern: /\bINSERT\s+INTO\b/i },
  { label: LEAKED_SQL_LABEL_DELETE_FROM, pattern: /\bDELETE\s+FROM\b/i },
  { label: LEAKED_SQL_LABEL_UPDATE_SET, pattern: /\bUPDATE\s+\S+\s+SET\b/i },
  { label: LEAKED_SQL_LABEL_JOIN_ON, pattern: /\bJOIN\b[\s\S]*?\bON\b/i },
  { label: LEAKED_SQL_LABEL_BACKTICK, pattern: /`/ },
  { label: LEAKED_SQL_LABEL_SCHEMA_PLACEHOLDER, pattern: /\?\?/ },
  { label: LEAKED_SQL_LABEL_BOUND_PARAM, pattern: /=\s*\?/ }
];

// Fails loudly naming WHICH pattern matched, per the project's verbose/debuggable testing rule.
function expectNoLeakedSQLOrInternals(message: string): void {
  for (const { label, pattern } of LEAKED_SQL_PATTERNS) {
    expect(message, `error message must never leak SQL/internal implementation detail (matched: ${label})`).not.toMatch(pattern);
  }
}

// Tree A: the single tree shared by two sibling batch rows in tests 1-3.
const TREE_ID_A = 300;
const TREE_TAG_A = 'T-300';
const QUADRAT_ID_A = 9;
const OLD_SPECIES_ID = 9;
const OLD_SPECIES_CODE = 'AA';
const NEW_SPECIES_ID = 11;
const NEW_SPECIES_CODE = 'BB';
const STEM_GUID_A1 = 500;
const STEM_GUID_A2 = 501;
const CM_ID_A1 = 900;
const CM_ID_A2 = 901;
const ROW_INDEX_A = 0;
const ROW_INDEX_B = 1;

// Test 4: a batch row that is DISJOINT from tree A's IDs and carries no
// species correction at all (pre-#427 shape).
const CM_ID_NO_CORRECTION = 700;
const ROW_INDEX_NO_CORRECTION = 0;

// Tests 5-8: synthetic blocking TreeStemResolution error messages, built via
// `buildBlockingTreeStemError` rather than the real rule modules (phase 3's
// demotion gate only inspects `.reason`/`.blocking`/`.kind`, never the exact
// `rules/*.ts` wording, so a hand-built message is sufficient and keeps each
// test's expected string independent of production code).
const DIFFERENT_QUADRAT_MESSAGE = 'Matching stem exists in a different quadrat (test fixture)';
const INCONSISTENT_SCOPE_MESSAGE = "Tree T#300's attached stem/measurement scope is inconsistent (test fixture)";

// Test 6: two batch rows disjoint from tree A's IDs, neither requesting a
// species correction and neither implicated by any group blocker.
const CM_ID_GENERIC_SURVIVOR = 960;
const CM_ID_GENERIC_DEMOTED = 961;

// Test 7: the species code a NON-requesting, group-implicated sibling row
// explicitly supplies, deliberately contradicting tree A's canonical
// NEW_SPECIES_CODE so Check A (`detectSpeciesDisagreement`) names that row.
const CONTRADICTING_SPECIES_CODE = 'CC';

// Test 8: a second, genuinely different destination species/ID requested by
// a sibling row for the SAME tree A — must disagree in both ID and code from
// NEW_SPECIES_ID/NEW_SPECIES_CODE so the destination-conflict check fires.
const CONFLICTING_NEW_SPECIES_ID = 13;
const CONFLICTING_NEW_SPECIES_CODE = 'DD';

// Test 9: three target/measurement IDs disjoint from every other test's IDs,
// each driving a distinct analyzeEdit-throws-before-returning-a-plan path.
const TARGET_NOT_FOUND_CM_ID = 950;
const SPECIES_NOT_FOUND_CM_ID = 951;
const BLANK_SPECIES_CM_ID = 952;
const UNRESOLVABLE_SPECIES_CODE = 'ZZ999';
const ROW_INDEX_C = 2;

// Test 3: the species-correction effect's real id/title (mirrored from
// `rules/species.ts#applySpeciesRules`) vs. a row-local effect with a
// distinct id/category/affectedTable that must never be mistaken for it.
const SPECIES_EFFECT_RULE_ID = 'R1a';
const SPECIES_EFFECT_TITLE = 'Tree species will be corrected';
const SPECIES_EFFECT_AFFECTED_ROW_COUNT = 1;
const ROW_LOCAL_EFFECT_RULE_ID = 'TEST_ROW_LOCAL_FIELD_EFFECT';
const ROW_LOCAL_EFFECT_TITLE = 'Row-local field effect (test fixture)';
const ROW_LOCAL_EFFECT_DETAIL = 'row-local effect detail (test fixture)';
const ROW_LOCAL_EFFECT_AFFECTED_ROW_COUNT = 4;
const EXPECTED_ROW_LOCAL_AGGREGATE_ROW_COUNT = ROW_LOCAL_EFFECT_AFFECTED_ROW_COUNT * 2;

// Tests B2-1/B2-2: row B always targets CM_ID_A2, the SAME measurement
// `buildSpeciesCorrectionSummaryTreeA()` already attaches to tree A, so its
// targetID genuinely falls inside tree A's correction membership.
const GENERIC_MISSING_BLOCKER_MESSAGE = 'Matching stem/measurement link is missing (test fixture)';
const GENERIC_INACTIVE_BLOCKER_MESSAGE = 'Matching stem/measurement link is inactive (test fixture)';
const CM_ID_B3_SPECIES_FIELD_SURVIVOR = 980;
const CM_ID_B3_NO_SPECIES_FIELD_DEMOTED = 981;

// --- Fixture builders (module scope, reusable by a later slice) ------------

function buildThrowingConnectionManagerStub(): ConnectionManager {
  const target: Record<string, unknown> = {};
  const proxy = new Proxy(target, {
    get(): unknown {
      throw new Error(NO_DB_ACCESS_EXPECTED);
    }
  });
  return proxy as unknown as ConnectionManager;
}

const CONNECTION_MANAGER_STUB = buildThrowingConnectionManagerStub();

function buildSpeciesCorrectionSummaryTreeA(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
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
    activeStemCount: 2,
    inactiveStemCount: 0,
    activeMeasurementCount: 2,
    inactiveMeasurementCount: 0,
    stems: [
      { stemGUID: STEM_GUID_A1, censusID: CENSUS_ID, quadratID: QUADRAT_ID_A, isActive: true },
      { stemGUID: STEM_GUID_A2, censusID: CENSUS_ID, quadratID: QUADRAT_ID_A, isActive: true }
    ],
    measurements: [
      { coreMeasurementID: CM_ID_A1, stemGUID: STEM_GUID_A1, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE },
      { coreMeasurementID: CM_ID_A2, stemGUID: STEM_GUID_A2, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE }
    ],
    ...overrides
  };
}

/** Mirrors the exact `Effect` shape `rules/species.ts#applySpeciesRules` attaches (id 'R1a', category 'identity', affectedTable 'trees'). */
function buildSpeciesCorrectionEffect(correction: SpeciesCorrectionSummary, affectedRowCount: number = SPECIES_EFFECT_AFFECTED_ROW_COUNT): Effect {
  const totalStems = correction.activeStemCount + correction.inactiveStemCount;
  const totalMeasurements = correction.activeMeasurementCount + correction.inactiveMeasurementCount;
  return {
    id: SPECIES_EFFECT_RULE_ID,
    severity: 'warn',
    category: 'identity',
    title: SPECIES_EFFECT_TITLE,
    detail:
      `Tree T#${correction.targetTreeID} (TreeTag "${correction.treeTag}") species "${correction.oldSpeciesCode}" -> "${correction.newSpeciesCode}". ` +
      `${totalStems} stem(s) (${correction.activeStemCount} active, ${correction.inactiveStemCount} inactive) and ` +
      `${totalMeasurements} measurement(s) (${correction.activeMeasurementCount} active, ${correction.inactiveMeasurementCount} inactive) will show the corrected species.`,
    affectedTable: 'trees',
    affectedRowCount,
    references: {
      treeIDs: [correction.targetTreeID],
      speciesID: correction.newSpeciesID,
      coreMeasurementIDs: correction.measurements.map(measurement => measurement.coreMeasurementID),
      stemGUIDs: correction.stems.map(stem => stem.stemGUID)
    }
  };
}

/** A row-local effect that `isSpeciesCorrectionEffect` must NEVER match: different id/category/affectedTable. */
function buildRowLocalEffect(affectedRowCount: number = ROW_LOCAL_EFFECT_AFFECTED_ROW_COUNT): Effect {
  return {
    id: ROW_LOCAL_EFFECT_RULE_ID,
    severity: 'info',
    category: 'field',
    title: ROW_LOCAL_EFFECT_TITLE,
    detail: ROW_LOCAL_EFFECT_DETAIL,
    affectedTable: 'coremeasurements',
    affectedRowCount
  };
}

function buildMatchedEditPlan(args: {
  targetID: number;
  fieldChanges?: EditPlan['fieldChanges'];
  effects?: Effect[];
  errors?: PreviewError[];
  speciesCorrection?: SpeciesCorrectionSummary;
}): EditPlan {
  return {
    dataType: DATA_TYPE,
    targetID: args.targetID,
    fieldChanges: args.fieldChanges ?? [{ field: 'SpeciesCode', from: OLD_SPECIES_CODE, to: NEW_SPECIES_CODE }],
    effects: args.effects ?? [],
    errors: args.errors ?? [],
    maxSeverity: 'warn',
    planHash: '',
    generatedAt: PLAN_GENERATED_AT,
    ...(args.speciesCorrection ? { speciesCorrection: args.speciesCorrection } : {})
  };
}

/** A hand-built blocking `TreeStemResolutionPreviewError` (tests 5-8): `subject` is fixed at `'tree'` since none of those tests inspect it, only `reason`/`message`/`blocking`/`kind` (phase 3's actual decision inputs). */
function buildBlockingTreeStemError(
  reason: TreeStemResolutionPreviewError['reason'],
  message: string,
  field: TreeStemResolutionPreviewError['field'] = 'TreeTag'
): TreeStemResolutionPreviewError {
  return {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason,
    field,
    message,
    severity: 'destructive',
    blocking: true
  };
}

function buildBulkInput(
  matched: BulkInput['matched'],
  duplicateMeasurementIDsToDelete: DuplicateDeletion[] = [],
  newRows: BulkInput['newRows'] = []
): BulkInput {
  return { matched, newRows, invalid: [], duplicateMeasurementIDsToDelete };
}

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/**
 * A ConnectionManager stub for the #427 batch identity-overlap tests (U-group
 * below): unlike `buildThrowingConnectionManagerStub`, `executeQuery` actually
 * resolves — with `rowsToReturn` on every call — and every `(sql, params)`
 * pair is recorded so a test can assert on the exact statement/bindings sent.
 */
function buildRecordingConnectionManagerStub(rowsToReturn: Array<Record<string, unknown>>): { cm: ConnectionManager; recordedCalls: RecordedQuery[] } {
  const recordedCalls: RecordedQuery[] = [];
  const stub = {
    executeQuery: async (sql: string, params: unknown[] = []) => {
      recordedCalls.push({ sql, params });
      return rowsToReturn;
    }
  };
  return { cm: stub as unknown as ConnectionManager, recordedCalls };
}

/** Drives `analyzeEdit` per-row by `targetID`, never by call order. */
function configureAnalyzeEditMock(plansByTargetID: Map<number, EditPlan | Error>): void {
  mockedAnalyzeEdit.mockImplementation(async (_cm, _schema, _dataType, _plotID, _censusID, targetID) => {
    const entry = plansByTargetID.get(targetID);
    if (entry === undefined) throw new Error(`${UNREGISTERED_TARGET_ID_PREFIX}${targetID}`);
    if (entry instanceof Error) throw entry;
    return entry;
  });
}

async function runAnalyzeBulk(input: BulkInput, cm: ConnectionManager = CONNECTION_MANAGER_STUB) {
  return analyzeBulk(cm, SCHEMA, DATA_TYPE, PLOT_ID, CENSUS_ID, input);
}

describe('analyzeBulk - #427 batch species corrections', () => {
  beforeEach(() => {
    mockedAnalyzeEdit.mockReset();
  });

  it('collapses two sibling rows requesting the same tree correction into one SpeciesCorrectionGroup', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, effects: [buildSpeciesCorrectionEffect(correction)], speciesCorrection: correction });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_A2, effects: [buildSpeciesCorrectionEffect(correction)], speciesCorrection: correction });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);

    const plan = await runAnalyzeBulk(input);

    expect(plan.errors, 'two identical sibling requests must not self-conflict').toEqual([]);
    expect(plan.canApply, 'plan.canApply must be true with no conflicts').toBe(true);

    const groups = plan.speciesCorrectionGroups;
    expect(groups, 'plan.speciesCorrectionGroups must be set').toBeDefined();
    expect(groups).toHaveLength(1);

    const group = (groups as SpeciesCorrectionGroup[])[0];
    expect(group.treeID).toBe(TREE_ID_A);
    expect(group.censusID).toBe(CENSUS_ID);
    expect(group.members).toEqual([
      { rowIndex: ROW_INDEX_A, coreMeasurementID: CM_ID_A1, requestedCorrection: true },
      { rowIndex: ROW_INDEX_B, coreMeasurementID: CM_ID_A2, requestedCorrection: true }
    ]);
    expect(group.affectedCoreMeasurementIDs).toEqual([CM_ID_A1, CM_ID_A2]);
    expect(group.affectedStemGUIDs).toEqual([STEM_GUID_A1, STEM_GUID_A2]);
  });

  it('produces an identical planHash and speciesCorrectionGroups when the sibling rows are supplied in reversed file order', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, effects: [buildSpeciesCorrectionEffect(correction)], speciesCorrection: correction });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_A2, effects: [buildSpeciesCorrectionEffect(correction)], speciesCorrection: correction });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const forwardInput = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);
    const reversedInput = buildBulkInput([
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);

    const forwardPlan = await runAnalyzeBulk(forwardInput);
    const reversedPlan = await runAnalyzeBulk(reversedInput);

    expect(reversedPlan.planHash, 'planHash must not depend on file order').toBe(forwardPlan.planHash);
    expect(reversedPlan.speciesCorrectionGroups, 'speciesCorrectionGroups must be structurally identical regardless of file order').toEqual(
      forwardPlan.speciesCorrectionGroups
    );
  });

  it('aggregates the shared species-correction effect ONCE per tree while the row-local effect still aggregates per row', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({
      targetID: CM_ID_A1,
      effects: [buildSpeciesCorrectionEffect(correction, SPECIES_EFFECT_AFFECTED_ROW_COUNT), buildRowLocalEffect(ROW_LOCAL_EFFECT_AFFECTED_ROW_COUNT)],
      speciesCorrection: correction
    });
    const planB = buildMatchedEditPlan({
      targetID: CM_ID_A2,
      effects: [buildSpeciesCorrectionEffect(correction, SPECIES_EFFECT_AFFECTED_ROW_COUNT), buildRowLocalEffect(ROW_LOCAL_EFFECT_AFFECTED_ROW_COUNT)],
      speciesCorrection: correction
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);

    const plan = await runAnalyzeBulk(input);

    const speciesAggregate = plan.aggregateEffects.find(effect => effect.id === SPECIES_EFFECT_RULE_ID);
    expect(speciesAggregate, 'the species-correction effect must appear in aggregateEffects').toBeDefined();
    expect(speciesAggregate?.affectedRowCount, 'species effect must NOT be doubled across the two sibling rows').toBe(SPECIES_EFFECT_AFFECTED_ROW_COUNT);
    expect(speciesAggregate?.detail).toBe(`1 row(s) affected · ${SPECIES_EFFECT_AFFECTED_ROW_COUNT} downstream row(s)`);

    const rowLocalAggregate = plan.aggregateEffects.find(effect => effect.id === ROW_LOCAL_EFFECT_RULE_ID);
    expect(rowLocalAggregate, 'the row-local effect must appear in aggregateEffects').toBeDefined();
    expect(rowLocalAggregate?.affectedRowCount, 'row-local effect must sum across both sibling rows (no dedup)').toBe(EXPECTED_ROW_LOCAL_AGGREGATE_ROW_COUNT);
    expect(rowLocalAggregate?.detail).toBe(`2 row(s) affected · ${EXPECTED_ROW_LOCAL_AGGREGATE_ROW_COUNT} downstream row(s)`);
  });

  it('leaves a batch with no corrections byte-identical to the pre-#427 shape (speciesCorrectionGroups key absent, hash unaffected)', async () => {
    const plan = buildMatchedEditPlan({
      targetID: CM_ID_NO_CORRECTION,
      fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }]
    });

    configureAnalyzeEditMock(new Map([[CM_ID_NO_CORRECTION, plan]]));

    const input = buildBulkInput([{ rowIndex: ROW_INDEX_NO_CORRECTION, targetID: CM_ID_NO_CORRECTION, newRow: { MeasuredDBH: 12 } }]);

    const bulkPlan = await runAnalyzeBulk(input);

    expect('speciesCorrectionGroups' in bulkPlan, 'speciesCorrectionGroups key must be entirely absent, not merely undefined').toBe(false);
    expect(bulkPlan.errors).toEqual([]);
    expect(bulkPlan.canApply).toBe(true);

    const hashWithExplicitUndefinedGroups = hashPlan({ ...bulkPlan, speciesCorrectionGroups: undefined });
    expect(bulkPlan.planHash, "an additive, absent field must not change an existing batch's hash").toBe(hashWithExplicitUndefinedGroups);
  });

  it('survives demotion when a species-correction row carries a generic (non-correction-specific) blocker', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const blocker = buildBlockingTreeStemError('different_quadrat', DIFFERENT_QUADRAT_MESSAGE);
    const plan = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, errors: [blocker] });

    configureAnalyzeEditMock(new Map([[CM_ID_A1, plan]]));

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const rowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_A);
    expect(rowPlan, 'rowPlan for ROW_INDEX_A must exist').toBeDefined();
    expect(rowPlan?.status, 'a row that IS a correction must never be demoted to invalid').not.toBe('invalid');
    expect(rowPlan?.plan, 'the surviving row must keep its EditPlan').toBeDefined();
    expect(bulkPlan.speciesCorrectionGroups, 'bulkPlan.speciesCorrectionGroups must be set with exactly the one tree-A group').toHaveLength(1);

    const surfacedMessages = (bulkPlan.errors ?? []).map(error => error.message);
    expect(surfacedMessages, 'the blocker must still be surfaced on bulkPlan.errors, not silently discarded').toContain(DIFFERENT_QUADRAT_MESSAGE);
    expect(bulkPlan.canApply, 'a surviving blocking error must force canApply to false').toBe(false);
  });

  it('demotes a generic blocker but keeps a correction-specific-reason blocker, on two otherwise-unrelated rows', async () => {
    const survivorBlocker = buildBlockingTreeStemError('inconsistent_scope', INCONSISTENT_SCOPE_MESSAGE);
    const demotedBlocker = buildBlockingTreeStemError('different_quadrat', DIFFERENT_QUADRAT_MESSAGE);
    const survivorPlan = buildMatchedEditPlan({ targetID: CM_ID_GENERIC_SURVIVOR, errors: [survivorBlocker] });
    // Explicit DBH-only fieldChanges: the default fixture fieldChanges is a
    // SpeciesCode change, which would itself trigger the B3 survival path
    // and defeat this test's ordinary-demotion intent.
    const demotedPlan = buildMatchedEditPlan({
      targetID: CM_ID_GENERIC_DEMOTED,
      fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
      errors: [demotedBlocker]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_GENERIC_SURVIVOR, survivorPlan],
        [CM_ID_GENERIC_DEMOTED, demotedPlan]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_GENERIC_SURVIVOR, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_GENERIC_DEMOTED, newRow: { MeasuredDBH: 12 } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const survivorRowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_A);
    const demotedRowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_B);
    expect(survivorRowPlan, 'survivor rowPlan must exist').toBeDefined();
    expect(demotedRowPlan, 'demoted rowPlan must exist').toBeDefined();

    expect(survivorRowPlan?.status, 'inconsistent_scope is a correction-specific reason: it must survive even with no speciesCorrection').not.toBe('invalid');
    expect(survivorRowPlan?.plan, 'the surviving row must keep its EditPlan').toBeDefined();
    const surfacedMessages = (bulkPlan.errors ?? []).map(error => error.message);
    expect(surfacedMessages, "the surviving row's blocker message must reach bulkPlan.errors").toContain(INCONSISTENT_SCOPE_MESSAGE);

    expect(demotedRowPlan).toEqual({ rowIndex: ROW_INDEX_B, targetID: CM_ID_GENERIC_DEMOTED, status: 'invalid', reason: DIFFERENT_QUADRAT_MESSAGE });
    expect(demotedRowPlan?.plan, 'a demoted row must not retain its plan').toBeUndefined();
    expect(surfacedMessages, "a demoted row's blocker message must NOT reach bulkPlan.errors (the gate is reason-specific, not blanket)").not.toContain(
      DIFFERENT_QUADRAT_MESSAGE
    );

    expect('speciesCorrectionGroups' in bulkPlan, 'neither row carries a speciesCorrection, so the key must be entirely absent').toBe(false);
  });

  it('keeps a group-implicated sibling row alive even though its own blocker is generic and it requested no correction itself', async () => {
    // Why this must survive: both `app/api/revisionupload/route.ts` and
    // `.../apply/route.ts` re-run `analyzeBulk` on the SURVIVING matched rows
    // only. Row B contributes nothing to its OWN demotion test (no
    // speciesCorrection, and `different_quadrat` is not a
    // CORRECTION_SPECIFIC_BLOCKING_REASON) — but it IS the row Check A names
    // as contradicting tree A's destination. If row B were dropped here, the
    // next `analyzeBulk` pass would never see its contradicting
    // `explicitSpeciesCode` again, the `group_species_conflict` blocker would
    // silently vanish, and a batch that actually contradicts itself on tree
    // A's destination species could apply.
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_A2, errors: [buildBlockingTreeStemError('different_quadrat', DIFFERENT_QUADRAT_MESSAGE)] });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: {}, explicitSpeciesCode: CONTRADICTING_SPECIES_CODE }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const groupConflict = (bulkPlan.errors ?? []).find(
      (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === 'group_species_conflict'
    );
    expect(groupConflict, 'Check A must produce a group_species_conflict error naming row B').toBeDefined();
    expect(groupConflict?.treeID).toBe(TREE_ID_A);
    expect(groupConflict?.rowIndexes).toEqual([ROW_INDEX_B]);

    const rowBPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_B);
    expect(rowBPlan, 'rowPlan for ROW_INDEX_B must exist').toBeDefined();
    expect(rowBPlan?.status, 'group-implicated row B must survive even though its own blocker is generic').not.toBe('invalid');
    expect(rowBPlan?.plan, 'row B must keep its EditPlan').toBeDefined();
    expect(bulkPlan.canApply, 'an unresolved group conflict must force canApply to false').toBe(false);
  });

  it('blocks a batch where two sibling rows request two different destination species for the same tree, with one actionable error', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const correctionB = buildSpeciesCorrectionSummaryTreeA({ newSpeciesID: CONFLICTING_NEW_SPECIES_ID, newSpeciesCode: CONFLICTING_NEW_SPECIES_CODE });
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_A2, speciesCorrection: correctionB, effects: [buildSpeciesCorrectionEffect(correctionB)] });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: CONFLICTING_NEW_SPECIES_CODE } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const groupConflicts = (bulkPlan.errors ?? []).filter(
      (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === 'group_species_conflict'
    );
    expect(groupConflicts, 'exactly one actionable error for the whole destination conflict, not one per row').toHaveLength(1);

    const conflict = groupConflicts[0];
    expect(conflict.blocking).toBe(true);
    expect(conflict.severity).toBe('destructive');
    expect(conflict.treeID).toBe(TREE_ID_A);
    expect(conflict.rowIndexes).toEqual([ROW_INDEX_A, ROW_INDEX_B]);
    expect(conflict.rowIndex).toBe(ROW_INDEX_A);
    expect(conflict.message).toContain(TREE_TAG_A);
    expect(conflict.message).toContain(NEW_SPECIES_CODE);
    expect(conflict.message).toContain(CONFLICTING_NEW_SPECIES_CODE);
    expectNoLeakedSQLOrInternals(conflict.message);

    expect(bulkPlan.canApply).toBe(false);
    expect(bulkPlan.maxSeverity).toBe('destructive');
  });

  it('leaves not-found reasons unchanged: TargetNotFoundError and both SpeciesNotFoundError shapes still demote per-row without blocking the batch', async () => {
    configureAnalyzeEditMock(
      new Map<number, EditPlan | Error>([
        [TARGET_NOT_FOUND_CM_ID, new TargetNotFoundError(TARGET_NOT_FOUND_CM_ID)],
        [SPECIES_NOT_FOUND_CM_ID, new SpeciesNotFoundError(UNRESOLVABLE_SPECIES_CODE)],
        [BLANK_SPECIES_CM_ID, new SpeciesNotFoundError('')]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: TARGET_NOT_FOUND_CM_ID, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B, targetID: SPECIES_NOT_FOUND_CM_ID, newRow: { SpeciesCode: UNRESOLVABLE_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_C, targetID: BLANK_SPECIES_CM_ID, newRow: { SpeciesCode: '' } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const targetNotFoundRow = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_A);
    const speciesNotFoundRow = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_B);
    const blankSpeciesRow = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_C);

    expect(targetNotFoundRow).toEqual({
      rowIndex: ROW_INDEX_A,
      targetID: TARGET_NOT_FOUND_CM_ID,
      status: 'invalid',
      reason: `Measurement ${TARGET_NOT_FOUND_CM_ID} is no longer active in this plot/census`
    });
    expect(speciesNotFoundRow).toEqual({
      rowIndex: ROW_INDEX_B,
      targetID: SPECIES_NOT_FOUND_CM_ID,
      status: 'invalid',
      reason: `Species not found: ${UNRESOLVABLE_SPECIES_CODE}`
    });
    expect(blankSpeciesRow).toEqual({
      rowIndex: ROW_INDEX_C,
      targetID: BLANK_SPECIES_CM_ID,
      status: 'invalid',
      reason: 'Species code is blank — species cannot be cleared'
    });

    expect(bulkPlan.canApply, 'per-row not-found demotions must never block the whole batch').toBe(true);
  });

  it('blocks a batch where a duplicate deletion removes a species-correction member, without ever touching the database', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const plan = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });

    configureAnalyzeEditMock(new Map([[CM_ID_A1, plan]]));

    const duplicateDeletions = [{ coreMeasurementID: CM_ID_A2, survivorCoreMeasurementID: CM_ID_A1 }];
    const input = buildBulkInput([{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }], duplicateDeletions);

    // Awaited directly (not wrapped in try/catch): if analyzeBulk ever
    // touched CONNECTION_MANAGER_STUB, the stub's proxy throws
    // NO_DB_ACCESS_EXPECTED and that rejection surfaces straight out of this
    // `await`, failing the test.
    const bulkPlan = await runAnalyzeBulk(input);

    const memberDeletionError = (bulkPlan.errors ?? []).find(
      (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === 'group_member_deletion'
    );
    expect(memberDeletionError, 'deleting a correction member as a duplicate must produce a group_member_deletion error').toBeDefined();
    expect(memberDeletionError?.treeID).toBe(TREE_ID_A);
    expect(memberDeletionError?.rowIndexes).toEqual([ROW_INDEX_A]);
    expect(memberDeletionError?.blocking).toBe(true);

    expect(bulkPlan.canApply).toBe(false);
    expect(bulkPlan.duplicateDeletions).toEqual(duplicateDeletions);

    const r6Effect = bulkPlan.aggregateEffects.find(effect => effect.id === 'R6');
    expect(r6Effect, "the real applyDuplicateRules 'R6' destructive effect must be present in aggregateEffects").toBeDefined();

    expect(mockedAnalyzeEdit, 'exactly the one matched row must have been analyzed through the mock, never through a real DB path').toHaveBeenCalledTimes(1);
  });

  it('(B2-1) still names a thrown SpeciesNotFoundError sibling in a group_species_conflict when its explicit code disagrees with the destination', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });

    configureAnalyzeEditMock(
      new Map<number, EditPlan | Error>([
        [CM_ID_A1, planA],
        [CM_ID_A2, new SpeciesNotFoundError(CONTRADICTING_SPECIES_CODE)]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: CONTRADICTING_SPECIES_CODE }, explicitSpeciesCode: CONTRADICTING_SPECIES_CODE }
    ]);

    const bulkPlan = await runAnalyzeBulk(input);

    const groupConflicts = (bulkPlan.errors ?? []).filter(
      (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === 'group_species_conflict'
    );
    expect(groupConflicts, 'the thrown sibling contradicting the destination must produce exactly one group_species_conflict').toHaveLength(1);
    expect(groupConflicts[0].rowIndexes, 'row B (the thrown sibling) must be named').toContain(ROW_INDEX_B);

    const rowBPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_B);
    expect(rowBPlan, 'row B rowPlan must exist even though analyzeEdit threw').toEqual({
      rowIndex: ROW_INDEX_B,
      targetID: CM_ID_A2,
      status: 'invalid',
      reason: `Species not found: ${CONTRADICTING_SPECIES_CODE}`
    });

    expect(bulkPlan.canApply, 'an unresolved group conflict from a thrown row must still block the batch').toBe(false);

    const group = (bulkPlan.speciesCorrectionGroups as SpeciesCorrectionGroup[])[0];
    expect(
      group.members.some(member => member.rowIndex === ROW_INDEX_B),
      'a thrown (status:invalid) row must never become a hashed group member'
    ).toBe(false);
  });

  it('(B2-2) keeps speciesCorrectionGroups byte-identical whether a thrown-but-agreeing sibling is present or entirely absent from the batch', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });

    configureAnalyzeEditMock(
      new Map<number, EditPlan | Error>([
        [CM_ID_A1, planA],
        [CM_ID_A2, new SpeciesNotFoundError(NEW_SPECIES_CODE)]
      ])
    );
    const inputWithThrownAgreeingSibling = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);
    const planWithThrownSibling = await runAnalyzeBulk(inputWithThrownAgreeingSibling);

    configureAnalyzeEditMock(new Map<number, EditPlan | Error>([[CM_ID_A1, planA]]));
    const inputWithoutSibling = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ]);
    const planWithoutSibling = await runAnalyzeBulk(inputWithoutSibling);

    // Only speciesCorrectionGroups is asserted invariant: rowPlans/rowCount/planHash
    // genuinely differ between the two runs (one has an extra invalid rowPlan for
    // row B), so asserting those equal would be a false claim, not a stronger test.
    expect(planWithThrownSibling.speciesCorrectionGroups, 'a thrown sibling (any outcome) must never alter the hashed group').toEqual(
      planWithoutSibling.speciesCorrectionGroups
    );
  });

  it('(B3-1) survives demotion when a row requests a SpeciesCode field change but has only a generic missing/inactive blocker and no speciesCorrection', async () => {
    const blocker = buildBlockingTreeStemError('missing', GENERIC_MISSING_BLOCKER_MESSAGE);
    const plan = buildMatchedEditPlan({ targetID: CM_ID_B3_SPECIES_FIELD_SURVIVOR, errors: [blocker] });

    configureAnalyzeEditMock(new Map([[CM_ID_B3_SPECIES_FIELD_SURVIVOR, plan]]));

    const input = buildBulkInput([{ rowIndex: ROW_INDEX_A, targetID: CM_ID_B3_SPECIES_FIELD_SURVIVOR, newRow: { SpeciesCode: NEW_SPECIES_CODE } }]);
    const bulkPlan = await runAnalyzeBulk(input);

    const rowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_A);
    expect(rowPlan?.status, 'a row that itself requests a SpeciesCode change must survive a generic missing/inactive blocker (B3)').toBe('matched');
    expect(rowPlan?.plan, 'the surviving row must keep its EditPlan').toBeDefined();

    const surfacedMessages = (bulkPlan.errors ?? []).map(error => error.message);
    expect(surfacedMessages, "the surviving row's generic blocker must still reach bulkPlan.errors").toContain(GENERIC_MISSING_BLOCKER_MESSAGE);
    expect(bulkPlan.canApply, 'a surviving blocking error must force canApply to false').toBe(false);
  });

  it('(B3-2 narrowness guard) still demotes a row with the same generic missing/inactive blocker when its fieldChanges do NOT touch SpeciesCode', async () => {
    const blocker = buildBlockingTreeStemError('inactive', GENERIC_INACTIVE_BLOCKER_MESSAGE);
    const plan = buildMatchedEditPlan({
      targetID: CM_ID_B3_NO_SPECIES_FIELD_DEMOTED,
      fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
      errors: [blocker]
    });

    configureAnalyzeEditMock(new Map([[CM_ID_B3_NO_SPECIES_FIELD_DEMOTED, plan]]));

    const input = buildBulkInput([{ rowIndex: ROW_INDEX_A, targetID: CM_ID_B3_NO_SPECIES_FIELD_DEMOTED, newRow: { MeasuredDBH: 12 } }]);
    const bulkPlan = await runAnalyzeBulk(input);

    const rowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_A);
    expect(rowPlan, "B3's fix must not broaden survival to a row with no SpeciesCode change").toEqual({
      rowIndex: ROW_INDEX_A,
      targetID: CM_ID_B3_NO_SPECIES_FIELD_DEMOTED,
      status: 'invalid',
      reason: GENERIC_INACTIVE_BLOCKER_MESSAGE
    });

    const surfacedMessages = (bulkPlan.errors ?? []).map(error => error.message);
    expect(surfacedMessages, "a demoted row's blocker message must NOT reach bulkPlan.errors").not.toContain(GENERIC_INACTIVE_BLOCKER_MESSAGE);
  });
});

// --- #427 batch-level identity-overlap check (U1-U6) -----------------------
//
// `detectIdentityOverlap` (bulkspeciesgroups.ts) only inspects IN-GROUP rows.
// `analyzeBulk`'s own `detectBatchIdentityOverlaps` closes the gap: a NEW row
// inserting a tree under a group's TreeTag, or an OUTSIDER matched row
// renaming some other tree to it. These tests exercise that DB-backed check.

const GROUP_IDENTITY_OVERLAP_REASON: TreeStemResolutionPreviewError['reason'] = 'group_identity_overlap';

function findGroupIdentityOverlapErrors(errors: PreviewError[] | undefined): TreeStemResolutionPreviewError[] {
  return (errors ?? []).filter(
    (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === GROUP_IDENTITY_OVERLAP_REASON
  );
}

// #427 B5 (see the dedicated describe block near the end of this file for
// the full explanation): a batch-wide guard that fires whenever a
// species-correction group shares a batch with one or more new rows and no
// MORE SPECIFIC group blocker already exists. Declared here, next to
// `findGroupIdentityOverlapErrors`, because U2/U5/U6 below are the first
// existing tests this guard legitimately changes the outcome of.
const GROUP_NEW_ROWS_REQUIRE_SEPARATE_BATCH_REASON: TreeStemResolutionPreviewError['reason'] = 'group_new_rows_require_separate_batch';

function findNewRowsRequireSeparateBatchErrors(errors: PreviewError[] | undefined): TreeStemResolutionPreviewError[] {
  return (errors ?? []).filter(
    (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === GROUP_NEW_ROWS_REQUIRE_SEPARATE_BATCH_REASON
  );
}

// U1-U2: a new row's TreeTag with no species-correction group at all in the batch.
const CM_ID_U1_NO_GROUP = 990;
const ROW_INDEX_U1_NO_GROUP = 0;
const NEW_ROW_INDEX_U1 = 10;

// U2: a real correction group, but neither the new row nor any outsider
// matched row carries a TreeTag value — zero candidates.
const NEW_ROW_INDEX_U2_NO_TAG = 11;

// U3: a brand-new batch row whose canonical TreeTag the DB reports as
// colliding with tree A (the tree being corrected).
const NEW_ROW_INDEX_U3_COLLISION = 12;

// U4: an outsider matched row (its own targetID is NOT part of tree A's
// correction membership) renaming its tree to tree A's TreeTag.
const CM_ID_U4_OUTSIDER = 975;
const ROW_INDEX_U4_OUTSIDER = 4;
const OUTSIDER_OLD_TREE_TAG_U4 = 'OLD-TAG-OUTSIDER';

// U5: identical shape to U3, but the DB reports no collision.
const NEW_ROW_INDEX_U5_NO_HIT = 13;

// U6: a new row's TreeTag differs from tree A's TreeTag ONLY by case. The DB
// stub returns NO match — proving the code trusts that answer rather than
// independently lower-casing/comparing in JS.
const NEW_ROW_INDEX_U6_CASE_VARIANT = 14;
const CASE_VARIANT_OF_TREE_TAG_A = TREE_TAG_A.toLowerCase();

describe('analyzeBulk - #427 batch-level identity-overlap check (new/outsider rows vs. a correction group)', () => {
  beforeEach(() => {
    mockedAnalyzeEdit.mockReset();
  });

  it('(U1) issues no query when the batch has no species-correction group, even though a new row carries a TreeTag', async () => {
    const plan = buildMatchedEditPlan({ targetID: CM_ID_U1_NO_GROUP, fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }] });
    configureAnalyzeEditMock(new Map([[CM_ID_U1_NO_GROUP, plan]]));

    const input = buildBulkInput(
      [{ rowIndex: ROW_INDEX_U1_NO_GROUP, targetID: CM_ID_U1_NO_GROUP, newRow: { MeasuredDBH: 12 } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_U1, newRow: { TreeTag: TREE_TAG_A } }]
    );

    // Awaited directly against the THROWING stub: if detectBatchIdentityOverlaps
    // ever touched `cm` here, the proxy throws NO_DB_ACCESS_EXPECTED and this
    // `await` rejects, failing the test.
    const bulkPlan = await runAnalyzeBulk(input);

    expect(findGroupIdentityOverlapErrors(bulkPlan.errors), 'no group exists, so the check must never fire').toHaveLength(0);
    expect(bulkPlan.canApply).toBe(true);
  });

  it('(U2) issues no query when a correction group exists but no new/outsider row carries a TreeTag candidate', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(new Map([[CM_ID_A1, planA]]));

    const input = buildBulkInput(
      [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_U2_NO_TAG, newRow: { MeasuredDBH: 12 } }]
    );

    const bulkPlan = await runAnalyzeBulk(input);

    expect(findGroupIdentityOverlapErrors(bulkPlan.errors), 'a group with zero TreeTag candidates must never fire').toHaveLength(0);
    expect(bulkPlan.speciesCorrectionGroups, 'the tree-A group must still be built').toHaveLength(1);
    // The batch still combines a correction group with a new row -- even one
    // with no TreeTag candidate for THIS check to see -- so the #427 B5
    // same-batch guard (group_new_rows_require_separate_batch; see its own
    // describe block near the end of this file) is the reason canApply can
    // no longer be true here.
    expect(
      findNewRowsRequireSeparateBatchErrors(bulkPlan.errors),
      'mixing a correction group with a new row must produce exactly one B5 group_new_rows_require_separate_batch error'
    ).toHaveLength(1);
    expect(bulkPlan.canApply, 'the B5 same-batch guard blocks this batch even though this check itself found zero identity-overlap candidates').toBe(false);
  });

  it("(U3) blocks the batch when a NEW row's canonical TreeTag collides (per the DB) with the tree being corrected", async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(new Map([[CM_ID_A1, planA]]));

    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([{ TreeID: TREE_ID_A, CandidateKey: 0 }]);

    const input = buildBulkInput(
      [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_U3_COLLISION, newRow: { TreeTag: TREE_TAG_A } }]
    );

    const bulkPlan = await runAnalyzeBulk(input, cm);

    const overlapErrors = findGroupIdentityOverlapErrors(bulkPlan.errors);
    expect(overlapErrors, 'exactly one group_identity_overlap for the colliding new row').toHaveLength(1);
    const overlapError = overlapErrors[0];
    expect(overlapError.treeID).toBe(TREE_ID_A);
    expect(overlapError.newRowIndexes, 'the colliding NEW row must be named in newRowIndexes').toEqual([NEW_ROW_INDEX_U3_COLLISION]);
    expect('rowIndexes' in overlapError, 'a NEW-row-only collision must never populate rowIndexes (different index space)').toBe(false);
    expectNoLeakedSQLOrInternals(overlapError.message);
    expect(bulkPlan.canApply, 'an unresolved identity overlap must block the batch').toBe(false);

    expect(recordedCalls, 'exactly one chunked query for the single candidate').toHaveLength(1);
    const { sql, params } = recordedCalls[0];
    expect(sql, "the schema must reach the query only via safeFormatQuery's escaped identifier").toContain(`\`${SCHEMA}\``);
    expect(sql.includes(String(TREE_ID_A)), 'TreeID must never be inlined as a literal into the SQL text').toBe(false);
    expect(params, 'TreeID must be bound as a query parameter, not inlined').toContain(TREE_ID_A);
  });

  it("(U4) blocks the batch when an OUTSIDER matched row renames its tree to the corrected tree's TreeTag, and that row survives phase-3 demotion", async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    const outsiderPlan = buildMatchedEditPlan({
      targetID: CM_ID_U4_OUTSIDER,
      fieldChanges: [{ field: 'TreeTag', from: OUTSIDER_OLD_TREE_TAG_U4, to: TREE_TAG_A }],
      errors: [buildBlockingTreeStemError('different_quadrat', DIFFERENT_QUADRAT_MESSAGE)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_U4_OUTSIDER, outsiderPlan]
      ])
    );

    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([{ TreeID: TREE_ID_A, CandidateKey: 0 }]);

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_U4_OUTSIDER, targetID: CM_ID_U4_OUTSIDER, newRow: { TreeTag: TREE_TAG_A } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input, cm);

    const overlapErrors = findGroupIdentityOverlapErrors(bulkPlan.errors);
    expect(overlapErrors, 'exactly one group_identity_overlap for the renaming outsider row').toHaveLength(1);
    const overlapError = overlapErrors[0];
    expect(overlapError.rowIndexes, 'the renaming MATCHED row must be named in rowIndexes').toEqual([ROW_INDEX_U4_OUTSIDER]);
    expect('newRowIndexes' in overlapError, 'a MATCHED-row-only collision must never populate newRowIndexes (different index space)').toBe(false);

    const outsiderRowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_U4_OUTSIDER);
    expect(outsiderRowPlan, 'rowPlan for the outsider row must exist').toBeDefined();
    expect(
      outsiderRowPlan?.status,
      'the outsider row has only a generic (non-correction-specific) blocker, so it survives ONLY because this check implicated it'
    ).not.toBe('invalid');
    expect(outsiderRowPlan?.plan, 'the group-implicated outsider row must keep its EditPlan').toBeDefined();
    expect(bulkPlan.canApply).toBe(false);

    expect(recordedCalls).toHaveLength(1);
  });

  it('(U5) reports no overlap and leaves speciesCorrectionGroups unchanged when the DB reports no collision', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(new Map([[CM_ID_A1, planA]]));

    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([]);
    const inputWithNewRow = buildBulkInput(
      [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_U5_NO_HIT, newRow: { TreeTag: TREE_TAG_A } }]
    );
    const bulkPlanWithNewRow = await runAnalyzeBulk(inputWithNewRow, cm);

    expect(findGroupIdentityOverlapErrors(bulkPlanWithNewRow.errors), 'the DB returned no rows, so no overlap error may be produced').toHaveLength(0);
    expect(recordedCalls, 'the one candidate must still have been checked against the DB').toHaveLength(1);
    // "No overlap error" does not mean "no blocker": the batch still
    // combines a correction group with a new row, so with the
    // identity-overlap check clear, the #427 B5 same-batch guard
    // (group_new_rows_require_separate_batch) is the one error left
    // standing, and canApply is no longer true.
    expect(
      findNewRowsRequireSeparateBatchErrors(bulkPlanWithNewRow.errors),
      'with the identity-overlap check clear, the B5 same-batch guard must be the sole error blocking this batch'
    ).toHaveLength(1);
    expect(bulkPlanWithNewRow.canApply, 'a correction group combined with a new row is blocked by B5 even when the DB reports no identity collision').toBe(
      false
    );

    const inputWithoutNewRow = buildBulkInput([{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }]);
    const bulkPlanWithoutNewRow = await runAnalyzeBulk(inputWithoutNewRow);

    expect(
      bulkPlanWithNewRow.speciesCorrectionGroups,
      'a no-hit candidate batch must produce a byte-identical speciesCorrectionGroups to the same batch run with no new row at all'
    ).toEqual(bulkPlanWithoutNewRow.speciesCorrectionGroups);
  });

  it('(U6, collation-is-delegated-not-faked) produces no overlap when a candidate TreeTag differs only by case and the DB reports no match', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(new Map([[CM_ID_A1, planA]]));

    // The DB stub deliberately returns NO rows even though
    // CASE_VARIANT_OF_TREE_TAG_A and TREE_TAG_A are equal under a naive JS
    // case-fold. If analyzeBulk ever added its own `.toLowerCase()`
    // comparison instead of trusting the DB's answer, this test would catch
    // it by failing (an overlap error would appear that the DB never reported).
    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([]);

    const input = buildBulkInput(
      [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_U6_CASE_VARIANT, newRow: { TreeTag: CASE_VARIANT_OF_TREE_TAG_A } }]
    );

    const bulkPlan = await runAnalyzeBulk(input, cm);

    expect(
      findGroupIdentityOverlapErrors(bulkPlan.errors),
      'the DB (not a JS case-fold) decides collation equality; it reported no match, so no overlap error may appear'
    ).toHaveLength(0);
    expect(recordedCalls, 'the case-variant candidate must still have reached the DB (the comparison is delegated, not skipped)').toHaveLength(1);
    // Clearing the identity-overlap check does not clear the batch: it still
    // combines a correction group with a new row, so the #427 B5 same-batch
    // guard (group_new_rows_require_separate_batch) is the one error left
    // standing, regardless of the collation outcome.
    expect(
      findNewRowsRequireSeparateBatchErrors(bulkPlan.errors),
      'with the identity-overlap check clear, the B5 same-batch guard must be the sole error blocking this batch'
    ).toHaveLength(1);
    expect(bulkPlan.canApply, 'a correction group combined with a new row is blocked by B5 regardless of the collation check outcome').toBe(false);
  });
});

// --- #427 B4: prospective cross-group destination identity collision -------
//
// `detectBatchIdentityOverlaps` only compares a NEW/OUTSIDER row's TreeTag
// against ONE correction group's own tree. It cannot see two DISTINCT
// correction groups whose own TreeTags collide under the database's
// collation while both target the SAME destination species in the SAME
// census -- a write-time UNIQUE (TreeTag, SpeciesID, CensusID) collision
// neither group's own precondition check can detect, since neither
// destination exists until the OTHER group's write lands.

const TREE_ID_B4_SECOND = 310;
const QUADRAT_ID_B4_SECOND = 10;
const B4_SECOND_OLD_SPECIES_ID = 15;
const B4_SECOND_OLD_SPECIES_CODE = 'CC';
const STEM_GUID_B4_SECOND = 520;
const CM_ID_B4_SECOND = 910;
const ROW_INDEX_B4_SECOND = 2;

const TREE_ID_B4_DIFFERENT_TAG = 320;
const TREE_TAG_B4_DIFFERENT = 'T-320';
const CM_ID_B4_DIFFERENT_TAG = 920;
const ROW_INDEX_B4_DIFFERENT_TAG = 3;

const TREE_ID_B4_DIFFERENT_SPECIES = 330;
const B4_DIFFERENT_DEST_SPECIES_ID = 17;
const B4_DIFFERENT_DEST_SPECIES_CODE = 'EE';
const CM_ID_B4_DIFFERENT_SPECIES = 930;
const ROW_INDEX_B4_DIFFERENT_SPECIES = 4;

function buildSpeciesCorrectionSummaryForSecondTree(args: {
  targetTreeID: number;
  treeTag: string;
  newSpeciesID: number;
  newSpeciesCode: string;
  stemGUID: number;
  coreMeasurementID: number;
}): SpeciesCorrectionSummary {
  return {
    version: 1,
    targetTreeID: args.targetTreeID,
    treeTag: args.treeTag,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    oldSpeciesID: B4_SECOND_OLD_SPECIES_ID,
    oldSpeciesCode: B4_SECOND_OLD_SPECIES_CODE,
    newSpeciesID: args.newSpeciesID,
    newSpeciesCode: args.newSpeciesCode,
    activeStemCount: 1,
    inactiveStemCount: 0,
    activeMeasurementCount: 1,
    inactiveMeasurementCount: 0,
    stems: [{ stemGUID: args.stemGUID, censusID: CENSUS_ID, quadratID: QUADRAT_ID_B4_SECOND, isActive: true }],
    measurements: [
      { coreMeasurementID: args.coreMeasurementID, stemGUID: args.stemGUID, censusID: CENSUS_ID, isActive: true, priorRawSpCode: B4_SECOND_OLD_SPECIES_CODE }
    ]
  };
}

describe('analyzeBulk - #427 B4 prospective cross-group destination identity collision', () => {
  beforeEach(() => {
    mockedAnalyzeEdit.mockReset();
  });

  it('(B4-1) blocks the batch when two DISTINCT correction groups share a collation-equal TreeTag and the same destination species/census', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const correctionB = buildSpeciesCorrectionSummaryForSecondTree({
      targetTreeID: TREE_ID_B4_SECOND,
      treeTag: TREE_TAG_A,
      newSpeciesID: NEW_SPECIES_ID,
      newSpeciesCode: NEW_SPECIES_CODE,
      stemGUID: STEM_GUID_B4_SECOND,
      coreMeasurementID: CM_ID_B4_SECOND
    });
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_B4_SECOND, speciesCorrection: correctionB, effects: [buildSpeciesCorrectionEffect(correctionB)] });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_B4_SECOND, planB]
      ])
    );

    // Both candidates share the exact same TreeTag text, so the real DB
    // would report each candidate matching BOTH TreeIDs (two self-matches,
    // two cross-matches) -- the code must collapse that into ONE error.
    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([
      { TreeID: TREE_ID_A, CandidateKey: 0 },
      { TreeID: TREE_ID_B4_SECOND, CandidateKey: 0 },
      { TreeID: TREE_ID_A, CandidateKey: 1 },
      { TreeID: TREE_ID_B4_SECOND, CandidateKey: 1 }
    ]);

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B4_SECOND, targetID: CM_ID_B4_SECOND, newRow: { SpeciesCode: NEW_SPECIES_CODE } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input, cm);

    const collisionErrors = findGroupIdentityOverlapErrors(bulkPlan.errors);
    expect(collisionErrors, 'exactly one actionable error for the whole prospective collision, not one per group/direction').toHaveLength(1);

    const collision = collisionErrors[0];
    expect(collision.reason).toBe('group_identity_overlap');
    expect(collision.blocking).toBe(true);
    expect(collision.severity).toBe('destructive');
    expect(collision.treeID, 'treeID must be the lower of the two colliding TreeIDs').toBe(TREE_ID_A);
    expect(collision.rowIndexes, "both groups' requesting rows must be named").toEqual([ROW_INDEX_A, ROW_INDEX_B4_SECOND].sort((a, b) => a - b));
    expect('newRowIndexes' in collision, 'both colliding trees come from matched rows, never new rows').toBe(false);
    expect(collision.message).toContain(`T#${TREE_ID_A}`);
    expect(collision.message).toContain(`T#${TREE_ID_B4_SECOND}`);
    expect(collision.message).toContain(TREE_TAG_A);
    expect(collision.message).toContain(NEW_SPECIES_CODE);
    expectNoLeakedSQLOrInternals(collision.message);

    expect(bulkPlan.canApply, 'an unresolved prospective cross-group collision must block the batch').toBe(false);

    expect(recordedCalls, 'exactly one chunked query for the two group-destination candidates').toHaveLength(1);
    const { sql, params } = recordedCalls[0];
    expect(sql, "the schema must reach the query only via safeFormatQuery's escaped identifier").toContain(`\`${SCHEMA}\``);
    expect(params, "both groups' own TreeIDs must be bound as parameters, scoped to just these two trees").toEqual(
      expect.arrayContaining([TREE_ID_A, TREE_ID_B4_SECOND])
    );
  });

  it('(B4-2) does not block when two groups target the same destination species/census but have genuinely different TreeTags', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const correctionDifferentTag = buildSpeciesCorrectionSummaryForSecondTree({
      targetTreeID: TREE_ID_B4_DIFFERENT_TAG,
      treeTag: TREE_TAG_B4_DIFFERENT,
      newSpeciesID: NEW_SPECIES_ID,
      newSpeciesCode: NEW_SPECIES_CODE,
      stemGUID: STEM_GUID_B4_SECOND + 1,
      coreMeasurementID: CM_ID_B4_DIFFERENT_TAG
    });
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planDifferentTag = buildMatchedEditPlan({
      targetID: CM_ID_B4_DIFFERENT_TAG,
      speciesCorrection: correctionDifferentTag,
      effects: [buildSpeciesCorrectionEffect(correctionDifferentTag)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_B4_DIFFERENT_TAG, planDifferentTag]
      ])
    );

    // The DB is queried (both groups share a destination species+census,
    // so the pre-filter cannot skip it) but reports only each candidate's
    // OWN tree -- the two TreeTags genuinely differ.
    const { cm, recordedCalls } = buildRecordingConnectionManagerStub([
      { TreeID: TREE_ID_A, CandidateKey: 0 },
      { TreeID: TREE_ID_B4_DIFFERENT_TAG, CandidateKey: 1 }
    ]);

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B4_DIFFERENT_TAG, targetID: CM_ID_B4_DIFFERENT_TAG, newRow: { SpeciesCode: NEW_SPECIES_CODE } }
    ]);

    const bulkPlan = await runAnalyzeBulk(input, cm);

    expect(findGroupIdentityOverlapErrors(bulkPlan.errors), 'genuinely different TreeTags must never produce a collision error').toHaveLength(0);
    expect(bulkPlan.canApply, 'two unrelated trees correcting to the same species must stay applicable').toBe(true);
    expect(recordedCalls, 'the DB is still consulted once the species/census pre-filter matches').toHaveLength(1);
  });

  it('(B4-3) issues no query when two groups share a TreeTag but target different destination species (no two groups could share a destination)', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const correctionDifferentSpecies = buildSpeciesCorrectionSummaryForSecondTree({
      targetTreeID: TREE_ID_B4_DIFFERENT_SPECIES,
      treeTag: TREE_TAG_A,
      newSpeciesID: B4_DIFFERENT_DEST_SPECIES_ID,
      newSpeciesCode: B4_DIFFERENT_DEST_SPECIES_CODE,
      stemGUID: STEM_GUID_B4_SECOND + 2,
      coreMeasurementID: CM_ID_B4_DIFFERENT_SPECIES
    });
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planDifferentSpecies = buildMatchedEditPlan({
      targetID: CM_ID_B4_DIFFERENT_SPECIES,
      speciesCorrection: correctionDifferentSpecies,
      effects: [buildSpeciesCorrectionEffect(correctionDifferentSpecies)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_B4_DIFFERENT_SPECIES, planDifferentSpecies]
      ])
    );

    const input = buildBulkInput([
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B4_DIFFERENT_SPECIES, targetID: CM_ID_B4_DIFFERENT_SPECIES, newRow: { SpeciesCode: B4_DIFFERENT_DEST_SPECIES_CODE } }
    ]);

    // Awaited directly against the THROWING stub: if the B4 check ever
    // issued a query here, the proxy throws NO_DB_ACCESS_EXPECTED and this
    // `await` rejects, failing the test.
    const bulkPlan = await runAnalyzeBulk(input);

    expect(findGroupIdentityOverlapErrors(bulkPlan.errors), 'no two groups share a destination species, so the check must never fire').toHaveLength(0);
    expect(bulkPlan.canApply).toBe(true);
  });
});

// --- #427 B5: species corrections cannot share a batch with new rows ------
//
// The apply route writes a #427 species correction and then calls the
// shared new-row ingestion pipeline, whose stored procedure
// (`bulkingestionprocess`) opens and commits its OWN transaction. That
// commit lands the correction writes early, so a later failure in the SAME
// upload can no longer be rolled back -- breaking #427's all-or-nothing
// guarantee. Transaction ownership is deliberately NOT refactored for this
// issue; the conservative, user-authorized product decision is that
// species corrections and new measurement rows must be submitted as
// separate uploads, even when no tree identity actually overlaps. Preview
// and apply agree because the apply route re-runs `analyzeBulk` and gates
// on `canApply` -- this rule applies whether or not the user checked the
// new-rows confirmation checkbox.

// B5-1/B5-6: a new row with NO TreeTag field at all. It cannot possibly
// collide with anything, which is what makes an "unrelated new row" an
// honest claim without needing a recording DB stub: `detectBatchIdentityOverlaps`
// never builds a candidate for it, so the whole batch stays on the
// THROWING connection stub and zero DB access is proven for free.
const NEW_ROW_INDEX_B5_UNRELATED = 20;
const NEW_ROW_INDEX_B5_NONDEMOTION = 26;

// B5-2: a second, distinct correction group (its own tree/destination
// species) plus two new rows supplied in NON-ascending rowIndex order, to
// prove the merged rowIndexes/newRowIndexes are actually sorted, not merely
// concatenated in supply order. The second group's destination species
// deliberately differs from tree A's so the B4 destination-collision
// pre-filter bucket never reaches two groups and that check's own query is
// never sent either.
const TREE_ID_B5_SECOND = 340;
const TREE_TAG_B5_SECOND = 'T-340';
const NEW_SPECIES_ID_B5_SECOND = 19;
const NEW_SPECIES_CODE_B5_SECOND = 'FF';
const STEM_GUID_B5_SECOND = 530;
const CM_ID_B5_SECOND_GROUP = 940;
const ROW_INDEX_B5_SECOND_GROUP_MEMBER = 5;
const NEW_ROW_INDEX_B5_MULTI_HIGHER = 23;
const NEW_ROW_INDEX_B5_MULTI_LOWER = 21;

// B5-3: suppression -- a batch with a MORE specific group blocker already
// (two sibling rows requesting two different destination species for the
// same tree, exactly as the existing group_species_conflict test), plus an
// otherwise-irrelevant new row.
const NEW_ROW_INDEX_B5_SUPPRESSED = 24;

// B5-4: narrowness guard -- new rows plus an ordinary matched field edit,
// with NO species-correction group anywhere in the batch.
const CM_ID_B5_NARROW_MATCHED = 941;
const NEW_ROW_INDEX_B5_NARROW = 25;

describe('analyzeBulk - #427 B5 batch-wide guard: species corrections cannot share a batch with new rows', () => {
  beforeEach(() => {
    mockedAnalyzeEdit.mockReset();
  });

  it('(B5-1) blocks a batch combining one correction group with an unrelated new row, naming exactly the group and new-row indexes', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(new Map([[CM_ID_A1, planA]]));

    const matched = [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }];
    // The new row carries no TreeTag field at all, so it cannot collide with
    // tree A under any collation -- "unrelated" is honest without a DB
    // stub, and this test runs safely against the THROWING connection stub.
    const inputWithNewRow = buildBulkInput(matched, [], [{ rowIndex: NEW_ROW_INDEX_B5_UNRELATED, newRow: {} }]);

    const bulkPlan = await runAnalyzeBulk(inputWithNewRow);

    const separateBatchErrors = findNewRowsRequireSeparateBatchErrors(bulkPlan.errors);
    expect(separateBatchErrors, 'a correction group combined with any new row must produce exactly one B5 error').toHaveLength(1);

    const error = separateBatchErrors[0];
    expect(bulkPlan.canApply, 'the B5 guard is blocking, so canApply must be false').toBe(false);
    expect(error.rowIndexes, "the error's rowIndexes must equal exactly the group's member rowIndexes").toEqual([ROW_INDEX_A]);
    expect(error.newRowIndexes, "the error's newRowIndexes must equal exactly the new row's own index").toEqual([NEW_ROW_INDEX_B5_UNRELATED]);
    expect('treeID' in error, 'B5 is a batch-wide guard, not a per-tree one, so it must never carry a treeID').toBe(false);
    expectNoLeakedSQLOrInternals(error.message);
    expect(error.message.toLowerCase(), 'the message must stay product-level and must never mention SQL').not.toContain('sql');
    expect(error.message.toLowerCase(), 'the message must stay product-level and must never mention transactions').not.toContain('transaction');

    const inputWithoutNewRow = buildBulkInput(matched);
    const bulkPlanWithoutNewRow = await runAnalyzeBulk(inputWithoutNewRow);
    expect(
      bulkPlan.speciesCorrectionGroups,
      'the B5 guard must not mutate or drop the group it names -- it must stay byte-identical to the same batch with no new row at all'
    ).toEqual(bulkPlanWithoutNewRow.speciesCorrectionGroups);
  });

  it('(B5-2) merges rowIndexes/newRowIndexes from MULTIPLE groups and MULTIPLE new rows into one de-duplicated ascending union', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const planA1 = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planA2 = buildMatchedEditPlan({ targetID: CM_ID_A2, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });

    const correctionB = buildSpeciesCorrectionSummaryForSecondTree({
      targetTreeID: TREE_ID_B5_SECOND,
      treeTag: TREE_TAG_B5_SECOND,
      newSpeciesID: NEW_SPECIES_ID_B5_SECOND,
      newSpeciesCode: NEW_SPECIES_CODE_B5_SECOND,
      stemGUID: STEM_GUID_B5_SECOND,
      coreMeasurementID: CM_ID_B5_SECOND_GROUP
    });
    const planB = buildMatchedEditPlan({
      targetID: CM_ID_B5_SECOND_GROUP,
      fieldChanges: [{ field: 'SpeciesCode', from: OLD_SPECIES_CODE, to: NEW_SPECIES_CODE_B5_SECOND }],
      speciesCorrection: correctionB,
      effects: [buildSpeciesCorrectionEffect(correctionB)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA1],
        [CM_ID_A2, planA2],
        [CM_ID_B5_SECOND_GROUP, planB]
      ])
    );

    const matched = [
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      {
        rowIndex: ROW_INDEX_B5_SECOND_GROUP_MEMBER,
        targetID: CM_ID_B5_SECOND_GROUP,
        newRow: { SpeciesCode: NEW_SPECIES_CODE_B5_SECOND },
        explicitSpeciesCode: NEW_SPECIES_CODE_B5_SECOND
      }
    ];
    // Two new rows supplied HIGHER-index-first (non-ascending) to prove the
    // merged newRowIndexes is actually sorted, not merely concatenated in
    // supplied order. Neither carries a TreeTag, so (as in B5-1) this runs
    // safely against the THROWING connection stub -- zero DB access.
    const input = buildBulkInput(
      matched,
      [],
      [
        { rowIndex: NEW_ROW_INDEX_B5_MULTI_HIGHER, newRow: {} },
        { rowIndex: NEW_ROW_INDEX_B5_MULTI_LOWER, newRow: {} }
      ]
    );

    const bulkPlan = await runAnalyzeBulk(input);

    expect(bulkPlan.speciesCorrectionGroups, 'both distinct trees must each produce their own group').toHaveLength(2);

    const separateBatchErrors = findNewRowsRequireSeparateBatchErrors(bulkPlan.errors);
    expect(separateBatchErrors, 'multiple groups and multiple new rows must still collapse into exactly one B5 error').toHaveLength(1);

    const error = separateBatchErrors[0];
    expect(error.rowIndexes, "every group's member rowIndexes must be merged ascending, across BOTH groups").toEqual([
      ROW_INDEX_A,
      ROW_INDEX_B,
      ROW_INDEX_B5_SECOND_GROUP_MEMBER
    ]);
    expect(error.newRowIndexes, 'both new-row indexes must be merged ascending, regardless of supply order').toEqual([
      NEW_ROW_INDEX_B5_MULTI_LOWER,
      NEW_ROW_INDEX_B5_MULTI_HIGHER
    ]);
    expect(bulkPlan.canApply).toBe(false);
  });

  it('(B5-3) suppresses the B5 error when a more specific group blocker already exists, even with a new row present', async () => {
    const correctionA = buildSpeciesCorrectionSummaryTreeA();
    const correctionB = buildSpeciesCorrectionSummaryTreeA({ newSpeciesID: CONFLICTING_NEW_SPECIES_ID, newSpeciesCode: CONFLICTING_NEW_SPECIES_CODE });
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correctionA, effects: [buildSpeciesCorrectionEffect(correctionA)] });
    const planB = buildMatchedEditPlan({
      targetID: CM_ID_A2,
      fieldChanges: [{ field: 'SpeciesCode', from: OLD_SPECIES_CODE, to: CONFLICTING_NEW_SPECIES_CODE }],
      speciesCorrection: correctionB,
      effects: [buildSpeciesCorrectionEffect(correctionB)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const matched = [
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE } },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: CONFLICTING_NEW_SPECIES_CODE } }
    ];
    // Same contradictory-destination shape as the existing group_species_conflict
    // test above, plus one otherwise-irrelevant new row with no TreeTag, so
    // this still runs against the THROWING stub -- zero DB access either way.
    const input = buildBulkInput(matched, [], [{ rowIndex: NEW_ROW_INDEX_B5_SUPPRESSED, newRow: {} }]);

    const bulkPlan = await runAnalyzeBulk(input);

    const speciesConflicts = (bulkPlan.errors ?? []).filter(
      (error): error is TreeStemResolutionPreviewError => error.kind === 'TreeStemResolution' && error.reason === 'group_species_conflict'
    );
    expect(speciesConflicts, 'the more specific destination-conflict error must still fire').toHaveLength(1);

    expect(
      findNewRowsRequireSeparateBatchErrors(bulkPlan.errors),
      'B5 must be suppressed entirely once a more specific group blocker already exists -- a redundant generic message would just add noise'
    ).toHaveLength(0);
    expect(bulkPlan.canApply, 'the batch is still blocked, by the more specific conflict, not by B5').toBe(false);
  });

  it('(B5-4 narrowness guard) never fires on a plain new-row batch with no correction group at all', async () => {
    const plan = buildMatchedEditPlan({ targetID: CM_ID_B5_NARROW_MATCHED, fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }] });
    configureAnalyzeEditMock(new Map([[CM_ID_B5_NARROW_MATCHED, plan]]));

    const input = buildBulkInput(
      [{ rowIndex: ROW_INDEX_A, targetID: CM_ID_B5_NARROW_MATCHED, newRow: { MeasuredDBH: 12 } }],
      [],
      [{ rowIndex: NEW_ROW_INDEX_B5_NARROW, newRow: { MeasuredDBH: 7 } }]
    );

    // Awaited directly against the THROWING stub: B5 requires groups.length
    // > 0, and there is no species-correction group anywhere in this batch,
    // so if analyzeBulk ever touched the database here this `await` would
    // reject on NO_DB_ACCESS_EXPECTED, failing the test.
    const bulkPlan = await runAnalyzeBulk(input);

    expect('speciesCorrectionGroups' in bulkPlan, 'no row in this batch requests a correction, so the key must be entirely absent').toBe(false);
    expect(findNewRowsRequireSeparateBatchErrors(bulkPlan.errors), 'new rows alone, with no correction group, must never trigger B5').toHaveLength(0);
    expect(bulkPlan.canApply).toBe(true);
  });

  it('(B5-5 narrowness guard) never fires on a correction-only batch with zero new rows', async () => {
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    const planB = buildMatchedEditPlan({ targetID: CM_ID_A2, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const matched = [
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE }
    ];
    // With zero new rows, B5's own gate (`groups.length > 0 && input.newRows.length
    // > 0` in analyzeBulk) cannot fire no matter how many correction groups
    // exist -- there is no second collection to combine with. Phase 2 still
    // builds the correction group normally, which this test asserts directly.
    const bulkPlan = await runAnalyzeBulk(buildBulkInput(matched));

    expect(findNewRowsRequireSeparateBatchErrors(bulkPlan.errors), 'zero new rows must never trigger B5').toHaveLength(0);
    expect(bulkPlan.canApply, 'a correction-only batch with no new rows must remain applicable').toBe(true);

    expect(bulkPlan.speciesCorrectionGroups, 'exactly one group must be built for tree A').toHaveLength(1);
    const group = (bulkPlan.speciesCorrectionGroups as SpeciesCorrectionGroup[])[0];
    expect(group.treeID, "the group's treeID must be tree A's own TreeID").toBe(TREE_ID_A);
    expect(group.censusID, "the group's censusID must be the batch's own CensusID").toBe(CENSUS_ID);
    expect(group.members, 'both rows must be recorded as requesting members, sorted ascending by rowIndex').toEqual([
      { rowIndex: ROW_INDEX_A, coreMeasurementID: CM_ID_A1, requestedCorrection: true },
      { rowIndex: ROW_INDEX_B, coreMeasurementID: CM_ID_A2, requestedCorrection: true }
    ]);
  });

  it('(B5-6) does not demote a blocked group MEMBER row even though its own blocker is generic and it requested no correction itself', async () => {
    // Why this matters: unlike every other group_* reason (which names only
    // the rows actually implicated in ITS OWN check), `buildNewRowsRequireSeparateBatchError`
    // names EVERY member of EVERY group -- requesting or not -- because
    // `groupImplicatedRowIndexes` (analyzeBulk's phase-3 survival gate) is
    // built from mergedGroupErrors[].rowIndexes. If a non-requesting member
    // row with only a generic blocker were demoted here, the next
    // `analyzeBulk` pass (both revisionupload/route.ts and apply/route.ts
    // re-run it on surviving rows only) would never see that row again.
    const correction = buildSpeciesCorrectionSummaryTreeA();
    const planA = buildMatchedEditPlan({ targetID: CM_ID_A1, speciesCorrection: correction, effects: [buildSpeciesCorrectionEffect(correction)] });
    // Row B is a non-requesting MEMBER: its targetID (CM_ID_A2) is one of
    // tree A's attached measurements, but its OWN plan carries no
    // speciesCorrection, no SpeciesCode fieldChange, and no
    // correction-specific blocking reason -- only a generic `different_quadrat`
    // blocker, and no explicitSpeciesCode (so Check A never fires on it).
    const planB = buildMatchedEditPlan({
      targetID: CM_ID_A2,
      fieldChanges: [],
      errors: [buildBlockingTreeStemError('different_quadrat', DIFFERENT_QUADRAT_MESSAGE)]
    });

    configureAnalyzeEditMock(
      new Map([
        [CM_ID_A1, planA],
        [CM_ID_A2, planB]
      ])
    );

    const matched = [
      { rowIndex: ROW_INDEX_A, targetID: CM_ID_A1, newRow: { SpeciesCode: NEW_SPECIES_CODE }, explicitSpeciesCode: NEW_SPECIES_CODE },
      { rowIndex: ROW_INDEX_B, targetID: CM_ID_A2, newRow: {} }
    ];
    const input = buildBulkInput(matched, [], [{ rowIndex: NEW_ROW_INDEX_B5_NONDEMOTION, newRow: {} }]);

    const bulkPlan = await runAnalyzeBulk(input);

    const separateBatchErrors = findNewRowsRequireSeparateBatchErrors(bulkPlan.errors);
    expect(separateBatchErrors, 'the B5 error must fire and name both the requesting row and the non-requesting member').toHaveLength(1);
    expect(separateBatchErrors[0].rowIndexes, "B5's rowIndexes must include the non-requesting member, not just the requesting row").toEqual([
      ROW_INDEX_A,
      ROW_INDEX_B
    ]);

    // groupImplicatedRowIndexes (phase 3's survival gate) is built from
    // mergedGroupErrors[].rowIndexes -- which is exactly the array asserted
    // above, so row B's survival below is caused by THAT set, not by
    // anything intrinsic to row B's own plan.
    const rowBPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === ROW_INDEX_B);
    expect(rowBPlan, 'rowPlan for the non-requesting member (row B) must exist').toBeDefined();
    expect(
      rowBPlan?.status,
      'row B has no speciesCorrection, no SpeciesCode request, and only a generic blocker -- it survives ONLY because B5 names its rowIndex'
    ).not.toBe('invalid');
    expect(rowBPlan?.plan, 'the group-implicated member must keep its EditPlan, not be demoted to a bare invalid rowPlan').toBeDefined();

    const surfacedMessages = (bulkPlan.errors ?? []).map(error => error.message);
    expect(surfacedMessages, "row B's own blocker message must still reach bulkPlan.errors because it survived demotion").toContain(DIFFERENT_QUADRAT_MESSAGE);
    expect(bulkPlan.canApply).toBe(false);
  });
});
