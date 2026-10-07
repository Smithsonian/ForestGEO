import { describe, it, expect, vi } from 'vitest';
import { planSpeciesCorrection, SpeciesCorrectionLockingRequiresTransactionError } from './tree-species-correction';
import type { PlanSpeciesCorrectionInput } from './tree-species-correction';
import type ConnectionManager from '@/lib/db/connectionmanager';

// ---------------------------------------------------------------------------
// Minimal ConnectionManager stub: returns caller-supplied rows in call order
// and records the exact SQL text + bound params for every call so tests can
// assert on query shape (FOR UPDATE presence, flat IN-clause placeholders,
// deterministic ORDER BY) without re-deriving the SQL from memory. Throws on
// any call beyond the provided row sequence instead of silently returning an
// empty array — a planner bug that issues one more (or fewer) query than
// expected must fail loudly, not be masked by a permissive stub.
// ---------------------------------------------------------------------------
function makeConnectionManager(rowSequence: unknown[][]) {
  let callIndex = 0;
  const calls: Array<{ sql: string; params: unknown[]; transactionID: string | undefined }> = [];
  const executeQuery = vi.fn(async (sql: string, params: unknown[], transactionID?: string) => {
    if (callIndex >= rowSequence.length) {
      throw new Error(`Unexpected executeQuery call #${callIndex + 1} (only ${rowSequence.length} row-sequence entries provided). SQL: ${sql}`);
    }
    const rows = rowSequence[callIndex];
    calls.push({ sql, params, transactionID });
    callIndex++;
    return rows;
  });
  return { cm: { executeQuery } as unknown as ConnectionManager, calls };
}

const TEST_SCHEMA = 'forestgeo_test';

// Query order when every check passes: source tree -> destination species ->
// destination collision -> stems -> measurements.
const BASE_INPUT: PlanSpeciesCorrectionInput = {
  treeID: 100,
  plotID: 3,
  censusID: 7,
  newSpeciesID: 2,
  editedStemGUID: 200,
  editedCoreMeasurementID: 42
};

function sourceTreeRow(overrides: Record<string, unknown> = {}) {
  return {
    TreeID: 100,
    TreeTag: 'T-100',
    SpeciesID: 1,
    CensusID: 7,
    TreeIsActive: 1,
    PlotID: 3,
    OldSpeciesCode: 'AA',
    ...overrides
  };
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

describe('planSpeciesCorrection', () => {
  // --- Source tree validation ---

  it('returns source_missing when no tree row matches TreeID/CensusID', async () => {
    const { cm, calls } = makeConnectionManager([[]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_missing' });
    if (result.status === 'source_missing') {
      expect(result.message).toContain('100');
      expect(result.message).toContain('7');
    }
    expect(calls).toHaveLength(1);
  });

  it('returns source_missing (not a plot-identity leak) when the tree exists but its census belongs to a different plot', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow({ PlotID: 999 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result.status).toBe('source_missing');
  });

  it('returns source_inactive with the tree ID when the matching tree is inactive', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow({ TreeIsActive: 0 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_inactive', treeID: 100 });
    if (result.status === 'source_inactive') {
      expect(result.message).toContain('T-100');
    }
  });

  // --- Same resolved SpeciesID: no-op, checked before any destination query ---

  it("returns no_correction (not a destination collision against itself) when newSpeciesID equals the source tree's own current SpeciesID", async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, { ...BASE_INPUT, newSpeciesID: 1 });
    expect(result.status).toBe('no_correction');
    // Only the source tree was read — no destination species/collision query.
    expect(calls).toHaveLength(1);
  });

  // --- Destination species: re-read by ID, canonical code, active required ---

  it('returns destination_species_missing when newSpeciesID no longer names any species row', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], []]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_species_missing' });
    if (result.status === 'destination_species_missing') expect(result.message).toContain('2');
    expect(calls).toHaveLength(2);
  });

  it('returns destination_species_inactive with the speciesID when the destination species has been deactivated', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow({ IsActive: 0 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_species_inactive', speciesID: 2 });
    expect(calls).toHaveLength(2);
  });

  it('reads the canonical SpeciesCode from the species table rather than trusting a caller-supplied spelling', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow({ SpeciesCode: 'BB' })], [], [stemRow()], [measurementRow()]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.correction.newSpeciesCode).toBe('BB');
  });

  // --- Destination collision ---

  it('returns destination_exists (active) without merging when a tree already owns (TreeTag, newSpeciesID, CensusID)', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [{ TreeID: 555, IsActive: 1 }]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_exists', destinationTreeID: 555, destinationIsActive: true });
  });

  it('returns destination_exists (inactive) when the colliding destination tree is itself inactive', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [{ TreeID: 556, IsActive: 0 }]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_exists', destinationTreeID: 556, destinationIsActive: false });
  });

  // --- Membership scope integrity: enumerated by TreeID/StemGUID, no
  // CensusID filter — inconsistencies are reported, never silently filtered ---

  it('returns scope_inconsistent (not a filtered result) when an attached stem belongs to a different census than the tree', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow({ StemCensusID: 8 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'scope_inconsistent', treeID: 100 });
    expect(calls).toHaveLength(4);
  });

  it('returns scope_inconsistent when a stem has no quadrat link at all (QuadratID is null)', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow({ QuadratID: null, QuadratPlotID: null })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'scope_inconsistent', treeID: 100 });
  });

  it('returns scope_inconsistent when an attached stem belongs to a quadrat outside the requested plot', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow({ QuadratPlotID: 999 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'scope_inconsistent', treeID: 100 });
  });

  it('returns scope_inconsistent when an attached measurement belongs to a different census than the tree', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow({ MeasurementCensusID: 8 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'scope_inconsistent', treeID: 100 });
    expect(calls).toHaveLength(5);
  });

  // --- Edited stem/measurement membership: the row actually being edited
  // must be present in that exact tree and active ---

  it("returns edited_stem_missing when the edited stem is not among this tree's attached stems", async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow({ StemGUID: 201 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT); // editedStemGUID: 200, not present
    expect(result).toMatchObject({ status: 'edited_stem_missing' });
    // No measurement query is issued once the edited stem can't be found.
    expect(calls).toHaveLength(4);
  });

  it('returns edited_stem_inactive with the stemGUID when the edited stem is attached but inactive', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow({ StemIsActive: 0 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'edited_stem_inactive', stemGUID: 200 });
    expect(calls).toHaveLength(4);
  });

  it("returns edited_measurement_missing when the edited measurement is not among this tree's attached measurements", async () => {
    const { cm, calls } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      [stemRow()],
      [measurementRow({ CoreMeasurementID: 99 })] // not editedCoreMeasurementID: 42
    ]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'edited_measurement_missing' });
    expect(calls).toHaveLength(5);
  });

  it('returns edited_measurement_inactive with the coreMeasurementID when the edited measurement is attached but inactive', async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow({ CoreIsActive: 0 })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'edited_measurement_inactive', coreMeasurementID: 42 });
  });

  // --- F8: the edited CM must be attached to the exact previewed stem, not
  // merely some stem on the tree. Two siblings share the same editedStemGUID
  // (200, active) and editedCoreMeasurementID (42), but 42 actually lives on
  // sibling 201 (inactive) — its link moved after the plan/preview was read. ---

  it('returns edited_measurement_moved (not a silent success) when the edited CoreMeasurementID is now attached to an inactive sibling stem instead of the previewed active stem', async () => {
    const { cm, calls } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      [stemRow({ StemGUID: 200, StemIsActive: 1 }), stemRow({ StemGUID: 201, StemIsActive: 0 })],
      [measurementRow({ CoreMeasurementID: 42, StemGUID: 201, CoreIsActive: 1 })]
    ]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT); // editedStemGUID: 200, editedCoreMeasurementID: 42
    expect(result).toMatchObject({
      status: 'edited_measurement_moved',
      coreMeasurementID: 42,
      expectedStemGUID: 200,
      actualStemGUID: 201
    });
    if (result.status === 'edited_measurement_moved') {
      expect(result.message).toContain('42');
      expect(result.message).toContain('200');
      expect(result.message).toContain('201');
    }
    expect(calls).toHaveLength(5);
  });

  it('returns edited_measurement_moved when the edited CoreMeasurementID moved to an active sibling stem', async () => {
    const { cm } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      [stemRow({ StemGUID: 200, StemIsActive: 1 }), stemRow({ StemGUID: 201, StemIsActive: 1 })],
      [measurementRow({ CoreMeasurementID: 42, StemGUID: 201, CoreIsActive: 1 })]
    ]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'edited_measurement_moved', expectedStemGUID: 200, actualStemGUID: 201 });
  });

  it('accepts inactive sibling stems/measurements as long as the edited stem/measurement is itself active (normal inactive-sibling support preserved)', async () => {
    const { cm } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      [stemRow({ StemGUID: 200, StemIsActive: 1 }), stemRow({ StemGUID: 201, StemIsActive: 0 })],
      [measurementRow({ CoreMeasurementID: 42, StemGUID: 200, CoreIsActive: 1 }), measurementRow({ CoreMeasurementID: 43, StemGUID: 201, CoreIsActive: 0 })]
    ]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result.status).toBe('ok');
  });

  // --- Successful correction: full per-member membership contract ---

  it("reports separate active/inactive stem and measurement counts, sorts membership ascending, and carries each member's own link/scope/activity (not just an ID)", async () => {
    const { cm } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      // Returned out of StemGUID order to prove the module sorts explicitly
      // rather than depending on the query's ORDER BY.
      [
        { StemGUID: 202, StemCensusID: 7, QuadratID: 9, QuadratPlotID: 3, StemIsActive: 0 },
        { StemGUID: 200, StemCensusID: 7, QuadratID: 9, QuadratPlotID: 3, StemIsActive: 1 },
        { StemGUID: 201, StemCensusID: 7, QuadratID: 11, QuadratPlotID: 3, StemIsActive: 1 }
      ],
      [
        { CoreMeasurementID: 44, StemGUID: 202, MeasurementCensusID: 7, CoreIsActive: 0, RawSpCode: null },
        { CoreMeasurementID: 42, StemGUID: 200, MeasurementCensusID: 7, CoreIsActive: 1, RawSpCode: 'AA' },
        { CoreMeasurementID: 43, StemGUID: 201, MeasurementCensusID: 7, CoreIsActive: 1, RawSpCode: 'aa' }
      ]
    ]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const { correction } = result;
    expect(correction.activeStemCount).toBe(2);
    expect(correction.inactiveStemCount).toBe(1);
    expect(correction.activeMeasurementCount).toBe(2);
    expect(correction.inactiveMeasurementCount).toBe(1);
    expect(correction.stems).toEqual([
      { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
      { stemGUID: 201, censusID: 7, quadratID: 11, isActive: true },
      { stemGUID: 202, censusID: 7, quadratID: 9, isActive: false }
    ]);
    expect(correction.measurements).toEqual([
      { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
      { coreMeasurementID: 43, stemGUID: 201, censusID: 7, isActive: true, priorRawSpCode: 'aa' },
      { coreMeasurementID: 44, stemGUID: 202, censusID: 7, isActive: false, priorRawSpCode: null }
    ]);
    expect(correction.targetTreeID).toBe(100);
    expect(correction.treeTag).toBe('T-100');
    expect(correction.oldSpeciesID).toBe(1);
    expect(correction.oldSpeciesCode).toBe('AA');
    expect(correction.newSpeciesID).toBe(2);
    expect(correction.newSpeciesCode).toBe('BB');
    expect(correction.version).toBe(1);
  });

  // --- Honest nullable identity handling (F9): TreeTag, SpeciesID, the
  // source tree's own current species code, and the destination species'
  // own code are all genuinely nullable columns. A blank/NULL value must be
  // held as a structured outcome, never coerced into "null"/0/''. ---------

  it('returns source_identity_invalid (not a fabricated "null" TreeTag) when the source tree\'s TreeTag is NULL', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow({ TreeTag: null })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_identity_invalid', treeID: 100 });
    if (result.status === 'source_identity_invalid') expect(result.message).toContain('TreeTag');
    // Only the source tree was read — the nullable TreeTag is rejected
    // before any destination query, same as other source-tree outcomes.
    expect(calls).toHaveLength(1);
  });

  it("returns source_identity_invalid when the source tree's TreeTag is blank/whitespace-only", async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow({ TreeTag: '   ' })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_identity_invalid', treeID: 100 });
  });

  it("returns source_identity_invalid (not a fabricated 0 SpeciesID) when the source tree's SpeciesID is NULL", async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow({ SpeciesID: null })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_identity_invalid', treeID: 100 });
    if (result.status === 'source_identity_invalid') expect(result.message).toContain('SpeciesID');
    expect(calls).toHaveLength(1);
  });

  it("returns source_identity_invalid (not a fabricated empty string) when the source tree's current OldSpeciesCode is NULL", async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow({ OldSpeciesCode: null })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_identity_invalid', treeID: 100 });
    if (result.status === 'source_identity_invalid') expect(result.message).toContain('species code');
    expect(calls).toHaveLength(1);
  });

  it("returns source_identity_invalid when the source tree's current OldSpeciesCode is blank/whitespace-only", async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow({ OldSpeciesCode: '  ' })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'source_identity_invalid', treeID: 100 });
  });

  it('returns destination_species_code_missing (not a fabricated "null" code) when the destination species\' own SpeciesCode is NULL', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow({ SpeciesCode: null })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_species_code_missing', speciesID: 2 });
    // Rejected immediately after the destination species read, before the
    // destination-collision/stem/measurement queries.
    expect(calls).toHaveLength(2);
  });

  it("returns destination_species_code_missing when the destination species' own SpeciesCode is blank/whitespace-only", async () => {
    const { cm } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow({ SpeciesCode: '   ' })]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(result).toMatchObject({ status: 'destination_species_code_missing', speciesID: 2 });
  });

  // --- Locking mode (forUpdate) is writer-only and requires a transaction ---

  it('rejects forUpdate: true without a transactionID before issuing any query', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow()]]);
    await expect(planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT, undefined, { forUpdate: true })).rejects.toBeInstanceOf(
      SpeciesCorrectionLockingRequiresTransactionError
    );
    expect(calls).toHaveLength(0);
  });

  it('does not lock any query when forUpdate is omitted (preview/analyze default)', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow()]]);
    await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.sql).not.toMatch(/FOR UPDATE/i);
    }
  });

  it('locks every read with FOR UPDATE when forUpdate is true and a transactionID is supplied', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow()]]);
    const result = await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT, 'tx-lock', { forUpdate: true });
    expect(result.status).toBe('ok');
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.sql).toMatch(/FOR UPDATE/i);
      expect(call.transactionID).toBe('tx-lock');
    }
  });

  it('binds the measurement IN-clause as flat per-value placeholders, not a nested array', async () => {
    const { cm, calls } = makeConnectionManager([
      [sourceTreeRow()],
      [destinationSpeciesRow()],
      [],
      [stemRow({ StemGUID: 200 }), stemRow({ StemGUID: 201 })],
      []
    ]);
    await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    const measurementCall = calls[4];
    expect(measurementCall.sql).toContain('IN (?, ?)');
    expect(measurementCall.params).toEqual([200, 201]);
    expect(measurementCall.params.every(p => typeof p === 'number')).toBe(true);
  });

  it('passes the caller transactionID through to every query', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow()]]);
    await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT, 'tx-123');
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.transactionID).toBe('tx-123');
    }
  });

  it('orders the stem and measurement reads deterministically (ascending StemGUID / CoreMeasurementID)', async () => {
    const { cm, calls } = makeConnectionManager([[sourceTreeRow()], [destinationSpeciesRow()], [], [stemRow()], [measurementRow()]]);
    await planSpeciesCorrection(cm, TEST_SCHEMA, BASE_INPUT);
    const [, , , stemCall, measurementCall] = calls;
    expect(stemCall.sql).toContain('ORDER BY s.StemGUID');
    expect(measurementCall.sql).toContain('ORDER BY CoreMeasurementID');
  });
});
