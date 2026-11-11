import { describe, expect, it } from 'vitest';
import {
  analyzeBulkSpeciesCorrections,
  BulkSpeciesGroupRow,
  buildSpeciesCorrectionGroups,
  detectSpeciesGroupConflicts,
  isSpeciesCorrectionEffect
} from './bulkspeciesgroups';
import {
  DuplicateDeletion,
  Effect,
  EditPlan,
  FieldChange,
  SpeciesCorrectionMeasurementPrecondition,
  SpeciesCorrectionStemPrecondition,
  SpeciesCorrectionSummary
} from './types';

// --- Named fixture constants (no bare magic numbers/strings in assertions) ---
const TREE_ID_A = 100;
const TREE_ID_B = 200;
const CENSUS_ID = 7;
const OTHER_CENSUS_ID = 8;
const PLOT_ID = 3;
const TREE_TAG_A = 'T-A1';
const TREE_TAG_B = 'T-B1';
const OLD_SPECIES_ID = 9;
const OLD_SPECIES_CODE = 'AA';
const NEW_SPECIES_ID = 11;
const NEW_SPECIES_CODE = 'BB';
const ALT_NEW_SPECIES_ID = 12;
const ALT_NEW_SPECIES_CODE = 'CC';

const STEM_GUID_1 = 500;
const STEM_GUID_2 = 501;
const STEM_GUID_3 = 502;
const STEM_GUID_TREE_B = 600;
const STEM_GUID_TREE_B_2 = 601;
const CM_ID_1 = 900;
const CM_ID_2 = 901;
const CM_ID_4 = 903;
const CM_ID_5 = 904;
const CM_ID_TREE_B = 910;
const CM_ID_TREE_B_SIBLING = 911;
const CM_ID_UNRELATED = 999;

const ROW_INDEX_0 = 0;
const ROW_INDEX_1 = 1;
const ROW_INDEX_2 = 2;
const ROW_INDEX_3 = 3;

// --- Leaked-SQL / internal-detail guard (real SQL syntax, never ordinary English prose) ---
const LEAKED_SQL_LABEL_SELECT_FROM = 'SELECT...FROM co-occurrence';
const LEAKED_SQL_LABEL_INSERT_INTO = 'INSERT INTO';
const LEAKED_SQL_LABEL_DELETE_FROM = 'DELETE FROM';
const LEAKED_SQL_LABEL_UPDATE_SET = 'UPDATE <ident> SET';
const LEAKED_SQL_LABEL_JOIN_ON = 'JOIN...ON';
const LEAKED_SQL_LABEL_BACKTICK = 'backtick schema-identifier quote';
const LEAKED_SQL_LABEL_SCHEMA_PLACEHOLDER = '?? schema placeholder';
const LEAKED_SQL_LABEL_BOUND_PARAM = 'bound-parameter comparison (= ?)';

const REAL_LEAKED_QUERY = 'SELECT TreeID, IsActive FROM ??.trees WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?';

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

// --- Slice 3 (batch-level integrity checks) fixture constants ---
const CONTRADICTING_SPECIES_CODE_1 = 'ZZ';
const CONTRADICTING_SPECIES_CODE_2 = 'YY';

const TREE_TAG_CHANGED_VALUE = 'T-A1-renamed';
const STEM_TAG_CHANGED_VALUE = 'S-99';
const QUADRAT_NAME_CHANGED_VALUE = 'Q-99';
const MEASURED_DBH_CHANGED_VALUE = 15.5;
const DESCRIPTION_CHANGED_VALUE = 'updated note';

const STEM_LOCAL_X_VALUE_LOW = 12.3;
const STEM_LOCAL_X_VALUE_HIGH = 99.9;
// Both round to the same stored 2-decimal value (PER_COLUMN_DECIMAL_PRECISION.StemLocalX)
// via normalizeFieldValueForComparison, so comparing them actually exercises the shared
// rounding logic rather than mere strict/string equality.
const STEM_LOCAL_X_PRECISE_VARIANT_A = 12.3;
const STEM_LOCAL_X_PRECISE_VARIANT_B = 12.3049;

const CONFLICTING_DBH_VALUE_1 = 11;
const CONFLICTING_DBH_VALUE_2 = 12;

function buildStem(overrides: Partial<SpeciesCorrectionStemPrecondition> = {}): SpeciesCorrectionStemPrecondition {
  return { stemGUID: STEM_GUID_1, censusID: CENSUS_ID, quadratID: 1, isActive: true, ...overrides };
}

function buildMeasurement(overrides: Partial<SpeciesCorrectionMeasurementPrecondition> = {}): SpeciesCorrectionMeasurementPrecondition {
  return { coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1, censusID: CENSUS_ID, isActive: true, priorRawSpCode: OLD_SPECIES_CODE, ...overrides };
}

/**
 * Two active stems, two measurements (one per stem) — the minimal
 * membership shape most tests vary from.
 */
function buildCorrection(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
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
    stems: [buildStem({ stemGUID: STEM_GUID_1 }), buildStem({ stemGUID: STEM_GUID_2 })],
    measurements: [
      buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 }),
      buildMeasurement({ coreMeasurementID: CM_ID_2, stemGUID: STEM_GUID_2 })
    ],
    ...overrides
  };
}

function buildPlanWithCorrection(targetID: number, correction: SpeciesCorrectionSummary): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID,
    fieldChanges: [{ field: 'SpeciesCode', from: correction.oldSpeciesCode, to: correction.newSpeciesCode }],
    effects: [],
    maxSeverity: 'warn',
    planHash: '',
    generatedAt: '2026-04-21T00:00:00.000Z',
    speciesCorrection: correction
  };
}

function buildRequestingRow(rowIndex: number, targetID: number, correction: SpeciesCorrectionSummary): BulkSpeciesGroupRow {
  return { rowIndex, targetID, status: 'matched', plan: buildPlanWithCorrection(targetID, correction) };
}

/**
 * Same as `buildRequestingRow`, plus extra `fieldChanges` beyond the
 * `SpeciesCode` entry — a row can request a species correction AND an
 * ordinary field edit (e.g. a coordinate) in the same edit; only an
 * identity-field change (`TreeTag`/`StemTag`/`QuadratName`) is mutually
 * exclusive with a species correction (`rules/species.ts`'s `mixed_identity`
 * gate), which this helper is never used to construct.
 */
function buildRequestingRowWithFieldChanges(
  rowIndex: number,
  targetID: number,
  correction: SpeciesCorrectionSummary,
  extraFieldChanges: FieldChange[]
): BulkSpeciesGroupRow {
  const base = buildPlanWithCorrection(targetID, correction);
  return { rowIndex, targetID, status: 'matched', plan: { ...base, fieldChanges: [...base.fieldChanges, ...extraFieldChanges] } };
}

function buildNonRequestingRow(
  rowIndex: number,
  targetID: number,
  status: BulkSpeciesGroupRow['status'] = 'unchanged',
  explicitSpeciesCode?: string | null
): BulkSpeciesGroupRow {
  return { rowIndex, targetID, status, ...(explicitSpeciesCode !== undefined ? { explicitSpeciesCode } : {}) };
}

/**
 * A sibling row that carries its OWN field edit(s) — not a species
 * correction — so `plan.fieldChanges` describes a real requested change
 * (`TreeTag`, `StemLocalX`, `MeasuredDBH`, etc.) without `speciesCorrection`
 * being present at all. Used to exercise checks B/D, which look at
 * `plan.fieldChanges` on rows other than the one requesting the correction.
 */
function buildFieldChangeOnlyRow(
  rowIndex: number,
  targetID: number,
  fieldChanges: FieldChange[],
  status: BulkSpeciesGroupRow['status'] = 'matched'
): BulkSpeciesGroupRow {
  return {
    rowIndex,
    targetID,
    status,
    plan: {
      dataType: 'measurementssummary',
      targetID,
      fieldChanges,
      effects: [],
      maxSeverity: 'warn',
      planHash: '',
      generatedAt: '2026-04-21T00:00:00.000Z'
    }
  };
}

function buildDuplicateDeletion(coreMeasurementID: number, survivorCoreMeasurementID: number): DuplicateDeletion {
  return { coreMeasurementID, survivorCoreMeasurementID };
}

describe('buildSpeciesCorrectionGroups', () => {
  it('collapses two sibling rows requesting the identical correction into one group with one canonical correction and no errors', () => {
    const correction = buildCorrection();
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correction);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.errors).toEqual([]);
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group.correction).toEqual(correction);
    expect(group.members).toEqual([
      { rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_1, requestedCorrection: true },
      { rowIndex: ROW_INDEX_1, coreMeasurementID: CM_ID_2, requestedCorrection: true }
    ]);
  });

  it('produces a deep-equal result regardless of which file order the two sibling rows arrive in', () => {
    const correction = buildCorrection();
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correction);

    const forward = buildSpeciesCorrectionGroups([rowA, rowB]);
    const reversed = buildSpeciesCorrectionGroups([rowB, rowA]);

    expect(reversed).toEqual(forward);
  });

  it('returns unique, ascending-sorted affectedCoreMeasurementIDs/affectedStemGUIDs including inactive members', () => {
    const correction = buildCorrection({
      inactiveStemCount: 1,
      inactiveMeasurementCount: 1,
      stems: [buildStem({ stemGUID: STEM_GUID_2 }), buildStem({ stemGUID: STEM_GUID_1 }), buildStem({ stemGUID: STEM_GUID_3, isActive: false })],
      measurements: [
        buildMeasurement({ coreMeasurementID: CM_ID_2, stemGUID: STEM_GUID_2 }),
        buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 }),
        buildMeasurement({ coreMeasurementID: CM_ID_4, stemGUID: STEM_GUID_3, isActive: false })
      ]
    });
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correction);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.errors).toEqual([]);
    expect(result.groups[0].affectedCoreMeasurementIDs).toEqual([CM_ID_1, CM_ID_2, CM_ID_4]);
    expect(result.groups[0].affectedStemGUIDs).toEqual([STEM_GUID_1, STEM_GUID_2, STEM_GUID_3]);
  });

  it('pulls in a non-requesting sibling row ("unchanged", no speciesCorrection) whose targetID is attached, marked requestedCorrection:false', () => {
    const correction = buildCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged');

    const result = buildSpeciesCorrectionGroups([requesting, sibling]);

    expect(result.groups[0].members).toEqual([
      { rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_1, requestedCorrection: true },
      { rowIndex: ROW_INDEX_1, coreMeasurementID: CM_ID_2, requestedCorrection: false }
    ]);
  });

  it("does not attach a row whose targetID is not among any correction's measurements to any group", () => {
    const correction = buildCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const unrelated = buildNonRequestingRow(ROW_INDEX_1, CM_ID_UNRELATED, 'unchanged');

    const result = buildSpeciesCorrectionGroups([requesting, unrelated]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].members.some(member => member.rowIndex === ROW_INDEX_1)).toBe(false);
  });

  it('flags a group_species_conflict (destination kind) when two rows request different destination species for the same tree+census, still emitting the group from the lowest rowIndex', () => {
    const correctionBB = buildCorrection({ newSpeciesID: NEW_SPECIES_ID, newSpeciesCode: NEW_SPECIES_CODE });
    const correctionCC = buildCorrection({ newSpeciesID: ALT_NEW_SPECIES_ID, newSpeciesCode: ALT_NEW_SPECIES_CODE });
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correctionBB);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correctionCC);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].correction.newSpeciesCode).toBe(NEW_SPECIES_CODE);

    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error.reason).toBe('group_species_conflict');
    expect(error.treeID).toBe(TREE_ID_A);
    expect(error.rowIndexes).toEqual([ROW_INDEX_0, ROW_INDEX_1]);
    expect(error.rowIndex).toBe(ROW_INDEX_0);
    expect(error.message).toContain(`"${NEW_SPECIES_CODE}"`);
    expect(error.message).toContain(`"${ALT_NEW_SPECIES_CODE}"`);
    expect(error.message).toContain(`"${TREE_TAG_A}"`);
    expectNoLeakedSQLOrInternals(error.message);
  });

  it('flags a group_species_conflict (membership kind) when a measurement moves between two already-attached sibling stems despite equal counts and an identical ID set', () => {
    const correctionA = buildCorrection();
    const correctionB = buildCorrection({
      // Same CoreMeasurementID set (CM_ID_1, CM_ID_2) and StemGUID set
      // (STEM_GUID_1, STEM_GUID_2); only CM_ID_2's link moves from
      // STEM_GUID_2 to STEM_GUID_1.
      measurements: [
        buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 }),
        buildMeasurement({ coreMeasurementID: CM_ID_2, stemGUID: STEM_GUID_1 })
      ]
    });
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correctionA);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correctionB);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.groups).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('group_species_conflict');
    expect(result.errors[0].message).toMatch(/re-review/i);
    expectNoLeakedSQLOrInternals(result.errors[0].message);
  });

  it('flags a group_species_conflict (membership kind) on an activity swap between two equal-count sibling stems despite an identical StemGUID set', () => {
    // Same StemGUID set (STEM_GUID_1, STEM_GUID_2) and the same active count
    // (one active, one inactive) in both variants — only WHICH stem is
    // inactive swaps.
    const correctionWithStem1Active = buildCorrection({
      activeStemCount: 1,
      inactiveStemCount: 1,
      stems: [buildStem({ stemGUID: STEM_GUID_1, isActive: true }), buildStem({ stemGUID: STEM_GUID_2, isActive: false })]
    });
    const correctionWithStem2Active = buildCorrection({
      activeStemCount: 1,
      inactiveStemCount: 1,
      stems: [buildStem({ stemGUID: STEM_GUID_1, isActive: false }), buildStem({ stemGUID: STEM_GUID_2, isActive: true })]
    });
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correctionWithStem1Active);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correctionWithStem2Active);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.groups).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('group_species_conflict');
  });

  it('does not report a case-only newSpeciesCode difference (same newSpeciesID) as a conflict, and still collapses to one group', () => {
    const correctionUpper = buildCorrection({ newSpeciesCode: NEW_SPECIES_CODE });
    const correctionLower = buildCorrection({ newSpeciesCode: NEW_SPECIES_CODE.toLowerCase() });
    const rowA = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correctionUpper);
    const rowB = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correctionLower);

    const result = buildSpeciesCorrectionGroups([rowA, rowB]);

    expect(result.errors).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].correction.newSpeciesCode).toBe(NEW_SPECIES_CODE);
  });

  it('produces two groups sorted by treeID for two different trees corrected in the same batch, each with its own members', () => {
    // Deliberately disjoint CoreMeasurementID/StemGUID sets between the two
    // corrections (a single measurement can only ever belong to one tree in
    // real data) so a membership-matching bug that leaked a row into the
    // WRONG tree's group would be caught by the exact-members assertions
    // below instead of accidentally passing.
    const correctionForTreeA = buildCorrection();
    const correctionForTreeB = buildCorrection({
      targetTreeID: TREE_ID_B,
      treeTag: TREE_TAG_B,
      censusID: OTHER_CENSUS_ID,
      activeStemCount: 1,
      activeMeasurementCount: 1,
      stems: [buildStem({ stemGUID: STEM_GUID_TREE_B })],
      measurements: [buildMeasurement({ coreMeasurementID: CM_ID_TREE_B, stemGUID: STEM_GUID_TREE_B })]
    });

    // Deliberately pushed in an order where the higher TreeID is first, to
    // prove the output is sorted rather than input-order-preserving.
    const rowForTreeB = buildRequestingRow(ROW_INDEX_0, CM_ID_TREE_B, correctionForTreeB);
    const rowForTreeA = buildRequestingRow(ROW_INDEX_1, CM_ID_1, correctionForTreeA);

    const result = buildSpeciesCorrectionGroups([rowForTreeB, rowForTreeA]);

    expect(result.errors).toEqual([]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].treeID).toBe(TREE_ID_A);
    expect(result.groups[1].treeID).toBe(TREE_ID_B);
    expect(result.groups[0].members).toEqual([{ rowIndex: ROW_INDEX_1, coreMeasurementID: CM_ID_1, requestedCorrection: true }]);
    expect(result.groups[1].members).toEqual([{ rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_TREE_B, requestedCorrection: true }]);
  });

  it("never mutates the caller's correction object, and returns descending-supplied stems/measurements re-sorted ascending", () => {
    const descendingStems = [buildStem({ stemGUID: STEM_GUID_3, isActive: false }), buildStem({ stemGUID: STEM_GUID_2 }), buildStem({ stemGUID: STEM_GUID_1 })];
    const descendingMeasurements = [
      buildMeasurement({ coreMeasurementID: CM_ID_4, stemGUID: STEM_GUID_3, isActive: false }),
      buildMeasurement({ coreMeasurementID: CM_ID_2, stemGUID: STEM_GUID_2 }),
      buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 })
    ];
    const correction = buildCorrection({
      inactiveStemCount: 1,
      inactiveMeasurementCount: 1,
      stems: descendingStems,
      measurements: descendingMeasurements
    });
    const originalStemsSnapshot = [...descendingStems];
    const originalMeasurementsSnapshot = [...descendingMeasurements];
    const row = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);

    const result = buildSpeciesCorrectionGroups([row]);

    expect(correction.stems).toEqual(originalStemsSnapshot);
    expect(correction.measurements).toEqual(originalMeasurementsSnapshot);
    expect(result.groups[0].correction.stems.map(stem => stem.stemGUID)).toEqual([STEM_GUID_1, STEM_GUID_2, STEM_GUID_3]);
    expect(result.groups[0].correction.measurements.map(measurement => measurement.coreMeasurementID)).toEqual([CM_ID_1, CM_ID_2, CM_ID_4]);
  });

  it("reports a membership group_species_conflict (not silent acceptance) when a requesting row's own targetID is absent from its own correction's measurements", () => {
    const correction = buildCorrection();
    // CM_ID_UNRELATED is not among correction.measurements — a planner-
    // contract violation that must be surfaced, not swallowed.
    const row = buildRequestingRow(ROW_INDEX_0, CM_ID_UNRELATED, correction);

    const result = buildSpeciesCorrectionGroups([row]);

    expect(result.groups).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('group_species_conflict');
    expect(result.errors[0].treeID).toBe(TREE_ID_A);
    expect(result.errors[0].rowIndexes).toEqual([ROW_INDEX_0]);
  });

  it('leaves a row with no plan and no matching group entirely absent from the result', () => {
    const correction = buildCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const invalidRow = buildNonRequestingRow(ROW_INDEX_2, CM_ID_UNRELATED, 'invalid');

    const result = buildSpeciesCorrectionGroups([requesting, invalidRow]);

    expect(result.groups[0].members.some(member => member.rowIndex === ROW_INDEX_2)).toBe(false);
  });
});

describe('isSpeciesCorrectionEffect', () => {
  const correction = buildCorrection();

  function buildRealSpeciesRuleEffect(forCorrection: SpeciesCorrectionSummary): Effect {
    // Faithfully copies the shape rules/species.ts#applySpeciesRules builds
    // (id 'R1a' is NOT what we match on — see the function's own doc comment).
    const totalStems = forCorrection.activeStemCount + forCorrection.inactiveStemCount;
    const totalMeasurements = forCorrection.activeMeasurementCount + forCorrection.inactiveMeasurementCount;
    return {
      id: 'R1a',
      severity: 'warn',
      category: 'identity',
      title: 'Tree species will be corrected',
      detail:
        `Tree T#${forCorrection.targetTreeID} (TreeTag "${forCorrection.treeTag}") species "${forCorrection.oldSpeciesCode}" -> "${forCorrection.newSpeciesCode}". ` +
        `${totalStems} stem(s) (${forCorrection.activeStemCount} active, ${forCorrection.inactiveStemCount} inactive) and ` +
        `${totalMeasurements} measurement(s) (${forCorrection.activeMeasurementCount} active, ${forCorrection.inactiveMeasurementCount} inactive) will show the corrected species.`,
      affectedTable: 'trees',
      affectedRowCount: 1,
      references: {
        treeIDs: [forCorrection.targetTreeID],
        speciesID: forCorrection.newSpeciesID,
        coreMeasurementIDs: forCorrection.measurements.map(measurement => measurement.coreMeasurementID),
        stemGUIDs: forCorrection.stems.map(stem => stem.stemGUID)
      }
    };
  }

  it('returns true for the real effect shape rules/species.ts produces for this correction', () => {
    expect(isSpeciesCorrectionEffect(buildRealSpeciesRuleEffect(correction), correction)).toBe(true);
  });

  it('returns false for a row-local field effect (different category/affectedTable)', () => {
    const fieldEffect: Effect = {
      id: 'R2',
      severity: 'warn',
      category: 'field',
      title: 'Measured value changed',
      detail: 'd',
      affectedTable: 'coremeasurements',
      affectedRowCount: 1
    };
    expect(isSpeciesCorrectionEffect(fieldEffect, correction)).toBe(false);
  });

  it('returns false for an identity effect referencing a different tree', () => {
    const differentTreeEffect = buildRealSpeciesRuleEffect(correction);
    differentTreeEffect.references = { ...differentTreeEffect.references, treeIDs: [TREE_ID_B] };
    expect(isSpeciesCorrectionEffect(differentTreeEffect, correction)).toBe(false);
  });

  it('returns false for an identity effect whose references.speciesID is the OLD species, not the new one', () => {
    const oldSpeciesEffect = buildRealSpeciesRuleEffect(correction);
    oldSpeciesEffect.references = { ...oldSpeciesEffect.references, speciesID: correction.oldSpeciesID };
    expect(isSpeciesCorrectionEffect(oldSpeciesEffect, correction)).toBe(false);
  });
});

// --- Slice 3: batch-level integrity checks (detectSpeciesGroupConflicts, analyzeBulkSpeciesCorrections) ---

/**
 * Three measurements across three stems (one inactive) for the same tree —
 * enough room for a requesting row plus two independent non-requesting
 * siblings in checks A/B/C, which need more than the default two-member
 * fixture provides.
 */
function buildThreeMemberCorrection(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
  return buildCorrection({
    activeStemCount: 2,
    inactiveStemCount: 1,
    activeMeasurementCount: 2,
    inactiveMeasurementCount: 1,
    stems: [buildStem({ stemGUID: STEM_GUID_1 }), buildStem({ stemGUID: STEM_GUID_2 }), buildStem({ stemGUID: STEM_GUID_3, isActive: false })],
    measurements: [
      buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 }),
      buildMeasurement({ coreMeasurementID: CM_ID_2, stemGUID: STEM_GUID_2 }),
      buildMeasurement({ coreMeasurementID: CM_ID_4, stemGUID: STEM_GUID_3, isActive: false })
    ],
    ...overrides
  });
}

/** Two measurements (CM_ID_1, CM_ID_5) on the SAME stem — check D2's shared-column fixture. */
function buildSharedStemCorrection(): SpeciesCorrectionSummary {
  return buildCorrection({
    activeStemCount: 1,
    activeMeasurementCount: 2,
    stems: [buildStem({ stemGUID: STEM_GUID_1 })],
    measurements: [
      buildMeasurement({ coreMeasurementID: CM_ID_1, stemGUID: STEM_GUID_1 }),
      buildMeasurement({ coreMeasurementID: CM_ID_5, stemGUID: STEM_GUID_1 })
    ]
  });
}

describe('detectSpeciesGroupConflicts (check A: group_species_conflict via explicitSpeciesCode)', () => {
  it('flags a sibling row with status "unchanged", no fieldChanges, and explicitSpeciesCode equal to the tree\'s OLD species code', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged', OLD_SPECIES_CODE);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    const errors = detectSpeciesGroupConflicts(rows, groups, []);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.kind).toBe('TreeStemResolution');
    expect(error.reason).toBe('group_species_conflict');
    expect(error.subject).toBe('species');
    expect(error.field).toBe('SpeciesCode');
    expect(error.treeID).toBe(TREE_ID_A);
    expect(error.rowIndexes).toEqual([ROW_INDEX_1]);
    expect(error.rowIndex).toBe(ROW_INDEX_1);
    expect(error.message).toContain(`"${NEW_SPECIES_CODE}"`);
    expect(error.message).toContain(`"${OLD_SPECIES_CODE}"`);
    expectNoLeakedSQLOrInternals(error.message);
  });

  it('does not flag a sibling whose explicitSpeciesCode equals the destination code in a different case', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged', NEW_SPECIES_CODE.toLowerCase());
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });

  it('never invents a species request from a null or an entirely absent explicitSpeciesCode', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const siblingWithNull = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged', null);
    const siblingWithoutProperty = buildNonRequestingRow(ROW_INDEX_2, CM_ID_4, 'unchanged');
    const rows = [requesting, siblingWithNull, siblingWithoutProperty];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });

  it('aggregates two sibling rows contradicting with two different codes into ONE error listing both, with rowIndexes/rowIndex from the lowest', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const siblingOne = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged', CONTRADICTING_SPECIES_CODE_1);
    const siblingTwo = buildNonRequestingRow(ROW_INDEX_2, CM_ID_4, 'unchanged', CONTRADICTING_SPECIES_CODE_2);
    const rows = [requesting, siblingOne, siblingTwo];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    const errors = detectSpeciesGroupConflicts(rows, groups, []);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.rowIndexes).toEqual([ROW_INDEX_1, ROW_INDEX_2]);
    expect(error.rowIndex).toBe(ROW_INDEX_1);
    expect(error.message).toContain(`"${CONTRADICTING_SPECIES_CODE_1}"`);
    expect(error.message).toContain(`"${CONTRADICTING_SPECIES_CODE_2}"`);
  });
});

describe('detectSpeciesGroupConflicts (check B: group_identity_overlap)', () => {
  it.each([
    ['TreeTag', TREE_TAG_CHANGED_VALUE],
    ['StemTag', STEM_TAG_CHANGED_VALUE],
    ['QuadratName', QUADRAT_NAME_CHANGED_VALUE]
  ])('flags a non-requesting sibling row whose plan.fieldChanges actually changes %s', (field, newValue) => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_2, [{ field, from: 'old-value', to: newValue }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    const errors = detectSpeciesGroupConflicts(rows, groups, []);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.reason).toBe('group_identity_overlap');
    expect(error.subject).toBe('tree');
    expect(error.treeID).toBe(TREE_ID_A);
    expect(error.rowIndexes).toEqual([ROW_INDEX_1]);
    expect(error.rowIndex).toBe(ROW_INDEX_1);
    expect(error.message).toContain(field);
    expectNoLeakedSQLOrInternals(error.message);
  });

  it('does not flag a sibling row whose plan.fieldChanges only changes MeasuredDBH (a row-local field, not an identity field)', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_2, [{ field: 'MeasuredDBH', from: 10, to: MEASURED_DBH_CHANGED_VALUE }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });
});

describe('detectSpeciesGroupConflicts (check C: group_member_deletion)', () => {
  it('flags a duplicateDeletions entry that deletes a measurement within affectedCoreMeasurementIDs', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const survivorSibling = buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'unchanged');
    const rows = [requesting, survivorSibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);
    const duplicateDeletions = [buildDuplicateDeletion(CM_ID_4, CM_ID_2)];

    const errors = detectSpeciesGroupConflicts(rows, groups, duplicateDeletions);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.reason).toBe('group_member_deletion');
    expect(error.subject).toBe('tree');
    expect(error.treeID).toBe(TREE_ID_A);
    expect(error.message).toContain(String(CM_ID_4));
    expect(error.rowIndexes).toEqual([ROW_INDEX_1]);
    expect(error.rowIndex).toBe(ROW_INDEX_1);
    expectNoLeakedSQLOrInternals(error.message);
  });

  it('does not flag a duplicateDeletions entry that deletes a measurement NOT in affectedCoreMeasurementIDs', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const rows = [requesting];
    const { groups } = buildSpeciesCorrectionGroups(rows);
    const duplicateDeletions = [buildDuplicateDeletion(CM_ID_UNRELATED, CM_ID_1)];

    expect(detectSpeciesGroupConflicts(rows, groups, duplicateDeletions)).toEqual([]);
  });
});

describe('detectSpeciesGroupConflicts (check D: group_field_conflict)', () => {
  it('flags two in-group rows on the SAME stemGUID requesting different StemLocalX values, naming the field and both requested values', () => {
    const correction = buildSharedStemCorrection();
    const requesting = buildRequestingRowWithFieldChanges(ROW_INDEX_0, CM_ID_1, correction, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_LOW }]);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_5, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_HIGH }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    const errors = detectSpeciesGroupConflicts(rows, groups, []);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.reason).toBe('group_field_conflict');
    expect(error.subject).toBe('stem');
    expect(error.field).toBe('StemTag');
    expect(error.treeID).toBe(TREE_ID_A);
    expect(error.rowIndexes).toEqual([ROW_INDEX_0, ROW_INDEX_1]);
    expect(error.rowIndex).toBe(ROW_INDEX_0);
    expect(error.message).toContain('StemLocalX');
    expect(error.message).toContain(String(STEM_LOCAL_X_VALUE_LOW));
    expect(error.message).toContain(String(STEM_LOCAL_X_VALUE_HIGH));
    expectNoLeakedSQLOrInternals(error.message);
  });

  it('produces a deep-equal error list regardless of which order the two conflicting rows arrive in (no order-dependent winner)', () => {
    const correction = buildSharedStemCorrection();
    const requesting = buildRequestingRowWithFieldChanges(ROW_INDEX_0, CM_ID_1, correction, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_LOW }]);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_5, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_HIGH }]);

    const forwardRows = [requesting, sibling];
    const forward = detectSpeciesGroupConflicts(forwardRows, buildSpeciesCorrectionGroups(forwardRows).groups, []);

    const reversedRows = [sibling, requesting];
    const reversed = detectSpeciesGroupConflicts(reversedRows, buildSpeciesCorrectionGroups(reversedRows).groups, []);

    expect(reversed).toEqual(forward);
  });

  it('does not flag two in-group rows on the SAME stemGUID requesting the identical StemLocalX value (consistent duplicate requests are allowed)', () => {
    const correction = buildSharedStemCorrection();
    const requesting = buildRequestingRowWithFieldChanges(ROW_INDEX_0, CM_ID_1, correction, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_LOW }]);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_5, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_LOW }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });

  it('does not flag two in-group rows requesting numerically-equal-but-differently-precise StemLocalX values (normalizeFieldValueForComparison rounds both to the same stored value)', () => {
    const correction = buildSharedStemCorrection();
    const requesting = buildRequestingRowWithFieldChanges(ROW_INDEX_0, CM_ID_1, correction, [
      { field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_PRECISE_VARIANT_A }
    ]);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_5, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_PRECISE_VARIANT_B }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });

  it('does not flag two in-group rows on DIFFERENT stemGUIDs requesting different StemLocalX values (they write different stem rows)', () => {
    const correction = buildCorrection();
    const requesting = buildRequestingRowWithFieldChanges(ROW_INDEX_0, CM_ID_1, correction, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_LOW }]);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_2, [{ field: 'StemLocalX', from: 0, to: STEM_LOCAL_X_VALUE_HIGH }]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });

  it('(defensive D1 path) flags two rows that share the same targetID requesting different values for the same field', () => {
    const correction = buildThreeMemberCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_2, correction);
    const duplicateOne = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_1, [{ field: 'MeasuredDBH', from: 10, to: CONFLICTING_DBH_VALUE_1 }]);
    const duplicateTwo = buildFieldChangeOnlyRow(ROW_INDEX_2, CM_ID_1, [{ field: 'MeasuredDBH', from: 10, to: CONFLICTING_DBH_VALUE_2 }]);
    const rows = [requesting, duplicateOne, duplicateTwo];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    const errors = detectSpeciesGroupConflicts(rows, groups, []);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error.reason).toBe('group_field_conflict');
    expect(error.message).toContain('MeasuredDBH');
    expect(error.message).toContain(String(CONFLICTING_DBH_VALUE_1));
    expect(error.message).toContain(String(CONFLICTING_DBH_VALUE_2));
    expect(error.rowIndexes).toEqual([ROW_INDEX_1, ROW_INDEX_2]);
  });
});

describe('detectSpeciesGroupConflicts (no false positives on row-local-only siblings)', () => {
  it('reports no errors when a group has one correcting row plus a sibling changing only MeasuredDBH/Description', () => {
    const correction = buildCorrection();
    const requesting = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correction);
    const sibling = buildFieldChangeOnlyRow(ROW_INDEX_1, CM_ID_2, [
      { field: 'MeasuredDBH', from: 10, to: MEASURED_DBH_CHANGED_VALUE },
      { field: 'Description', from: 'old note', to: DESCRIPTION_CHANGED_VALUE }
    ]);
    const rows = [requesting, sibling];
    const { groups } = buildSpeciesCorrectionGroups(rows);

    expect(detectSpeciesGroupConflicts(rows, groups, [])).toEqual([]);
  });
});

describe('analyzeBulkSpeciesCorrections', () => {
  it('merges grouping errors (buildSpeciesCorrectionGroups) and conflict errors (detectSpeciesGroupConflicts) in the shared treeID/reason/rowIndex order', () => {
    const correctionBB = buildCorrection({ newSpeciesID: NEW_SPECIES_ID, newSpeciesCode: NEW_SPECIES_CODE });
    const correctionCC = buildCorrection({ newSpeciesID: ALT_NEW_SPECIES_ID, newSpeciesCode: ALT_NEW_SPECIES_CODE });
    const rowTreeA0 = buildRequestingRow(ROW_INDEX_0, CM_ID_1, correctionBB);
    const rowTreeA1 = buildRequestingRow(ROW_INDEX_1, CM_ID_2, correctionCC);

    const correctionTreeB = buildCorrection({
      targetTreeID: TREE_ID_B,
      treeTag: TREE_TAG_B,
      censusID: OTHER_CENSUS_ID,
      activeStemCount: 2,
      activeMeasurementCount: 2,
      stems: [buildStem({ stemGUID: STEM_GUID_TREE_B }), buildStem({ stemGUID: STEM_GUID_TREE_B_2 })],
      measurements: [
        buildMeasurement({ coreMeasurementID: CM_ID_TREE_B, stemGUID: STEM_GUID_TREE_B }),
        buildMeasurement({ coreMeasurementID: CM_ID_TREE_B_SIBLING, stemGUID: STEM_GUID_TREE_B_2 })
      ]
    });
    const rowTreeB0 = buildRequestingRow(ROW_INDEX_2, CM_ID_TREE_B, correctionTreeB);
    const rowTreeB1 = buildFieldChangeOnlyRow(ROW_INDEX_3, CM_ID_TREE_B_SIBLING, [{ field: 'TreeTag', from: 'old', to: TREE_TAG_CHANGED_VALUE }]);

    const rows = [rowTreeA0, rowTreeA1, rowTreeB0, rowTreeB1];

    const result = analyzeBulkSpeciesCorrections(rows, []);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].treeID).toBe(TREE_ID_A);
    expect(result.errors[0].reason).toBe('group_species_conflict');
    expect(result.errors[1].treeID).toBe(TREE_ID_B);
    expect(result.errors[1].reason).toBe('group_identity_overlap');
  });

  it('returns {groups: [], errors: []} and performs no work on duplicateDeletions when the batch has no species corrections at all', () => {
    const rows = [buildNonRequestingRow(ROW_INDEX_0, CM_ID_1, 'unchanged'), buildNonRequestingRow(ROW_INDEX_1, CM_ID_2, 'invalid')];
    const duplicateDeletions = [buildDuplicateDeletion(CM_ID_1, CM_ID_2)];

    expect(analyzeBulkSpeciesCorrections(rows, duplicateDeletions)).toEqual({ groups: [], errors: [] });
  });
});

describe('expectNoLeakedSQLOrInternals (proves the guard is not vacuous)', () => {
  const IDENTITY_OVERLAP_SAMPLE_FIELD = 'TreeTag';
  const REPRESENTATIONAL_IDENTITY_OVERLAP_MESSAGE =
    `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}") is being corrected in this batch while another row in the same batch ` +
    `changes its ${IDENTITY_OVERLAP_SAMPLE_FIELD}. Submit identity changes (TreeTag/StemTag/QuadratName) separately from a species correction for the same tree.`;

  // Destination-kind group_species_conflict (bulkspeciesgroups.ts:195): two distinct destination codes, no semicolon.
  const REPRESENTATIONAL_DESTINATION_CONFLICT_MESSAGE =
    `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}") has conflicting species corrections requested in this batch: ` +
    `"${NEW_SPECIES_CODE}", "${ALT_NEW_SPECIES_CODE}". Submit one species per tree in a single batch.`;

  // Membership-kind group_species_conflict (bulkspeciesgroups.ts:196): one of the two real semicolon-bearing shapes.
  const REPRESENTATIONAL_MEMBERSHIP_CONFLICT_MESSAGE = `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}")'s attached stems/measurements changed while this batch was being analyzed; re-review the upload before applying.`;

  // detectSpeciesDisagreement's own message (bulkspeciesgroups.ts:516-519).
  const REPRESENTATIONAL_SPECIES_DISAGREEMENT_MESSAGE =
    `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}") is being corrected to species "${NEW_SPECIES_CODE}" in this batch, ` +
    `but "${CONTRADICTING_SPECIES_CODE_1}" was also explicitly requested for it. All rows for one tree must agree on its species in a single batch.`;

  // group_member_deletion (bulkspeciesgroups.ts:607-609).
  const REPRESENTATIONAL_MEMBER_DELETION_MESSAGE =
    `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}")'s species correction covers CoreMeasurementID(s) ${CM_ID_4}, ` +
    `which this same batch also deletes as duplicate(s). Resolve the duplicate deletion or drop the species correction for this tree before re-submitting.`;

  // group_field_conflict (bulkspeciesgroups.ts:651-653) with TWO conflicting fields, so conflictDescriptions.join('; ')
  // actually produces a semicolon — the second of the two real semicolon-bearing shapes.
  const REPRESENTATIONAL_FIELD_CONFLICT_MESSAGE =
    `Tree T#${TREE_ID_A} (TreeTag "${TREE_TAG_A}") has rows in this batch requesting different values for the same stored column: ` +
    `StemLocalX ("${STEM_LOCAL_X_VALUE_LOW}" vs "${STEM_LOCAL_X_VALUE_HIGH}"); StemLocalY ("${STEM_LOCAL_X_VALUE_LOW}" vs "${STEM_LOCAL_X_VALUE_HIGH}"). ` +
    `These rows write the same underlying record, so only one requested value can be applied.`;

  const REPRESENTATIONAL_REAL_MESSAGE_SHAPES: ReadonlyArray<{ shapeLabel: string; message: string }> = [
    { shapeLabel: 'group_species_conflict (destination)', message: REPRESENTATIONAL_DESTINATION_CONFLICT_MESSAGE },
    { shapeLabel: 'group_species_conflict (membership, semicolon)', message: REPRESENTATIONAL_MEMBERSHIP_CONFLICT_MESSAGE },
    { shapeLabel: 'group_species_conflict (detectSpeciesDisagreement)', message: REPRESENTATIONAL_SPECIES_DISAGREEMENT_MESSAGE },
    { shapeLabel: 'group_identity_overlap', message: REPRESENTATIONAL_IDENTITY_OVERLAP_MESSAGE },
    { shapeLabel: 'group_member_deletion', message: REPRESENTATIONAL_MEMBER_DELETION_MESSAGE },
    { shapeLabel: 'group_field_conflict (semicolon-joined)', message: REPRESENTATIONAL_FIELD_CONFLICT_MESSAGE }
  ];

  it('matches a real leaked SQL query from tree-species-correction.ts but never fires on real prose containing "from"', () => {
    expect(
      LEAKED_SQL_PATTERNS.some(entry => entry.pattern.test(REAL_LEAKED_QUERY)),
      'at least one pattern must detect the real leaked query'
    ).toBe(true);
    expect(() => expectNoLeakedSQLOrInternals(REPRESENTATIONAL_IDENTITY_OVERLAP_MESSAGE)).not.toThrow();
  });

  it.each(REPRESENTATIONAL_REAL_MESSAGE_SHAPES)('never fires on the real $shapeLabel message shape, including both semicolon-bearing ones', ({ message }) => {
    expect(() => expectNoLeakedSQLOrInternals(message)).not.toThrow();
  });
});
