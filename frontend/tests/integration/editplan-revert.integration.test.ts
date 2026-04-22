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
  CannotRevertRevertError,
  RevertDriftError
} from '@/config/editplan/revert';
import { ScopeLockHeldError } from '@/config/editplan/apply';
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

    it('restores Attributes (cmattributes rows) to the pre-edit set after the client confirms the destructive restore plan', async () => {
      // Attribute edits that remove previously-valid codes are always R5 destructive
      // per spec rule catalog — that applies to the forward edit AND the revert,
      // because undoing "set to B" means deleting B and re-inserting A;M. Revert
      // therefore surfaces the plan on the first attempt and only proceeds after
      // the client re-posts with confirmedPlanHash.
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

      let freshPlanHash: string | null = null;
      try {
        await revertEdit(cm, {
          schema: config.database,
          editOperationID: originalEditOperationID,
          createdBy: CREATED_BY_REVERT
        });
      } catch (err) {
        if (!(err instanceof RevertDriftError)) throw err;
        expect(err.freshPlan.maxSeverity).toBe('destructive');
        freshPlanHash = err.freshPlan.planHash;
      }
      expect(freshPlanHash).not.toBeNull();

      await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT,
        confirmedPlanHash: freshPlanHash!
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

  describe('scope lock contention', () => {
    // The revert test harness's ConnectionManager mock stubs acquireApplicationLock
    // to always return true because every other test exercises the happy lock
    // path. For this test we override the stub to simulate the scope lock being
    // held by another session (a concurrent apply, validation, or upload).
    // revertEdit must fail fast with ScopeLockHeldError, roll back the
    // transaction it just opened, and leave the ledger untouched.
    it('throws ScopeLockHeldError and does not write a revert ledger row when the scope lock is held elsewhere', async () => {
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

      const originalAcquire = cm.acquireApplicationLock;
      cm.acquireApplicationLock = async () => false;
      try {
        await expect(
          revertEdit(cm, {
            schema: config.database,
            editOperationID: originalEditOperationID,
            createdBy: CREATED_BY_REVERT
          })
        ).rejects.toBeInstanceOf(ScopeLockHeldError);
      } finally {
        cm.acquireApplicationLock = originalAcquire;
      }

      // No revert ledger row written — the original edit is still the last
      // entry for this target and remains unreverted.
      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original!.revertedByEditOperationID).toBeNull();

      const [ledgerCountRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM edit_operations WHERE OperationType = 'revert' AND TargetID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(ledgerCountRows[0].cnt)).toBe(0);

      // And the measurement value stays at the post-apply state: the revert
      // never wrote, so the drift/restore path was fully skipped.
      const cmRowAfter = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfter.MeasuredDBH)).toBeCloseTo(EDITED_DBH, 2);
    });
  });

  describe('drift scenario', () => {
    // When the out-of-band change only affects a field whose restore carries no
    // cross-row or destructive ramification (e.g. raw MeasuredDBH), the revert
    // still proceeds because maxSeverity stays 'info'. This is the low-risk
    // path: the captured before-state is restored and the drift write is
    // deliberately overwritten.
    it('restores the snapshot when the out-of-band drift is benign (info severity only)', async () => {
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

      await connection.query('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [
        DRIFT_DBH,
        fixture.coreMeasurementID
      ]);
      const cmRowAfterDrift = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterDrift.MeasuredDBH)).toBeCloseTo(DRIFT_DBH, 2);

      const revertResult = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT
      });
      expect(revertResult.editOperationID).not.toBeNull();

      const cmRowAfterRevert = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRowAfterRevert.MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);

      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original!.revertedByEditOperationID).toBe(revertResult.editOperationID);
    });

    // When the out-of-band change makes the restore trigger a cross-row effect
    // (here: someone re-wrote stems.LocalX while our edit was still the most
    // recent logical state, so restoring StemLocalX now propagates to every
    // measurement on that stem), revert MUST refuse to blindly overwrite and
    // return a fresh plan. This is the spec contract at
    // docs/superpowers/specs/2026-04-21-row-editing-consistency-design.md:230-231.
    it('refuses to restore and surfaces the fresh plan when drift would cause cross-row effects', async () => {
      const EDITED_STEM_X = 7.0;
      const DRIFT_STEM_X = 50.0;

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { StemLocalX: EDITED_STEM_X },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      const stemRowsAfterEdit = await connection.query<RowDataPacket[]>(
        'SELECT LocalX FROM stems WHERE StemGUID = ?',
        [fixture.stemGUID]
      );
      expect(Number((stemRowsAfterEdit[0] as RowDataPacket[])[0].LocalX)).toBeCloseTo(EDITED_STEM_X, 2);

      await connection.query('UPDATE stems SET LocalX = ? WHERE StemGUID = ?', [DRIFT_STEM_X, fixture.stemGUID]);

      await expect(
        revertEdit(cm, {
          schema: config.database,
          editOperationID: originalEditOperationID,
          createdBy: CREATED_BY_REVERT
        })
      ).rejects.toBeInstanceOf(RevertDriftError);

      const stemRowsAfterRefusal = await connection.query<RowDataPacket[]>(
        'SELECT LocalX FROM stems WHERE StemGUID = ?',
        [fixture.stemGUID]
      );
      expect(Number((stemRowsAfterRefusal[0] as RowDataPacket[])[0].LocalX)).toBeCloseTo(DRIFT_STEM_X, 2);

      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original!.revertedByEditOperationID).toBeNull();
    });

    it('proceeds when the client re-posts revert with confirmedPlanHash matching the fresh plan', async () => {
      const EDITED_STEM_X = 7.0;
      const DRIFT_STEM_X = 50.0;

      const applyResult = await applyEdit(cm, {
        dataType: 'measurementssummary',
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        targetID: fixture.coreMeasurementID,
        newRow: { StemLocalX: EDITED_STEM_X },
        expectedPlanHash: null,
        createdBy: CREATED_BY_APPLY
      });
      const originalEditOperationID = applyResult.editOperationID!;

      await connection.query('UPDATE stems SET LocalX = ? WHERE StemGUID = ?', [DRIFT_STEM_X, fixture.stemGUID]);

      let freshPlanHash: string | null = null;
      try {
        await revertEdit(cm, {
          schema: config.database,
          editOperationID: originalEditOperationID,
          createdBy: CREATED_BY_REVERT
        });
      } catch (err) {
        if (!(err instanceof RevertDriftError)) throw err;
        freshPlanHash = err.freshPlan.planHash;
      }
      expect(freshPlanHash).not.toBeNull();

      const revertResult = await revertEdit(cm, {
        schema: config.database,
        editOperationID: originalEditOperationID,
        createdBy: CREATED_BY_REVERT,
        confirmedPlanHash: freshPlanHash!
      });
      expect(revertResult.editOperationID).not.toBeNull();

      const stemRowsAfterRevert = await connection.query<RowDataPacket[]>(
        'SELECT LocalX FROM stems WHERE StemGUID = ?',
        [fixture.stemGUID]
      );
      expect(Number((stemRowsAfterRevert[0] as RowDataPacket[])[0].LocalX)).toBeCloseTo(INITIAL_STEM_X, 2);

      const original = await readEditOperation(cm, config.database, originalEditOperationID);
      expect(original!.revertedByEditOperationID).toBe(revertResult.editOperationID);
    });
  });
});
