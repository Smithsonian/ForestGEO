import { beforeEach, describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { EditOperationStateRow } from '@/config/editoperations';
import type { ApplyInTransactionInput } from '../apply';
import type { EditPlan, FieldChange, SpeciesCorrectionSummary } from '../types';
import { SPECIES_CORRECTION_METADATA_TABLE, type SpeciesCorrectionDomainDiff, type SpeciesCorrectionMetadata } from '../tree-species-correction-writer';

// --- F11 harness mocks -----------------------------------------------------
// writeMeasurementsSummary's #427 correction path dispatches into
// tree-species-correction-writer (owned by another worker) and the shared
// ingestion-error refresh helper. Both are stubbed so this file's tests
// exercise ONLY writeMeasurementsSummary's own sparse-write logic (F11)
// against a recording ConnectionManager, never a real correction apply.
const refreshIngestionErrorsForMeasurementMock = vi.fn(async (..._args: unknown[]) => []);
vi.mock('@/config/measurementerrors', () => ({
  refreshIngestionErrorsForMeasurement: (...args: unknown[]) => refreshIngestionErrorsForMeasurementMock(...args)
}));

// Matches CORE_MEASUREMENT_ID in the `describe` block below. Kept as a
// separate top-level constant (rather than referencing CORE_MEASUREMENT_ID
// directly) because `vi.mock` factories are hoisted above every
// block-scoped test fixture and cannot close over them.
const MOCKED_CORRECTION_TARGET_CORE_MEASUREMENT_ID = 500;

const prepareTreeSpeciesCorrectionMock = vi.fn(
  async (_cm: unknown, _schema: string, input: { editedCoreMeasurementID: number; editedStemGUID: number }, transactionID: string) => ({
    transactionID,
    editedCoreMeasurementID: input.editedCoreMeasurementID,
    // Required by the real `PreparedSpeciesCorrection` contract — omitting
    // it previously let `editedStemGUID: undefined` reach the real
    // `buildSpeciesCorrectionMetadataStateRows` call below undetected.
    editedStemGUID: input.editedStemGUID,
    correction: {} as unknown,
    siblingBeforeState: []
  })
);
// `applyPreparedTreeSpeciesCorrection` no longer returns metadata state rows
// or takes a domainDiff — `correction` must be a realistic summary, since
// the real (un-mocked) `buildSpeciesCorrectionMetadataStateRows` consumes it.
const applyPreparedTreeSpeciesCorrectionMock = vi.fn(async (..._args: unknown[]) => ({
  correction: {
    version: 1,
    targetTreeID: 700,
    treeTag: 'T-100',
    plotID: 3,
    censusID: 7,
    oldSpeciesID: 1,
    oldSpeciesCode: 'AA',
    newSpeciesID: 2,
    newSpeciesCode: 'BB',
    activeStemCount: 1,
    inactiveStemCount: 0,
    activeMeasurementCount: 1,
    inactiveMeasurementCount: 0,
    stems: [{ stemGUID: 600, censusID: 7, quadratID: 9, isActive: true }],
    measurements: [{ coreMeasurementID: MOCKED_CORRECTION_TARGET_CORE_MEASUREMENT_ID, stemGUID: 600, censusID: 7, isActive: true, priorRawSpCode: 'AA' }]
  },
  siblingBeforeState: [],
  siblingAfterState: [],
  errorRefresh: {
    ingestionRefreshedMeasurementIDs: [MOCKED_CORRECTION_TARGET_CORE_MEASUREMENT_ID],
    resolvedValidationOccurrenceCount: 0,
    pendingMeasurementIDs: [MOCKED_CORRECTION_TARGET_CORE_MEASUREMENT_ID]
  }
}));
const assertNoEditedFieldDriftForSpeciesCorrectionMock = vi.fn((..._args: unknown[]) => undefined);
// Partial mock via `importOriginal`: only the three DB-touching functions
// above are replaced, so the real pure builders (domainDiff, metadata state
// rows) still run against this file's own canned rows.
vi.mock('../tree-species-correction-writer', async importOriginal => {
  const actual = await importOriginal<typeof import('../tree-species-correction-writer')>();
  return {
    ...actual,
    prepareTreeSpeciesCorrection: (...args: unknown[]) =>
      prepareTreeSpeciesCorrectionMock(...(args as [unknown, string, { editedCoreMeasurementID: number; editedStemGUID: number }, string])),
    applyPreparedTreeSpeciesCorrection: (...args: unknown[]) => applyPreparedTreeSpeciesCorrectionMock(...args),
    assertNoEditedFieldDriftForSpeciesCorrection: (...args: unknown[]) => assertNoEditedFieldDriftForSpeciesCorrectionMock(...args)
  };
});

// F20: the view-refresh step calls these directly (not via cm.executeQuery),
// so this file's recording ConnectionManager harness never sees them. Mocked
// here purely to assert WHICH refresh function is called and with what ids —
// never a real view-table read/write.
const refreshMeasurementViewsForScopeMock = vi.fn(async (..._args: unknown[]) => undefined);
const refreshMeasurementViewsForCoreMeasurementsMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/measurementviewrefresh', () => ({
  refreshMeasurementViewsForScope: (...args: unknown[]) => refreshMeasurementViewsForScopeMock(...args),
  refreshMeasurementViewsForCoreMeasurements: (...args: unknown[]) => refreshMeasurementViewsForCoreMeasurementsMock(...args)
}));

import {
  resolveMeasurementViewRefreshTargets,
  writeMeasurementsSummary,
  SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND,
  SpeciesCorrectionGroupMemberContextError,
  loadLockedEditedFieldValuesForSpeciesCorrection,
  type SpeciesCorrectionGroupMemberWriteContext
} from './measurementssummary';

function makeConnectionManager(rows: Array<Record<string, unknown>> = []) {
  return {
    executeQuery: vi.fn(async () => rows)
  } as any;
}

describe('resolveMeasurementViewRefreshTargets', () => {
  it('targets only the edited row for measurement-local fields', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['MeasuredDBH', 'Attributes']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'targeted', coreMeasurementIDs: [42] });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('includes measurements on old and new stems for identity and coordinate edits', async () => {
    const cm = makeConnectionManager([{ CoreMeasurementID: 5 }, { CoreMeasurementID: 101 }]);

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['StemLocalX']),
      beforeStemGUID: 22,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('FROM `forestgeo_testing`.coremeasurements cm');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('WHERE cm.StemGUID IN (?, ?)');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('AND c.PlotID = ?');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('AND cm.CensusID = ?');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual([11, 22, 1, 2]);
    expect(result).toEqual({ mode: 'targeted', coreMeasurementIDs: [5, 42, 101] });
  });

  it('expands to stem neighbors for plot-coordinate edits', async () => {
    const cm = makeConnectionManager([{ CoreMeasurementID: 7 }]);

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['StemPlotX', 'StemPlotY']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('WHERE cm.StemGUID IN (?)');
    expect(result).toEqual({ mode: 'targeted', coreMeasurementIDs: [7, 42] });
  });

  it('falls back to the scope refresh for unsupported changed fields', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['UnexpectedField']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'unsupported-field' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('falls back when the target CoreMeasurementID is not a positive integer', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 0,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['MeasuredDBH']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'invalid-target-id' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('falls back when stem-neighbor expansion cannot be bounded to a valid scope', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 0,
      censusID: 2,
      changedFields: new Set(['TreeTag']),
      beforeStemGUID: 11,
      afterStemGUID: 12,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'invalid-scope' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// writeMeasurementsSummary — F11 sparse-write regression coverage.
//
// Fixture shape: a single measurement (CORE_MEASUREMENT_ID) on a shared stem
// (STEM_GUID) that also carries OTHER sibling measurements in the real DB
// (not modeled here — the point of F11 is that this writer must never touch
// a `stems`/`coremeasurements` column the user did not actually edit,
// precisely because that row can be shared). No scenario below edits
// TreeTag/StemTag/QuadratName, so the tree/stem RE-resolution branch
// (resolveMeasurementSummaryStem et al.) never engages and the call
// sequence stays fully deterministic and enumerable by hand.
// ===========================================================================
describe('writeMeasurementsSummary — F11 sparse Raw*/stems/coremeasurements sync', () => {
  interface RecordedCall {
    sql: string;
    params: unknown[];
    transactionID: string | undefined;
  }

  const TEST_SCHEMA = 'forestgeo_testing';
  const TX_ID = 'tx-measurementssummary';
  const CORE_MEASUREMENT_ID = 500;
  const STEM_GUID = 600;
  const TREE_ID = 700;
  const PLOT_ID = 3;
  const CENSUS_ID = 7;
  const NEW_SPECIES_ID = 2;
  const UPDATE_STATEMENT_PATTERN = /^UPDATE\b/;

  function makeRecordingConnectionManager(rowSequence: unknown[][]) {
    let callIndex = 0;
    const calls: RecordedCall[] = [];
    const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      if (callIndex >= rowSequence.length) {
        throw new Error(
          `writeMeasurementsSummary F11 test: unexpected executeQuery call #${callIndex + 1} ` +
            `(only ${rowSequence.length} canned row-sets were provided). SQL: ${sql}`
        );
      }
      const rows = rowSequence[callIndex];
      calls.push({ sql, params, transactionID });
      callIndex++;
      return rows;
    });
    return { cm: { executeQuery } as unknown as ConnectionManager, calls };
  }

  // Every UPDATE actually issued against `tableBacktick` (e.g. '`stems`').
  // Anchored on ^UPDATE so a `SELECT ... FOR UPDATE` read is never
  // mis-matched, and so the `/* skip_changelog */ UPDATE ...` IsValidated
  // reset (which does not start with the literal word UPDATE) is naturally
  // excluded without a separate comment check.
  function findUpdateCalls(calls: RecordedCall[], tableBacktick: string): RecordedCall[] {
    return calls.filter(c => UPDATE_STATEMENT_PATTERN.test(c.sql) && c.sql.includes(tableBacktick));
  }

  // --- F12 regression guards --------------------------------------------
  // Before F12, `changesFound` alone gated a hard DELETE against
  // `measurement_error_log` and an `IsValidated = NULL` reset for the
  // EDITED ROW ONLY, on every path including a species correction. F12
  // moved that ownership to `applyPreparedTreeSpeciesCorrection` (via
  // `refreshCorrectionErrorsAndValidationPending`) on the correction path,
  // which treats the edited row like every other attached member and never
  // hard-deletes history. These helpers let the tests below assert the
  // narrowed behavior directly instead of merely re-deriving a call count.
  const DELETE_STATEMENT_PATTERN = /^DELETE\b/i;
  const MEASUREMENT_ERROR_LOG_TABLE_NAME = 'measurement_error_log';
  const IS_VALIDATED_RESET_SQL_MARKER = 'IsValidated';

  function findMeasurementErrorLogReferences(calls: RecordedCall[]): RecordedCall[] {
    return calls.filter(c => c.sql.includes(MEASUREMENT_ERROR_LOG_TABLE_NAME));
  }
  function findDeleteCalls(calls: RecordedCall[]): RecordedCall[] {
    return calls.filter(c => DELETE_STATEMENT_PATTERN.test(c.sql));
  }
  function findIsValidatedResetCalls(calls: RecordedCall[]): RecordedCall[] {
    return calls.filter(c => c.sql.includes(IS_VALIDATED_RESET_SQL_MARKER));
  }

  // domainDiff is no longer an applyPreparedTreeSpeciesCorrection argument —
  // it is embedded in the real `species_correction_metadata` state row this
  // writer builds itself, so tests read it back from there instead.
  function findSpeciesCorrectionMetadataRow(state: EditOperationStateRow[]): SpeciesCorrectionMetadata {
    const metadataRow = state.find(row => row.table === SPECIES_CORRECTION_METADATA_TABLE);
    if (!metadataRow?.row) {
      throw new Error(`expected a "${SPECIES_CORRECTION_METADATA_TABLE}" state row; got tables: ${state.map(r => r.table).join(', ')}`);
    }
    return metadataRow.row as unknown as SpeciesCorrectionMetadata;
  }
  function findSpeciesCorrectionMetadataDomainDiff(state: EditOperationStateRow[]): SpeciesCorrectionDomainDiff {
    return findSpeciesCorrectionMetadataRow(state).domainDiff;
  }

  function coreMeasurementRow(overrides: Record<string, unknown> = {}) {
    return { CoreMeasurementID: CORE_MEASUREMENT_ID, StemGUID: STEM_GUID, CensusID: CENSUS_ID, ...overrides };
  }
  function stemRow(overrides: Record<string, unknown> = {}) {
    return { StemGUID: STEM_GUID, TreeID: TREE_ID, LocalX: 10, LocalY: 20, PlotX: 1, PlotY: 2, ...overrides };
  }
  function treeRow(overrides: Record<string, unknown> = {}) {
    return { TreeID: TREE_ID, SpeciesID: 1, ...overrides };
  }
  // The canonical joined "current" read. Non-null across the board so any
  // test that fails to gate a field on changedFields will visibly leak one
  // of these canonical values into a Raw* column instead of silently
  // passing — e.g. Description/StemLocalY/MeasuredHOM below are exactly the
  // kind of "innocuous-looking but unchanged" values a regression would
  // fabricate into a raw column if F11's gating were ever removed.
  function joinedRow(overrides: Record<string, unknown> = {}) {
    return {
      CoreMeasurementID: CORE_MEASUREMENT_ID,
      CensusID: CENSUS_ID,
      PlotID: PLOT_ID,
      StemGUID: STEM_GUID,
      MeasurementDate: '2020-01-01',
      MeasuredDBH: 100,
      MeasuredHOM: 130,
      Description: 'canonical description — must never leak into RawComments unless edited',
      Attributes: 'A1',
      TreeTag: 'T-100',
      TreeID: TREE_ID,
      SpeciesCode: 'AA',
      SpeciesID: 1,
      StemTag: 'S-1',
      StemLocalX: 10,
      StemLocalY: 20,
      StemPlotX: 1,
      StemPlotY: 2,
      QuadratName: 'Q1',
      ...overrides
    };
  }

  function speciesCorrectionSummary(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
    return {
      version: 1,
      targetTreeID: TREE_ID,
      treeTag: 'T-100',
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      oldSpeciesID: 1,
      oldSpeciesCode: 'AA',
      newSpeciesID: NEW_SPECIES_ID,
      newSpeciesCode: 'BB',
      activeStemCount: 1,
      inactiveStemCount: 0,
      activeMeasurementCount: 1,
      inactiveMeasurementCount: 0,
      stems: [{ stemGUID: STEM_GUID, censusID: CENSUS_ID, quadratID: 9, isActive: true }],
      measurements: [{ coreMeasurementID: CORE_MEASUREMENT_ID, stemGUID: STEM_GUID, censusID: CENSUS_ID, isActive: true, priorRawSpCode: 'AA' }],
      ...overrides
    };
  }

  function makeFieldChange(field: string, from: unknown, to: unknown): FieldChange {
    return { field, from, to };
  }

  function buildPlan(fieldChanges: FieldChange[], speciesCorrection?: SpeciesCorrectionSummary): EditPlan {
    return {
      dataType: 'measurementssummary',
      targetID: CORE_MEASUREMENT_ID,
      fieldChanges,
      effects: [],
      maxSeverity: 'info',
      planHash: 'test-plan-hash',
      generatedAt: new Date().toISOString(),
      ...(speciesCorrection ? { speciesCorrection } : {})
    };
  }

  function buildInput(): ApplyInTransactionInput {
    return {
      dataType: 'measurementssummary',
      schema: TEST_SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID,
      targetID: CORE_MEASUREMENT_ID,
      newRow: {},
      expectedPlanHash: null,
      createdBy: 'test-runner',
      // Skips the view-refresh tail entirely so this harness only needs to
      // model the rows writeMeasurementsSummary itself reads/writes.
      refreshViews: false,
      transactionID: TX_ID
    };
  }

  beforeEach(() => {
    refreshIngestionErrorsForMeasurementMock.mockClear();
    prepareTreeSpeciesCorrectionMock.mockClear();
    applyPreparedTreeSpeciesCorrectionMock.mockClear();
    assertNoEditedFieldDriftForSpeciesCorrectionMock.mockClear();
  });

  it("species correction, SpeciesCode-only edit: never backfills a Raw* column from the canonical join, never issues any coremeasurements UPDATE (so RawSpCode/RawX/RawComments/etc. stay exactly as uploaded), and — F12 — never touches measurement_error_log/IsValidated or calls this writer's own ingestion-error refresh (that is now exclusively applyPreparedTreeSpeciesCorrection's job)", async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()], // 1: before core (FOR UPDATE)
      [stemRow()], // 2: before stem (FOR UPDATE)
      [treeRow()], // 3: before tree (FOR UPDATE)
      [], // 4: before cmattributes (FOR UPDATE)
      [joinedRow()], // 5: current joined (FOR UPDATE)
      [{ SpeciesID: NEW_SPECIES_ID }], // 6: species lookup for the typed code
      [coreMeasurementRow()], // 7: after core (FOR UPDATE)
      [stemRow()], // 8: after stem (FOR UPDATE)
      [treeRow()], // 9: after tree (FOR UPDATE)
      [] // 10: after cmattributes (FOR UPDATE)
    ];
    const { cm, calls } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB')], speciesCorrectionSummary());

    const result = await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    // F12 narrowed the correction path to exactly 10 reads/writes (the
    // pre-F12 sequence also issued a `measurement_error_log` DELETE and an
    // `IsValidated = NULL` reset for the edited row — both now removed from
    // this writer on the correction path, see the guard in
    // writeMeasurementsSummary around `changesFound && !isSpeciesCorrection`).
    expect(calls, `expected exactly 10 reads/writes, got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(10);
    const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
    expect(coreUpdates, `expected NO coremeasurements UPDATE at all; got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(0);
    expect(result.updatedIDs.CoreMeasurementID).toBe(CORE_MEASUREMENT_ID);

    // F12 regression guards (strongest scenario — the sparsest correction
    // edit, so there is no other write that could coincidentally mask a
    // reintroduced DELETE/reset/refresh).
    const errorLogReferences = findMeasurementErrorLogReferences(calls);
    expect(
      errorLogReferences,
      `expected no SQL to mention measurement_error_log on the correction path; got:\n${errorLogReferences.map(c => c.sql).join('\n')}`
    ).toHaveLength(0);
    const deleteCalls = findDeleteCalls(calls);
    expect(deleteCalls, `expected no DELETE statement at all on the correction path; got:\n${deleteCalls.map(c => c.sql).join('\n')}`).toHaveLength(0);
    const isValidatedResetCalls = findIsValidatedResetCalls(calls);
    expect(
      isValidatedResetCalls,
      `expected no IsValidated reset statement issued by this writer on the correction path; got:\n${isValidatedResetCalls.map(c => c.sql).join('\n')}`
    ).toHaveLength(0);
    expect(
      refreshIngestionErrorsForMeasurementMock,
      "expected this writer's own refreshIngestionErrorsForMeasurement call to be skipped on the correction path (applyPreparedTreeSpeciesCorrection owns it instead)"
    ).not.toHaveBeenCalled();

    // F30 regression guard: `preparedSpeciesCorrection.editedStemGUID` feeds
    // directly into the real (un-mocked) `buildSpeciesCorrectionMetadataStateRows`
    // call. If that id were ever lost (e.g. an `undefined` fallback), the
    // persisted metadata row would carry `editedStemGUID: undefined` instead
    // of the edited row's actual stem — these assertions fail in that case.
    const metadataBeforeRow = findSpeciesCorrectionMetadataRow(result.beforeState);
    const metadataAfterRow = findSpeciesCorrectionMetadataRow(result.afterState);
    expect(metadataBeforeRow.editedCoreMeasurementID).toBe(CORE_MEASUREMENT_ID);
    expect(metadataAfterRow.editedCoreMeasurementID).toBe(CORE_MEASUREMENT_ID);
    expect(typeof metadataBeforeRow.editedStemGUID).toBe('number');
    expect(typeof metadataAfterRow.editedStemGUID).toBe('number');
    expect(metadataBeforeRow.editedStemGUID).toBe(STEM_GUID);
    expect(metadataAfterRow.editedStemGUID).toBe(STEM_GUID);

    // The actual stored after-values the real builder produced from this
    // test's canned `applyPreparedTreeSpeciesCorrectionMock` correction —
    // never a fabricated/defaulted stand-in.
    expect(metadataAfterRow.targetTreeID).toBe(TREE_ID);
    expect(metadataBeforeRow.speciesID).toBe(1);
    expect(metadataBeforeRow.speciesCode).toBe('AA');
    expect(metadataAfterRow.speciesID).toBe(NEW_SPECIES_ID);
    expect(metadataAfterRow.speciesCode).toBe('BB');
    expect(metadataAfterRow.domainDiff).toEqual({ coremeasurements: {}, stems: {}, attributeCodes: { before: [], after: [] } });
  });

  it('species correction, StemLocalX-only coordinate edit on a shared stem: stems UPDATE sets LocalX but never LocalY, and the Raw* sync sets RawX but never RawY or RawSpCode', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // stems UPDATE (LocalX only)
      [], // coremeasurements Raw* sync UPDATE (RawX only)
      // F12: no DELETE measurement_error_log / IsValidated reset row here
      // anymore — applyPreparedTreeSpeciesCorrection now owns that, and it
      // is fully mocked in this file (issues no executeQuery call at all).
      [coreMeasurementRow()],
      [stemRow({ LocalX: 99 })],
      [treeRow()],
      []
    ];
    const { cm, calls } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('StemLocalX', 10, 99)], speciesCorrectionSummary());

    await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const stemsUpdates = findUpdateCalls(calls, '`stems`');
    expect(stemsUpdates, `expected exactly one stems UPDATE; got:\n${stemsUpdates.map(c => c.sql).join('\n')}`).toHaveLength(1);
    expect(stemsUpdates[0].sql).toContain('`LocalX`');
    expect(stemsUpdates[0].sql).not.toContain('`LocalY`');

    const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
    expect(coreUpdates, `expected exactly one coremeasurements UPDATE (the Raw* sync); got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(1);
    expect(coreUpdates[0].sql).toContain('`RawX`');
    expect(coreUpdates[0].sql).not.toContain('`RawY`');
    expect(coreUpdates[0].sql).not.toContain('`RawSpCode`');
  });

  it('species correction, StemLocalX-only edit: the domainDiff handed to applyPreparedTreeSpeciesCorrection carries exactly stems.LocalX and coremeasurements.RawX — the two columns this edit actually wrote — omits every other allowlisted column, and copies the unedited attribute-code set verbatim on both sides', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow({ RawX: 10 })],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // stems UPDATE (LocalX only)
      [], // coremeasurements Raw* sync UPDATE (RawX only)
      [coreMeasurementRow({ RawX: 99 })],
      [stemRow({ LocalX: 99 })],
      [treeRow()],
      []
    ];
    const { cm } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('StemLocalX', 10, 99)], speciesCorrectionSummary());

    const result = await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    expect(applyPreparedTreeSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
    const domainDiff = findSpeciesCorrectionMetadataDomainDiff(result.beforeState);
    expect(domainDiff.stems).toEqual({ LocalX: { before: 10, after: 99 } });
    expect(domainDiff.coremeasurements).toEqual({ RawX: { before: 10, after: 99 } });
    expect(domainDiff.attributeCodes).toEqual({ before: [], after: [] });
  });

  it('species correction, MeasuredDBH-only edit: no coremeasurements UPDATE payload ever contains MeasuredHOM or MeasurementDate', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // coremeasurements numeric-fields UPDATE (MeasuredDBH only)
      [], // coremeasurements Raw* sync UPDATE (MeasuredDBH only)
      // F12: no DELETE measurement_error_log / IsValidated reset row here
      // anymore — applyPreparedTreeSpeciesCorrection now owns that, and it
      // is fully mocked in this file (issues no executeQuery call at all).
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      []
    ];
    const { cm, calls } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('MeasuredDBH', 100, 160)], speciesCorrectionSummary());

    await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
    expect(coreUpdates, `expected exactly two coremeasurements UPDATEs; got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(2);
    for (const call of coreUpdates) {
      expect(call.sql).not.toContain('`MeasuredHOM`');
      expect(call.sql).not.toContain('`MeasurementDate`');
      expect(call.sql).not.toContain('`RawSpCode`');
    }
    expect(coreUpdates.some(call => call.sql.includes('`MeasuredDBH`'))).toBe(true);
  });

  it('species correction, MeasuredDBH-only edit: the domainDiff handed to applyPreparedTreeSpeciesCorrection carries exactly coremeasurements.MeasuredDBH before/after, an empty stems diff (no stem column was ever written), and the unedited attribute-code set verbatim on both sides', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow({ MeasuredDBH: 100 })],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // coremeasurements numeric-fields UPDATE (MeasuredDBH only)
      [], // coremeasurements Raw* sync UPDATE (MeasuredDBH only)
      [coreMeasurementRow({ MeasuredDBH: 160 })],
      [stemRow()],
      [treeRow()],
      []
    ];
    const { cm } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('MeasuredDBH', 100, 160)], speciesCorrectionSummary());

    const result = await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    expect(applyPreparedTreeSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
    const domainDiff = findSpeciesCorrectionMetadataDomainDiff(result.beforeState);
    expect(domainDiff.coremeasurements).toEqual({ MeasuredDBH: { before: 100, after: 160 } });
    expect(domainDiff.stems).toEqual({});
    expect(domainDiff.attributeCodes).toEqual({ before: [], after: [] });
  });

  it('species correction, MeasuredDBH-only edit: the domainDiff after-value is the actual post-write row this test canned, not the requested 160 — this fails if the overlay this writer used to predict after-state is ever reintroduced', async () => {
    const PERSISTED_AFTER_MEASURED_DBH = '155.555556';
    const rows: unknown[][] = [
      [coreMeasurementRow({ MeasuredDBH: 100 })],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // coremeasurements numeric-fields UPDATE (MeasuredDBH only)
      [], // coremeasurements Raw* sync UPDATE (MeasuredDBH only)
      // Deliberately NOT the requested 160: proves the diff is read back
      // from this canned post-write row, never from the write parameters.
      [coreMeasurementRow({ MeasuredDBH: PERSISTED_AFTER_MEASURED_DBH })],
      [stemRow()],
      [treeRow()],
      []
    ];
    const { cm } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('MeasuredDBH', 100, 160)], speciesCorrectionSummary());

    const result = await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const domainDiff = findSpeciesCorrectionMetadataDomainDiff(result.beforeState);
    expect(domainDiff.coremeasurements).toEqual({ MeasuredDBH: { before: 100, after: PERSISTED_AFTER_MEASURED_DBH } });
  });

  it('species correction, StemLocalX-only edit (Attributes NOT in changedFields): attributeCodes.before/after each come from their own independent cmattributes read, not from each other or from newValues.Attributes', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      [
        { CMAID: 1, CoreMeasurementID: CORE_MEASUREMENT_ID, Code: 'A1' },
        { CMAID: 2, CoreMeasurementID: CORE_MEASUREMENT_ID, Code: 'A2' }
      ],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // stems UPDATE (LocalX only)
      [], // coremeasurements Raw* sync UPDATE (RawX only)
      [coreMeasurementRow()],
      [stemRow({ LocalX: 99 })],
      [treeRow()],
      [
        { CMAID: 1, CoreMeasurementID: CORE_MEASUREMENT_ID, Code: 'A1' },
        { CMAID: 3, CoreMeasurementID: CORE_MEASUREMENT_ID, Code: 'A3' }
      ]
    ];
    const { cm } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('StemLocalX', 10, 99)], speciesCorrectionSummary());

    const result = await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const domainDiff = findSpeciesCorrectionMetadataDomainDiff(result.beforeState);
    expect(domainDiff.attributeCodes).toEqual({ before: ['A1', 'A2'], after: ['A1', 'A3'] });
  });

  it('species correction, Description-only edit: RawComments/Description are written, RawCodes stays absent because Attributes did not change, and RawSpCode is never written', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      [],
      [joinedRow()],
      [{ SpeciesID: NEW_SPECIES_ID }],
      [], // coremeasurements Raw* sync UPDATE (RawComments + Description only)
      // F12: no DELETE measurement_error_log / IsValidated reset row here
      // anymore — applyPreparedTreeSpeciesCorrection now owns that, and it
      // is fully mocked in this file (issues no executeQuery call at all).
      [coreMeasurementRow()],
      [stemRow()],
      [treeRow()],
      []
    ];
    const { cm, calls } = makeRecordingConnectionManager(rows);
    const plan = buildPlan(
      [makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('Description', 'old description', 'new description')],
      speciesCorrectionSummary()
    );

    await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
    expect(coreUpdates, `expected exactly one coremeasurements UPDATE; got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(1);
    const sql = coreUpdates[0].sql;
    expect(sql).toContain('`RawComments`');
    expect(sql).toContain('`Description`');
    for (const absentKey of [
      'RawCodes',
      'RawSpCode',
      'RawTreeTag',
      'RawStemTag',
      'RawQuadrat',
      'RawX',
      'RawY',
      'MeasuredDBH',
      'MeasuredHOM',
      'MeasurementDate'
    ]) {
      expect(sql, `payload unexpectedly contains \`${absentKey}\`: ${sql}`).not.toContain(`\`${absentKey}\``);
    }
  });

  it('legacy (non-correction) edit: the full Raw* sync contract is unchanged — every existing key is still written even though only MeasuredDBH changed', async () => {
    const rows: unknown[][] = [
      [coreMeasurementRow()], // 1: before core (no lock — not a correction)
      [stemRow()], // 2: before stem
      [treeRow()], // 3: before tree
      [], // 4: before cmattributes
      [joinedRow()], // 5: current joined
      [], // 6: coremeasurements numeric-fields UPDATE (legacy: all 3 fields)
      [], // 7: coremeasurements Raw* sync UPDATE (legacy: all keys)
      [], // 8: DELETE measurement_error_log
      [], // 9: UPDATE IsValidated = NULL
      [coreMeasurementRow()], // 10: after core
      [stemRow()], // 11: after stem
      [treeRow()], // 12: after tree
      [] // 13: after cmattributes
    ];
    const { cm, calls } = makeRecordingConnectionManager(rows);
    const plan = buildPlan([makeFieldChange('MeasuredDBH', 100, 160)]); // no speciesCorrection -> legacy path

    await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

    const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
    expect(coreUpdates, `expected exactly two coremeasurements UPDATEs; got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(2);
    const rawSyncCall = coreUpdates.find(call => call.sql.includes('`RawTreeTag`'));
    expect(rawSyncCall, `could not find the legacy Raw* sync UPDATE among:\n${coreUpdates.map(c => c.sql).join('\n')}`).toBeDefined();
    const legacyKeys = [
      'RawTreeTag',
      'RawStemTag',
      'RawSpCode',
      'RawQuadrat',
      'RawX',
      'RawY',
      'RawCodes',
      'RawComments',
      'Description',
      'MeasurementDate',
      'MeasuredDBH',
      'MeasuredHOM'
    ];
    for (const key of legacyKeys) {
      expect(rawSyncCall!.sql, `legacy Raw* sync payload is missing \`${key}\`: ${rawSyncCall!.sql}`).toContain(`\`${key}\``);
    }

    // F12 contrast: step 1 only NARROWED the correction path — it must not
    // have touched this legacy (non-correction) path at all. The
    // measurement_error_log DELETE, the IsValidated reset, and this
    // writer's own refreshIngestionErrorsForMeasurement call must all still
    // fire exactly as before.
    const errorLogDeleteCalls = findDeleteCalls(calls).filter(c => c.sql.includes(MEASUREMENT_ERROR_LOG_TABLE_NAME));
    expect(errorLogDeleteCalls, `expected the legacy measurement_error_log DELETE to still be issued; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(
      1
    );
    const isValidatedResetCalls = findIsValidatedResetCalls(calls);
    expect(isValidatedResetCalls, `expected the legacy IsValidated = NULL reset to still be issued; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(1);
    expect(
      refreshIngestionErrorsForMeasurementMock,
      "expected this writer's own refreshIngestionErrorsForMeasurement call to still fire exactly once on the legacy (non-correction) path"
    ).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // #427 batch-executor group-member write context.
  //
  // The batch executor applies a tree-wide species correction exactly once,
  // then still calls this writer for every OTHER row-local field a group
  // member's own row independently requested (e.g. a sibling's own DBH
  // edit), passing `groupMemberContext` so this writer takes the SAME sparse
  // correction write policy WITHOUT also re-running
  // prepare/applyPreparedTreeSpeciesCorrection. See the module-level doc
  // comment on `assertValidSpeciesCorrectionGroupMemberContext` and
  // `correctionWritePolicyActive` for the exact contract.
  // =========================================================================
  describe('writeMeasurementsSummary — #427 batch-executor group-member write context', () => {
    function buildGroupMemberContext(overrides: Partial<SpeciesCorrectionGroupMemberWriteContext> = {}): SpeciesCorrectionGroupMemberWriteContext {
      return {
        kind: SPECIES_CORRECTION_GROUP_MEMBER_WRITE_KIND,
        transactionID: TX_ID,
        schema: TEST_SCHEMA,
        plotID: PLOT_ID,
        censusID: CENSUS_ID,
        targetCoreMeasurementID: CORE_MEASUREMENT_ID,
        ...overrides
      };
    }

    // The group path builds no ledger row (so no species_correction_metadata
    // marker) and no per-row view refresh — both enforced by
    // assertValidSpeciesCorrectionGroupMemberContext, so every valid
    // group-member test must set both explicitly.
    function buildGroupMemberInput(overrides: Partial<ApplyInTransactionInput> = {}): ApplyInTransactionInput {
      return { ...buildInput(), writeLedger: false, refreshViews: false, ...overrides };
    }

    const UNEDITED_RAW_COLUMN_NAMES = ['MeasuredHOM', 'MeasurementDate', 'RawTreeTag', 'RawStemTag', 'RawQuadrat', 'RawX', 'RawY', 'RawCodes', 'RawSpCode'];

    function expectNoMetadataStateRow(state: EditOperationStateRow[], label: string): void {
      const metadataRow = state.find(row => row.table === SPECIES_CORRECTION_METADATA_TABLE);
      expect(
        metadataRow,
        `expected NO "${SPECIES_CORRECTION_METADATA_TABLE}" row in ${label}; got tables: ${state.map(r => r.table).join(', ')}`
      ).toBeUndefined();
    }

    it("sibling group member (MeasuredDBH + Description, no plan.speciesCorrection) with a valid context: writes only the sparse coremeasurements UPDATE for the fields actually changed, never RawSpCode, never an unedited measurement column, never touches measurement_error_log/IsValidated, never calls this writer's own ingestion-error refresh, and never calls either view-refresh function", async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()], // 1: before core (FOR UPDATE — group policy)
        [stemRow()], // 2: before stem
        [treeRow()], // 3: before tree
        [], // 4: before cmattributes
        [joinedRow()], // 5: current joined (FOR UPDATE)
        [], // 6: coremeasurements numeric-fields UPDATE (MeasuredDBH only)
        [], // 7: coremeasurements Raw* sync UPDATE (MeasuredDBH + RawComments/Description)
        [coreMeasurementRow()], // 8: after core
        [stemRow()], // 9: after stem
        [treeRow()], // 10: after tree
        [] // 11: after cmattributes
      ];
      const { cm, calls } = makeRecordingConnectionManager(rows);
      const plan = buildPlan([makeFieldChange('MeasuredDBH', 100, 160), makeFieldChange('Description', 'old description', 'new description')]);

      const result = await writeMeasurementsSummary(cm, buildGroupMemberInput(), plan, TX_ID, buildGroupMemberContext());

      expect(calls, `expected exactly 11 reads/writes, got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(11);

      const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
      expect(coreUpdates, `expected exactly two coremeasurements UPDATEs; got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(2);
      expect(coreUpdates.some(call => call.sql.includes('`MeasuredDBH`'))).toBe(true);
      expect(coreUpdates.some(call => call.sql.includes('`RawComments`'))).toBe(true);
      expect(coreUpdates.some(call => call.sql.includes('`Description`'))).toBe(true);
      for (const call of coreUpdates) {
        for (const unedited of UNEDITED_RAW_COLUMN_NAMES) {
          expect(call.sql, `payload unexpectedly contains \`${unedited}\`: ${call.sql}`).not.toContain(`\`${unedited}\``);
        }
      }

      const errorLogReferences = findMeasurementErrorLogReferences(calls);
      expect(errorLogReferences, `expected no SQL to mention measurement_error_log; got:\n${errorLogReferences.map(c => c.sql).join('\n')}`).toHaveLength(0);
      const deleteCalls = findDeleteCalls(calls);
      expect(deleteCalls, `expected no DELETE statement at all; got:\n${deleteCalls.map(c => c.sql).join('\n')}`).toHaveLength(0);
      const isValidatedResetCalls = findIsValidatedResetCalls(calls);
      expect(isValidatedResetCalls, `expected no IsValidated reset statement; got:\n${isValidatedResetCalls.map(c => c.sql).join('\n')}`).toHaveLength(0);
      expect(
        refreshIngestionErrorsForMeasurementMock,
        "expected this writer's own refreshIngestionErrorsForMeasurement call to be skipped"
      ).not.toHaveBeenCalled();
      expect(prepareTreeSpeciesCorrectionMock, 'a group-member write must never call prepareTreeSpeciesCorrection').not.toHaveBeenCalled();
      expect(applyPreparedTreeSpeciesCorrectionMock, 'a group-member write must never call applyPreparedTreeSpeciesCorrection').not.toHaveBeenCalled();
      expect(refreshMeasurementViewsForScopeMock).not.toHaveBeenCalled();
      expect(refreshMeasurementViewsForCoreMeasurementsMock).not.toHaveBeenCalled();

      expectNoMetadataStateRow(result.beforeState, 'beforeState');
      expectNoMetadataStateRow(result.afterState, 'afterState');
    });

    it('the SAME plan/input WITHOUT the context: proves case above is caused by the context, not an unrelated harness quirk — the legacy path IS taken, issuing a measurement_error_log DELETE and an IsValidated reset', async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()], // 1: before core (no lock — legacy path)
        [stemRow()], // 2: before stem
        [treeRow()], // 3: before tree
        [], // 4: before cmattributes
        [joinedRow()], // 5: current joined
        [], // 6: coremeasurements numeric-fields UPDATE (legacy: all 3 fields)
        [], // 7: coremeasurements Raw* sync UPDATE (legacy: all keys)
        [], // 8: DELETE measurement_error_log
        [], // 9: UPDATE IsValidated = NULL
        [coreMeasurementRow()], // 10: after core
        [stemRow()], // 11: after stem
        [treeRow()], // 12: after tree
        [] // 13: after cmattributes
      ];
      const { cm, calls } = makeRecordingConnectionManager(rows);
      const plan = buildPlan([makeFieldChange('MeasuredDBH', 100, 160), makeFieldChange('Description', 'old description', 'new description')]);

      // No groupMemberContext argument at all — same plan/input shape as the
      // sibling-member test above, otherwise.
      await writeMeasurementsSummary(cm, buildGroupMemberInput(), plan, TX_ID);

      const errorLogDeleteCalls = findDeleteCalls(calls).filter(c => c.sql.includes(MEASUREMENT_ERROR_LOG_TABLE_NAME));
      expect(errorLogDeleteCalls, `expected the legacy measurement_error_log DELETE to be issued; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(1);
      const isValidatedResetCalls = findIsValidatedResetCalls(calls);
      expect(isValidatedResetCalls, `expected the legacy IsValidated = NULL reset to be issued; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(1);
      expect(refreshIngestionErrorsForMeasurementMock, 'expected the legacy ingestion-error refresh to fire exactly once').toHaveBeenCalledTimes(1);
    });

    it('shared-stem coordinate group member (StemLocalX only, no plan.speciesCorrection) with a valid context: stems UPDATE sets LocalX but never LocalY, and the Raw* sync sets RawX but never RawY or RawSpCode', async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        [],
        [joinedRow()],
        [], // stems UPDATE (LocalX only)
        [], // coremeasurements Raw* sync UPDATE (RawX only)
        [coreMeasurementRow()],
        [stemRow({ LocalX: 99 })],
        [treeRow()],
        []
      ];
      const { cm, calls } = makeRecordingConnectionManager(rows);
      const plan = buildPlan([makeFieldChange('StemLocalX', 10, 99)]);

      await writeMeasurementsSummary(cm, buildGroupMemberInput(), plan, TX_ID, buildGroupMemberContext());

      const stemsUpdates = findUpdateCalls(calls, '`stems`');
      expect(stemsUpdates, `expected exactly one stems UPDATE; got:\n${stemsUpdates.map(c => c.sql).join('\n')}`).toHaveLength(1);
      expect(stemsUpdates[0].sql).toContain('`LocalX`');
      expect(stemsUpdates[0].sql).not.toContain('`LocalY`');

      const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
      expect(coreUpdates, `expected exactly one coremeasurements UPDATE (the Raw* sync); got:\n${coreUpdates.map(c => c.sql).join('\n')}`).toHaveLength(1);
      expect(coreUpdates[0].sql).toContain('`RawX`');
      expect(coreUpdates[0].sql).not.toContain('`RawY`');
      expect(coreUpdates[0].sql).not.toContain('`RawSpCode`');
    });

    it('group-member write SKIPS the pre-write drift guard even when a changed field\'s "from" no longer matches the locked current row (e.g. a value this same batch already wrote), and the write still proceeds', async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        [],
        [joinedRow()], // locked current MeasuredDBH is 100 — deliberately NOT what `from` below claims
        [], // coremeasurements numeric-fields UPDATE (MeasuredDBH only)
        [], // coremeasurements Raw* sync UPDATE (MeasuredDBH only)
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        []
      ];
      const { cm, calls } = makeRecordingConnectionManager(rows);
      const STALE_FROM_VALUE = 999; // does not match joinedRow().MeasuredDBH (100)
      const plan = buildPlan([makeFieldChange('MeasuredDBH', STALE_FROM_VALUE, 160)]);

      await writeMeasurementsSummary(cm, buildGroupMemberInput(), plan, TX_ID, buildGroupMemberContext());

      expect(
        assertNoEditedFieldDriftForSpeciesCorrectionMock,
        'a group-member write must never re-run the drift guard — the executor already ran it pre-batch against the locked value'
      ).not.toHaveBeenCalled();
      const coreUpdates = findUpdateCalls(calls, '`coremeasurements`');
      expect(coreUpdates, 'the write must still proceed despite the stale `from`').toHaveLength(2);
    });

    it("contrast: the TRUE species-correction path (plan.speciesCorrection present, no groupMemberContext) still runs the pre-write drift guard, with the locked current row's own values", async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        [],
        [joinedRow()],
        [{ SpeciesID: NEW_SPECIES_ID }],
        [], // coremeasurements numeric-fields UPDATE (MeasuredDBH only)
        [], // coremeasurements Raw* sync UPDATE (MeasuredDBH only)
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        []
      ];
      const { cm } = makeRecordingConnectionManager(rows);
      const STALE_FROM_VALUE = 999;
      const plan = buildPlan([makeFieldChange('SpeciesCode', 'AA', 'BB'), makeFieldChange('MeasuredDBH', STALE_FROM_VALUE, 160)], speciesCorrectionSummary());

      await writeMeasurementsSummary(cm, buildInput(), plan, TX_ID);

      expect(assertNoEditedFieldDriftForSpeciesCorrectionMock).toHaveBeenCalledTimes(1);
      expect(assertNoEditedFieldDriftForSpeciesCorrectionMock).toHaveBeenCalledWith(plan.fieldChanges, {
        TreeTag: 'T-100',
        StemTag: 'S-1',
        QuadratName: 'Q1',
        StemLocalX: 10,
        StemLocalY: 20,
        StemPlotX: 1,
        StemPlotY: 2,
        MeasurementDate: '2020-01-01',
        MeasuredDBH: 100,
        MeasuredHOM: 130,
        Description: 'canonical description — must never leak into RawComments unless edited',
        Attributes: 'A1'
      });
    });

    it('group-member write with a Description-only edit never calls prepare/applyPreparedTreeSpeciesCorrection and produces no species_correction_metadata state row on either side', async () => {
      const rows: unknown[][] = [
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        [],
        [joinedRow()],
        [], // coremeasurements Raw* sync UPDATE (RawComments + Description only)
        [coreMeasurementRow()],
        [stemRow()],
        [treeRow()],
        []
      ];
      const { cm, calls } = makeRecordingConnectionManager(rows);
      const plan = buildPlan([makeFieldChange('Description', 'old description', 'new description')]);

      const result = await writeMeasurementsSummary(cm, buildGroupMemberInput(), plan, TX_ID, buildGroupMemberContext());

      expect(calls, `expected exactly 10 reads/writes, got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(10);
      expect(prepareTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
      expect(applyPreparedTreeSpeciesCorrectionMock).not.toHaveBeenCalled();
      expectNoMetadataStateRow(result.beforeState, 'beforeState');
      expectNoMetadataStateRow(result.afterState, 'afterState');
    });

    // --- Context validation: one case per rejection in Task A. Each must
    // throw SpeciesCorrectionGroupMemberContextError BEFORE any read/write —
    // zero executeQuery calls recorded. Table-driven to keep this readable;
    // each row names exactly one broken field relative to an otherwise-valid
    // context/input/plan triple.
    const rejectionCases: Array<{
      name: string;
      context?: Record<string, unknown>;
      input?: Record<string, unknown>;
      plan?: Record<string, unknown>;
    }> = [
      { name: 'kind is not the group-member discriminator', context: { kind: 'not-a-real-kind' } },
      { name: "transactionID does not match this call's own transaction", context: { transactionID: 'some-other-transaction-id' } },
      { name: 'schema does not match input.schema', context: { schema: 'some_other_schema' } },
      { name: 'plotID does not match input.plotID', context: { plotID: PLOT_ID + 1 } },
      { name: 'censusID does not match input.censusID', context: { censusID: CENSUS_ID + 1 } },
      { name: 'targetCoreMeasurementID does not match input.targetID', context: { targetCoreMeasurementID: CORE_MEASUREMENT_ID + 1 } },
      { name: 'input.writeLedger is not exactly false', input: { writeLedger: true } },
      { name: 'input.refreshViews is not exactly false', input: { refreshViews: true } },
      { name: 'plan also carries its own plan.speciesCorrection', plan: { speciesCorrection: speciesCorrectionSummary() } }
    ];

    for (const rejectionCase of rejectionCases) {
      it(`rejects a group-member write when ${rejectionCase.name}, with NO read/write issued`, async () => {
        const { cm, calls } = makeRecordingConnectionManager([]);
        const context = { ...buildGroupMemberContext(), ...rejectionCase.context } as SpeciesCorrectionGroupMemberWriteContext;
        const input = { ...buildGroupMemberInput(), ...rejectionCase.input } as ApplyInTransactionInput;
        const plan = { ...buildPlan([makeFieldChange('Description', 'old description', 'new description')]), ...rejectionCase.plan } as EditPlan;

        await expect(writeMeasurementsSummary(cm, input, plan, TX_ID, context)).rejects.toThrow(SpeciesCorrectionGroupMemberContextError);
        expect(calls, `expected zero reads/writes before validation throws; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(0);
      });
    }

    describe('loadLockedEditedFieldValuesForSpeciesCorrection', () => {
      it("issues exactly one FOR UPDATE read, issues no write, and returns all 12 drift fields with the locked row's actual values — including a genuine null preserved as null, never coerced", async () => {
        const rows: unknown[][] = [[joinedRow({ Description: null })]];
        const { cm, calls } = makeRecordingConnectionManager(rows);

        const result = await loadLockedEditedFieldValuesForSpeciesCorrection(cm, TEST_SCHEMA, CORE_MEASUREMENT_ID, TX_ID);

        expect(calls, `expected exactly one read; got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(1);
        expect(calls[0].sql, 'the read must be a locking FOR UPDATE read').toContain('FOR UPDATE');
        expect(findUpdateCalls(calls, '`coremeasurements`'), 'this helper must issue NO write').toHaveLength(0);
        expect(result).toEqual({
          TreeTag: 'T-100',
          StemTag: 'S-1',
          QuadratName: 'Q1',
          StemLocalX: 10,
          StemLocalY: 20,
          StemPlotX: 1,
          StemPlotY: 2,
          MeasurementDate: '2020-01-01',
          MeasuredDBH: 100,
          MeasuredHOM: 130,
          Description: null,
          Attributes: 'A1'
        });
        expect(result.Description).toBeNull();
      });

      it('throws when the joined row does not exist, rather than returning a half-empty map', async () => {
        const { cm } = makeRecordingConnectionManager([[]]);

        await expect(loadLockedEditedFieldValuesForSpeciesCorrection(cm, TEST_SCHEMA, CORE_MEASUREMENT_ID, TX_ID)).rejects.toThrow(/not found/);
      });
    });
  });
});
