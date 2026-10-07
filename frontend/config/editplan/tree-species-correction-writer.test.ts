import { describe, it, expect, vi, beforeEach } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { SpeciesCorrectionSummary } from './types';

const refreshIngestionErrorsForMeasurementMock = vi.fn(async (...args: unknown[]) => []);
vi.mock('@/config/measurementerrors', () => ({
  refreshIngestionErrorsForMeasurement: (...args: unknown[]) => refreshIngestionErrorsForMeasurementMock(...args),
  // The SUT (tree-species-correction-writer.ts) also imports this constant
  // directly from this module, to bind the validation-occurrence UPDATE's
  // `ErrorSource = ?` parameter. `vi.mock` replaces the ENTIRE
  // module with this factory's return value — there is no partial/
  // passthrough behavior — so omitting it here would make that import
  // silently resolve to `undefined` inside the SUT, corrupting every query
  // parameter this file asserts on below without any test noticing. Value
  // matches the real export in measurementerrors.ts exactly.
  VALIDATION_ERROR_SOURCE: 'validation',
  // Same reasoning as VALIDATION_ERROR_SOURCE above: the SUT also binds this
  // constant directly into the validation-occurrence UPDATE's exclusion
  // clause, so it must be present on the mock, not merely on the real module.
  INGESTION_STAGE_ERROR_CODES: ['20', '21']
}));

import {
  writeTreeSpeciesCorrection,
  prepareTreeSpeciesCorrection,
  applyPreparedTreeSpeciesCorrection,
  assertNoEditedFieldDriftForSpeciesCorrection,
  refreshCorrectionErrorsAndValidationPending,
  buildSpeciesCorrectionDomainDiff,
  buildSpeciesCorrectionMetadataStateRows,
  EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF,
  SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD,
  SpeciesCorrectionWriteConflictError,
  SpeciesCorrectionTransactionMismatchError,
  SPECIES_CORRECTION_METADATA_TABLE
} from './tree-species-correction-writer';
// Resolves through the mock above — kept as a real import (rather than a
// second hardcoded literal) so this file can never drift from whatever
// value the mock actually hands the SUT.
import { VALIDATION_ERROR_SOURCE, INGESTION_STAGE_ERROR_CODES } from '@/config/measurementerrors';

// ---------------------------------------------------------------------------
// Same row-sequence stub convention as tree-species-correction.test.ts: each
// entry is the result returned by the Nth executeQuery call, in order.
// Throws loudly on any call beyond the provided sequence. Most entries are a
// row array (SELECTs); a mysql2 UPDATE/DELETE instead resolves to an
// OkPacket-like object (e.g. `{ affectedRows: 2 }`) — `resolveSupportedValidationOccurrences`
// reads exactly that shape — so an entry may be either, matching what the
// real driver actually returns for that statement kind.
// ---------------------------------------------------------------------------
function makeConnectionManager(rowSequence: unknown[]) {
  let callIndex = 0;
  const calls: Array<{ sql: string; params: unknown[]; transactionID: string | undefined }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[], transactionID?: string) => {
    if (callIndex >= rowSequence.length) {
      throw new Error(`Unexpected executeQuery call #${callIndex + 1} (only ${rowSequence.length} row-sequence entries provided). SQL: ${sql}`);
    }
    const result = rowSequence[callIndex];
    calls.push({ sql, params, transactionID });
    callIndex++;
    return result;
  });
  return { cm: { executeQuery } as unknown as ConnectionManager, calls };
}

const TEST_SCHEMA = 'forestgeo_test';
const TX_ID = 'tx-species-write';

function sourceTreeRow(overrides: Record<string, unknown> = {}) {
  return { TreeID: 100, TreeTag: 'T-100', SpeciesID: 1, CensusID: 7, TreeIsActive: 1, PlotID: 3, OldSpeciesCode: 'AA', ...overrides };
}
function destinationSpeciesRow(overrides: Record<string, unknown> = {}) {
  return { SpeciesCode: 'BB', IsActive: 1, ...overrides };
}
function stemRow(overrides: Record<string, unknown> = {}) {
  return { StemGUID: 200, StemCensusID: 7, QuadratID: 9, QuadratPlotID: 3, StemIsActive: 1, ...overrides };
}
function measurementRow(overrides: Record<string, unknown> = {}) {
  return { CoreMeasurementID: 42, StemGUID: 200, MeasurementCensusID: 7, CoreIsActive: 1, RawSpCode: 'AA', ...overrides };
}

function previewed(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
  return {
    version: 1,
    targetTreeID: 100,
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
    stems: [{ stemGUID: 200, censusID: 7, quadratID: 9, isActive: true }],
    measurements: [{ coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' }],
    ...overrides
  };
}

const BASE_WRITE_INPUT = {
  previewedCorrection: previewed(),
  editedCoreMeasurementID: 42,
  editedStemGUID: 200,
  domainDiff: EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF
};

// The five locked replan reads (always identical shape/order to
// tree-species-correction.ts: source tree, destination species,
// destination collision, stems, measurements).
function replanRows(overrides: { stems?: unknown[]; measurements?: unknown[] } = {}) {
  return [[sourceTreeRow()], [destinationSpeciesRow()], [], overrides.stems ?? [stemRow()], overrides.measurements ?? [measurementRow()]];
}

// The row shape `selectEffectiveFieldsForMeasurements` returns — the
// single locked read `refreshIngestionErrorsForAllMembers` fans out to
// `refreshIngestionErrorsForMeasurement` for every attached member. Default
// values describe the edited measurement (42); sibling-scoped tests
// override `CoreMeasurementID` and give each member its OWN distinct
// values, so a test can tell "the right row's values were forwarded to the
// right member" apart from merely "the right COUNT of rows was forwarded".
function effectiveFieldsRow(overrides: Record<string, unknown> = {}) {
  return {
    CoreMeasurementID: 42,
    Tag: 'T-100',
    StemTag: 'S-1',
    SpCode: 'BB',
    Quadrat: 'Q1',
    X: 1,
    Y: 1,
    DBH: 10,
    HOM: 1.3,
    Date: '2020-01-01',
    Codes: null,
    Comments: null,
    ...overrides
  };
}

/** The `effectiveFieldsRow` fields `refreshIngestionErrorsForMeasurement` actually receives, with `X`/`Y`/`DBH`/`HOM` coerced to number|null and `Date` coerced to a date-only string — see `toOptionalNumber`/`toDateOnlyString` in tree-species-correction-writer.ts. Every value used by the row builders above is already a bare number or a date-only string, so this is an identity mapping that drops only `CoreMeasurementID` (passed separately) — kept distinct from `effectiveFieldsRow` anyway so each test's intent (DB row shape vs. forwarded-call shape) stays self-documenting at the call site. */
function expectedForwardedFields(row: ReturnType<typeof effectiveFieldsRow>) {
  const { CoreMeasurementID, ...rest } = row;
  return rest;
}

/** Matches the one statement in this module that joins `sitespecificvalidations` — the supported-validation-occurrence resolution. Unique: no other statement this module issues references that table. */
function findSupportedValidationUpdateCall(calls: Array<{ sql: string; params: unknown[] }>) {
  return calls.find(c => c.sql.includes('sitespecificvalidations'));
}

/** Matches the pending-revalidation reset (`/* skip_changelog *\/ UPDATE ... SET IsValidated = NULL`). Distinct from `findSupportedValidationUpdateCall` above — two different statements, both scoped to `activeMemberIDs`. */
function findPendingResetCall(calls: Array<{ sql: string; params: unknown[] }>) {
  return calls.find(c => c.sql.includes('IsValidated = NULL'));
}

beforeEach(() => {
  refreshIngestionErrorsForMeasurementMock.mockClear();
});

describe('writeTreeSpeciesCorrection', () => {
  // --- Requirement 1: locked precondition comparison vs stale snapshot ---

  it('locks every replan read with FOR UPDATE under the caller transactionID', async () => {
    // 5 replan reads + trees UPDATE + RawSpCode sync UPDATE + effective-
    // fields read + validation-occurrence UPDATE + pending reset (the lone
    // edited measurement is active and has no siblings, so the error-refresh
    // statements still run over it, but no sibling before/after SELECT).
    const { cm, calls } = makeConnectionManager([...replanRows(), [], [], [effectiveFieldsRow()], [], []]);
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    for (const call of calls.slice(0, 5)) {
      expect(call.sql).toMatch(/FOR UPDATE/i);
      expect(call.transactionID).toBe(TX_ID);
    }
  });

  it('throws a replan conflict (not a silent apply) when the locked re-read no longer returns ok', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow({ TreeIsActive: 0 })]]);
    const promise = writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => {
      expect(error.reason).toMatchObject({ kind: 'replan', result: { status: 'source_inactive' } });
    });
    // No mutation was attempted once the locked re-read failed.
    expect(calls).toHaveLength(1);
  });

  it('throws a replan conflict when the correction has already vanished under lock (no_correction)', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow({ SpeciesID: 2 })]]);
    const promise = writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => expect(error.reason).toMatchObject({ kind: 'replan', result: { status: 'no_correction' } }));
  });

  it('throws a drift conflict (stale snapshot) when stem membership changed since the preview, even though the locked replan itself returns ok', async () => {
    const { cm, calls } = makeConnectionManager(
      replanRows({
        stems: [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201 })],
        measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 43, StemGUID: 201 })]
      })
    );
    const promise = writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => expect(error.reason).toMatchObject({ kind: 'drift' }));
    // The replan itself succeeded (5 reads); no write was attempted after drift was detected.
    expect(calls).toHaveLength(5);
  });

  it('throws a drift conflict when a sibling measurement is no longer active', async () => {
    const { cm } = makeConnectionManager(replanRows({ measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 43, CoreIsActive: 0 })] }));
    const promise = writeTreeSpeciesCorrection(
      cm,
      TEST_SCHEMA,
      {
        ...BASE_WRITE_INPUT,
        previewedCorrection: previewed({
          activeMeasurementCount: 2,
          measurements: [
            { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
            { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' }
          ]
        })
      },
      TX_ID
    );
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => expect(error.reason).toMatchObject({ kind: 'drift' }));
  });

  it("throws a drift conflict when a measurement's RawSpCode changed under lock since the preview — priorRawSpCode is a precondition to gate on, not merely a fresh value to capture", async () => {
    const { cm, calls } = makeConnectionManager(replanRows({ measurements: [measurementRow({ RawSpCode: 'ZZ' })] }));
    const promise = writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => expect(error.reason).toMatchObject({ kind: 'drift', message: expect.stringContaining('RawSpCode') }));
    // The replan itself succeeded (5 reads); no write was attempted after drift was detected.
    expect(calls).toHaveLength(5);
  });

  // --- Requirement 2: direct trees.SpeciesID update, no resolver/creation -

  it('updates only trees.SpeciesID for the exact (TreeID, CensusID), with no other tree/stem write', async () => {
    const { cm, calls } = makeConnectionManager([...replanRows(), [], [], [effectiveFieldsRow()], [], []]);
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    // Anchored to the statement's own start: the locked replan reads (source
    // tree, destination collision) also touch `.trees` and also carry the
    // substring "UPDATE" (as part of "... FOR UPDATE"), so an unanchored
    // `.includes('UPDATE')` matches the FIRST locked SELECT, not the actual
    // mutating UPDATE — asserting against the wrong statement entirely.
    const treeUpdateCall = calls.find(c => /^UPDATE\b/i.test(c.sql) && c.sql.includes('.trees'));
    expect(treeUpdateCall).toBeDefined();
    expect(treeUpdateCall!.sql).toContain('SET SpeciesID = ?');
    expect(treeUpdateCall!.sql).toContain('WHERE TreeID = ? AND CensusID = ?');
    expect(treeUpdateCall!.params).toEqual([2, 100, 7]);
    // No INSERT anywhere — a linked correction never allocates a tree/stem.
    expect(calls.every(c => !/INSERT/i.test(c.sql))).toBe(true);
  });

  it('same-resolved-ID input is refused as no_correction before any write (no allocation, no mutation)', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow({ SpeciesID: 2 })]]);
    await expect(writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID)).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    expect(calls).toHaveLength(1);
  });

  it('translates ER_DUP_ENTRY on the trees UPDATE into a structured unique-constraint conflict', async () => {
    const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
    let callIndex = 0;
    const rows = replanRows();
    const executeQuery = vi.fn(async (sql: string) => {
      if (/UPDATE .*\.trees/.test(sql)) throw dupError;
      const result = rows[callIndex];
      callIndex++;
      return result;
    });
    const cm = { executeQuery } as unknown as ConnectionManager;
    const promise = writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(promise).rejects.toBeInstanceOf(SpeciesCorrectionWriteConflictError);
    await promise.catch(error => expect(error.reason).toMatchObject({ kind: 'unique-constraint' }));
  });

  it('does not translate (and does not swallow) an unrelated SQL error on the trees UPDATE — failure propagates unchanged', async () => {
    const otherError = Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 });
    const rows = replanRows();
    let callIndex = 0;
    const executeQuery = vi.fn(async (sql: string) => {
      if (/UPDATE .*\.trees/.test(sql)) throw otherError;
      const result = rows[callIndex];
      callIndex++;
      return result;
    });
    const cm = { executeQuery } as unknown as ConnectionManager;
    await expect(writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID)).rejects.toBe(otherError);
  });

  // --- Requirement 2/3: canonical RawSpCode sync incl. NULL/inactive,
  // no other column on any sibling ----------------------------------------

  it('synchronizes RawSpCode to the canonical destination code on every attached CM, including an inactive sibling with a NULL RawSpCode, touching no other column', async () => {
    const { cm, calls } = makeConnectionManager([
      ...replanRows({
        stems: [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201, StemIsActive: 0 })],
        measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 44, StemGUID: 201, CoreIsActive: 0, RawSpCode: null })]
      }),
      [{ CoreMeasurementID: 44, RawSpCode: null }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      // Effective-fields read for BOTH attached members (42 active,
      // 44 inactive) — the ingestion-error refresh scope is every member.
      [effectiveFieldsRow({ CoreMeasurementID: 42 }), effectiveFieldsRow({ CoreMeasurementID: 44 })],
      [], // validation-occurrence UPDATE — active-only (42)
      [], // pending reset — active-only (42)
      [{ CoreMeasurementID: 44, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        inactiveStemCount: 1,
        inactiveMeasurementCount: 1,
        stems: [
          { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
          { stemGUID: 201, censusID: 7, quadratID: 9, isActive: false }
        ],
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: false, priorRawSpCode: null }
        ]
      })
    };
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);
    const rawSyncCall = calls.find(c => c.sql.includes('SET RawSpCode = ?'));
    expect(rawSyncCall).toBeDefined();
    expect(rawSyncCall!.sql).toContain('WHERE CoreMeasurementID IN (?, ?)');
    expect(rawSyncCall!.params).toEqual(['BB', 42, 44]);
    expect(rawSyncCall!.sql).not.toMatch(/MeasuredDBH|MeasuredHOM|Description|RawCodes/);
  });

  // --- Requirement 4: active-only error refresh/pending reset, no hard
  // DELETE expansion to sibling history --------------------------------

  it('refreshes ingestion errors for every attached member including the edited target itself, and resets pending for every active member, never issuing a DELETE against sibling history', async () => {
    const editedFields = effectiveFieldsRow({ CoreMeasurementID: 42 });
    const siblingFields = effectiveFieldsRow({ CoreMeasurementID: 43, StemTag: 'S-2', Quadrat: 'Q2', X: 5, Y: 6, DBH: 20, HOM: 2.1, Date: '2021-02-03' });
    const { cm, calls } = makeConnectionManager([
      ...replanRows({ measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 43 })] }),
      [{ CoreMeasurementID: 43, RawSpCode: 'AA' }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      // Ingestion-error refresh scope is `allMemberIDs`, not "siblings only"
      // — the edited measurement (42) is refreshed like every other member.
      [editedFields, siblingFields], // effective fields read, ascending CoreMeasurementID (42 then 43)
      [], // validation-occurrence UPDATE
      [], // pending reset
      [{ CoreMeasurementID: 43, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        activeMeasurementCount: 2,
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' }
        ]
      })
    };
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);

    // Exact per-member args for BOTH ids — not merely a call count — so a
    // regression that forwards the wrong row to the wrong member (e.g. 43's
    // values under 42's id) would fail this, not just a weaker "was it
    // called" check.
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenCalledTimes(2);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenNthCalledWith(1, cm, TEST_SCHEMA, 42, 7, expectedForwardedFields(editedFields), TX_ID);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenNthCalledWith(2, cm, TEST_SCHEMA, 43, 7, expectedForwardedFields(siblingFields), TX_ID);

    expect(calls.some(c => /^DELETE\b/i.test(c.sql))).toBe(false);
    const pendingResetCall = findPendingResetCall(calls);
    expect(pendingResetCall, `expected an IsValidated = NULL reset; got:\n${calls.map(c => c.sql).join('\n')}`).toBeDefined();
    expect(pendingResetCall!.sql).toContain('WHERE CoreMeasurementID IN (?, ?)');
    expect(pendingResetCall!.params).toEqual([42, 43]);
  });

  it('refreshes ingestion errors for an inactive sibling too (scope is every attached member), but excludes it from validation-occurrence resolution and the pending reset, both of which remain active-only', async () => {
    const editedFields = effectiveFieldsRow({ CoreMeasurementID: 42 });
    const inactiveSiblingFields = effectiveFieldsRow({
      CoreMeasurementID: 44,
      StemTag: 'S-2',
      Quadrat: 'Q2',
      X: 9,
      Y: 9,
      DBH: 30,
      HOM: 3.3,
      Date: '2022-03-04'
    });
    const { cm, calls } = makeConnectionManager([
      ...replanRows({
        stems: [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201, StemIsActive: 0 })],
        measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 44, StemGUID: 201, CoreIsActive: 0 })]
      }),
      [{ CoreMeasurementID: 44, RawSpCode: 'AA' }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      [editedFields, inactiveSiblingFields], // effective fields read for BOTH members (42 active, 44 inactive)
      [], // validation-occurrence UPDATE — active-only (42)
      [], // pending reset — active-only (42)
      [{ CoreMeasurementID: 44, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        inactiveStemCount: 1,
        inactiveMeasurementCount: 1,
        stems: [
          { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
          { stemGUID: 201, censusID: 7, quadratID: 9, isActive: false }
        ],
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: false, priorRawSpCode: 'AA' }
        ]
      })
    };
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);

    // Ingestion-error refresh covers EVERY attached member: an inactive
    // measurement's SpCode-derived findings are just as stale against the
    // new species as an active one's.
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenCalledTimes(2);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenNthCalledWith(1, cm, TEST_SCHEMA, 42, 7, expectedForwardedFields(editedFields), TX_ID);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenNthCalledWith(2, cm, TEST_SCHEMA, 44, 7, expectedForwardedFields(inactiveSiblingFields), TX_ID);

    // ...but the validation-occurrence resolution and the pending reset
    // remain active-only: the inactive id (44) is absent from both
    // statements' bind params, never merely "not the whole count".
    const validationUpdateCall = findSupportedValidationUpdateCall(calls);
    expect(validationUpdateCall, `expected a sitespecificvalidations-joined UPDATE; got:\n${calls.map(c => c.sql).join('\n')}`).toBeDefined();
    expect(validationUpdateCall!.params).toEqual([42, VALIDATION_ERROR_SOURCE, ...INGESTION_STAGE_ERROR_CODES]);
    const pendingResetCall = findPendingResetCall(calls);
    expect(pendingResetCall, `expected an IsValidated = NULL reset; got:\n${calls.map(c => c.sql).join('\n')}`).toBeDefined();
    expect(pendingResetCall!.sql).toContain('WHERE CoreMeasurementID IN (?)');
    expect(pendingResetCall!.params).toEqual([42]);
  });

  it("issues no sibling before/after reads when the edited measurement has no siblings, while the target's own affected-set finalization (RawSpCode sync, ingestion-error refresh, validation-occurrence resolution, pending reset) still runs", async () => {
    const { cm, calls } = makeConnectionManager([...replanRows(), [], [], [effectiveFieldsRow()], [], []]);
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    // 5 replan reads + trees UPDATE + RawSpCode sync UPDATE + effective-
    // fields read + validation-occurrence UPDATE + pending reset = 10; no
    // sibling before/after SELECTs because there are none to read. The
    // full affected-set finalization still runs over the lone edited
    // measurement itself.
    expect(calls).toHaveLength(10);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenCalledTimes(1);
  });

  // --- Requirement 5: complete, versioned before/after metadata ----------

  it("builds before/after metadata carrying the original PK, old/new species, and each member's prior/canonical RawSpCode (including NULL)", async () => {
    const { cm } = makeConnectionManager([
      ...replanRows({
        stems: [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201, StemIsActive: 0 })],
        measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 44, StemGUID: 201, CoreIsActive: 0, RawSpCode: null })]
      }),
      [{ CoreMeasurementID: 44, RawSpCode: null }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      [effectiveFieldsRow({ CoreMeasurementID: 42 }), effectiveFieldsRow({ CoreMeasurementID: 44 })], // effective fields read
      [], // validation-occurrence UPDATE — active-only (42)
      [], // pending reset — active-only (42)
      [{ CoreMeasurementID: 44, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        inactiveStemCount: 1,
        inactiveMeasurementCount: 1,
        stems: [
          { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
          { stemGUID: 201, censusID: 7, quadratID: 9, isActive: false }
        ],
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: false, priorRawSpCode: null }
        ]
      })
    };
    const result = await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);

    expect(result.metadataBeforeState.table).toBe(SPECIES_CORRECTION_METADATA_TABLE);
    expect(result.metadataBeforeState.primaryKey).toBe('TreeID');
    expect(result.metadataBeforeState.primaryKeyValue).toBe(100);
    expect(result.metadataBeforeState.row).toMatchObject({
      version: 1,
      operation: 'tree-species-correction',
      targetTreeID: 100,
      treeTag: 'T-100',
      speciesID: 1,
      speciesCode: 'AA'
    });
    const beforeMeasurements = (result.metadataBeforeState.row as any).measurements;
    expect(beforeMeasurements).toEqual([
      { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, rawSpCode: 'AA' },
      { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: false, rawSpCode: null }
    ]);

    expect(result.metadataAfterState.primaryKeyValue).toBe(100);
    expect(result.metadataAfterState.row).toMatchObject({ speciesID: 2, speciesCode: 'BB' });
    const afterMeasurements = (result.metadataAfterState.row as any).measurements;
    expect(afterMeasurements).toEqual([
      { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, rawSpCode: 'BB' },
      { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: false, rawSpCode: 'BB' }
    ]);
  });

  it('returns the locked, canonical correction (not the previewed one) as `correction`', async () => {
    const { cm } = makeConnectionManager([...replanRows({ measurements: [measurementRow()] }), [], [], [effectiveFieldsRow()], [], []]);
    const result = await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    expect(result.correction.newSpeciesCode).toBe('BB');
    expect(result.correction.targetTreeID).toBe(100);
  });

  it('embeds the caller-supplied domainDiff, and the explicit editedCoreMeasurementID/editedStemGUID, identically on both the before- and after-state metadata rows', async () => {
    const { cm } = makeConnectionManager([...replanRows(), [], [], [effectiveFieldsRow()], [], []]);
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: 10, after: 20 } },
      stems: {},
      attributeCodes: { before: [], after: [] }
    };
    const result = await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, { ...BASE_WRITE_INPUT, domainDiff }, TX_ID);

    for (const stateRow of [result.metadataBeforeState, result.metadataAfterState]) {
      expect((stateRow.row as any).editedCoreMeasurementID).toBe(42);
      expect((stateRow.row as any).editedStemGUID).toBe(200);
      expect((stateRow.row as any).domainDiff).toEqual(domainDiff);
    }
  });
});

// ---------------------------------------------------------------------------
// A validation UPDATE that is too PERMISSIVE (resolving an excluded
// ingestion-stage code, a 'MANAGER_OVERRIDE'/other code with no matching
// `sitespecificvalidations` row, a disabled/undefined rule, or reactivating
// an already-resolved occurrence) is a silent data-integrity regression no
// "was it called" assertion would ever catch — only asserting on the
// statement's own SQL text and params can. These tests exercise the full
// `writeTreeSpeciesCorrection` path so the SQL under test is exactly what
// production issues, not a hand-rebuilt string.
// ---------------------------------------------------------------------------
describe('supported-validation-occurrence resolution and pending reset', () => {
  it("the validation UPDATE's SQL excludes ingestion-stage codes '20'/'21' by name, keeps 'MANAGER_OVERRIDE' and any other code with no matching rule untouched, skips a disabled rule and an already-resolved occurrence; binds exactly the active ids plus ErrorSource and the excluded codes; never a DELETE", async () => {
    const editedFields = effectiveFieldsRow({ CoreMeasurementID: 42 });
    const siblingFields = effectiveFieldsRow({ CoreMeasurementID: 43 });
    const { cm, calls } = makeConnectionManager([
      ...replanRows({ measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 43 })] }),
      [{ CoreMeasurementID: 43, RawSpCode: 'AA' }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      [editedFields, siblingFields], // effective fields read
      [], // validation-occurrence UPDATE
      [], // pending reset
      [{ CoreMeasurementID: 43, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        activeMeasurementCount: 2,
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' }
        ]
      })
    };
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);

    const validationUpdateCall = findSupportedValidationUpdateCall(calls);
    expect(validationUpdateCall, `expected a sitespecificvalidations-joined UPDATE; got:\n${calls.map(c => c.sql).join('\n')}`).toBeDefined();
    const sql = validationUpdateCall!.sql;

    expect(sql).toMatch(/^UPDATE\b/i);
    // Ingestion-stage codes ('20'/'21') are excluded explicitly by name
    // (NOT IN), not by assuming they fail the join. 'MANAGER_OVERRIDE' or
    // any other code with no matching `sitespecificvalidations` row fails
    // the INNER JOIN itself and is never touched — regardless of ErrorSource.
    expect(sql).toContain('JOIN');
    expect(sql).toContain('sitespecificvalidations ssv');
    expect(sql).toContain('ON me.ErrorCode = CAST(ssv.ValidationID AS CHAR) COLLATE utf8mb4_0900_ai_ci');
    expect(sql).toContain('SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()');
    // Scoped to exactly the active member ids, not every attached member.
    expect(sql).toContain('MeasurementID IN (?, ?)');
    // Only validation-source rows are even candidates — an ingestion-source
    // row with the same ErrorCode coincidentally matching a ValidationID is
    // never resolved by this statement.
    expect(sql).toContain('me.ErrorSource = ?');
    // An already-resolved occurrence's ResolvedAt/history is never
    // rewritten, and nothing already resolved is ever flipped back to
    // unresolved (no reactivation).
    expect(sql).toContain('mel.IsResolved = FALSE');
    // A rule that is disabled, or has no runnable Definition, can never
    // recompute its own finding — so nothing resolves it even though the
    // join itself matched.
    expect(sql).toContain('ssv.IsEnabled = 1');
    expect(sql).toContain("TRIM(COALESCE(ssv.Definition, '')) <> ''");

    expect(validationUpdateCall!.params).toEqual([42, 43, VALIDATION_ERROR_SOURCE, ...INGESTION_STAGE_ERROR_CODES]);
    expect(
      calls.some(c => /^DELETE\b/i.test(c.sql)),
      `expected no DELETE anywhere; got:\n${calls.map(c => c.sql).join('\n')}`
    ).toBe(false);
  });

  it('issues no DELETE statement anywhere in a correction touching an active sibling AND an inactive sibling together', async () => {
    const { cm, calls } = makeConnectionManager([
      ...replanRows({
        stems: [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201 }), stemRow({ StemGUID: 202, StemIsActive: 0 })],
        measurements: [
          measurementRow(),
          measurementRow({ CoreMeasurementID: 43, StemGUID: 201 }),
          measurementRow({ CoreMeasurementID: 44, StemGUID: 202, CoreIsActive: 0 })
        ]
      }),
      [
        { CoreMeasurementID: 43, RawSpCode: 'AA' },
        { CoreMeasurementID: 44, RawSpCode: 'AA' }
      ], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      [effectiveFieldsRow({ CoreMeasurementID: 42 }), effectiveFieldsRow({ CoreMeasurementID: 43 }), effectiveFieldsRow({ CoreMeasurementID: 44 })], // effective fields read
      [], // validation-occurrence UPDATE
      [], // pending reset
      [
        { CoreMeasurementID: 43, RawSpCode: 'BB' },
        { CoreMeasurementID: 44, RawSpCode: 'BB' }
      ] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        // 3 stems (2 active, 1 inactive) — unlike every other scenario in
        // this file, which leaves `stems`/`activeStemCount` at `previewed`'s
        // single-active-stem default because they only ever add siblings on
        // the SAME stem. `findSpeciesCorrectionDrift` compares
        // activeStemCount/inactiveStemCount against the locked re-read too,
        // so both must be overridden here or this test would fail with a
        // spurious drift conflict rather than exercising the DELETE check.
        activeStemCount: 2,
        inactiveStemCount: 1,
        activeMeasurementCount: 2,
        inactiveMeasurementCount: 1,
        stems: [
          { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
          { stemGUID: 201, censusID: 7, quadratID: 9, isActive: true },
          { stemGUID: 202, censusID: 7, quadratID: 9, isActive: false }
        ],
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 43, stemGUID: 201, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 44, stemGUID: 202, censusID: 7, isActive: false, priorRawSpCode: 'AA' }
        ]
      })
    };
    await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);
    expect(
      calls.some(c => /^DELETE\b/i.test(c.sql)),
      `expected no DELETE anywhere; got:\n${calls.map(c => c.sql).join('\n')}`
    ).toBe(false);
  });

  it("propagates `errorRefresh` on the full write result: resolvedValidationOccurrenceCount reflects the UPDATE's own affectedRows (not a count this module invents), pendingMeasurementIDs is exactly the active ids, ingestionRefreshedMeasurementIDs is exactly what the effective-fields read returned", async () => {
    const { cm } = makeConnectionManager([
      ...replanRows({ measurements: [measurementRow(), measurementRow({ CoreMeasurementID: 43 })] }),
      [{ CoreMeasurementID: 43, RawSpCode: 'AA' }], // sibling before
      [], // trees UPDATE
      [], // RawSpCode sync UPDATE
      [effectiveFieldsRow({ CoreMeasurementID: 42 }), effectiveFieldsRow({ CoreMeasurementID: 43 })], // effective fields read
      { affectedRows: 1 }, // validation-occurrence UPDATE — only 1 of the 2 active ids actually had a resolvable occurrence
      [], // pending reset
      [{ CoreMeasurementID: 43, RawSpCode: 'BB' }] // sibling after
    ]);
    const input = {
      ...BASE_WRITE_INPUT,
      previewedCorrection: previewed({
        activeMeasurementCount: 2,
        measurements: [
          { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
          { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' }
        ]
      })
    };
    const result = await writeTreeSpeciesCorrection(cm, TEST_SCHEMA, input, TX_ID);
    expect(result.errorRefresh.resolvedValidationOccurrenceCount).toBe(1);
    expect(result.errorRefresh.pendingMeasurementIDs).toEqual([42, 43]);
    expect(result.errorRefresh.ingestionRefreshedMeasurementIDs).toEqual([42, 43]);
  });
});

// ---------------------------------------------------------------------------
// Direct unit tests of the exported `refreshCorrectionErrorsAndValidationPending`
// — no replan, no trees/RawSpCode UPDATE, no metadata. Isolates its own
// three-statement contract (ingestion refresh over `allMemberIDs`,
// validation-occurrence resolution + pending reset over `activeMemberIDs`
// only) from everything `applyPreparedTreeSpeciesCorrection` wraps it in.
// ---------------------------------------------------------------------------
describe('refreshCorrectionErrorsAndValidationPending (direct unit tests)', () => {
  it("stamps the caller's transactionID on every statement it issues", async () => {
    const { cm, calls } = makeConnectionManager([[effectiveFieldsRow({ CoreMeasurementID: 42 })], [], []]);
    await refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [42], [42], TX_ID);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.transactionID).toBe(TX_ID);
    }
  });

  it('issues no sitespecificvalidations UPDATE and no IsValidated reset — and never degenerates to an `IN ()` — when activeMemberIDs is empty, even though allMemberIDs is not', async () => {
    const { cm, calls } = makeConnectionManager([[effectiveFieldsRow({ CoreMeasurementID: 44 })]]);
    const result = await refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [44], [], TX_ID);
    expect(result.resolvedValidationOccurrenceCount).toBe(0);
    expect(result.pendingMeasurementIDs).toEqual([]);
    // Only the effective-fields read — no validation UPDATE, no pending
    // reset — proving the guard actually skips the statement rather than
    // issuing it with an empty (and invalid) `IN ()`.
    expect(calls, `expected exactly 1 call (the effective-fields read only); got:\n${calls.map(c => c.sql).join('\n')}`).toHaveLength(1);
    expect(calls.some(c => /IN\s*\(\s*\)/.test(c.sql))).toBe(false);
  });

  it('issues no effective-fields read and calls refreshIngestionErrorsForMeasurement zero times when allMemberIDs is empty', async () => {
    const { cm, calls } = makeConnectionManager([]);
    const result = await refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [], [], TX_ID);
    expect(result.ingestionRefreshedMeasurementIDs).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(refreshIngestionErrorsForMeasurementMock).not.toHaveBeenCalled();
  });

  it("counts/ids reflect actual values, not invented ones: ingestionRefreshedMeasurementIDs from the effective-fields read, resolvedValidationOccurrenceCount from the UPDATE's own affectedRows, pendingMeasurementIDs exactly activeMemberIDs", async () => {
    const { cm } = makeConnectionManager([
      [effectiveFieldsRow({ CoreMeasurementID: 42 }), effectiveFieldsRow({ CoreMeasurementID: 43 })], // effective fields read
      { affectedRows: 2 }, // validation-occurrence UPDATE
      [] // pending reset
    ]);
    const result = await refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [42, 43], [42, 43], TX_ID);
    expect(result.ingestionRefreshedMeasurementIDs).toEqual([42, 43]);
    expect(result.resolvedValidationOccurrenceCount).toBe(2);
    expect(result.pendingMeasurementIDs).toEqual([42, 43]);
    expect(refreshIngestionErrorsForMeasurementMock).toHaveBeenCalledTimes(2);
  });

  it('propagates a thrown SQL error from the validation-occurrence UPDATE unchanged — never swallowed, never translated', async () => {
    const dbError = new Error('Lock wait timeout exceeded');
    const effectiveRows = [effectiveFieldsRow({ CoreMeasurementID: 42 })];
    let effectiveReadConsumed = false;
    const executeQuery = vi.fn(async (sql: string) => {
      if (sql.includes('sitespecificvalidations')) throw dbError;
      if (!effectiveReadConsumed) {
        effectiveReadConsumed = true;
        return effectiveRows;
      }
      return [];
    });
    const cm = { executeQuery } as unknown as ConnectionManager;
    await expect(refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [42], [42], TX_ID)).rejects.toBe(dbError);
  });

  it('excludes INGESTION_STAGE_ERROR_CODES from the validation-occurrence UPDATE by code, not by an assumed-missing join row', async () => {
    const { cm, calls } = makeConnectionManager([[effectiveFieldsRow({ CoreMeasurementID: 42 })], [], []]);
    await refreshCorrectionErrorsAndValidationPending(cm, TEST_SCHEMA, 7, [42], [42], TX_ID);

    const validationUpdateCall = findSupportedValidationUpdateCall(calls);
    expect(validationUpdateCall, `expected a sitespecificvalidations-joined UPDATE; got:\n${calls.map(c => c.sql).join('\n')}`).toBeDefined();
    // Removing the NOT IN exclusion would make this assertion fail even
    // though the surrounding predicates are unchanged.
    expect(validationUpdateCall!.sql).toContain('AND me.ErrorCode NOT IN');
    expect(validationUpdateCall!.params).toEqual(expect.arrayContaining([...INGESTION_STAGE_ERROR_CODES]));
  });
});

// ---------------------------------------------------------------------------
// Two-phase API: `prepareTreeSpeciesCorrection` (read-only) must run — and
// capture its result — before the caller's own first write; a later
// `applyPreparedTreeSpeciesCorrection` must consume that exact result
// verbatim, never re-planning, and must refuse a prepared result captured
// under a different transaction. `writeTreeSpeciesCorrection` above is just
// prepare()+apply() back-to-back, so these cases are new, not duplicates of
// the suite above.
// ---------------------------------------------------------------------------
describe('prepareTreeSpeciesCorrection / applyPreparedTreeSpeciesCorrection (two-phase API)', () => {
  it("prepare() issues only the 5 locked replan reads — no write of any kind — and captures the edited measurement's own pre-mutation RawSpCode; apply() then consumes that prepared snapshot verbatim, so a write the caller makes to the same row in between is never re-observed (no self-induced drift)", async () => {
    const rows = replanRows(); // single edited measurement, no siblings
    const calls: Array<{ sql: string }> = [];
    let callIndex = 0;
    const executeQuery = vi.fn(async (sql: string) => {
      calls.push({ sql });
      const result = callIndex < rows.length ? rows[callIndex] : [];
      callIndex++;
      return result;
    });
    const cm = { executeQuery } as unknown as ConnectionManager;

    const prepared = await prepareTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    expect(calls).toHaveLength(5);
    expect(calls.every(c => !/^(UPDATE|INSERT|DELETE)\b/i.test(c.sql))).toBe(true);
    expect(prepared.transactionID).toBe(TX_ID);
    expect(prepared.correction.measurements[0].priorRawSpCode).toBe('AA');

    // Simulate the caller's own generic Raw* sync overwriting the edited
    // row's RawSpCode between prepare() and apply() — `prepared` must not
    // be affected by this, since apply() never re-plans.
    await cm.executeQuery(
      `/* caller's own write, outside this module */ UPDATE \`${TEST_SCHEMA}\`.coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?`,
      ['aa', 42],
      TX_ID
    );

    const applied = await applyPreparedTreeSpeciesCorrection(cm, TEST_SCHEMA, prepared, TX_ID);
    const { metadataBeforeState, metadataAfterState } = buildSpeciesCorrectionMetadataStateRows(
      applied.correction,
      prepared.editedCoreMeasurementID,
      prepared.editedStemGUID,
      EMPTY_SPECIES_CORRECTION_DOMAIN_DIFF
    );
    expect((metadataBeforeState.row as any).measurements[0]).toEqual({ coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, rawSpCode: 'AA' });
    expect((metadataAfterState.row as any).measurements[0]).toEqual({ coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, rawSpCode: 'BB' });
  });

  it('rejects applying a prepared correction under a different transaction than the one that captured it', async () => {
    const { cm } = makeConnectionManager(replanRows());
    const prepared = await prepareTreeSpeciesCorrection(cm, TEST_SCHEMA, BASE_WRITE_INPUT, TX_ID);
    await expect(applyPreparedTreeSpeciesCorrection(cm, TEST_SCHEMA, prepared, 'tx-other-transaction')).rejects.toBeInstanceOf(
      SpeciesCorrectionTransactionMismatchError
    );
    await applyPreparedTreeSpeciesCorrection(cm, TEST_SCHEMA, prepared, 'tx-other-transaction').catch(error => {
      expect(error.preparedTransactionID).toBe(TX_ID);
      expect(error.applyTransactionID).toBe('tx-other-transaction');
    });
  });

  it('buildSpeciesCorrectionMetadataStateRows: the same domainDiff and editedCoreMeasurementID/editedStemGUID are embedded identically on both the before- and after-state rows it returns, given only a correction and a pre-built domainDiff (no DB, no apply)', () => {
    const domainDiff = {
      coremeasurements: { MeasuredDBH: { before: 10, after: 20 } },
      stems: {},
      attributeCodes: { before: ['A'], after: ['A', 'B'] }
    };
    const correction = previewed();

    const { metadataBeforeState, metadataAfterState } = buildSpeciesCorrectionMetadataStateRows(correction, 42, 200, domainDiff);

    for (const stateRow of [metadataBeforeState, metadataAfterState]) {
      expect(stateRow.table).toBe(SPECIES_CORRECTION_METADATA_TABLE);
      expect(stateRow.primaryKeyValue).toBe(100);
      expect((stateRow.row as any).editedCoreMeasurementID).toBe(42);
      expect((stateRow.row as any).editedStemGUID).toBe(200);
      expect((stateRow.row as any).domainDiff).toEqual(domainDiff);
    }
    expect((metadataBeforeState.row as any).speciesCode).toBe('AA');
    expect((metadataAfterState.row as any).speciesCode).toBe('BB');
  });
});

// ---------------------------------------------------------------------------
// `prepareTreeSpeciesCorrection`'s locked replan only verifies the
// species/membership preconditions `planSpeciesCorrection` itself returns.
// `assertNoEditedFieldDriftForSpeciesCorrection` closes the gap it leaves
// open: a stale `from` on some OTHER field (MeasuredDBH, StemLocalX,
// Description, Attributes, ...) the user edited in the same submit must
// never silently overwrite another user's committed change. It is a pure
// function — no ConnectionManager, no `makeConnectionManager` stub needed —
// so these assert directly on its return/throw behavior for real,
// independently-constructed `FieldChange` inputs, never on "was it called".
// ---------------------------------------------------------------------------
describe('assertNoEditedFieldDriftForSpeciesCorrection', () => {
  it("throws a drift conflict when an edited field's previewed `from` no longer matches its locked current value", () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: 10, to: 20 }];
    const lockedCurrent = { MeasuredDBH: 15 }; // someone else committed 10 -> 15 after this edit was previewed
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrowError(SpeciesCorrectionWriteConflictError);
    try {
      assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent);
      throw new Error('expected assertNoEditedFieldDriftForSpeciesCorrection to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SpeciesCorrectionWriteConflictError);
      expect((error as SpeciesCorrectionWriteConflictError).reason).toMatchObject({ kind: 'drift' });
    }
  });

  it('allows a concurrent change to a field the user did NOT edit — only fields present in fieldChanges are ever checked', () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: 10, to: 20 }]; // MeasuredDBH itself matches
    const lockedCurrent = {
      MeasuredDBH: 10,
      StemLocalX: 999 // changed concurrently by someone else, but never edited by THIS user -> must not be checked
    };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it('does not report drift for a MeasurementDate Date object vs. a date-only string referring to the same calendar day', () => {
    const fieldChanges = [{ field: 'MeasurementDate', from: new Date('2026-01-02T00:00:00.000Z'), to: '2026-01-03' }];
    const lockedCurrent = { MeasurementDate: '2026-01-02' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it('does report drift for a MeasurementDate whose locked current calendar day genuinely differs', () => {
    const fieldChanges = [{ field: 'MeasurementDate', from: new Date('2026-01-02T00:00:00.000Z'), to: '2026-01-03' }];
    const lockedCurrent = { MeasurementDate: '2026-02-09' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('does not report drift for a DECIMAL field whose stored trailing-zero string differs only in formatting (12.30 vs 12.300)', () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: '12.30', to: '15.00' }];
    const lockedCurrent = { MeasuredDBH: '12.300' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it("does not report drift for the mysql2 driver DECIMAL-string shape ('3.500000') vs the plan's own JS number (3.5) on a real DECIMAL(..,2) column (MeasuredDBH, per PER_COLUMN_DECIMAL_PRECISION in fieldpolicy.ts)", () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: 3.5, to: 4.2 }];
    const lockedCurrent = { MeasuredDBH: '3.500000' }; // what mysql2 actually returns for a DECIMAL column
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  // Attributes drift is compared RAW-to-RAW (previewed `from` vs the locked
  // `current.Attributes`, which is `cm.RawCodes`), never against a
  // materialized `cmattributes` association set: an as-uploaded code that
  // never resolved to a `cmattributes` row (e.g. an unrecognized "UNKNOWN")
  // is part of the raw string on both sides and must NOT be reported as
  // drift merely because the materialized set omits it.
  it('does not report drift for an unresolved raw Attributes code (e.g. "A;UNKNOWN") when the locked current RAW value is byte-identical, even though no cmattributes row was ever materialized for "UNKNOWN"', () => {
    const fieldChanges = [{ field: 'Attributes', from: 'A;UNKNOWN', to: 'A;B' }];
    const lockedCurrent = { Attributes: 'A;UNKNOWN' }; // the locked cm.RawCodes — materialized cmattributes only ever held "A"
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it('reports drift for a genuine raw Attributes change: previewed "A" vs locked current raw "A;M"', () => {
    const fieldChanges = [{ field: 'Attributes', from: 'A', to: 'A;B' }];
    const lockedCurrent = { Attributes: 'A;M' }; // someone else added "M" to the raw string after this edit was previewed
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('reports drift for a genuine raw Attributes change: previewed NULL vs locked current raw "A"', () => {
    const fieldChanges = [{ field: 'Attributes', from: null, to: 'A;B' }];
    const lockedCurrent = { Attributes: 'A' }; // someone else set a raw code after this edit was previewed against a NULL row
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('ignores SpeciesCode divergence entirely — that precondition belongs to the locked replan, not this guard', () => {
    const fieldChanges = [{ field: 'SpeciesCode', from: 'AA', to: 'BB' }];
    // No SpeciesCode entry in lockedCurrentFieldValues at all, and the value
    // if it were checked would obviously "drift" — this guard must never
    // even look at it.
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, {})).not.toThrow();
  });

  // This guard uses the stored-precision comparison on raw column values,
  // not an invented "blank-equivalent" normalization. A stored `null` and a
  // stored `''` are genuinely different column states (NULL vs empty
  // string) and must drift; so must a change to the literal text `'NULL'`.

  it('reports drift for a stored "NULL" vs a stored "null" — these are different stored strings, not equivalent clears', () => {
    const fieldChanges = [{ field: 'Description', from: 'NULL', to: 'new comment' }];
    const lockedCurrent = { Description: 'null' }; // different literal string under lock
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it("reports drift for a stored `null` vs a stored empty string `''` — NULL and empty string are different stored states", () => {
    const fieldChanges = [{ field: 'Description', from: null, to: 'new comment' }];
    const lockedCurrent = { Description: '' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('reports drift for a whitespace-only difference: previewed "abc" vs locked current "abc " (trailing space)', () => {
    const fieldChanges = [{ field: 'Description', from: 'abc', to: 'new comment' }];
    const lockedCurrent = { Description: 'abc ' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('does not report drift when both the previewed `from` and the locked current value are `null`', () => {
    const fieldChanges = [{ field: 'Description', from: null, to: 'new comment' }];
    const lockedCurrent = { Description: null };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it('names only the plan-level field in its error message and never leaks a raw SQL column, table alias, or SQL keyword', () => {
    const fieldChanges = [{ field: 'StemLocalX', from: 10.5, to: 20.5 }];
    const lockedCurrent = { StemLocalX: 99.9 };
    try {
      assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent);
      throw new Error('expected assertNoEditedFieldDriftForSpeciesCorrection to throw');
    } catch (error) {
      const message = (error as SpeciesCorrectionWriteConflictError).message;
      expect(message).toContain('StemLocalX');
      expect(message).not.toMatch(/\bs\.LocalX\b/);
      expect(message).not.toMatch(/\bRawX\b/);
      expect(message).not.toMatch(/\bcm\./);
      expect(message).not.toMatch(/\bSELECT\b|\bUPDATE\b|\bFROM\b|\bWHERE\b/i);
    }
  });

  // F31 regression: MeasuredDBH/MeasuredHOM/StemLocalX/StemLocalY are
  // DECIMAL(12,6) columns, but PER_COLUMN_DECIMAL_PRECISION rounds them to 2
  // for UI/analyzer diffing. This guard compares against a LOCKED, freshly
  // re-read current row, so it must catch a concurrent write below that
  // UI-rounding precision instead of reporting "no change".
  it('reports drift for a MeasuredDBH change below UI-rounding precision: previewed 10.000000 vs locked current 10.000001', () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: 10.0, to: 12.0 }];
    const lockedCurrent = { MeasuredDBH: '10.000001' }; // committed by another writer after this edit was previewed
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('reports drift for a StemLocalX change below UI-rounding precision: previewed 5.000000 vs locked current 5.000001', () => {
    const fieldChanges = [{ field: 'StemLocalX', from: 5.0, to: 6.0 }];
    const lockedCurrent = { StemLocalX: '5.000001' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('reports drift for a MeasuredHOM change below UI-rounding precision: previewed 1.300000 vs locked current 1.300002', () => {
    const fieldChanges = [{ field: 'MeasuredHOM', from: 1.3, to: 1.5 }];
    const lockedCurrent = { MeasuredHOM: '1.300002' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).toThrow(SpeciesCorrectionWriteConflictError);
  });

  it('does not report drift for the mysql2 DECIMAL-string shape at full stored precision: previewed 10 vs locked current "10.000000"', () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: 10, to: 12 }];
    const lockedCurrent = { MeasuredDBH: '10.000000' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  it('does not report drift for a numeric-string vs number at full stored precision: previewed "3.500000" vs locked current 3.5', () => {
    const fieldChanges = [{ field: 'MeasuredDBH', from: '3.500000', to: 4.2 }];
    const lockedCurrent = { MeasuredDBH: 3.5 };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });

  // A non-numeric field has no entry in PER_COLUMN_DECIMAL_PRECISION, so the
  // stored-precision comparison must never coerce it to a number — exact
  // raw-string semantics, identical to the default fieldChanged path.
  it('does not report drift for a non-numeric field whose locked current raw string is byte-identical to the previewed value', () => {
    const fieldChanges = [{ field: 'Description', from: 'same comment', to: 'new comment' }];
    const lockedCurrent = { Description: 'same comment' };
    expect(() => assertNoEditedFieldDriftForSpeciesCorrection(fieldChanges, lockedCurrent)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// `buildSpeciesCorrectionDomainDiff` is the pure, DB-free undo-evidence
// builder `writers/measurementssummary.ts` calls before
// `applyPreparedTreeSpeciesCorrection`. Tested directly, independent of any
// ConnectionManager stub, against the exact fixed allowlist (#427): only an
// allowlisted column that actually changed appears, NULL is never coerced
// on either side, and attributeCodes is always present.
// ---------------------------------------------------------------------------
describe('buildSpeciesCorrectionDomainDiff (pure undo-diff builder)', () => {
  it('includes only an allowlisted coremeasurements column whose stored value actually changed, omitting every unchanged allowlisted column entirely', () => {
    const unchanged = {
      MeasuredHOM: 1.3,
      MeasurementDate: '2020-01-01',
      Description: 'd',
      RawComments: 'd',
      RawCodes: 'A',
      RawX: 1,
      RawY: 2,
      RawPlotX: 3,
      RawPlotY: 4
    };
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { MeasuredDBH: 10, ...unchanged },
      afterCoreMeasurement: { MeasuredDBH: 20, ...unchanged },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements).toEqual({ MeasuredDBH: { before: 10, after: 20 } });
  });

  it('includes an allowlisted stems column (LocalX) only when it actually changed, leaving an unchanged sibling column (LocalY) out entirely', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: { LocalX: 10, LocalY: 20, PlotX: 1, PlotY: 2 },
      afterStem: { LocalX: 99, LocalY: 20, PlotX: 1, PlotY: 2 },
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.stems).toEqual({ LocalX: { before: 10, after: 99 } });
  });

  it('preserves a NULL before value exactly — never coerced to empty string or 0 — on a genuinely changed column', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { Description: null },
      afterCoreMeasurement: { Description: 'new comment' },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements.Description).toEqual({ before: null, after: 'new comment' });
  });

  it('never includes a derived/bookkeeping column or SpeciesID/RawSpCode, even when present (and differing) on the input rows — only the fixed allowlist is ever consulted', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { IsValidated: null, SpeciesID: 1, RawSpCode: 'AA' },
      afterCoreMeasurement: { IsValidated: 1, SpeciesID: 2, RawSpCode: 'BB' },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements).toEqual({});
  });

  it('omits every stems entry when the edited row has no stem (before/afterStem both null) — no LocalX/Y/PlotX/Y diff is possible without one', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.stems).toEqual({});
  });

  it('always includes attributeCodes, even when both sides are the identical empty array — a provably empty set, never "missing"', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.attributeCodes).toEqual({ before: [], after: [] });
  });

  it('copies a genuine attribute-code change verbatim, codes only, never a CMAID', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: ['A'],
      attributeCodesAfter: ['A', 'B']
    });
    expect(diff.attributeCodes).toEqual({ before: ['A'], after: ['A', 'B'] });
  });

  it('reports a populated-to-empty attribute-code change (every code removed), not an omitted/defaulted-to-before set', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: ['A', 'B'],
      attributeCodesAfter: []
    });
    expect(diff.attributeCodes).toEqual({ before: ['A', 'B'], after: [] });
  });

  it('reports a reordered-but-identical attribute-code set verbatim in its given order, rather than treating it as unchanged and rewriting it to match "before"', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: ['A', 'B'],
      attributeCodesAfter: ['B', 'A']
    });
    expect(diff.attributeCodes).toEqual({ before: ['A', 'B'], after: ['B', 'A'] });
  });

  // Stored-column normalization regression: a DECIMAL(12,6) column (mapped
  // here to StemPlotX via SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD)
  // round-trips through mysql2 as a string, and must compare equal to a JS
  // number at that column's own precision rather than fabricate a diff.

  it("does not diff a DECIMAL-mapped coremeasurements column when the stored string and the JS number round to the same value at that column's own precision (RawPlotX -> StemPlotX, precision 6)", () => {
    expect(SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD.RawPlotX).toBe('StemPlotX');
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { RawPlotX: '1.123457' },
      afterCoreMeasurement: { RawPlotX: 1.123457 },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements).toEqual({});
  });

  it('reports the actual persisted after-value verbatim on a genuine change — never a value this builder was not given, such as an unrounded write request', () => {
    const PERSISTED_AFTER_VALUE = '1.123457';
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { RawPlotX: 2 },
      afterCoreMeasurement: { RawPlotX: PERSISTED_AFTER_VALUE },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements).toEqual({ RawPlotX: { before: 2, after: PERSISTED_AFTER_VALUE } });
  });

  it('omits a coremeasurements column entirely when both before and after are NULL, rather than reporting a false before:null/after:null entry', () => {
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: { Description: null },
      afterCoreMeasurement: { Description: null },
      beforeStem: null,
      afterStem: null,
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.coremeasurements).toEqual({});
  });

  it("does not diff a DECIMAL-mapped stems column when the stored string and the JS number round to the same value at that column's own precision (LocalY -> StemLocalY, precision 2)", () => {
    expect(SPECIES_CORRECTION_STORED_COLUMN_COMPARISON_FIELD.LocalY).toBe('StemLocalY');
    const diff = buildSpeciesCorrectionDomainDiff({
      beforeCoreMeasurement: {},
      afterCoreMeasurement: {},
      beforeStem: { LocalX: 1, LocalY: '20.00', PlotX: 1, PlotY: 1 },
      afterStem: { LocalX: 1, LocalY: 20, PlotX: 1, PlotY: 1 },
      attributeCodesBefore: [],
      attributeCodesAfter: []
    });
    expect(diff.stems).toEqual({});
  });
});
