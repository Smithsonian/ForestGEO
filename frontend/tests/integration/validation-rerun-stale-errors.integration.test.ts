/**
 * Validation Rerun — Stale Error Clearing Integration Tests
 *
 * Reproduces the field-reported bug: two measurements share a TreeTag/StemTag,
 * the duplicate-tag validation flags BOTH rows, the user corrects the tag on
 * ONE row, reruns validations — and the UN-EDITED partner row keeps its stale
 * "duplicate" error forever, because both the pre-run cleanup and every
 * validation definition only consider rows with IsValidated IS NULL. The
 * partner row sits at IsValidated = FALSE, so it is never re-examined.
 *
 * These tests drive the REAL app code end to end against a live MySQL:
 *   - runValidation / prepareValidationRun (components/processors/processorhelperfunctions.tsx)
 *   - updateValidatedRows (same module — mirrors /api/validations/updatepassedvalidations)
 *   - writeMeasurementsSummary (config/editplan/writers/measurementssummary.ts — the grid edit path)
 *
 * ConnectionManager is bridged onto the test connection using the same
 * vi.mock pattern as editplan-writer-measurementssummary.integration.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { setupTestDatabase, teardownTestDatabase, log, type TestData } from '../setup/local-db-setup';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'test-transaction-id';

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (query.includes('??')) {
        throw new Error(`ConnectionManager mock: query contains unformatted identifier placeholders: ${query}`);
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: commit transactionID mismatch');
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

// Route ailogger through the console so genuine failures inside runValidation
// surface in test output instead of being swallowed.
vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: (...args: unknown[]) => console.warn('[ailogger.warn]', ...args),
    error: (...args: unknown[]) => console.error('[ailogger.error]', ...args)
  }
}));

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import ConnectionManager from '@/lib/db/connectionmanager';
import { runValidation, updateValidatedRows } from '@/components/processors/processorhelperfunctions';
import { writeMeasurementsSummary } from '@/config/editplan/writers/measurementssummary';
import type { EditPlan, FieldChange } from '@/config/editplan/types';
import type { ApplyInTransactionInput } from '@/config/editplan/apply';

const DUPLICATE_TAG_VALIDATION_ID = 5; // ValidateFindDuplicateStemTreeTagCombinationsPerCensus

const SPECIES_CODE = 'ACERRU';
const QUADRAT_NAME = 'VRQ1';
const DUPLICATED_TREE_TAG = 'VRT01';
const CORRECTED_TREE_TAG = 'VRT02';
const SHARED_STEM_TAG = 'VRS1';

const PLAN_HASH_PLACEHOLDER = 'test-plan-hash';
const CREATED_BY_USER = 'integration-test';

interface DuplicateFixture {
  plotID: number;
  censusID: number;
  treeID: number;
  stemGUID: number;
  editedMeasurementID: number;
  partnerMeasurementID: number;
}

interface MeasurementValidationState {
  isValidated: boolean | null;
  unresolvedValidationErrorCodes: string[];
}

function toNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Number(value) === 1;
}

async function seedDuplicateTagFixture(connection: Connection, testData: TestData): Promise<DuplicateFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ? LIMIT 1', [SPECIES_CODE]);
  if (speciesRows.length === 0) throw new Error(`Seed species ${SPECIES_CODE} missing from test database`);
  const speciesID = speciesRows[0].SpeciesID as number;

  const [quadratRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
     VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
    [plotID, QUADRAT_NAME]
  );

  const [treeRes] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
    DUPLICATED_TREE_TAG,
    speciesID,
    censusID
  ]);
  const treeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
     VALUES (?, ?, ?, ?, 1.5, 2.5, 1)`,
    [treeID, quadratRes.insertId, censusID, SHARED_STEM_TAG]
  );
  const stemGUID = stemRes.insertId;

  // Two field sheets both said tag VRT01 / stem VRS1, so ingestion attached
  // both measurements to the same stem — the exact shape validation 5 flags.
  const measurementIDs: number[] = [];
  for (const seed of [
    { dbh: 15.2, date: '2024-06-01' },
    { dbh: 31.7, date: '2024-06-02' }
  ]) {
    const [cmRes] = await connection.query<ResultSetHeader>(
      `INSERT INTO coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
          RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, IsValidated, IsActive)
       VALUES (?, ?, ?, 1.3, ?, ?, ?, ?, ?, 1.5, 2.5, NULL, 1)`,
      [stemGUID, censusID, seed.dbh, seed.date, DUPLICATED_TREE_TAG, SHARED_STEM_TAG, SPECIES_CODE, QUADRAT_NAME]
    );
    measurementIDs.push(cmRes.insertId);
  }

  return {
    plotID,
    censusID,
    treeID,
    stemGUID,
    editedMeasurementID: measurementIDs[0],
    partnerMeasurementID: measurementIDs[1]
  };
}

async function getMeasurementValidationState(connection: Connection, measurementID: number): Promise<MeasurementValidationState> {
  const [cmRows] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ? LIMIT 1', [measurementID]);
  if (cmRows.length === 0) throw new Error(`coremeasurements row ${measurementID} vanished`);

  const [errorRows] = await connection.query<RowDataPacket[]>(
    `SELECT me.ErrorCode
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE mel.MeasurementID = ?
       AND mel.IsResolved = FALSE
       AND me.ErrorSource = 'validation'
     ORDER BY me.ErrorCode`,
    [measurementID]
  );

  return {
    isValidated: toNullableBool(cmRows[0].IsValidated),
    unresolvedValidationErrorCodes: errorRows.map(row => String(row.ErrorCode))
  };
}

async function runDuplicateTagValidation(connection: Connection, schema: string, plotID: number, censusID: number): Promise<void> {
  const [defRows] = await connection.query<RowDataPacket[]>(
    'SELECT ProcedureName, Definition FROM sitespecificvalidations WHERE ValidationID = ? AND IsEnabled = 1 LIMIT 1',
    [DUPLICATE_TAG_VALIDATION_ID]
  );
  if (defRows.length === 0) throw new Error(`Validation ${DUPLICATE_TAG_VALIDATION_ID} missing or disabled in test database`);

  const succeeded = await runValidation(DUPLICATE_TAG_VALIDATION_ID, String(defRows[0].ProcedureName), schema, String(defRows[0].Definition), {
    p_CensusID: censusID,
    p_PlotID: plotID
  });
  if (!succeeded) throw new Error('runValidation reported failure — see logs');

  await updateValidatedRows(schema, { p_CensusID: censusID, p_PlotID: plotID });
}

async function correctTreeTagViaGridEdit(schema: string, fixture: DuplicateFixture): Promise<void> {
  const cm = ConnectionManager.getInstance();

  const fieldChanges: FieldChange[] = [{ field: 'TreeTag', from: DUPLICATED_TREE_TAG, to: CORRECTED_TREE_TAG }];
  const plan: EditPlan = {
    dataType: 'measurementssummary',
    targetID: fixture.editedMeasurementID,
    fieldChanges,
    effects: [],
    maxSeverity: 'info',
    planHash: PLAN_HASH_PLACEHOLDER,
    generatedAt: new Date().toISOString()
  };
  const input: ApplyInTransactionInput = {
    dataType: 'measurementssummary',
    schema,
    plotID: fixture.plotID,
    censusID: fixture.censusID,
    targetID: fixture.editedMeasurementID,
    newRow: { TreeTag: CORRECTED_TREE_TAG },
    expectedPlanHash: null,
    createdBy: CREATED_BY_USER,
    transactionID: TEST_TRANSACTION_ID,
    refreshViews: false
  };

  const txID = await cm.beginTransaction();
  await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
  await cm.commitTransaction(txID);
}

describe('Validation rerun clears stale errors (duplicate tag correction)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let fixture: DuplicateFixture;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    await connection.query('DELETE FROM measurement_error_log');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query('DELETE FROM quadrats WHERE QuadratName = ?', [QUADRAT_NAME]);
    fixture = await seedDuplicateTagFixture(connection, testData);
  });

  it('flags BOTH measurements of a duplicated tag pair on the first run', async () => {
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    const edited = await getMeasurementValidationState(connection, fixture.editedMeasurementID);
    const partner = await getMeasurementValidationState(connection, fixture.partnerMeasurementID);
    log.debug(`After first run — edited: ${JSON.stringify(edited)}, partner: ${JSON.stringify(partner)}`);

    expect(edited.unresolvedValidationErrorCodes).toEqual([String(DUPLICATE_TAG_VALIDATION_ID)]);
    expect(partner.unresolvedValidationErrorCodes).toEqual([String(DUPLICATE_TAG_VALIDATION_ID)]);
    expect(edited.isValidated).toBe(false);
    expect(partner.isValidated).toBe(false);
  });

  it('clears the stale duplicate error on the UN-EDITED partner row after tag correction + rerun', async () => {
    // Step 1: first validation run flags both rows of the duplicate pair.
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    // Step 2: the user corrects the tag on ONE row via the grid edit path.
    await correctTreeTagViaGridEdit(config.database, fixture);

    const editedAfterEdit = await getMeasurementValidationState(connection, fixture.editedMeasurementID);
    log.debug(`After edit — edited row: ${JSON.stringify(editedAfterEdit)}`);
    expect(editedAfterEdit.isValidated).toBeNull(); // edit resets the edited row to pending
    expect(editedAfterEdit.unresolvedValidationErrorCodes).toEqual([]);

    // Step 3: the user reruns validations.
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    const edited = await getMeasurementValidationState(connection, fixture.editedMeasurementID);
    const partner = await getMeasurementValidationState(connection, fixture.partnerMeasurementID);
    log.debug(`After rerun — edited: ${JSON.stringify(edited)}, partner: ${JSON.stringify(partner)}`);

    // The corrected row passes.
    expect(edited.unresolvedValidationErrorCodes).toEqual([]);
    expect(edited.isValidated).toBe(true);

    // THE BUG: the partner row is no longer a duplicate (its tag is now unique
    // in the census) but keeps the stale unresolved error and stays failed.
    expect(partner.unresolvedValidationErrorCodes).toEqual([]);
    expect(partner.isValidated).toBe(true);
  });

  it('keeps flagging both rows when the duplicate is NOT corrected between reruns', async () => {
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    const edited = await getMeasurementValidationState(connection, fixture.editedMeasurementID);
    const partner = await getMeasurementValidationState(connection, fixture.partnerMeasurementID);
    log.debug(`After double run without correction — edited: ${JSON.stringify(edited)}, partner: ${JSON.stringify(partner)}`);

    expect(edited.unresolvedValidationErrorCodes).toEqual([String(DUPLICATE_TAG_VALIDATION_ID)]);
    expect(partner.unresolvedValidationErrorCodes).toEqual([String(DUPLICATE_TAG_VALIDATION_ID)]);
    expect(edited.isValidated).toBe(false);
    expect(partner.isValidated).toBe(false);
  });

  it('does not disturb rows whose validation state was overridden to TRUE', async () => {
    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    // Simulate the "override validations" action: force both rows valid while
    // their duplicate errors are still unresolved.
    await connection.query('UPDATE coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID IN (?, ?)', [
      fixture.editedMeasurementID,
      fixture.partnerMeasurementID
    ]);

    await runDuplicateTagValidation(connection, config.database, fixture.plotID, fixture.censusID);

    const edited = await getMeasurementValidationState(connection, fixture.editedMeasurementID);
    const partner = await getMeasurementValidationState(connection, fixture.partnerMeasurementID);
    log.debug(`After rerun with override — edited: ${JSON.stringify(edited)}, partner: ${JSON.stringify(partner)}`);

    expect(edited.isValidated).toBe(true);
    expect(partner.isValidated).toBe(true);
  });
});
