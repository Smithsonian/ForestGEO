import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — mirrors the pattern used by editoperations and
// editplan-writer integration tests. Lets the hoisted vi.mock adapter read
// the live connection once beforeAll completes.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

const TEST_TRANSACTION_ID_PREFIX = 'test-transaction-';

vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(
          `ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`
        );
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch`);
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

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import ConnectionManager from '@/config/connectionmanager';
import { applyEdit } from '@/config/editplan/apply';
import {
  revertEdit,
  EditOperationNotFoundError,
  AlreadyRevertedError,
  CannotRevertRevertError
} from '@/config/editplan/revert';
import { readEditOperation } from '@/config/editoperations';

// ---------------------------------------------------------------------------
// Fixture constants (kept short — StemTag is varchar(10)).
// ---------------------------------------------------------------------------
const SPECIES_CODE_ACERRU = 'ACERRU';
const SPECIES_CODE_QUERCO = 'QUERCO';

const QUADRAT_NAME_A = 'RVA';
const QUADRAT_NAME_B = 'RVB';

const TREE_TAG_T1 = 'RT001';
const STEM_TAG_S1 = 'RS1';

const ATTR_CODE_ALIVE = 'A';
const ATTR_CODE_MISSING = 'M';

const INITIAL_DBH = 12.34;
const INITIAL_HOM = 1.3;
const INITIAL_DATE = '2024-06-15';
const INITIAL_STEM_X = 3.5;
const INITIAL_STEM_Y = 4.25;
const INITIAL_DESCRIPTION = 'initial comment';

const EDITED_DBH = 45.5;
const DRIFT_DBH = 99.9;
const UNKNOWN_EDIT_OPERATION_ID = 9_999_999;
const CREATED_BY_APPLY = 'revert-test-apply';
const CREATED_BY_REVERT = 'revert-test-revert';

interface RevertFixture {
  plotID: number;
  censusID: number;
  speciesIDs: Record<string, number>;
  quadratIDs: Record<string, number>;
  treeID: number;
  stemGUID: number;
  coreMeasurementID: number;
}

async function seedRevertFixture(connection: Connection, testData: TestData): Promise<RevertFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>(
    'SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?, ?)',
    [SPECIES_CODE_ACERRU, SPECIES_CODE_QUERCO]
  );
  const speciesIDs: Record<string, number> = {};
  for (const row of speciesRows) {
    speciesIDs[row.SpeciesCode as string] = row.SpeciesID as number;
  }

  const quadratIDs: Record<string, number> = {};
  for (const name of [QUADRAT_NAME_A, QUADRAT_NAME_B]) {
    const [res] = await connection.query<ResultSetHeader>(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
      [plotID, name]
    );
    quadratIDs[name] = res.insertId;
  }

  const [treeRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`,
    [TREE_TAG_T1, speciesIDs[SPECIES_CODE_ACERRU], censusID]
  );
  const treeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [treeID, quadratIDs[QUADRAT_NAME_A], censusID, STEM_TAG_S1, INITIAL_STEM_X, INITIAL_STEM_Y]
  );
  const stemGUID = stemRes.insertId;

  const [cmRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
        RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      stemGUID,
      censusID,
      INITIAL_DBH,
      INITIAL_HOM,
      INITIAL_DATE,
      TREE_TAG_T1,
      STEM_TAG_S1,
      SPECIES_CODE_ACERRU,
      QUADRAT_NAME_A,
      INITIAL_STEM_X,
      INITIAL_STEM_Y,
      `${ATTR_CODE_ALIVE}; ${ATTR_CODE_MISSING}`,
      INITIAL_DESCRIPTION,
      INITIAL_DESCRIPTION
    ]
  );
  const coreMeasurementID = cmRes.insertId;

  for (const code of [ATTR_CODE_ALIVE, ATTR_CODE_MISSING]) {
    await connection.query<ResultSetHeader>(
      `INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`,
      [coreMeasurementID, code]
    );
  }

  return { plotID, censusID, speciesIDs, quadratIDs, treeID, stemGUID, coreMeasurementID };
}

async function loadCoreMeasurement(connection: Connection, coreMeasurementID: number): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT * FROM coremeasurements WHERE CoreMeasurementID = ? LIMIT 1',
    [coreMeasurementID]
  );
  if (rows.length === 0) throw new Error('coremeasurements row vanished');
  return rows[0] as Record<string, unknown>;
}

describe('revertEdit (integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  const cm = ConnectionManager.getInstance() as any;

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

  let fixture: RevertFixture;
  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.transactionCounter = 0;
    await connection.query('DROP TABLE IF EXISTS edit_operations');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query(`DELETE FROM quadrats WHERE QuadratName IN (?, ?)`, [QUADRAT_NAME_A, QUADRAT_NAME_B]);
    fixture = await seedRevertFixture(connection, testData);
  });

  describe('round-trip apply + revert', () => {
    it('restores the measurement to its pre-edit state and links the ledger records', async () => {
      // 1. Apply an edit — change MeasuredDBH.
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { MeasuredDBH: EDITED_DBH },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });

      expect(applyResult.editOperationID).not.toBeNull();
      const originalEditOperationID = applyResult.editOperationID!;

      const cmRowAfterEdit = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterEdit.MeasuredDBH)).toBeCloseTo(EDITED_DBH, 2);

      // 2. Revert the edit.
      const revertResult = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });

      expect(revertResult.editOperationID).not.toBeNull();
      const revertEditOperationID = revertResult.editOperationID!;
      expect(revertEditOperationID).not.toBe(originalEditOperationID);

      // 3. Measurement is back to pre-edit DBH.
      const cmRowAfterRevert = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterRevert.MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);
      expect(Number(cmRowAfterRevert.MeasuredHOM)).toBeCloseTo(INITIAL_HOM, 2);

      // 4. Ledger: original now points at the revert, revert itself is unreverted
      //    and is flagged as operationType='revert'.
      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original).not.toBeNull();
      expect(original!.revertedByEditOperationID).toBe(revertEditOperationID);

      const revertRecord = await readEditOperation(cm, config.database, revertEditOperationID);
      expect(revertRecord).not.toBeNull();
      expect(revertRecord!.operationType).toBe('revert');
      expect(revertRecord!.revertedByEditOperationID).toBeNull();
      expect(revertRecord!.createdBy).toBe(CREATED_BY_REVERT);
    });

    it('restores Attributes (cmattributes rows) to the pre-edit set', async () => {
      const NEW_ATTRIBUTES = 'B';
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { Attributes: NEW_ATTRIBUTES },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      const [attrsAfterEdit] = await connection.query<RowDataPacket[]>(
        'SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code',
        [fixture.coreMeasurementID]
      );
      expect(attrsAfterEdit.map(r => r.Code)).toEqual(['B']);

      await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });

      const [attrsAfterRevert] = await connection.query<RowDataPacket[]>(
        'SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code',
        [fixture.coreMeasurementID]
      );
      const restoredCodes = attrsAfterRevert.map(r => r.Code as string).sort();
      expect(restoredCodes).toEqual([ATTR_CODE_ALIVE, ATTR_CODE_MISSING].sort());
    });
  });

  describe('rejection cases', () => {
    it('throws EditOperationNotFoundError for an unknown editOperationID', async () => {
      // Ensure the edit_operations table exists by writing + immediately
      // reading a throwaway record; otherwise readEditOperation would blow
      // up on a missing table instead of returning null.
      await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { MeasuredDBH: EDITED_DBH },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });

      await expect(
        revertEdit(cm, {
          schema: config.database,
          editOperationID: UNKNOWN_EDIT_OPERATION_ID,
          createdBy: CREATED_BY_REVERT
        })
      ).rejects.toBeInstanceOf(EditOperationNotFoundError);
    });

    it('throws AlreadyRevertedError when the operation has already been reverted', async () => {
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { MeasuredDBH: EDITED_DBH },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      // First revert succeeds.
      const firstRevert = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });
      expect(firstRevert.editOperationID).not.toBeNull();

      // Second revert of the same original operation should fail.
      const err = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      }).catch(e => e);
      expect(err).toBeInstanceOf(AlreadyRevertedError);
      expect((err as AlreadyRevertedError).byEditOperationID).toBe(firstRevert.editOperationID);
    });

    it('throws CannotRevertRevertError when asked to revert a revert', async () => {
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { MeasuredDBH: EDITED_DBH },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      const firstRevert = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });

      await expect(
        revertEdit(cm, {
          schema: config.database,
          editOperationID: firstRevert.editOperationID!,
          createdBy: CREATED_BY_REVERT
        })
      ).rejects.toBeInstanceOf(CannotRevertRevertError);
    });
  });

  describe('drift scenario', () => {
    it('restores the captured pre-edit state even when the row has moved out-of-band', async () => {
      // 1. Apply an edit.
      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { MeasuredDBH: EDITED_DBH },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      // 2. Mutate the row out-of-band — bypass the edit plan entirely.
      await connection.query('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [
        DRIFT_DBH,
        fixture.coreMeasurementID
      ]);
      const cmRowAfterDrift = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterDrift.MeasuredDBH)).toBeCloseTo(DRIFT_DBH, 2);

      // 3. Revert — the expectedPlanHash is null so the apply runs regardless
      //    of drift. The restore targets the captured before-state, not the
      //    current world.
      const revertResult = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });
      expect(revertResult.editOperationID).not.toBeNull();

      // 4. MeasuredDBH is now back at the original INITIAL_DBH — the drift
      //    write is overwritten. The revert restores the snapshot, not a diff.
      const cmRowAfterRevert = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterRevert.MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);

      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original!.revertedByEditOperationID).toBe(revertResult.editOperationID);
    });
  });
});
