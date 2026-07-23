/**
 * Quadrat upload geometry enforcement — server write-boundary integration tests.
 *
 * `app/api/sqlpacketload/route.ts` is the actual trust boundary for quadrat uploads: any
 * non-browser caller, or a browser with client-side preflight validation bypassed, still
 * has to go through this route. These tests call the real POST handler against a live
 * MySQL schema (docker-compose `mysql`) with only `@/auth` mocked (no next-auth runtime in
 * vitest) and `@/lib/db/connectionmanager` bridged to the real test connection so every
 * query -- including the new plot-bounds lookup and the geometry validation it feeds --
 * runs for real, exactly as production data would.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, insertDirectMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Named constants -- no magic numbers/strings
// ---------------------------------------------------------------------------

// Mirrors the plot seeded by setupTestDatabase (frontend/tests/setup/local-db-setup.ts):
// `INSERT INTO plots (..., DimensionX, DimensionY, ...) VALUES (..., 500, 500, ...)`.
const TEST_PLOT_DIMENSION = 500;

// The baseline grid setupTestDatabase seeds: 10 quadrats named Q01..Q10, each 20x20,
// tiled 5 wide starting at the plot origin. Every test resets to this exact layout in
// beforeEach so CLEAN_REUPLOAD tests (which wipe the whole active set) cannot leak state
// into the next test.
const BASELINE_QUADRAT_COUNT = 10;
const BASELINE_QUADRAT_SIZE = 20;
const BASELINE_QUADRATS_PER_ROW = 5;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const INVALID_QUADRAT_GEOMETRY_CODE = 'INVALID_QUADRAT_GEOMETRY';

const UPLOAD_MODE_CLEAN_REUPLOAD = 'clean_reupload';
const UPLOAD_MODE_REVISIONS = 'revisions';

const AUTH_USER_EMAIL = 'quadrat-geometry-test@example.com';
const TRANSACTION_ID_PREFIX = 'quadrat-geometry-tx-';

// ---------------------------------------------------------------------------
// Shared state bridge -- hoisted so the mocked ConnectionManager's closure can read the
// live test connection after beforeAll wires it up (mirrors arcgis-import.integration.test.ts).
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// A 'global' role clears assertSchemaAccess's schema-membership check so these tests
// exercise the geometry trust boundary itself, not an unrelated authz denial.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
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
      sharedState.transactionCounter += 1;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
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

// Route handler imported AFTER the mocks so they are wired before module load.
import { POST } from '@/app/api/sqlpacketload/route';

function buildQuadratUploadRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/sqlpacketload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }) as any;
}

async function resetQuadratsToBaseline(connection: Connection, plotID: number): Promise<void> {
  await connection.query('DELETE FROM quadrats WHERE PlotID = ?', [plotID]);
  for (let i = 0; i < BASELINE_QUADRAT_COUNT; i++) {
    const quadratName = `Q${String(i + 1).padStart(2, '0')}`;
    const startX = (i % BASELINE_QUADRATS_PER_ROW) * BASELINE_QUADRAT_SIZE;
    const startY = Math.floor(i / BASELINE_QUADRATS_PER_ROW) * BASELINE_QUADRAT_SIZE;
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'square')`,
      [plotID, quadratName, startX, startY, BASELINE_QUADRAT_SIZE, BASELINE_QUADRAT_SIZE, BASELINE_QUADRAT_SIZE * BASELINE_QUADRAT_SIZE]
    );
  }
}

async function countActiveQuadrats(connection: Connection, plotID: number): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM quadrats WHERE PlotID = ? AND IsActive = 1', [plotID]);
  return Number(rows[0].count);
}

async function findQuadratByName(connection: Connection, plotID: number, quadratName: string): Promise<RowDataPacket | null> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM quadrats WHERE PlotID = ? AND QuadratName = ? AND IsActive = 1', [plotID, quadratName]);
  return rows.length > 0 ? rows[0] : null;
}

describe('Quadrat upload geometry enforcement (server write boundary)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await resetQuadratsToBaseline(connection, plotID);
  });

  function baseRequestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema: config.database,
      formType: 'quadrats',
      fileName: 'quadrats.csv',
      plot: { plotID },
      census: { dateRanges: [{ censusID }] },
      user: 'Quadrat Geometry Test',
      uploadMode: UPLOAD_MODE_CLEAN_REUPLOAD,
      fileRowSet: {},
      ...overrides
    };
  }

  // =========================================================================
  // Out-of-bounds and cross-boundary trust tests
  // =========================================================================

  it('rejects an out-of-bounds row with 400 and writes nothing', async () => {
    const outOfBoundsRow = {
      quadrat: 'OOB01',
      startx: String(TEST_PLOT_DIMENSION - 10),
      starty: '0',
      dimx: '20', // 490 + 20 = 510 > plot DimensionX (500)
      dimy: '20'
    };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          fileRowSet: { 'row-1': outOfBoundsRow }
        })
      )
    ))!;

    expect(res.status, 'out-of-bounds quadrat must be rejected with 400').toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).toMatch(/dimensionX/i);

    expect(await countActiveQuadrats(connection, plotID), 'the baseline quadrat set must be completely untouched').toBe(BASELINE_QUADRAT_COUNT);
    expect(await findQuadratByName(connection, plotID, 'OOB01'), 'the rejected row must not have been written').toBeNull();
  });

  it('cannot be widened by client-supplied plot.dimensionX/dimensionY in the request body', async () => {
    // Same out-of-bounds row as above, but the request also lies about the plot's own
    // dimensions. If the route trusted this instead of the database row, the upload
    // would appear in-bounds (510 < 10000) and would incorrectly succeed.
    const outOfBoundsRow = {
      quadrat: 'SPOOF01',
      startx: String(TEST_PLOT_DIMENSION - 10),
      starty: '0',
      dimx: '20',
      dimy: '20'
    };
    const inflatedDimension = 10000;

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          plot: { plotID, dimensionX: inflatedDimension, dimensionY: inflatedDimension },
          fileRowSet: { 'row-1': outOfBoundsRow }
        })
      )
    ))!;

    expect(res.status, 'inflated client-supplied plot dimensions must not widen the authoritative DB bounds').toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);

    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
    expect(await findQuadratByName(connection, plotID, 'SPOOF01')).toBeNull();
  });

  it('rejects an internally overlapping file with 400 and writes nothing', async () => {
    const rowA = { quadrat: 'OVLA', startx: '300', starty: '300', dimx: '20', dimy: '20' };
    const rowB = { quadrat: 'OVLB', startx: '310', starty: '310', dimx: '20', dimy: '20' }; // overlaps rowA

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          fileRowSet: { 'row-1': rowA, 'row-2': rowB }
        })
      )
    ))!;

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).toMatch(/overlaps/i);

    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
    expect(await findQuadratByName(connection, plotID, 'OVLA')).toBeNull();
    expect(await findQuadratByName(connection, plotID, 'OVLB')).toBeNull();
  });

  it('rejects a row with a blank StartX with 400', async () => {
    const blankStartXRow = { quadrat: 'BLANK01', startx: '', starty: '0', dimx: '20', dimy: '20' };

    const res = (await POST(buildQuadratUploadRequest(baseRequestBody({ fileRowSet: { 'row-1': blankStartXRow } }))))!;

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).toMatch(/missing, blank, or non-numeric/i);
    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
  });

  it('rejects a row with a non-numeric DimensionX with 400', async () => {
    const nonNumericDimXRow = { quadrat: 'NAN01', startx: '0', starty: '0', dimx: 'twenty', dimy: '20' };

    const res = (await POST(buildQuadratUploadRequest(baseRequestBody({ fileRowSet: { 'row-1': nonNumericDimXRow } }))))!;

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
    expect(await findQuadratByName(connection, plotID, 'NAN01')).toBeNull();
  });

  it('rejects an unsupported reference corner with 400 and the INVALID_QUADRAT_GEOMETRY code', async () => {
    const validRow = { quadrat: 'CORNER01', startx: '0', starty: '0', dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          coordinateReferenceCorner: 'CENTER',
          fileRowSet: { 'row-1': validRow }
        })
      )
    ))!;

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).toMatch(/SW, SE, NW, or NE/);
    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
  });

  // =========================================================================
  // REVISIONS: prospective final layout
  // =========================================================================

  it('REVISIONS: rejects a new row that overlaps an untouched existing quadrat, leaving the existing row unchanged', async () => {
    const EXISTING_NAME = 'REV-EXIST';
    const EXISTING_START = 200;
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, ?, ?, ?, 20, 20, 400, 'square')`,
      [plotID, EXISTING_NAME, EXISTING_START, EXISTING_START]
    );

    // Overlaps [200,220) x [200,220) declared above.
    const overlappingNewRow = { quadrat: 'REV-NEW', startx: '210', starty: '210', dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: { 'row-1': overlappingNewRow }
        })
      )
    ))!;

    expect(res.status, 'a new row overlapping an untouched existing quadrat must be rejected').toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).toMatch(/overlaps/i);

    const existingRow = await findQuadratByName(connection, plotID, EXISTING_NAME);
    expect(existingRow, 'the existing quadrat must still be present').not.toBeNull();
    expect(Number(existingRow!.StartX)).toBe(EXISTING_START);
    expect(Number(existingRow!.StartY)).toBe(EXISTING_START);
    expect(await findQuadratByName(connection, plotID, 'REV-NEW'), 'the rejected new row must not have been written').toBeNull();
  });

  // =========================================================================
  // CLEAN_REUPLOAD: validate before the stem-safety check and before deleting
  // =========================================================================

  it('CLEAN_REUPLOAD: rejects a bad incoming file before the stem-safety check runs or anything is deleted', async () => {
    // Seed a stem on Q01. If geometry validation ran AFTER the stem-safety check (or
    // after the delete), this stem's presence would either change the response (a
    // "Clean re-upload refused: ... already referenced by stems" message) or, worse,
    // the DELETE would already have cascaded the stem away. Neither may happen.
    const speciesCode = testData.species[0].SpeciesCode;
    await insertDirectMeasurements(connection, testData, censusID, [
      {
        treeTag: 'GEOMTREE01',
        stemTag: 'GEOMSTEM1',
        speciesCode,
        quadratName: 'Q01',
        x: 1,
        y: 1,
        dbh: 10,
        hom: 1.3,
        date: '2024-01-01'
      }
    ]);
    const [stemCountBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM stems WHERE IsActive = 1');
    expect(Number(stemCountBefore[0].count), 'precondition: the seeded stem must exist before the request').toBe(1);

    const outOfBoundsRow = { quadrat: 'BADFILE01', startx: String(TEST_PLOT_DIMENSION + 10), starty: '0', dimx: '20', dimy: '20' };

    const res = (await POST(buildQuadratUploadRequest(baseRequestBody({ fileRowSet: { 'row-1': outOfBoundsRow } }))))!;

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    // Must be the geometry error, not the stem-safety refusal -- proves validation ran first.
    expect(body.code).toBe(INVALID_QUADRAT_GEOMETRY_CODE);
    expect(body.error).not.toMatch(/already referenced by stems/i);

    expect(await countActiveQuadrats(connection, plotID), 'existing quadrats must still be present: nothing was deleted').toBe(BASELINE_QUADRAT_COUNT);
    const q01 = await findQuadratByName(connection, plotID, 'Q01');
    expect(q01, 'Q01 must be untouched').not.toBeNull();
    expect(Number(q01!.StartX)).toBe(0);
    expect(Number(q01!.StartY)).toBe(0);

    const [stemCountAfter] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM stems WHERE IsActive = 1');
    expect(Number(stemCountAfter[0].count), 'the seeded stem must not have been cascade-deleted').toBe(1);
  });

  // =========================================================================
  // Reference-corner conversion
  // =========================================================================

  it('a north-east request persists canonical south-west coordinates', async () => {
    const NE_FOOTPRINT_X = 120; // declared NE corner X
    const NE_FOOTPRINT_Y = 120; // declared NE corner Y
    const DIMENSION = 20;
    const EXPECTED_CANONICAL_START = NE_FOOTPRINT_X - DIMENSION; // 100

    const neRow = { quadrat: 'NE01', startx: String(NE_FOOTPRINT_X), starty: String(NE_FOOTPRINT_Y), dimx: String(DIMENSION), dimy: String(DIMENSION) };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          coordinateReferenceCorner: 'NE',
          fileRowSet: { 'row-1': neRow }
        })
      )
    ))!;

    expect(res.status).toBe(HTTP_OK);

    const persisted = await findQuadratByName(connection, plotID, 'NE01');
    expect(persisted, 'the NE-declared quadrat must have been written').not.toBeNull();
    expect(Number(persisted!.StartX), 'StartX must be normalized to the canonical south-west corner').toBe(EXPECTED_CANONICAL_START);
    expect(Number(persisted!.StartY), 'StartY must be normalized to the canonical south-west corner').toBe(EXPECTED_CANONICAL_START);
  });

  it('an undeclared reference corner behaves as south-west (no shift applied)', async () => {
    const swRow = { quadrat: 'SW01', startx: '50', starty: '50', dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          // coordinateReferenceCorner intentionally omitted
          fileRowSet: { 'row-1': swRow }
        })
      )
    ))!;

    expect(res.status).toBe(HTTP_OK);

    const persisted = await findQuadratByName(connection, plotID, 'SW01');
    expect(persisted).not.toBeNull();
    expect(Number(persisted!.StartX)).toBe(50);
    expect(Number(persisted!.StartY)).toBe(50);
  });
});
