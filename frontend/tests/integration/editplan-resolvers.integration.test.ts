import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — vi.mock factories are hoisted, so the mock adapter
// cannot close over the `connection` local below. A hoisted container lets
// the adapter read the live connection once beforeAll has initialized it.
// Mirrors the pattern used by editoperations.integration.test.ts.
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
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: transaction already active');
      }
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };

  return {
    default: {
      getInstance: () => manager
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Imports below must come after vi.mock calls so the mocked ConnectionManager
// is the one wired into the module under test.
import ConnectionManager from '@/config/connectionmanager';
import {
  CONFLICT_REASON_DIFFERENT_QUADRAT,
  CONFLICT_REASON_INACTIVE_STEM,
  CONFLICT_REASON_INACTIVE_TREE,
  planQuadratResolution,
  planStemResolution,
  planTreeResolution,
  resolveSpeciesByCode
} from '@/config/editplan/resolvers';

// ---------------------------------------------------------------------------
// Fixture constants — named to avoid magic strings/numbers in assertions.
// ---------------------------------------------------------------------------
const SPECIES_CODE_AA = 'ACERRU';
const SPECIES_CODE_BB = 'QUERCO';
const SPECIES_CODE_UNKNOWN = 'ZZZZZZ';
const SPECIES_CODE_LOWERCASE = 'acerru';

const TREE_TAG_100 = 'T100';
const TREE_TAG_200 = 'T200';
const TREE_TAG_INACTIVE = 'T300-inactive';
const TREE_TAG_DOES_NOT_EXIST = 'T-missing';

// StemTag is varchar(10) so all labels must be <=10 chars.
const STEM_TAG_ON_TREE_100 = 'S100A';
const STEM_TAG_ON_TREE_100_SECOND = 'S100B';
const STEM_TAG_ON_TREE_200 = 'S200A';
const STEM_TAG_INACTIVE_BLOCKER = 'SINACT';
const STEM_TAG_DIFFERENT_QUADRAT = 'SQUAD';
const STEM_TAG_BRAND_NEW = 'SNEW';

const QUADRAT_NAME_A = 'QTA';
const QUADRAT_NAME_B = 'QTB';
const QUADRAT_NAME_UNKNOWN = 'QNONE';

interface FixtureIDs {
  plotID: number;
  censusID: number;
  speciesIDs: Record<string, number>;
  treeIDs: Record<string, number>;
  quadratIDs: Record<string, number>;
  stemGUIDs: Record<string, number>;
  inactiveTreeID: number;
}

async function seedResolverFixture(connection: Connection, testData: TestData): Promise<FixtureIDs> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  // Species IDs for the two codes we care about (seeded by default fixture)
  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?, ?)', [
    SPECIES_CODE_AA,
    SPECIES_CODE_BB
  ]);
  const speciesIDs: Record<string, number> = {};
  for (const row of speciesRows) {
    speciesIDs[row.SpeciesCode as string] = row.SpeciesID as number;
  }

  // Add two dedicated quadrats for resolver tests (default fixture has 10
  // unrelated quadrats, but we want predictable names/IDs here)
  const quadratIDs: Record<string, number> = {};
  for (const quadratName of [QUADRAT_NAME_A, QUADRAT_NAME_B]) {
    const [insertRes] = await connection.query<ResultSetHeader>(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
      [plotID, quadratName]
    );
    quadratIDs[quadratName] = insertRes.insertId;
  }

  // Two active trees + one inactive tree (same tag/species/census combo cannot
  // repeat because of the unique constraint, so inactive uses a distinct tag).
  const treeIDs: Record<string, number> = {};
  for (const treeTag of [TREE_TAG_100, TREE_TAG_200]) {
    const [insertRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
      treeTag,
      speciesIDs[SPECIES_CODE_AA],
      censusID
    ]);
    treeIDs[treeTag] = insertRes.insertId;
  }
  const [inactiveTreeRes] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 0)`, [
    TREE_TAG_INACTIVE,
    speciesIDs[SPECIES_CODE_AA],
    censusID
  ]);
  const inactiveTreeID = inactiveTreeRes.insertId;
  treeIDs[TREE_TAG_INACTIVE] = inactiveTreeID;

  // Stems:
  //  - Tree 100 has two active stems in QUADRAT_NAME_A (so moving one away
  //    leaves exactly one remaining on the source tree)
  //  - Tree 200 has one active stem in QUADRAT_NAME_A (used as the "exact
  //    match" destination target)
  //  - Tree 100 has an INACTIVE stem with tag STEM_TAG_INACTIVE_BLOCKER
  //    (used to assert the inactive-blocker conflict path)
  //  - Tree 100 has an ACTIVE stem with tag STEM_TAG_DIFFERENT_QUADRAT in
  //    QUADRAT_NAME_B (used to assert the different-quadrat conflict path)
  const stemGUIDs: Record<string, number> = {};

  const stemSeeds: Array<{
    label: string;
    treeTag: string;
    stemTag: string;
    quadratName: string;
    isActive: 0 | 1;
  }> = [
    { label: STEM_TAG_ON_TREE_100, treeTag: TREE_TAG_100, stemTag: STEM_TAG_ON_TREE_100, quadratName: QUADRAT_NAME_A, isActive: 1 },
    { label: STEM_TAG_ON_TREE_100_SECOND, treeTag: TREE_TAG_100, stemTag: STEM_TAG_ON_TREE_100_SECOND, quadratName: QUADRAT_NAME_A, isActive: 1 },
    { label: STEM_TAG_ON_TREE_200, treeTag: TREE_TAG_200, stemTag: STEM_TAG_ON_TREE_200, quadratName: QUADRAT_NAME_A, isActive: 1 },
    { label: STEM_TAG_INACTIVE_BLOCKER, treeTag: TREE_TAG_100, stemTag: STEM_TAG_INACTIVE_BLOCKER, quadratName: QUADRAT_NAME_A, isActive: 0 },
    { label: STEM_TAG_DIFFERENT_QUADRAT, treeTag: TREE_TAG_100, stemTag: STEM_TAG_DIFFERENT_QUADRAT, quadratName: QUADRAT_NAME_B, isActive: 1 }
  ];

  for (const stem of stemSeeds) {
    const [insertRes] = await connection.query<ResultSetHeader>(`INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, IsActive) VALUES (?, ?, ?, ?, ?)`, [
      treeIDs[stem.treeTag],
      quadratIDs[stem.quadratName],
      censusID,
      stem.stemTag,
      stem.isActive
    ]);
    stemGUIDs[stem.label] = insertRes.insertId;
  }

  return {
    plotID,
    censusID,
    speciesIDs,
    treeIDs,
    quadratIDs,
    stemGUIDs,
    inactiveTreeID
  };
}

async function countRows(connection: Connection, table: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return Number(rows[0].cnt);
}

describe('editplan/resolvers (integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let fixture: FixtureIDs;
  const cm = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
    fixture = await seedResolverFixture(connection, testData);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(() => {
    sharedState.activeTransactionID = null;
  });

  describe('resolveSpeciesByCode', () => {
    it('returns a SpeciesID for a known active code', async () => {
      const result = await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_AA);
      expect(result.speciesID).toBe(fixture.speciesIDs[SPECIES_CODE_AA]);
    });

    it('matches case-insensitively', async () => {
      const result = await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_LOWERCASE);
      expect(result.speciesID).toBe(fixture.speciesIDs[SPECIES_CODE_AA]);
    });

    it('returns null for an unknown code', async () => {
      const result = await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_UNKNOWN);
      expect(result.speciesID).toBeNull();
    });

    it('does not write rows (species count unchanged)', async () => {
      const before = await countRows(connection, 'species');
      await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_AA);
      await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_UNKNOWN);
      const after = await countRows(connection, 'species');
      expect(after).toBe(before);
    });
  });

  describe('planTreeResolution', () => {
    it('returns existingTreeID and wouldCreate=false when tree exists and is active', async () => {
      const result = await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_100,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: null
      });
      expect(result.existingTreeID).toBe(fixture.treeIDs[TREE_TAG_100]);
      expect(result.wouldCreate).toBe(false);
      expect(result.sourceTreeID).toBeNull();
      expect(result.sourceTreeRemainingStems).toBe(0);
    });

    it('returns wouldCreate=true and existingTreeID=null when tree does not exist', async () => {
      const result = await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_DOES_NOT_EXIST,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: null
      });
      expect(result.existingTreeID).toBeNull();
      expect(result.wouldCreate).toBe(true);
    });

    it('treats an inactive tree row as a conflict (existingTreeID=null, wouldCreate=false, conflictReason set)', async () => {
      // An inactive row with the same TreeTag+SpeciesID+CensusID collides with
      // the unique constraint ux_trees_treetag_speciesid_censusid, so the
      // planner cannot adopt the tombstone AND cannot safely promise an
      // INSERT either. It flags the conflict for the caller.
      const result = await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_INACTIVE,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: null
      });
      expect(result.existingTreeID).toBeNull();
      expect(result.wouldCreate).toBe(false);
      expect(result.conflictReason).toBe(CONFLICT_REASON_INACTIVE_TREE);
    });

    it('reports sourceTreeRemainingStems = (active stem count on currentTreeID) - 1 when moving away', async () => {
      // Ground-truth the invariant against a freshly-measured active stem
      // count so the assertion remains valid regardless of how many stems the
      // fixture attaches to TREE_TAG_100 (the seed attaches STEM_TAG_ON_TREE_100,
      // STEM_TAG_ON_TREE_100_SECOND, and STEM_TAG_DIFFERENT_QUADRAT — three
      // active stems — plus one inactive blocker).
      const [activeStemRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM stems WHERE TreeID = ? AND IsActive = 1', [
        fixture.treeIDs[TREE_TAG_100]
      ]);
      const activeStemCount = Number(activeStemRows[0].cnt);
      // Sanity check: the fixture must seed at least two active stems on the
      // source tree for this assertion to be meaningful (so count-1 > 0).
      expect(activeStemCount).toBeGreaterThanOrEqual(2);

      const result = await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_200,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: fixture.treeIDs[TREE_TAG_100]
      });
      expect(result.existingTreeID).toBe(fixture.treeIDs[TREE_TAG_200]);
      expect(result.wouldCreate).toBe(false);
      expect(result.sourceTreeID).toBe(fixture.treeIDs[TREE_TAG_100]);
      expect(result.sourceTreeRemainingStems).toBe(activeStemCount - 1);
    });

    it('reports sourceTreeRemainingStems = 0 when the edit keeps the measurement on the same tree', async () => {
      const result = await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_100,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: fixture.treeIDs[TREE_TAG_100]
      });
      expect(result.existingTreeID).toBe(fixture.treeIDs[TREE_TAG_100]);
      expect(result.sourceTreeRemainingStems).toBe(0);
    });

    it('does not write rows (trees count unchanged)', async () => {
      const before = await countRows(connection, 'trees');
      await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_DOES_NOT_EXIST,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: fixture.treeIDs[TREE_TAG_100]
      });
      const after = await countRows(connection, 'trees');
      expect(after).toBe(before);
    });
  });

  describe('planStemResolution', () => {
    it('returns the existingStemGUID when a tree/census/tag/quadrat quad matches exactly', async () => {
      const result = await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_200],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_ON_TREE_200,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      expect(result.existingStemGUID).toBe(fixture.stemGUIDs[STEM_TAG_ON_TREE_200]);
      expect(result.wouldCreate).toBe(false);
      expect(result.conflictReason).toBeUndefined();
    });

    it('returns wouldCreate=true when no row matches', async () => {
      const result = await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_BRAND_NEW,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      expect(result.existingStemGUID).toBeNull();
      expect(result.wouldCreate).toBe(true);
      expect(result.conflictReason).toBeUndefined();
    });

    it('returns conflictReason when the matching stem is inactive', async () => {
      const result = await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_INACTIVE_BLOCKER,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      expect(result.existingStemGUID).toBeNull();
      expect(result.wouldCreate).toBe(false);
      expect(result.conflictReason).toBe(CONFLICT_REASON_INACTIVE_STEM);
    });

    it('returns conflictReason when an active stem with the same tag lives in a different quadrat', async () => {
      const result = await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_DIFFERENT_QUADRAT,
        // Ask for the stem in quadrat A, but it actually lives in quadrat B
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      expect(result.existingStemGUID).toBeNull();
      expect(result.wouldCreate).toBe(false);
      expect(result.conflictReason).toBe(CONFLICT_REASON_DIFFERENT_QUADRAT);
    });

    it('does not write rows (stems count unchanged) across all four code paths', async () => {
      const before = await countRows(connection, 'stems');
      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_200],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_ON_TREE_200,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_BRAND_NEW,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_INACTIVE_BLOCKER,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_DIFFERENT_QUADRAT,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      const after = await countRows(connection, 'stems');
      expect(after).toBe(before);
    });
  });

  describe('planQuadratResolution', () => {
    it('returns the QuadratID for a known active quadrat name', async () => {
      const result = await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_A,
        PlotID: fixture.plotID
      });
      expect(result.quadratID).toBe(fixture.quadratIDs[QUADRAT_NAME_A]);
    });

    it('matches case-insensitively', async () => {
      const result = await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_A.toLowerCase(),
        PlotID: fixture.plotID
      });
      expect(result.quadratID).toBe(fixture.quadratIDs[QUADRAT_NAME_A]);
    });

    it('returns null for an unknown quadrat name', async () => {
      const result = await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_UNKNOWN,
        PlotID: fixture.plotID
      });
      expect(result.quadratID).toBeNull();
    });

    it('does not write rows (quadrats count unchanged)', async () => {
      const before = await countRows(connection, 'quadrats');
      await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_A,
        PlotID: fixture.plotID
      });
      await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_UNKNOWN,
        PlotID: fixture.plotID
      });
      const after = await countRows(connection, 'quadrats');
      expect(after).toBe(before);
    });
  });

  describe('no-writes invariant across all planners', () => {
    it('leaves species/trees/stems/quadrats row counts unchanged after exercising every planner', async () => {
      const snapshot = {
        species: await countRows(connection, 'species'),
        trees: await countRows(connection, 'trees'),
        stems: await countRows(connection, 'stems'),
        quadrats: await countRows(connection, 'quadrats')
      };

      await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_AA);
      await resolveSpeciesByCode(cm, config.database, SPECIES_CODE_UNKNOWN);

      await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_100,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: null
      });
      await planTreeResolution(cm, config.database, {
        TreeTag: TREE_TAG_DOES_NOT_EXIST,
        SpeciesID: fixture.speciesIDs[SPECIES_CODE_AA],
        CensusID: fixture.censusID,
        currentTreeID: fixture.treeIDs[TREE_TAG_100]
      });

      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_200],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_ON_TREE_200,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });
      await planStemResolution(cm, config.database, {
        TreeID: fixture.treeIDs[TREE_TAG_100],
        CensusID: fixture.censusID,
        StemTag: STEM_TAG_BRAND_NEW,
        QuadratID: fixture.quadratIDs[QUADRAT_NAME_A],
        currentStemGUID: null
      });

      await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_A,
        PlotID: fixture.plotID
      });
      await planQuadratResolution(cm, config.database, {
        QuadratName: QUADRAT_NAME_UNKNOWN,
        PlotID: fixture.plotID
      });

      expect(await countRows(connection, 'species')).toBe(snapshot.species);
      expect(await countRows(connection, 'trees')).toBe(snapshot.trees);
      expect(await countRows(connection, 'stems')).toBe(snapshot.stems);
      expect(await countRows(connection, 'quadrats')).toBe(snapshot.quadrats);
    });
  });
});
