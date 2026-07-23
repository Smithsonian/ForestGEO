/**
 * Task 8: end-to-end proof that a north-east referenced provisioning run
 * persists canonical south-west coordinates.
 *
 * `quadrats.StartX`/`StartY` are always south-west by DB convention. Some
 * sites label their CSV by the north-east corner instead, so the request
 * schema's `.transform()` (`canonicalizeProvisioningRequest` in
 * lib/provisioning/input-schema.ts, via `normalizeToSouthwest`) converts the
 * declared corner to canonical south-west exactly once, at the trust
 * boundary, before the row is ever persisted.
 *
 * This suite proves "exactly once" end-to-end by driving the real route
 * (POST /api/admin/provision is async: it returns 202 and the orchestrator
 * finishes the run on a `setImmediate`-scheduled worker, so we poll
 * `catalog.provisioning_runs.Status` to a terminal state rather than reading
 * site-schema rows immediately) and submitting the *same physical layout*
 * twice — once already-canonical and declared SW, once corner-shifted and
 * declared NE — then asserting the persisted `quadrats` rows are identical
 * AND match the known-canonical fixture. Comparing only NE-run-vs-SW-run
 * would miss a bug that shifts both runs the same wrong way; pinning both
 * runs against the hand-computed canonical fixture closes that gap.
 *
 * Unlike sibling admin-provision route tests, this file deliberately does
 * NOT mock `setImmediate` — the whole point is to let the real background
 * worker run both provisioning jobs to completion so we can read real
 * `quadrats` rows out of two real site schemas.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createTestPool, seedCatalogTables, clearProvisioningState, makeRequest, GLOBAL_SESSION, TEST_SCHEMA_PREFIX } from './_shared';
import { HTTPResponses } from '@/config/macros';
import type { QuadratCsvRow, QuadratReferenceCorner } from '@/lib/provisioning/types';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ailogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/ailogger', () => ({ default: mocks.ailogger }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));

let testPool: Pool;
vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => ({ pool: testPool })
}));

import { POST } from '@/app/api/admin/provision/route';

const POST_URL = 'http://test/api/admin/provision';
const SW_SCHEMA = TEST_SCHEMA_PREFIX + 'corner_sw';
const NE_SCHEMA = TEST_SCHEMA_PREFIX + 'corner_ne';
const OOB_NE_SCHEMA = TEST_SCHEMA_PREFIX + 'corner_ne_oob';

const QUADRAT_SIDE = 20;
const PLOT_SIDE = 100;
// Every other row in CANONICAL_SW_ROWS is a 20x20 square, so shiftX and
// shiftY are numerically identical for them regardless of which dimension
// feeds which axis — an X/Y-transposed normalizeToSouthwest bug is invisible
// against a square row. RECT_DIMENSION_X != RECT_DIMENSION_Y makes the
// rectangular row's correct south-west position provably distinct from what
// a transposed shift would produce, so the bug can only pass this suite by
// accident (see the mutation proof in the task write-up, not asserted here).
const RECT_DIMENSION_X = 30;
const RECT_DIMENSION_Y = 10;
const POLL_INTERVAL_MS = 200;
// Two full provisioning runs (create_schema, init_tables, deploy_procedures,
// seed_validations, apply_migrations, insert_catalog_row, insert_plot,
// insert_census, insert_quadrats, verify) run concurrently below; each run
// gets its own budget.
const RUN_TIMEOUT_MS = 60_000;

/**
 * The physical layout under test, already expressed as canonical south-west
 * rows. Deliberately includes:
 *   - an origin quadrat (Q_00_00) — the row that goes negative under a
 *     doubled normalization (0 - dimension < 0)
 *   - a quadrat flush against the plot's far edge (Q_80_80_FAR_EDGE, whose
 *     NE-declared coordinate is exactly the plot's 100x100 boundary) — the
 *     row that overflows the bounds check under a missing normalization
 *   - two off-diagonal quadrats so a swapped X/Y shift would also be caught
 *   - a rectangular (non-square) quadrat, Q_50_20_RECT — every other row here
 *     is 20x20, and a square quadrat can't distinguish a correct normalization
 *     from one with dimensionX/dimensionY transposed between the two axes,
 *     since the shift is numerically identical either way. Placed at
 *     (50, 20)-(80, 30): clear of every other row (nearest neighbors are
 *     Q_40_00 at (40,0)-(60,20), touching only at the y=20 edge, and
 *     Q_40_40/Q_80_80_FAR_EDGE, both clear on both axes) under the correct
 *     transform, so it fails only on wrong coordinates, never on a spurious
 *     overlap.
 */
const CANONICAL_SW_ROWS: readonly QuadratCsvRow[] = [
  { quadratName: 'Q_00_00', startX: 0, startY: 0, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE },
  { quadratName: 'Q_40_00', startX: 40, startY: 0, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE },
  { quadratName: 'Q_00_40', startX: 0, startY: 40, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE },
  { quadratName: 'Q_40_40', startX: 40, startY: 40, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE },
  { quadratName: 'Q_80_80_FAR_EDGE', startX: 80, startY: 80, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE },
  { quadratName: 'Q_50_20_RECT', startX: 50, startY: 20, dimensionX: RECT_DIMENSION_X, dimensionY: RECT_DIMENSION_Y }
];

/**
 * Derives the north-east-declared rows describing the exact same physical
 * layout as CANONICAL_SW_ROWS, so the two submissions provably can't drift
 * apart: a north-east corner's StartX/StartY is the south-west corner's
 * StartX/StartY plus the quadrat's own width/height.
 */
function deriveNortheastDeclaredRows(swRows: readonly QuadratCsvRow[]): QuadratCsvRow[] {
  return swRows.map(row => ({
    quadratName: row.quadratName,
    startX: row.startX + row.dimensionX,
    startY: row.startY + row.dimensionY,
    dimensionX: row.dimensionX,
    dimensionY: row.dimensionY
  }));
}

function buildProvisioningRequestBody(schemaName: string, siteName: string, rows: QuadratCsvRow[], coordinateReferenceCorner: QuadratReferenceCorner) {
  return {
    site: {
      siteName,
      schemaName,
      sqDimX: QUADRAT_SIDE,
      sqDimY: QUADRAT_SIDE,
      defaultUOMDBH: 'cm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'Corner Reference Test Location',
      country: 'Corner Reference Test Country'
    },
    plot: {
      plotName: 'Corner Reference Test Plot',
      dimensionX: PLOT_SIDE,
      dimensionY: PLOT_SIDE,
      area: PLOT_SIDE * PLOT_SIDE,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square' as const,
      description: 'coordinate-reference-corner.integration.test.ts fixture',
      defaultDimensionUnits: 'm' as const,
      defaultCoordinateUnits: 'm' as const,
      defaultAreaUnits: 'm2' as const,
      defaultDBHUnits: 'cm' as const,
      defaultHOMUnits: 'm' as const
    },
    quadrats: {
      mode: 'csv' as const,
      rows,
      coordinateReferenceCorner
    }
  };
}

/**
 * Polls `catalog.provisioning_runs.Status` until it reaches a terminal state.
 * POST /api/admin/provision returns 202 and dispatches the actual work
 * asynchronously, so reading site-schema rows without first reaching a
 * terminal status here would be a race.
 */
async function waitForTerminalStatus(pool: Pool, runId: number): Promise<string> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [rows]: any = await pool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    if (rows.length === 0) {
      throw new Error(`Run ${runId} vanished from catalog.provisioning_runs while polling for a terminal status`);
    }
    const status: string = rows[0].Status ?? rows[0].status;
    if (status !== 'running') return status;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Run ${runId} did not reach a terminal status within ${RUN_TIMEOUT_MS}ms`);
}

/**
 * On a `failed` run, surfaces the recorded step error(s) from
 * `catalog.provisioning_steps` so a test failure is debuggable instead of a
 * bare "expected 'completed', got 'failed'".
 */
async function throwIfRunFailed(pool: Pool, runId: number, status: string): Promise<void> {
  if (status !== 'failed') return;
  const [steps]: any = await pool.query(
    `SELECT StepIndex, StepKey, ErrorMessage FROM catalog.provisioning_steps
     WHERE RunID = ? AND ErrorMessage IS NOT NULL
     ORDER BY StepIndex`,
    [runId]
  );
  const detail = steps.map((s: any) => `  step ${s.StepIndex ?? s.stepindex} (${s.StepKey ?? s.stepkey}): ${s.ErrorMessage ?? s.errormessage}`).join('\n');
  throw new Error(`Run ${runId} failed instead of completing.\n${detail || '  (no step recorded an ErrorMessage)'}`);
}

interface PersistedQuadratRow {
  QuadratName: string;
  StartX: number;
  StartY: number;
  DimensionX: number;
  DimensionY: number;
}

/** Reads persisted quadrats rows back, ordered and with decimals cast to numbers. */
async function readQuadratRows(pool: Pool, schemaName: string): Promise<PersistedQuadratRow[]> {
  const [rows]: any = await pool.query(
    `SELECT QuadratName, StartX, StartY, DimensionX, DimensionY
     FROM \`${schemaName}\`.quadrats
     ORDER BY QuadratName`
  );
  return rows.map((r: any) => ({
    QuadratName: r.QuadratName ?? r.quadratname,
    StartX: Number(r.StartX ?? r.startx),
    StartY: Number(r.StartY ?? r.starty),
    DimensionX: Number(r.DimensionX ?? r.dimensionx),
    DimensionY: Number(r.DimensionY ?? r.dimensiony)
  }));
}

function toExpectedPersistedRows(rows: readonly QuadratCsvRow[]): PersistedQuadratRow[] {
  return [...rows]
    .sort((a, b) => a.quadratName.localeCompare(b.quadratName))
    .map(row => ({
      QuadratName: row.quadratName,
      StartX: row.startX,
      StartY: row.startY,
      DimensionX: row.dimensionX,
      DimensionY: row.dimensionY
    }));
}

async function schemaExists(pool: Pool, schemaName: string): Promise<boolean> {
  const [rows]: any = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [schemaName]);
  return rows.length > 0;
}

describe('coordinate reference corner (integration): NE input persists as canonical SW', () => {
  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
  }, 90_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    await clearProvisioningState(testPool, SW_SCHEMA);
    await clearProvisioningState(testPool, NE_SCHEMA);
    await clearProvisioningState(testPool, OOB_NE_SCHEMA);
  });

  afterAll(async () => {
    await clearProvisioningState(testPool, SW_SCHEMA);
    await clearProvisioningState(testPool, NE_SCHEMA);
    await clearProvisioningState(testPool, OOB_NE_SCHEMA);
    await testPool.end();
  });

  it(
    'a north-east declared run and a south-west declared run of the same physical layout persist byte-identical, canonical quadrats rows',
    async () => {
      const swBody = buildProvisioningRequestBody(SW_SCHEMA, 'Corner Reference SW', [...CANONICAL_SW_ROWS], 'SW');
      const neRows = deriveNortheastDeclaredRows(CANONICAL_SW_ROWS);
      const neBody = buildProvisioningRequestBody(NE_SCHEMA, 'Corner Reference NE', neRows, 'NE');

      // Sanity-check the derivation itself before trusting anything downstream:
      // the NE rows must actually differ from the SW rows (otherwise this test
      // could pass by comparing a submission against itself).
      expect(neRows).not.toEqual([...CANONICAL_SW_ROWS]);
      expect(Math.max(...neRows.map(r => r.startX))).toBe(PLOT_SIDE);
      expect(Math.max(...neRows.map(r => r.startY))).toBe(PLOT_SIDE);

      const [swRes, neRes] = await Promise.all([
        POST(makeRequest(POST_URL, { method: 'POST', body: swBody })),
        POST(makeRequest(POST_URL, { method: 'POST', body: neBody }))
      ]);

      expect(swRes.status).toBe(HTTPResponses.ACCEPTED);
      expect(neRes.status).toBe(HTTPResponses.ACCEPTED);
      const { runId: swRunId } = await swRes.json();
      const { runId: neRunId } = await neRes.json();
      expect(typeof swRunId).toBe('number');
      expect(typeof neRunId).toBe('number');

      const [swStatus, neStatus] = await Promise.all([waitForTerminalStatus(testPool, swRunId), waitForTerminalStatus(testPool, neRunId)]);
      await throwIfRunFailed(testPool, swRunId, swStatus);
      await throwIfRunFailed(testPool, neRunId, neStatus);
      expect(swStatus).toBe('completed');
      expect(neStatus).toBe('completed');

      const [swQuadrats, neQuadrats] = await Promise.all([readQuadratRows(testPool, SW_SCHEMA), readQuadratRows(testPool, NE_SCHEMA)]);
      const expectedRows = toExpectedPersistedRows(CANONICAL_SW_ROWS);

      // Pin both runs against the hand-computed canonical fixture, not just
      // against each other — a bug that shifts BOTH runs the same wrong way
      // (e.g. a broken shared constant) would slip past a bare ne===sw check.
      expect(swQuadrats).toEqual(expectedRows);
      expect(neQuadrats).toEqual(expectedRows);
      expect(neQuadrats).toEqual(swQuadrats);

      const [neRunRows]: any = await testPool.query(`SELECT InputPayload FROM catalog.provisioning_runs WHERE RunID = ?`, [neRunId]);
      const rawInputPayload = neRunRows[0].InputPayload ?? neRunRows[0].inputpayload;
      // mysql2 auto-parses MySQL JSON columns into objects; only string rows
      // (shouldn't happen for this driver, but mirrors orchestrator.ts's own
      // parseStoredInput defensively) need an explicit JSON.parse.
      const storedNeInput = typeof rawInputPayload === 'string' ? JSON.parse(rawInputPayload) : rawInputPayload;
      expect(storedNeInput.quadrats.coordinates).toBe('canonical-sw');
      expect(storedNeInput.quadrats.sourceCoordinateReferenceCorner).toBe('NE');
      expect(storedNeInput.quadrats.rows).toEqual([...CANONICAL_SW_ROWS]);
    },
    RUN_TIMEOUT_MS + 30_000
  );

  it('rejects an out-of-bounds NE payload with 400 and creates no schema and no catalog row', async () => {
    // Declared NE at (10, 10) with a 20x20 quadrat normalizes to canonical
    // SW (-10, -10) — negative, so out of bounds — regardless of any
    // normalization bug. This is a genuine validation case, not a
    // self-check mutation.
    const outOfBoundsRow: QuadratCsvRow = { quadratName: 'Q_OOB', startX: 10, startY: 10, dimensionX: QUADRAT_SIDE, dimensionY: QUADRAT_SIDE };
    const body = buildProvisioningRequestBody(OOB_NE_SCHEMA, 'Corner Reference OOB', [outOfBoundsRow], 'NE');

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body }));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const responseBody = await res.json();
    expect(Array.isArray(responseBody.errors)).toBe(true);
    expect(responseBody.errors.length).toBeGreaterThan(0);
    expect(responseBody.errors.some((e: { message: string }) => /negative start coordinate/.test(e.message))).toBe(true);

    const [runs]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE SchemaName = ?`, [OOB_NE_SCHEMA]);
    expect(runs).toHaveLength(0);

    const [sites]: any = await testPool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [OOB_NE_SCHEMA]);
    expect(sites).toHaveLength(0);

    expect(await schemaExists(testPool, OOB_NE_SCHEMA)).toBe(false);
  }, 30_000);
});
