import { describe, it, expect } from 'vitest';
import { canonicalizePlan, hashPlan } from './planhash';
import { BulkEditPlan, DuplicateDeletion, EditPlan, SpeciesCorrectionGroup, SpeciesCorrectionSummary, SpeciesCorrectionUndoRestoration } from './types';

function buildBulkPlanShell(overrides: Partial<BulkEditPlan> = {}): BulkEditPlan {
  return {
    dataType: 'measurementssummary',
    rowCount: 0,
    rowPlans: [],
    aggregateEffects: [],
    errors: [],
    canApply: true,
    maxSeverity: 'info',
    planHash: '',
    generatedAt: '2026-04-22T00:00:00.000Z',
    duplicateDeletions: [],
    ...overrides
  };
}

const base: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 1,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [{ id: 'R4', severity: 'warn', category: 'cross-row', title: 't', detail: 'd', affectedTable: 'stems', affectedRowCount: 3 }],
  maxSeverity: 'warn',
  planHash: '',
  generatedAt: '2026-04-21T00:00:00Z'
};

describe('hashPlan', () => {
  it('is stable across key reordering on effects', () => {
    const reorderedA: EditPlan = {
      ...base,
      effects: [
        {
          id: 'R4',
          severity: 'warn',
          category: 'cross-row',
          title: 't',
          detail: 'd',
          affectedTable: 'stems',
          affectedRowCount: 3,
          references: { coreMeasurementIDs: [1, 2], treeIDs: [5] }
        }
      ]
    };
    const reorderedB: EditPlan = {
      ...base,
      effects: [
        {
          affectedTable: 'stems',
          references: { treeIDs: [5], coreMeasurementIDs: [1, 2] },
          severity: 'warn',
          id: 'R4',
          category: 'cross-row',
          affectedRowCount: 3,
          detail: 'd',
          title: 't'
        }
      ]
    };
    expect(hashPlan(reorderedA)).toBe(hashPlan(reorderedB));
  });

  it('ignores generatedAt and planHash', () => {
    const other: EditPlan = { ...base, planHash: 'zzzz', generatedAt: '2030-01-01T00:00:00Z' };
    expect(hashPlan(base)).toBe(hashPlan(other));
  });

  it('changes when a field change differs', () => {
    const other: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 13 }] };
    expect(hashPlan(base)).not.toBe(hashPlan(other));
  });

  it('changes when an effect detail differs', () => {
    const other: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], detail: 'd-changed' }]
    };
    expect(hashPlan(base)).not.toBe(hashPlan(other));
  });

  it('normalizes decimal precision for measured columns', () => {
    const a: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00001, to: 12.00001 }] };
    const b: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00002, to: 12.00002 }] };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('sorts reference arrays deterministically', () => {
    const a: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [2, 1], treeIDs: [9, 3] } }]
    };
    const b: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], references: { treeIDs: [3, 9], coreMeasurementIDs: [1, 2] } }]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('sorts fieldChanges by field name deterministically', () => {
    const a: EditPlan = {
      ...base,
      fieldChanges: [
        { field: 'MeasuredDBH', from: 10, to: 12 },
        { field: 'MeasuredHOM', from: 1.3, to: 1.5 }
      ]
    };
    const b: EditPlan = {
      ...base,
      fieldChanges: [
        { field: 'MeasuredHOM', from: 1.3, to: 1.5 },
        { field: 'MeasuredDBH', from: 10, to: 12 }
      ]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('normalizes Date ISO strings to YYYY-MM-DD', () => {
    const a: EditPlan = {
      ...base,
      fieldChanges: [{ field: 'MeasurementDate', from: '2026-04-21T12:00:00Z', to: '2026-05-01T00:00:00Z' }]
    };
    const b: EditPlan = {
      ...base,
      fieldChanges: [{ field: 'MeasurementDate', from: '2026-04-21T23:59:59Z', to: '2026-05-01T01:00:00Z' }]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('canonicalizePlan is idempotent', () => {
    const once = canonicalizePlan(base);
    const twice = JSON.parse(JSON.stringify(once));
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('strips volatile fields from nested bulk row plans', () => {
    const bulkA: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: base }],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'a',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    };
    const bulkB: BulkEditPlan = {
      ...bulkA,
      planHash: 'b',
      generatedAt: '2030-01-01T00:00:00Z',
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: { ...base, planHash: 'nested', generatedAt: '2030-01-01T00:00:00Z' } }]
    };
    expect(hashPlan(bulkA)).toBe(hashPlan(bulkB));
  });

  it('hashes BulkEditPlan deterministically across reference-array order in nested row plans', () => {
    const effectOrderA = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [3, 1, 2], treeIDs: [9, 3] } }]
    };
    const effectOrderB = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [1, 2, 3], treeIDs: [3, 9] } }]
    };
    const bulkA: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 2,
      rowPlans: [
        { rowIndex: 0, targetID: 1, status: 'matched', plan: effectOrderA },
        { rowIndex: 1, targetID: 2, status: 'matched', plan: effectOrderA }
      ],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: '',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    };
    const bulkB: BulkEditPlan = {
      ...bulkA,
      rowPlans: [
        { rowIndex: 1, targetID: 2, status: 'matched', plan: effectOrderB },
        { rowIndex: 0, targetID: 1, status: 'matched', plan: effectOrderB }
      ]
    };
    expect(hashPlan(bulkA)).toBe(hashPlan(bulkB));
  });
});

describe('planhash - bulk duplicateDeletions', () => {
  it('hashes same pairs regardless of input order', () => {
    const a = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [
          { coreMeasurementID: 10, survivorCoreMeasurementID: 1 },
          { coreMeasurementID: 20, survivorCoreMeasurementID: 2 }
        ]
      })
    );
    const b = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [
          { coreMeasurementID: 20, survivorCoreMeasurementID: 2 },
          { coreMeasurementID: 10, survivorCoreMeasurementID: 1 }
        ]
      })
    );
    expect(a).toBe(b);
  });

  it('changes hash when survivor ID swaps', () => {
    const a = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 1 }]
      })
    );
    const b = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 2 }]
      })
    );
    expect(a).not.toBe(b);
  });

  it('changes hash when a pair is duplicated (no dedupe)', () => {
    const single = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 1 }]
      })
    );
    const doubled = hashPlan(
      buildBulkPlanShell({
        duplicateDeletions: [
          { coreMeasurementID: 10, survivorCoreMeasurementID: 1 },
          { coreMeasurementID: 10, survivorCoreMeasurementID: 1 }
        ]
      })
    );
    expect(single).not.toBe(doubled);
  });
});

describe('planhash - speciesCorrection (#427)', () => {
  const baseCorrection: SpeciesCorrectionSummary = {
    version: 1,
    targetTreeID: 100,
    treeTag: 'T-1',
    plotID: 3,
    censusID: 7,
    oldSpeciesID: 9,
    oldSpeciesCode: 'AA',
    newSpeciesID: 11,
    newSpeciesCode: 'BB',
    activeStemCount: 2,
    inactiveStemCount: 1,
    activeMeasurementCount: 3,
    inactiveMeasurementCount: 1,
    stems: [
      { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
      { stemGUID: 201, censusID: 7, quadratID: 9, isActive: true },
      { stemGUID: 202, censusID: 7, quadratID: 9, isActive: false }
    ],
    measurements: [
      { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
      { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
      { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: true, priorRawSpCode: null },
      { coreMeasurementID: 45, stemGUID: 202, censusID: 7, isActive: false, priorRawSpCode: 'aa' }
    ]
  };

  function buildPlanWithCorrection(correction: SpeciesCorrectionSummary): EditPlan {
    return { ...base, fieldChanges: [{ field: 'SpeciesCode', from: 'AA', to: 'BB' }], speciesCorrection: correction };
  }

  it('is stable regardless of membership array order (query order is never load-bearing)', () => {
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      stems: [...baseCorrection.stems].reverse(),
      measurements: [...baseCorrection.measurements].reverse()
    });
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('changes when a stem is replaced even though every count is unchanged', () => {
    // Equal-count replacement: still 3 stems, but a different stem is a
    // member. Counts alone must not be what's hashed.
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      stems: [baseCorrection.stems[0], baseCorrection.stems[1], { stemGUID: 999, censusID: 7, quadratID: 9, isActive: false }]
    });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('changes when a measurement moves between two already-attached sibling stems (same CoreMeasurementID set, different stemGUID link)', () => {
    // F6: the set of CoreMeasurementIDs (42,43,44,45) and StemGUIDs
    // (200,201,202) is IDENTICAL between a and b; only CM 44's stemGUID link
    // moves from 201 to 200. Hashing full records (not just ID lists) must
    // still detect this.
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      measurements: baseCorrection.measurements.map(m => (m.coreMeasurementID === 44 ? { ...m, stemGUID: 200 } : m))
    });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('changes on an activity swap between two equal-count sibling stems (same stemGUID set, swapped isActive)', () => {
    // F6: the set of stemGUIDs (200,201,202) and the active/inactive counts
    // (2 active, 1 inactive) are IDENTICAL between a and b; only which stem
    // is inactive differs (202 <-> 201).
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      stems: baseCorrection.stems.map(s => {
        if (s.stemGUID === 201) return { ...s, isActive: false };
        if (s.stemGUID === 202) return { ...s, isActive: true };
        return s;
      })
    });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('changes when oldSpeciesCode/newSpeciesCode differ', () => {
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({ ...baseCorrection, newSpeciesCode: 'CC' });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it("changes when a measurement's prior RawSpCode value differs (including NULL vs a case-only spelling)", () => {
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      measurements: baseCorrection.measurements.map(m => (m.coreMeasurementID === 44 ? { ...m, priorRawSpCode: 'aa' } : m))
    });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it("changes when an attached stem's own censusID/quadratID link differs (cross-census/different-quadrat drift)", () => {
    const a = buildPlanWithCorrection(baseCorrection);
    const b = buildPlanWithCorrection({
      ...baseCorrection,
      stems: baseCorrection.stems.map(s => (s.stemGUID === 201 ? { ...s, quadratID: 55 } : s))
    });
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('is absent from the hash input when speciesCorrection is undefined (no spurious key)', () => {
    const withoutCorrection: EditPlan = { ...base };
    const withEmptyCorrectionKey = { ...base, speciesCorrection: undefined };
    expect(hashPlan(withoutCorrection)).toBe(hashPlan(withEmptyCorrectionKey));
  });

  it('ignores generatedAt/planHash on the parent plan the same way as plans without a speciesCorrection', () => {
    const a = buildPlanWithCorrection(baseCorrection);
    const b: EditPlan = { ...a, planHash: 'stale', generatedAt: '2030-01-01T00:00:00Z' };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });
});

describe('planhash - bulk speciesCorrectionGroups (#427)', () => {
  const GROUP_TREE_ID_A = 100;
  const GROUP_TREE_ID_B = 200;
  const GROUP_CENSUS_ID = 7;
  const GROUP_TREE_TAG_A = 'T-A1';
  const GROUP_TREE_TAG_B = 'T-B1';
  const GROUP_PLOT_ID = 3;
  const GROUP_OLD_SPECIES_ID = 9;
  const GROUP_OLD_SPECIES_CODE = 'AA';
  const GROUP_NEW_SPECIES_ID = 11;
  const GROUP_NEW_SPECIES_CODE = 'BB';

  const STEM_GUID_A1 = 500;
  const STEM_GUID_A2 = 501;
  const STEM_GUID_B1 = 600;
  const CM_ID_A1 = 900;
  const CM_ID_A2 = 901;
  const CM_ID_B1 = 910;
  const EXTRA_SIBLING_CM_ID = 950;
  const EXTRA_SIBLING_ROW_INDEX = 2;
  const ROW_INDEX_0 = 0;
  const ROW_INDEX_1 = 1;

  function buildGroupCorrection(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
    return {
      version: 1,
      targetTreeID: GROUP_TREE_ID_A,
      treeTag: GROUP_TREE_TAG_A,
      plotID: GROUP_PLOT_ID,
      censusID: GROUP_CENSUS_ID,
      oldSpeciesID: GROUP_OLD_SPECIES_ID,
      oldSpeciesCode: GROUP_OLD_SPECIES_CODE,
      newSpeciesID: GROUP_NEW_SPECIES_ID,
      newSpeciesCode: GROUP_NEW_SPECIES_CODE,
      activeStemCount: 2,
      inactiveStemCount: 0,
      activeMeasurementCount: 2,
      inactiveMeasurementCount: 0,
      stems: [
        { stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: true },
        { stemGUID: STEM_GUID_A2, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: true }
      ],
      measurements: [
        { coreMeasurementID: CM_ID_A1, stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, isActive: true, priorRawSpCode: GROUP_OLD_SPECIES_CODE },
        { coreMeasurementID: CM_ID_A2, stemGUID: STEM_GUID_A2, censusID: GROUP_CENSUS_ID, isActive: true, priorRawSpCode: GROUP_OLD_SPECIES_CODE }
      ],
      ...overrides
    };
  }

  function buildGroup(overrides: Partial<SpeciesCorrectionGroup> = {}): SpeciesCorrectionGroup {
    return {
      version: 1,
      treeID: GROUP_TREE_ID_A,
      censusID: GROUP_CENSUS_ID,
      correction: buildGroupCorrection(),
      members: [
        { rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_A1, requestedCorrection: true },
        { rowIndex: ROW_INDEX_1, coreMeasurementID: CM_ID_A2, requestedCorrection: true }
      ],
      affectedCoreMeasurementIDs: [CM_ID_A1, CM_ID_A2],
      affectedStemGUIDs: [STEM_GUID_A1, STEM_GUID_A2],
      ...overrides
    };
  }

  function buildSecondTreeGroup(): SpeciesCorrectionGroup {
    return buildGroup({
      treeID: GROUP_TREE_ID_B,
      correction: buildGroupCorrection({
        targetTreeID: GROUP_TREE_ID_B,
        treeTag: GROUP_TREE_TAG_B,
        activeStemCount: 1,
        activeMeasurementCount: 1,
        stems: [{ stemGUID: STEM_GUID_B1, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: true }],
        measurements: [
          { coreMeasurementID: CM_ID_B1, stemGUID: STEM_GUID_B1, censusID: GROUP_CENSUS_ID, isActive: true, priorRawSpCode: GROUP_OLD_SPECIES_CODE }
        ]
      }),
      members: [{ rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_B1, requestedCorrection: true }],
      affectedCoreMeasurementIDs: [CM_ID_B1],
      affectedStemGUIDs: [STEM_GUID_B1]
    });
  }

  function buildPlanWithGroups(groups: SpeciesCorrectionGroup[]): BulkEditPlan {
    return {
      dataType: 'measurementssummary',
      rowCount: groups.length,
      rowPlans: [],
      aggregateEffects: [],
      errors: [],
      canApply: true,
      maxSeverity: 'info',
      planHash: '',
      generatedAt: '2026-04-22T00:00:00.000Z',
      duplicateDeletions: [],
      speciesCorrectionGroups: groups
    };
  }

  it("hashes identically regardless of group array order and each group's members/affected-ID array order (producer enumeration is never load-bearing)", () => {
    const groupAAscending = buildGroup();
    const groupBAscending = buildSecondTreeGroup();
    const ascending = buildPlanWithGroups([groupAAscending, groupBAscending]);

    const groupAReversed = buildGroup({
      members: [...groupAAscending.members].reverse(),
      affectedCoreMeasurementIDs: [...groupAAscending.affectedCoreMeasurementIDs].reverse(),
      affectedStemGUIDs: [...groupAAscending.affectedStemGUIDs].reverse()
    });
    const groupBReversed = buildSecondTreeGroup();
    const reversed = buildPlanWithGroups([groupBReversed, groupAReversed]);

    expect(hashPlan(ascending)).toBe(hashPlan(reversed));
  });

  it('hashes DIFFERENTLY when a measurement moves between two already-attached sibling stems despite an identical CoreMeasurementID/StemGUID set and identical counts', () => {
    const a = buildPlanWithGroups([buildGroup()]);
    const correctionWithMovedMeasurement = buildGroupCorrection({
      measurements: [
        { coreMeasurementID: CM_ID_A1, stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, isActive: true, priorRawSpCode: GROUP_OLD_SPECIES_CODE },
        // CM_ID_A2 now links to STEM_GUID_A1 instead of STEM_GUID_A2 — same
        // two IDs in each set, only the link between them differs.
        { coreMeasurementID: CM_ID_A2, stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, isActive: true, priorRawSpCode: GROUP_OLD_SPECIES_CODE }
      ]
    });
    const b = buildPlanWithGroups([buildGroup({ correction: correctionWithMovedMeasurement })]);

    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('hashes DIFFERENTLY on an equal-count isActive swap between two sibling stems inside a group', () => {
    const correctionWithStem1Inactive = buildGroupCorrection({
      activeStemCount: 1,
      inactiveStemCount: 1,
      stems: [
        { stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: false },
        { stemGUID: STEM_GUID_A2, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: true }
      ]
    });
    const correctionWithStem2Inactive = buildGroupCorrection({
      activeStemCount: 1,
      inactiveStemCount: 1,
      stems: [
        { stemGUID: STEM_GUID_A1, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: true },
        { stemGUID: STEM_GUID_A2, censusID: GROUP_CENSUS_ID, quadratID: 9, isActive: false }
      ]
    });
    const a = buildPlanWithGroups([buildGroup({ correction: correctionWithStem1Inactive })]);
    const b = buildPlanWithGroups([buildGroup({ correction: correctionWithStem2Inactive })]);

    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it("changes the hash when a group's members set gains a sibling row, but NOT when the same members are merely re-ordered", () => {
    const base = buildPlanWithGroups([buildGroup()]);
    const sameMembersReordered = buildPlanWithGroups([buildGroup({ members: [...buildGroup().members].reverse() })]);
    expect(hashPlan(base)).toBe(hashPlan(sameMembersReordered));

    const withAddedSibling = buildPlanWithGroups([
      buildGroup({
        members: [
          { rowIndex: ROW_INDEX_0, coreMeasurementID: CM_ID_A1, requestedCorrection: true },
          { rowIndex: ROW_INDEX_1, coreMeasurementID: CM_ID_A2, requestedCorrection: true },
          { rowIndex: EXTRA_SIBLING_ROW_INDEX, coreMeasurementID: EXTRA_SIBLING_CM_ID, requestedCorrection: false }
        ]
      })
    ]);
    expect(hashPlan(base)).not.toBe(hashPlan(withAddedSibling));
  });

  it('hashes a plan with speciesCorrectionGroups absent the SAME as one with it explicitly undefined, and that pre-#427 shape differs from a plan that has groups', () => {
    const withoutGroupsKeyAtAll: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 0,
      rowPlans: [],
      aggregateEffects: [],
      errors: [],
      canApply: true,
      maxSeverity: 'info',
      planHash: '',
      generatedAt: '2026-04-22T00:00:00.000Z',
      duplicateDeletions: []
    };
    const withGroupsExplicitlyUndefined: BulkEditPlan = { ...withoutGroupsKeyAtAll, speciesCorrectionGroups: undefined };

    expect(hashPlan(withoutGroupsKeyAtAll)).toBe(hashPlan(withGroupsExplicitlyUndefined));

    const withGroups = buildPlanWithGroups([buildGroup()]);
    expect(hashPlan(withoutGroupsKeyAtAll)).not.toBe(hashPlan(withGroups));
  });
});

describe('planhash - speciesCorrectionUndo (#427 undo)', () => {
  function buildRestoration(overrides: Partial<SpeciesCorrectionUndoRestoration> = {}): SpeciesCorrectionUndoRestoration {
    return {
      version: 1,
      targetTreeID: 100,
      restoredSpeciesID: 9,
      restoredSpeciesCode: 'AA',
      replacedSpeciesID: 11,
      replacedSpeciesCode: 'BB',
      restoredMemberRawSpCodes: [
        { coreMeasurementID: 42, rawSpCode: 'AA' },
        { coreMeasurementID: 43, rawSpCode: null }
      ],
      restoredCoreMeasurementColumns: [
        { column: 'SpeciesID', value: 9 },
        { column: 'MeasuredDBH', value: 10.0 }
      ],
      restoredStemColumns: [{ column: 'StemTag', value: 'S-1' }],
      restoredAttributeCodes: ['DEAD', 'ALIVE'],
      ...overrides
    };
  }

  function buildPlanWithUndo(restoration: SpeciesCorrectionUndoRestoration | undefined): EditPlan {
    return restoration === undefined ? { ...base } : { ...base, speciesCorrectionUndo: restoration };
  }

  it('hashes an ordinary plan the same whether speciesCorrectionUndo is absent or explicitly undefined, including nested in a bulk plan', () => {
    const withoutKey: EditPlan = { ...base };
    const withExplicitUndefined: EditPlan = { ...base, speciesCorrectionUndo: undefined };
    expect(hashPlan(withoutKey)).toBe(hashPlan(withExplicitUndefined));
    expect(hashPlan(withoutKey)).toBe(hashPlan(base));

    const bulkWithout = buildBulkPlanShell({
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: withoutKey }]
    });
    const bulkWithExplicitUndefined = buildBulkPlanShell({
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: withExplicitUndefined }]
    });
    expect(hashPlan(bulkWithout)).toBe(hashPlan(bulkWithExplicitUndefined));
  });

  it('changes the hash when speciesCorrectionUndo is added', () => {
    const without = buildPlanWithUndo(undefined);
    const withUndo = buildPlanWithUndo(buildRestoration());
    expect(hashPlan(without)).not.toBe(hashPlan(withUndo));
  });

  it("is stable regardless of enumeration order inside restoredMemberRawSpCodes/restoredCoreMeasurementColumns/restoredStemColumns/restoredAttributeCodes, and does not mutate the caller's arrays", () => {
    const restoration = buildRestoration({
      restoredStemColumns: [
        { column: 'TreeTag', value: 'B-1' },
        { column: 'StemTag', value: 'S-1' }
      ]
    });
    const memberRawSpCodesSnapshot = JSON.stringify(restoration.restoredMemberRawSpCodes);
    const coreColumnsSnapshot = JSON.stringify(restoration.restoredCoreMeasurementColumns);
    const stemColumnsSnapshot = JSON.stringify(restoration.restoredStemColumns);
    const attributeCodesSnapshot = JSON.stringify(restoration.restoredAttributeCodes);

    const reversed: SpeciesCorrectionUndoRestoration = {
      ...restoration,
      restoredMemberRawSpCodes: [...restoration.restoredMemberRawSpCodes].reverse(),
      restoredCoreMeasurementColumns: [...restoration.restoredCoreMeasurementColumns].reverse(),
      restoredStemColumns: [...restoration.restoredStemColumns].reverse(),
      restoredAttributeCodes: restoration.restoredAttributeCodes ? [...restoration.restoredAttributeCodes].reverse() : null
    };

    expect(hashPlan(buildPlanWithUndo(restoration))).toBe(hashPlan(buildPlanWithUndo(reversed)));
    expect(JSON.stringify(restoration.restoredMemberRawSpCodes)).toBe(memberRawSpCodesSnapshot);
    expect(JSON.stringify(restoration.restoredCoreMeasurementColumns)).toBe(coreColumnsSnapshot);
    expect(JSON.stringify(restoration.restoredStemColumns)).toBe(stemColumnsSnapshot);
    expect(JSON.stringify(restoration.restoredAttributeCodes)).toBe(attributeCodesSnapshot);
  });

  it("changes the hash when a member's rawSpCode moves from NULL to an empty string", () => {
    const a = buildPlanWithUndo(buildRestoration());
    const b = buildPlanWithUndo(
      buildRestoration({
        restoredMemberRawSpCodes: [
          { coreMeasurementID: 42, rawSpCode: 'AA' },
          { coreMeasurementID: 43, rawSpCode: '' }
        ]
      })
    );
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('changes the hash when a restored column value differs at the sixth decimal place', () => {
    const a = buildPlanWithUndo(buildRestoration({ restoredCoreMeasurementColumns: [{ column: 'MeasuredDBH', value: 10.0 }] }));
    const b = buildPlanWithUndo(buildRestoration({ restoredCoreMeasurementColumns: [{ column: 'MeasuredDBH', value: 10.000001 }] }));
    expect(hashPlan(a)).not.toBe(hashPlan(b));
  });

  it('distinguishes restoredAttributeCodes null from an empty array', () => {
    const withNull = buildPlanWithUndo(buildRestoration({ restoredAttributeCodes: null }));
    const withEmptyArray = buildPlanWithUndo(buildRestoration({ restoredAttributeCodes: [] }));
    expect(hashPlan(withNull)).not.toBe(hashPlan(withEmptyArray));
  });

  it('ignores generatedAt/planHash on the parent plan when speciesCorrectionUndo is present', () => {
    const a = buildPlanWithUndo(buildRestoration());
    const b: EditPlan = { ...a, planHash: 'stale', generatedAt: '2030-01-01T00:00:00Z' };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });
});
