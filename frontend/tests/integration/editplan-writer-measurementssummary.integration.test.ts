import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — matches the pattern used by editplan-resolvers and
// editoperations integration tests. Lets the hoisted vi.mock adapter read
// the live connection once beforeAll completes.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'test-transaction-id';

vi.mock('@/config/connectionmanager', () => {
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
import { writeMeasurementsSummary } from '@/config/editplan/writers/measurementssummary';
import type { EditPlan, FieldChange } from '@/config/editplan/types';
import type { ApplyInTransactionInput } from '@/config/editplan/apply';

// ---------------------------------------------------------------------------
// Fixture constants. Names are short on purpose — StemTag is varchar(10).
// ---------------------------------------------------------------------------
const SPECIES_CODE_ACERRU = 'ACERRU';
const SPECIES_CODE_QUERCO = 'QUERCO';
const SPECIES_CODE_UNKNOWN = 'NOSUCH';

const QUADRAT_NAME_A = 'WQA';
const QUADRAT_NAME_B = 'WQB';

const TREE_TAG_T1 = 'WT001';
const TREE_TAG_T2 = 'WT002';
const TREE_TAG_NEW = 'WT999';

const STEM_TAG_S1 = 'WS1';
const STEM_TAG_S2 = 'WS2';

const ATTR_CODE_ALIVE = 'A';
const ATTR_CODE_MISSING = 'M';
const ATTR_CODE_BROKEN = 'B';

const INITIAL_DBH = 12.34;
const INITIAL_HOM = 1.3;
const INITIAL_DATE = '2024-06-15';
const INITIAL_STEM_X = 3.5;
const INITIAL_STEM_Y = 4.25;

const PLAN_HASH_PLACEHOLDER = 'test-plan-hash';
const CREATED_BY_USER = 'integration-test';

interface WriterFixture {
  plotID: number;
  censusID: number;
  speciesIDs: Record<string, number>;
  quadratIDs: Record<string, number>;
  treeIDs: Record<string, number>;
  stemGUIDs: Record<string, number>;
  coreMeasurementID: number;
}

async function seedWriterFixture(connection: Connection, testData: TestData): Promise<WriterFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?, ?)', [
    SPECIES_CODE_ACERRU,
    SPECIES_CODE_QUERCO
  ]);
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

  // Trees: T1 (ACERRU), T2 (QUERCO) — both active in this census.
  const treeIDs: Record<string, number> = {};
  for (const [tag, code] of [
    [TREE_TAG_T1, SPECIES_CODE_ACERRU],
    [TREE_TAG_T2, SPECIES_CODE_QUERCO]
  ] as const) {
    const [res] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
      tag,
      speciesIDs[code],
      censusID
    ]);
    treeIDs[tag] = res.insertId;
  }

  // Stems: T1 has S1 in quadrat A, T2 has S2 in quadrat A.
  const stemGUIDs: Record<string, number> = {};
  const stemSeeds: Array<{ tag: string; treeTag: string; quadratName: string; x: number; y: number }> = [
    { tag: STEM_TAG_S1, treeTag: TREE_TAG_T1, quadratName: QUADRAT_NAME_A, x: INITIAL_STEM_X, y: INITIAL_STEM_Y },
    { tag: STEM_TAG_S2, treeTag: TREE_TAG_T2, quadratName: QUADRAT_NAME_A, x: 5, y: 6 }
  ];
  for (const stem of stemSeeds) {
    const [res] = await connection.query<ResultSetHeader>(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [treeIDs[stem.treeTag], quadratIDs[stem.quadratName], censusID, stem.tag, stem.x, stem.y]
    );
    stemGUIDs[stem.tag] = res.insertId;
  }

  // A live coremeasurements row on stem S1 with two attributes.
  const [cmRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
        RawCodes, RawComments, Description, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      stemGUIDs[STEM_TAG_S1],
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
      'initial comment',
      'initial comment'
    ]
  );
  const coreMeasurementID = cmRes.insertId;

  for (const code of [ATTR_CODE_ALIVE, ATTR_CODE_MISSING]) {
    await connection.query<ResultSetHeader>(`INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`, [coreMeasurementID, code]);
  }

  return { plotID, censusID, speciesIDs, quadratIDs, treeIDs, stemGUIDs, coreMeasurementID };
}

function buildPlan(fieldChanges: FieldChange[], targetID: number): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID,
    fieldChanges,
    effects: [],
    maxSeverity: 'info',
    planHash: PLAN_HASH_PLACEHOLDER,
    generatedAt: new Date().toISOString()
  };
}

function buildInput(schema: string, plotID: number, censusID: number, coreMeasurementID: number, newRow: Record<string, unknown>): ApplyInTransactionInput {
  return {
    dataType: 'measurementssummary',
    schema,
    plotID,
    censusID,
    targetID: coreMeasurementID,
    newRow,
    expectedPlanHash: null,
    createdBy: CREATED_BY_USER,
    transactionID: TEST_TRANSACTION_ID
  };
}

async function countCmAttributes(connection: Connection, coreMeasurementID: number): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM cmattributes WHERE CoreMeasurementID = ?', [coreMeasurementID]);
  return Number(rows[0].cnt);
}

async function loadCoreMeasurement(connection: Connection, coreMeasurementID: number): Promise<Record<string, unknown>> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM coremeasurements WHERE CoreMeasurementID = ? LIMIT 1', [coreMeasurementID]);
  if (rows.length === 0) throw new Error('coremeasurements row vanished');
  return rows[0] as Record<string, unknown>;
}

async function loadStem(connection: Connection, stemGUID: number): Promise<Record<string, unknown> | null> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM stems WHERE StemGUID = ? LIMIT 1', [stemGUID]);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function loadSpecies(connection: Connection, speciesID: number): Promise<Record<string, unknown> | null> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM species WHERE SpeciesID = ? LIMIT 1', [speciesID]);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

describe('writeMeasurementsSummary (integration)', () => {
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

  // Every test reseeds to make it independent; this is cheap because fixtures
  // are small and we explicitly tear down the rows we created.
  let fixture: WriterFixture;
  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    // Clean data from previous test iterations
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query(`DELETE FROM quadrats WHERE QuadratName IN (?, ?)`, [QUADRAT_NAME_A, QUADRAT_NAME_B]);
    fixture = await seedWriterFixture(connection, testData);
  });

  describe('DBH-only edit', () => {
    it('updates coremeasurements.MeasuredDBH without touching stems / trees / cmattributes', async () => {
      const NEW_DBH = 45.5;
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];
      const stemRowBefore = await loadStem(connection, stemGUIDBefore);
      const treeRowsCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      const attrCountBefore = await countCmAttributes(connection, fixture.coreMeasurementID);

      const plan = buildPlan([{ field: 'MeasuredDBH', from: INITIAL_DBH, to: NEW_DBH }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { MeasuredDBH: NEW_DBH });

      const txID = await cm.beginTransaction();
      const result = await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      expect(result.updatedIDs).toEqual({ CoreMeasurementID: fixture.coreMeasurementID });
      expect(result.validationPending).toBe(true);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRow.MeasuredDBH)).toBeCloseTo(NEW_DBH, 2);
      expect(cmRow.StemGUID).toBe(stemGUIDBefore);
      // DBH-only is not an identity-trigger so Raw* sync is not needed; verify
      // MeasuredDBH changed but the stems row is untouched.
      const stemRowAfter = await loadStem(connection, stemGUIDBefore);
      expect(stemRowAfter).toEqual(stemRowBefore);
      const treeRowsCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      expect(treeRowsCountAfter).toBe(treeRowsCountBefore);
      const attrCountAfter = await countCmAttributes(connection, fixture.coreMeasurementID);
      expect(attrCountAfter).toBe(attrCountBefore);

      // IsValidated should be reset to NULL once a change was applied.
      expect(cmRow.IsValidated).toBeNull();
    });
  });

  describe('TreeTag change', () => {
    it('creates a new tree row when TreeTag is previously unseen and rewires StemGUID', async () => {
      const treeCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];

      const plan = buildPlan([{ field: 'TreeTag', from: TREE_TAG_T1, to: TREE_TAG_NEW }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { TreeTag: TREE_TAG_NEW });

      const txID = await cm.beginTransaction();
      const result = await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const treeCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      expect(treeCountAfter).toBe(treeCountBefore + 1);

      const [newTreeRows] = await connection.query<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND CensusID = ?', [
        TREE_TAG_NEW,
        fixture.censusID
      ]);
      expect(newTreeRows.length).toBe(1);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      // StemGUID should have been rewritten to point at the stem on the new tree
      // (a fresh stem was created because (new-tree, S1) did not exist).
      expect(cmRow.StemGUID).not.toBe(stemGUIDBefore);
      const newStem = await loadStem(connection, Number(cmRow.StemGUID));
      expect(newStem?.StemTag).toBe(STEM_TAG_S1);
      expect(newStem?.TreeID).toBe(newTreeRows[0].TreeID);

      // Raw sync: RawTreeTag on coremeasurements mirrors the new tag
      expect(cmRow.RawTreeTag).toBe(TREE_TAG_NEW);

      expect(result.updatedIDs).toEqual({ CoreMeasurementID: fixture.coreMeasurementID });
    });

    it('reuses an existing tree row when a row already matches (TreeTag + SpeciesID + CensusID)', async () => {
      // Insert an extra tree so T2 with SpeciesID ACERRU already exists in this
      // census. Moving our measurement from T1 -> T2 should reuse that row.
      const [existingRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
        TREE_TAG_T2,
        fixture.speciesIDs[SPECIES_CODE_ACERRU],
        fixture.censusID
      ]);
      const existingMatchingTreeID = existingRes.insertId;
      const treeCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);

      const plan = buildPlan([{ field: 'TreeTag', from: TREE_TAG_T1, to: TREE_TAG_T2 }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { TreeTag: TREE_TAG_T2 });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const treeCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      expect(treeCountAfter).toBe(treeCountBefore);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      const newStem = await loadStem(connection, Number(cmRow.StemGUID));
      expect(newStem?.TreeID).toBe(existingMatchingTreeID);
    });
  });

  describe('StemLocalX change', () => {
    it('propagates the new LocalX to the stems row (affecting every measurement on that stem)', async () => {
      const NEW_X = 7.75;
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];

      const plan = buildPlan([{ field: 'StemLocalX', from: INITIAL_STEM_X, to: NEW_X }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemLocalX: NEW_X });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const stemRow = await loadStem(connection, stemGUIDBefore);
      expect(Number(stemRow?.LocalX)).toBeCloseTo(NEW_X, 2);
      // LocalY should remain untouched.
      expect(Number(stemRow?.LocalY)).toBeCloseTo(INITIAL_STEM_Y, 2);
    });
  });

  describe('StemTag change', () => {
    it('creates a new stem on the same tree/quadrat and rewires the measurement', async () => {
      const newStemTag = 'WS9';
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];
      const stemCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);

      const plan = buildPlan([{ field: 'StemTag', from: STEM_TAG_S1, to: newStemTag }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemTag: newStemTag });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const stemCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);
      expect(stemCountAfter).toBe(stemCountBefore + 1);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.StemGUID).not.toBe(stemGUIDBefore);
      expect(cmRow.RawStemTag).toBe(newStemTag);

      const newStem = await loadStem(connection, Number(cmRow.StemGUID));
      expect(newStem?.StemTag).toBe(newStemTag);
      expect(newStem?.TreeID).toBe(fixture.treeIDs[TREE_TAG_T1]);
      expect(newStem?.QuadratID).toBe(fixture.quadratIDs[QUADRAT_NAME_A]);
    });
  });

  describe('regression: post-stem-resolution snapshot reload', () => {
    // Without the post-resolution reload, `current` stays joined through the
    // OLD StemGUID. A StemTag-only edit that lands on a pre-existing stem
    // with different LocalX/LocalY then writes RawX/RawY from the OLD stem,
    // not the stem the row now points to.
    it('writes Raw X/Y for the new stem when StemTag-only edit lands on a pre-existing stem with different coords', async () => {
      const PREEXISTING_STEM_TAG = 'WSE';
      const PREEXISTING_STEM_X = 99.5;
      const PREEXISTING_STEM_Y = 88.25;

      const [preexistingRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [fixture.treeIDs[TREE_TAG_T1], fixture.quadratIDs[QUADRAT_NAME_A], fixture.censusID, PREEXISTING_STEM_TAG, PREEXISTING_STEM_X, PREEXISTING_STEM_Y]
      );
      const preexistingStemGUID = preexistingRes.insertId;

      const stemCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);

      const plan = buildPlan([{ field: 'StemTag', from: STEM_TAG_S1, to: PREEXISTING_STEM_TAG }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemTag: PREEXISTING_STEM_TAG });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const stemCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);
      expect(stemCountAfter).toBe(stemCountBefore);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(Number(cmRow.StemGUID)).toBe(preexistingStemGUID);
      expect(cmRow.RawStemTag).toBe(PREEXISTING_STEM_TAG);
      expect(Number(cmRow.RawX)).toBeCloseTo(PREEXISTING_STEM_X, 2);
      expect(Number(cmRow.RawY)).toBeCloseTo(PREEXISTING_STEM_Y, 2);
      expect(Number(cmRow.RawX)).not.toBeCloseTo(INITIAL_STEM_X, 2);
      expect(Number(cmRow.RawY)).not.toBeCloseTo(INITIAL_STEM_Y, 2);
    });
  });

  describe('row-local measurement fields', () => {
    it('updates MeasurementDate and Description without moving tree/stem identity', async () => {
      const newDate = '2024-08-09';
      const newDescription = 'field check complete';
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];
      const plan = buildPlan(
        [
          { field: 'MeasurementDate', from: INITIAL_DATE, to: newDate },
          { field: 'Description', from: 'initial comment', to: newDescription }
        ],
        fixture.coreMeasurementID
      );
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, {
        MeasurementDate: newDate,
        Description: newDescription
      });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      const storedDate = cmRow.MeasurementDate;
      const storedDateAsIso = storedDate instanceof Date ? storedDate.toISOString().split('T')[0] : String(storedDate).split('T')[0].split(' ')[0];
      expect(storedDateAsIso).toBe(newDate);
      expect(cmRow.Description).toBe(newDescription);
      expect(cmRow.RawComments).toBe(newDescription);
      expect(cmRow.StemGUID).toBe(stemGUIDBefore);
    });
  });

  describe('SpeciesCode re-link', () => {
    it('updates coremeasurements.SpeciesID (via tree rewire) but does NOT mutate the species row', async () => {
      const querSpeciesID = fixture.speciesIDs[SPECIES_CODE_QUERCO];
      const querRowBefore = await loadSpecies(connection, querSpeciesID);

      const plan = buildPlan([{ field: 'SpeciesCode', from: SPECIES_CODE_ACERRU, to: SPECIES_CODE_QUERCO }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { SpeciesCode: SPECIES_CODE_QUERCO });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      // The measurement should now be linked (via stems -> trees) to the QUERCO species.
      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      const stemRow = await loadStem(connection, Number(cmRow.StemGUID));
      const [treeRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM trees WHERE TreeID = ?', [stemRow?.TreeID]);
      expect(treeRows[0].SpeciesID).toBe(querSpeciesID);

      // Regression: the species row itself must not have been updated.
      const querRowAfter = await loadSpecies(connection, querSpeciesID);
      expect(querRowAfter).toEqual(querRowBefore);
    });
  });

  describe('Attributes change', () => {
    it('DELETEs old cmattributes rows and INSERTs exactly the new set', async () => {
      const newAttributes = `${ATTR_CODE_BROKEN}; ${ATTR_CODE_ALIVE}`;
      const plan = buildPlan([{ field: 'Attributes', from: `${ATTR_CODE_ALIVE}; ${ATTR_CODE_MISSING}`, to: newAttributes }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { Attributes: newAttributes });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const [rows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ? ORDER BY Code', [
        fixture.coreMeasurementID
      ]);
      const codes = rows.map(r => r.Code as string);
      expect(codes.sort()).toEqual([ATTR_CODE_ALIVE, ATTR_CODE_BROKEN].sort());
      // Verify the old M code is gone.
      expect(codes).not.toContain(ATTR_CODE_MISSING);
    });
  });

  describe('all editable fields together', () => {
    it('applies species/tree/stem/quadrat/coordinate/measurement/comment/attribute changes in one transaction', async () => {
      const allFieldStemTag = 'WSA';
      const newDate = '2024-09-10';
      const newDescription = 'all field edit';
      const newDBH = 33.33;
      const newHOM = 2.22;
      const newX = 11.11;
      const newY = 12.12;
      const newAttributes = ATTR_CODE_BROKEN;
      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];

      const plan = buildPlan(
        [
          { field: 'SpeciesCode', from: SPECIES_CODE_ACERRU, to: SPECIES_CODE_QUERCO },
          { field: 'TreeTag', from: TREE_TAG_T1, to: TREE_TAG_NEW },
          { field: 'StemTag', from: STEM_TAG_S1, to: allFieldStemTag },
          { field: 'QuadratName', from: QUADRAT_NAME_A, to: QUADRAT_NAME_B },
          { field: 'StemLocalX', from: INITIAL_STEM_X, to: newX },
          { field: 'StemLocalY', from: INITIAL_STEM_Y, to: newY },
          { field: 'MeasurementDate', from: INITIAL_DATE, to: newDate },
          { field: 'MeasuredDBH', from: INITIAL_DBH, to: newDBH },
          { field: 'MeasuredHOM', from: INITIAL_HOM, to: newHOM },
          { field: 'Description', from: 'initial comment', to: newDescription },
          { field: 'Attributes', from: `${ATTR_CODE_ALIVE}; ${ATTR_CODE_MISSING}`, to: newAttributes }
        ],
        fixture.coreMeasurementID
      );
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, {
        SpeciesCode: SPECIES_CODE_QUERCO,
        TreeTag: TREE_TAG_NEW,
        StemTag: allFieldStemTag,
        QuadratName: QUADRAT_NAME_B,
        StemLocalX: newX,
        StemLocalY: newY,
        MeasurementDate: newDate,
        MeasuredDBH: newDBH,
        MeasuredHOM: newHOM,
        Description: newDescription,
        Attributes: newAttributes
      });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.StemGUID).not.toBe(stemGUIDBefore);
      expect(Number(cmRow.MeasuredDBH)).toBeCloseTo(newDBH, 2);
      expect(Number(cmRow.MeasuredHOM)).toBeCloseTo(newHOM, 2);
      expect(cmRow.RawTreeTag).toBe(TREE_TAG_NEW);
      expect(cmRow.RawStemTag).toBe(allFieldStemTag);
      expect(cmRow.RawSpCode).toBe(SPECIES_CODE_QUERCO);
      expect(cmRow.RawQuadrat).toBe(QUADRAT_NAME_B);
      expect(Number(cmRow.RawX)).toBeCloseTo(newX, 2);
      expect(Number(cmRow.RawY)).toBeCloseTo(newY, 2);
      expect(cmRow.RawCodes).toBe(newAttributes);
      expect(cmRow.RawComments).toBe(newDescription);

      const storedDate = cmRow.MeasurementDate;
      const storedDateAsIso = storedDate instanceof Date ? storedDate.toISOString().split('T')[0] : String(storedDate).split('T')[0].split(' ')[0];
      expect(storedDateAsIso).toBe(newDate);

      const newStem = await loadStem(connection, Number(cmRow.StemGUID));
      expect(newStem?.StemTag).toBe(allFieldStemTag);
      expect(newStem?.QuadratID).toBe(fixture.quadratIDs[QUADRAT_NAME_B]);
      expect(Number(newStem?.LocalX)).toBeCloseTo(newX, 2);
      expect(Number(newStem?.LocalY)).toBeCloseTo(newY, 2);

      const [treeRows] = await connection.query<RowDataPacket[]>('SELECT TreeTag, SpeciesID FROM trees WHERE TreeID = ?', [newStem?.TreeID]);
      expect(treeRows[0].TreeTag).toBe(TREE_TAG_NEW);
      expect(treeRows[0].SpeciesID).toBe(fixture.speciesIDs[SPECIES_CODE_QUERCO]);

      const [attrRows] = await connection.query<RowDataPacket[]>('SELECT Code FROM cmattributes WHERE CoreMeasurementID = ?', [fixture.coreMeasurementID]);
      expect(attrRows.map(r => r.Code)).toEqual([ATTR_CODE_BROKEN]);
    });
  });

  describe('unknown SpeciesCode', () => {
    it('throws when the SpeciesCode cannot be resolved (safety net for bypassed analyzer)', async () => {
      const plan = buildPlan([{ field: 'SpeciesCode', from: SPECIES_CODE_ACERRU, to: SPECIES_CODE_UNKNOWN }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { SpeciesCode: SPECIES_CODE_UNKNOWN });

      const txID = await cm.beginTransaction();
      await expect(writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID)).rejects.toThrow(/Species not found/);
      await cm.rollbackTransaction(txID);
    });
  });

  // Constraint violations — the writer is the last line of defense. If the analyzer
  // is bypassed or the world races us between preview and apply, the resolvers must
  // refuse the write rather than silently corrupting data or violating
  // ux_trees_treetag_speciesid_censusid / stems unique shape. Each case verifies
  // the thrown message AND that the transaction rollback leaves no trace: the
  // measurement's StemGUID is unchanged, no new tree/stem rows were created, and
  // the original stem still carries this measurement.
  describe('constraint violations', () => {
    it('throws when TreeTag rename collides with an inactive tree for the same species+census', async () => {
      // Seed an inactive tree row that shares the target TreeTag, species, and census.
      // This would trip ux_trees_treetag_speciesid_censusid on INSERT, so the
      // resolver must detect the inactive match and refuse up front.
      const [inactiveRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 0)`, [
        TREE_TAG_NEW,
        fixture.speciesIDs[SPECIES_CODE_ACERRU],
        fixture.censusID
      ]);
      const inactiveTreeID = inactiveRes.insertId;

      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];
      const treeCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      const stemCountBefore = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);

      const plan = buildPlan([{ field: 'TreeTag', from: TREE_TAG_T1, to: TREE_TAG_NEW }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { TreeTag: TREE_TAG_NEW });

      const txID = await cm.beginTransaction();
      await expect(writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID)).rejects.toThrow(/matching tree exists but is inactive/);
      await cm.rollbackTransaction(txID);

      // Rollback invariants: no new trees/stems, measurement still on original stem,
      // the inactive tree seeded above is still the only row with that tag/species.
      const treeCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM trees'))[0] as RowDataPacket[])[0].cnt);
      const stemCountAfter = Number(((await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems'))[0] as RowDataPacket[])[0].cnt);
      expect(treeCountAfter).toBe(treeCountBefore);
      expect(stemCountAfter).toBe(stemCountBefore);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.StemGUID).toBe(stemGUIDBefore);

      const [inactiveTreeRows] = await connection.query<RowDataPacket[]>('SELECT IsActive FROM trees WHERE TreeID = ?', [inactiveTreeID]);
      expect(Number(inactiveTreeRows[0].IsActive)).toBe(0);
    });

    it('throws when StemTag change lands on a stem that exists for the same tree+census in a different quadrat', async () => {
      // Seed a blocking stem: same TreeID (T1) and a new StemTag, but in
      // quadrat B. Our measurement lives in quadrat A on stem S1. Renaming
      // S1 -> STEM_TAG_BLOCK while staying in quadrat A must fail because
      // the stem identity (TreeID, CensusID, StemTag) already exists elsewhere.
      const STEM_TAG_BLOCK = 'WSX';
      const [blockingStem] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, 0, 0, 1)`,
        [fixture.treeIDs[TREE_TAG_T1], fixture.quadratIDs[QUADRAT_NAME_B], fixture.censusID, STEM_TAG_BLOCK]
      );
      const blockingStemGUID = blockingStem.insertId;

      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];

      const plan = buildPlan([{ field: 'StemTag', from: STEM_TAG_S1, to: STEM_TAG_BLOCK }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemTag: STEM_TAG_BLOCK });

      const txID = await cm.beginTransaction();
      await expect(writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID)).rejects.toThrow(/already exists in a different quadrat/);
      await cm.rollbackTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.StemGUID).toBe(stemGUIDBefore);

      // Blocking stem is unchanged (same quadrat B, same StemTag).
      const blockingAfter = await loadStem(connection, blockingStemGUID);
      expect(blockingAfter?.QuadratID).toBe(fixture.quadratIDs[QUADRAT_NAME_B]);
      expect(blockingAfter?.StemTag).toBe(STEM_TAG_BLOCK);
    });

    it('throws when StemTag change collides with an inactive stem for the same tree+census', async () => {
      // Seed an inactive stem with the target StemTag on the same tree+census+quadrat
      // as our measurement. The resolver must detect the inactive match and refuse
      // rather than reactivating the row implicitly.
      const STEM_TAG_INACTIVE = 'WSI';
      const [inactiveStem] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, 0, 0, 0)`,
        [fixture.treeIDs[TREE_TAG_T1], fixture.quadratIDs[QUADRAT_NAME_A], fixture.censusID, STEM_TAG_INACTIVE]
      );
      const inactiveStemGUID = inactiveStem.insertId;

      const stemGUIDBefore = fixture.stemGUIDs[STEM_TAG_S1];

      const plan = buildPlan([{ field: 'StemTag', from: STEM_TAG_S1, to: STEM_TAG_INACTIVE }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemTag: STEM_TAG_INACTIVE });

      const txID = await cm.beginTransaction();
      await expect(writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID)).rejects.toThrow(/matching TreeID .* exists but is inactive/);
      await cm.rollbackTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.StemGUID).toBe(stemGUIDBefore);

      // Inactive stem was not touched.
      const inactiveAfter = await loadStem(connection, inactiveStemGUID);
      expect(Number(inactiveAfter?.IsActive)).toBe(0);
      expect(inactiveAfter?.StemTag).toBe(STEM_TAG_INACTIVE);
    });
  });

  // -----------------------------------------------------------------------
  // Clearable field NULL-write tests
  //
  // These tests verify that explicitly clearing a nullable field writes NULL
  // to the DB — NOT the stale current value. Each test seeds a row with a
  // non-null value, issues a plan change with `to: null`, then asserts the
  // DB column is NULL after apply.
  // -----------------------------------------------------------------------
  describe('explicit field clears write NULL to DB', () => {
    it('clears Description to NULL when the user removes it', async () => {
      const plan = buildPlan([{ field: 'Description', from: 'initial comment', to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { Description: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.Description).toBeNull();
      expect(cmRow.RawComments).toBeNull();
    });

    it('clears Attributes to NULL and removes all cmattributes rows', async () => {
      const attrCountBefore = await countCmAttributes(connection, fixture.coreMeasurementID);
      expect(attrCountBefore).toBeGreaterThan(0);

      const plan = buildPlan([{ field: 'Attributes', from: `${ATTR_CODE_ALIVE}; ${ATTR_CODE_MISSING}`, to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { Attributes: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.RawCodes).toBeNull();

      const attrCountAfter = await countCmAttributes(connection, fixture.coreMeasurementID);
      expect(attrCountAfter).toBe(0);
    });

    it('clears MeasuredDBH to NULL when the user removes it', async () => {
      const plan = buildPlan([{ field: 'MeasuredDBH', from: INITIAL_DBH, to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { MeasuredDBH: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.MeasuredDBH).toBeNull();
    });

    it('clears MeasuredHOM to NULL when the user removes it', async () => {
      const plan = buildPlan([{ field: 'MeasuredHOM', from: INITIAL_HOM, to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { MeasuredHOM: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.MeasuredHOM).toBeNull();
    });

    it('clears StemLocalX to NULL when the user removes it', async () => {
      const plan = buildPlan([{ field: 'StemLocalX', from: INITIAL_STEM_X, to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemLocalX: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.RawX).toBeNull();
    });

    it('clears StemLocalY to NULL when the user removes it', async () => {
      const plan = buildPlan([{ field: 'StemLocalY', from: INITIAL_STEM_Y, to: null }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { StemLocalY: null });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.RawY).toBeNull();
    });

    it('preserves current Description when it is not in the plan (regression: no stale-clear)', async () => {
      // Only change DBH — Description must remain 'initial comment', not become NULL.
      const NEW_DBH = 20.0;
      const plan = buildPlan([{ field: 'MeasuredDBH', from: INITIAL_DBH, to: NEW_DBH }], fixture.coreMeasurementID);
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, { MeasuredDBH: NEW_DBH });

      const txID = await cm.beginTransaction();
      await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const cmRow = await loadCoreMeasurement(connection, fixture.coreMeasurementID);
      expect(cmRow.Description).toBe('initial comment');
      expect(cmRow.RawComments).toBe('initial comment');
    });
  });

  describe('beforeState / afterState snapshots', () => {
    it('captures coremeasurements + stems + cmattributes state on both sides for attribute + identity change', async () => {
      const newAttributes = `${ATTR_CODE_BROKEN}`;
      const plan = buildPlan(
        [
          { field: 'MeasuredDBH', from: INITIAL_DBH, to: INITIAL_DBH + 5 },
          { field: 'Attributes', from: `${ATTR_CODE_ALIVE}; ${ATTR_CODE_MISSING}`, to: newAttributes }
        ],
        fixture.coreMeasurementID
      );
      const input = buildInput(config.database, fixture.plotID, fixture.censusID, fixture.coreMeasurementID, {
        MeasuredDBH: INITIAL_DBH + 5,
        Attributes: newAttributes
      });

      const txID = await cm.beginTransaction();
      const result = await writeMeasurementsSummary(cm, { ...input, transactionID: txID }, plan, txID);
      await cm.commitTransaction(txID);

      const beforeCm = result.beforeState.find(r => r.table === 'coremeasurements');
      expect(beforeCm).toBeDefined();
      expect(beforeCm?.primaryKeyValue).toBe(fixture.coreMeasurementID);
      expect(Number((beforeCm?.row as any).MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);

      const beforeStem = result.beforeState.find(r => r.table === 'stems');
      expect(beforeStem).toBeDefined();
      expect(beforeStem?.primaryKeyValue).toBe(fixture.stemGUIDs[STEM_TAG_S1]);

      const beforeAttrs = result.beforeState.filter(r => r.table === 'cmattributes');
      expect(beforeAttrs.length).toBe(2);
      const beforeAttrCodes = beforeAttrs.map(r => (r.row as any).Code).sort();
      expect(beforeAttrCodes).toEqual([ATTR_CODE_ALIVE, ATTR_CODE_MISSING].sort());

      const afterCm = result.afterState.find(r => r.table === 'coremeasurements');
      expect(afterCm).toBeDefined();
      expect(Number((afterCm?.row as any).MeasuredDBH)).toBeCloseTo(INITIAL_DBH + 5, 2);

      const afterAttrs = result.afterState.filter(r => r.table === 'cmattributes');
      expect(afterAttrs.length).toBe(1);
      expect((afterAttrs[0].row as any).Code).toBe(ATTR_CODE_BROKEN);
    });
  });
});
