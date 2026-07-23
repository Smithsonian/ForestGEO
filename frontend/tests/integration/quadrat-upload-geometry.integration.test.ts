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
import {
  buildQuadratOverlapAcknowledgment,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
  validateQuadratCollectionDetailed
} from '@/lib/provisioning/quadrat-collection-validation';

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
const OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE = 'QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT';

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

  it('holds an internally overlapping file for acknowledgment with 400 and writes nothing', async () => {
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
    expect(body.code).toBe(OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE);
    expect(body.error).toMatch(/overlaps/i);

    expect(await countActiveQuadrats(connection, plotID)).toBe(BASELINE_QUADRAT_COUNT);
    expect(await findQuadratByName(connection, plotID, 'OVLA')).toBeNull();
    expect(await findQuadratByName(connection, plotID, 'OVLB')).toBeNull();
  });

  it('commits an overlapping file when acknowledged and stores the acknowledgment text in the changelog', async () => {
    // Overlapping footprints can be real field measurements (e.g. SERC's surveyed widths
    // exceed the grid pitch), so with an explicit acknowledgment the layout is valid data.
    const rowA = { quadrat: 'ACKA', startx: '300', starty: '300', dimx: '20', dimy: '20' };
    const rowB = { quadrat: 'ACKB', startx: '310', starty: '310', dimx: '20', dimy: '20' };
    const overlapSummary = validateQuadratCollectionDetailed(
      [
        { quadratName: 'ACKA', startX: 300, startY: 300, dimensionX: 20, dimensionY: 20 },
        { quadratName: 'ACKB', startX: 310, startY: 310, dimensionX: 20, dimensionY: 20 }
      ],
      { dimensionX: TEST_PLOT_DIMENSION, dimensionY: TEST_PLOT_DIMENSION },
      'SW'
    ).overlapSummary;
    if (!overlapSummary) throw new Error('expected overlap summary');

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          quadratOverlapAcknowledgment: buildQuadratOverlapAcknowledgment([overlapSummary.layoutSignature]),
          fileRowSet: { 'row-1': rowA, 'row-2': rowB }
        })
      )
    ))!;

    expect(res.status, 'acknowledged overlaps must commit').toBe(HTTP_OK);
    expect(await findQuadratByName(connection, plotID, 'ACKA')).not.toBeNull();
    expect(await findQuadratByName(connection, plotID, 'ACKB')).not.toBeNull();

    const [changelogRows] = await connection.query<RowDataPacket[]>(
      `SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = 'quadrats.csv' ORDER BY ChangeID DESC LIMIT 1`
    );
    expect(changelogRows.length, 'the file_upload changelog entry must exist').toBe(1);
    const metadata = typeof changelogRows[0].NewRowState === 'string' ? JSON.parse(changelogRows[0].NewRowState) : changelogRows[0].NewRowState;
    expect(metadata.overlapAcknowledgment.statement).toBe(QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT);
    expect(metadata.overlapAcknowledgment.summaries[0].pairs.some((pair: { message: string }) => pair.message.includes('ACKA'))).toBe(true);
    expect(metadata.overlapAcknowledgment.acknowledgedBy).toBeDefined();
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

    expect(res.status, 'a new row overlapping an untouched existing quadrat must be held for acknowledgment').toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE);
    expect(body.error).toMatch(/overlaps/i);

    const existingRow = await findQuadratByName(connection, plotID, EXISTING_NAME);
    expect(existingRow, 'the existing quadrat must still be present').not.toBeNull();
    expect(Number(existingRow!.StartX)).toBe(EXISTING_START);
    expect(Number(existingRow!.StartY)).toBe(EXISTING_START);
    expect(await findQuadratByName(connection, plotID, 'REV-NEW'), 'the rejected new row must not have been written').toBeNull();
  });

  it('REVISIONS: accepts the exact server-challenged existing-layout overlap after confirmation', async () => {
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, 'CHALLENGE-EXISTING', 200, 200, 20, 20, 400, 'square')`,
      [plotID]
    );
    const fileRowSet = { 'row-1': { quadrat: 'CHALLENGE-NEW', startx: '210', starty: '210', dimx: '20', dimy: '20' } };
    const requestBody = baseRequestBody({ uploadMode: UPLOAD_MODE_REVISIONS, fileRowSet });

    const challengeResponse = (await POST(buildQuadratUploadRequest(requestBody)))!;
    expect(challengeResponse.status).toBe(HTTP_BAD_REQUEST);
    const challenge = await challengeResponse.json();
    const signature = challenge.overlapSummaries?.[0]?.layoutSignature;
    expect(signature).toMatch(/^quadrat-layout-v1-[0-9a-f]{16}$/);

    const confirmedResponse = (await POST(
      buildQuadratUploadRequest({
        ...requestBody,
        quadratOverlapAcknowledgment: buildQuadratOverlapAcknowledgment([signature])
      })
    ))!;
    expect(confirmedResponse.status).toBe(HTTP_OK);
    expect(await findQuadratByName(connection, plotID, 'CHALLENGE-NEW')).not.toBeNull();
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

  // =========================================================================
  // Legacy database state tolerance -- the write boundary against a DIRTY database.
  //
  // Production schemas contain rows written before this boundary existed: quadrats with
  // NULL geometry or NULL names (all geometry columns are nullable), plots without recorded
  // dimensions, and layouts with pre-existing overlaps. These tests seed those exact states
  // via raw SQL -- the same shape the old upload code produced -- and prove the boundary
  // tolerates what it must (no plot lockouts) while still blocking what it should.
  // =========================================================================

  it('LEGACY: a revision elsewhere in the plot succeeds despite an existing quadrat with NULL stored geometry', async () => {
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, 'LEGACY-NULL', NULL, NULL, NULL, NULL, NULL, 'square')`,
      [plotID]
    );

    const unrelatedRow = { quadrat: 'FARAWAY01', startx: '300', starty: '300', dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: { 'row-1': unrelatedRow }
        })
      )
    ))!;

    expect(res.status, 'a malformed legacy row the upload never names must not block the plot').toBe(HTTP_OK);
    expect(await findQuadratByName(connection, plotID, 'FARAWAY01'), 'the unrelated new row must have been written').not.toBeNull();

    const legacyRow = await findQuadratByName(connection, plotID, 'LEGACY-NULL');
    expect(legacyRow, 'the legacy row must be untouched').not.toBeNull();
    expect(legacyRow!.StartX, 'the legacy row geometry must still be NULL (not silently repaired)').toBeNull();
  });

  it('LEGACY: a revision can repair the very quadrat whose stored geometry is NULL', async () => {
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, 'LEGACY-REPAIR', NULL, NULL, NULL, NULL, NULL, 'square')`,
      [plotID]
    );
    const before = await findQuadratByName(connection, plotID, 'LEGACY-REPAIR');
    expect(before!.StartX, 'precondition: seeded geometry must be NULL').toBeNull();

    const REPAIRED_START = 300;
    const repairRow = { quadrat: 'LEGACY-REPAIR', startx: String(REPAIRED_START), starty: String(REPAIRED_START), dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: { 'row-1': repairRow }
        })
      )
    ))!;

    expect(res.status, 'naming the malformed row must repair it, not reject the upload').toBe(HTTP_OK);
    await expect(res.json()).resolves.toMatchObject({ insertedCount: 0, updatedCount: 1 });

    const after = await findQuadratByName(connection, plotID, 'LEGACY-REPAIR');
    expect(after!.QuadratID, 'the repair must update the existing row, not insert a duplicate').toBe(before!.QuadratID);
    expect(Number(after!.StartX)).toBe(REPAIRED_START);
    expect(Number(after!.StartY)).toBe(REPAIRED_START);
  });

  it('LEGACY: an unnamed (NULL QuadratName) quadrat still holds an overlapping revision for acknowledgment', async () => {
    const UNNAMED_START = 300;
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, NULL, ?, ?, 20, 20, 400, 'square')`,
      [plotID, UNNAMED_START, UNNAMED_START]
    );

    const overlappingRow = { quadrat: 'OVERUNNAMED', startx: String(UNNAMED_START + 10), starty: String(UNNAMED_START + 10), dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: { 'row-1': overlappingRow }
        })
      )
    ))!;

    expect(res.status, 'an unnamed quadrat occupies real area and must participate in the overlap check').toBe(HTTP_BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE);
    expect(body.error).toMatch(/unnamed QuadratID/i);
    expect(await findQuadratByName(connection, plotID, 'OVERUNNAMED')).toBeNull();
  });

  it('LEGACY: two pre-existing overlapping quadrats do not block an unrelated revision', async () => {
    const PREEXISTING_START = 200;
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, 'PREOVL-A', ?, ?, 20, 20, 400, 'square'), (?, 'PREOVL-B', ?, ?, 20, 20, 400, 'square')`,
      [plotID, PREEXISTING_START, PREEXISTING_START, plotID, PREEXISTING_START + 10, PREEXISTING_START + 10]
    );

    const unrelatedRow = { quadrat: 'ELSEWHERE01', startx: '400', starty: '400', dimx: '20', dimy: '20' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: { 'row-1': unrelatedRow }
        })
      )
    ))!;

    expect(res.status, 'defects the upload did not introduce must not reject it').toBe(HTTP_OK);
    expect(await findQuadratByName(connection, plotID, 'ELSEWHERE01')).not.toBeNull();
    expect(await findQuadratByName(connection, plotID, 'PREOVL-A'), 'pre-existing rows must be untouched').not.toBeNull();
    expect(await findQuadratByName(connection, plotID, 'PREOVL-B')).not.toBeNull();
  });

  it('LEGACY: NULL plot dimensions skip only the bounds checks -- valid uploads pass, overlapping files still fail', async () => {
    await connection.query('UPDATE plots SET DimensionX = NULL, DimensionY = NULL WHERE PlotID = ?', [plotID]);
    try {
      // Far outside the nominal 500x500 plot: only possible because bounds checks are skipped.
      const beyondNominalBounds = { quadrat: 'NODIMS01', startx: String(TEST_PLOT_DIMENSION * 2), starty: '0', dimx: '20', dimy: '20' };

      const okRes = (await POST(buildQuadratUploadRequest(baseRequestBody({ fileRowSet: { 'row-1': beyondNominalBounds } }))))!;
      expect(okRes.status, 'a plot without recorded dimensions must not be locked out of quadrat uploads').toBe(HTTP_OK);
      expect(await findQuadratByName(connection, plotID, 'NODIMS01')).not.toBeNull();

      const rowA = { quadrat: 'NODIMS-OVL-A', startx: '0', starty: '0', dimx: '20', dimy: '20' };
      const rowB = { quadrat: 'NODIMS-OVL-B', startx: '10', starty: '10', dimx: '20', dimy: '20' };
      const overlapRes = (await POST(buildQuadratUploadRequest(baseRequestBody({ fileRowSet: { 'row-1': rowA, 'row-2': rowB } }))))!;
      expect(overlapRes.status, 'degraded validation must still hold unacknowledged overlaps').toBe(HTTP_BAD_REQUEST);
      const body = await overlapRes.json();
      expect(body.code).toBe(OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE);
      expect(body.error).toMatch(/overlaps/i);
    } finally {
      await connection.query('UPDATE plots SET DimensionX = ?, DimensionY = ? WHERE PlotID = ?', [TEST_PLOT_DIMENSION, TEST_PLOT_DIMENSION, plotID]);
    }
  });

  it('LEGACY: entirely-blank padding rows are skipped and counted, not fatal', async () => {
    const validRow = { quadrat: 'PAD01', startx: '0', starty: '0', dimx: '20', dimy: '20' };
    const paddingRow = { quadrat: '', startx: '', starty: '', dimx: '', dimy: '' };

    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          fileRowSet: { 'row-1': validRow, 'row-2': paddingRow }
        })
      )
    ))!;

    expect(res.status).toBe(HTTP_OK);
    await expect(res.json()).resolves.toMatchObject({ insertedCount: 1, skippedCount: 1 });
    expect(await findQuadratByName(connection, plotID, 'PAD01')).not.toBeNull();
    // CLEAN_REUPLOAD replaced the baseline with exactly the one usable row.
    expect(await countActiveQuadrats(connection, plotID)).toBe(1);
  });

  it('LEGACY: a replacement grid over the provisioning placeholder grid gets the divergence guidance, not a raw overlap error', async () => {
    // Placeholder names must match SEQUENTIAL_QUADRAT_NAME_PATTERN (Q + 5 digits).
    await connection.query('DELETE FROM quadrats WHERE PlotID = ?', [plotID]);
    const PLACEHOLDER_SIZE = 20;
    for (let i = 0; i < 4; i++) {
      const name = `Q${String(i + 1).padStart(5, '0')}`;
      const startX = (i % 2) * PLACEHOLDER_SIZE;
      const startY = Math.floor(i / 2) * PLACEHOLDER_SIZE;
      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'square')`,
        [plotID, name, startX, startY, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE * PLACEHOLDER_SIZE]
      );
    }

    // A real replacement grid tiling the same area under researcher naming: every row
    // geometrically overlaps a placeholder, so if geometry validation ran before the
    // divergence guard the user would get pairwise overlap errors instead of guidance.
    const res = (await POST(
      buildQuadratUploadRequest(
        baseRequestBody({
          uploadMode: UPLOAD_MODE_REVISIONS,
          fileRowSet: {
            'row-1': { quadrat: 'C01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
            'row-2': { quadrat: 'C02', startx: '20', starty: '0', dimx: '20', dimy: '20' },
            'row-3': { quadrat: 'C03', startx: '0', starty: '20', dimx: '20', dimy: '20' }
          }
        })
      )
    ))!;

    expect(res.status, 'the divergence refusal is a generic (non-geometry) error and surfaces as 503').not.toBe(HTTP_OK);
    const body = await res.json();
    expect(body.error).toMatch(/appears to replace the generated placeholder grid/i);
    expect(body.error).not.toMatch(/overlaps quadrat/i);

    expect(await countActiveQuadrats(connection, plotID), 'the placeholder grid must be untouched').toBe(4);
    expect(await findQuadratByName(connection, plotID, 'C01'), 'no replacement row may have been written').toBeNull();
  });
});
