/**
 * Regression: reference-data PATCH persistence + zero-row failure (Task 7).
 *
 * These tests drive the PRODUCTION fixeddata route handlers against real local
 * MySQL — no hand-built UPDATE, no reimplemented mapper:
 *
 *   - WRITE goes through the exported `PATCH` of
 *     app/api/fixeddata/[dataType]/[[...slugs]]/route.ts, which runs the real
 *     withRouteAuthz wrapper and then config/macros/coreapifunctions::PATCH ->
 *     MapperFactory.getMapper(dataType).demapData(...) -> the real
 *     `UPDATE ?? SET ? WHERE ?? = ?` -> ConnectionManager.withTransaction.
 *   - READ-BACK goes through the exported `GET` of the same route (the exact
 *     paginated SELECT + MapperFactory.mapData the app's grid uses), so a value
 *     is asserted "visible" the same way the UI would see it.
 *
 * What it proves:
 *   1. A species-name edit persists and is visible via the production read.
 *   2. A quadrat coordinate (StartY) edit persists and is visible.
 *   3. A stale/missing primary key (0 affected rows) can NEVER be reported as
 *      success — the handler returns HTTPResponses.NOT_FOUND, creates no row,
 *      and mutates nothing else. This is the regression sentinel: if the
 *      affectedRows guard in coreapifunctions::PATCH were removed, the handler
 *      would return 200 and this assertion would go red.
 *   3b. A no-op edit (re-saving an EXISTING row with its current value) must be
 *      reported as success (200), NOT 404. The pool uses mysql2's default flags
 *      (which include FOUND_ROWS), so affectedRows counts matched rows and a
 *      matched-but-unchanged UPDATE reports affectedRows >= 1 — the guard leaves
 *      it alone. This pins the user-facing contract that an unchanged re-save
 *      succeeds; only a genuinely missing key is a 404.
 *   4. `CensusID` is EXCLUDED from species/quadrat writes: a payload that
 *      carries censusID still succeeds (species/quadrats have no CensusID
 *      column, so an un-stripped CensusID in the SET clause would raise
 *      ER_BAD_FIELD_ERROR / a 500). Success is therefore proof of exclusion.
 *
 * SAFETY: identical guard to coreapifunctions-patch-atomicity — the suite
 * HARD-FAILS before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import type { Connection } from 'mysql2/promise';

// The write path calls getCookie('censusID'); the read/write routes call auth().
// Mock both so the real handlers + real mapper + real DB run unimpeded. The
// connectionmanager is intentionally NOT mocked — these are real-DB tests.
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(),
  getCookieOrDefault: vi.fn(),
  submitCookie: vi.fn(),
  deleteCookie: vi.fn()
}));

import { auth } from '@/auth';
import { getCookie } from '@/app/actions/cookiemanager';
import { GET, PATCH } from '@/app/api/fixeddata/[dataType]/[[...slugs]]/route';
import { NextRequest } from 'next/server';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

// Read a page wide enough to include every seeded reference row.
const READ_PAGE = '0';
const READ_PAGE_SIZE = '1000';

// Session context for the route authz wrapper: a member of the test schema.
const TEST_USER_EMAIL = 'reference-data-patch@forestgeo.test';
const TEST_CENSUS_ID = '1';

// A primary key guaranteed not to exist in the freshly-seeded species table.
const STALE_SPECIES_ID = 999999;

// Seed species codes we edit (from local-db-setup seedSampleData).
const PERSIST_SPECIES_CODE = 'TILIAA';
const NOOP_SPECIES_CODE = 'PINUST';
const NOOP_SPECIES_NAME = 'Pinus strobus NOOP-STATE';
const CENSUS_EXCLUSION_SPECIES_CODE = 'FRAXAM';
const EDITED_SPECIES_NAME = 'Tilia americana EDITED-PERSIST';
const CENSUS_EXCLUSION_SPECIES_NAME = 'Fraxinus americana EDITED-NO-CENSUSID';

// Seed quadrat we edit; Q06 has a non-zero StartY (20) so the read round-trip
// is unambiguous, and we move it to a distinct decimal value.
const EDITED_QUADRAT_NAME = 'Q06';
const EDITED_START_Y = 33.75;

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

interface ReferenceRow {
  [key: string]: unknown;
}

function memberSession() {
  return {
    user: {
      email: TEST_USER_EMAIL,
      userStatus: 'global',
      sites: [{ schemaName: schema }],
      allsites: [{ schemaName: schema }]
    }
  };
}

/** Read reference rows through the production GET route (real mapper). */
async function readReferenceRows(dataType: string): Promise<ReferenceRow[]> {
  const slugs = [schema, READ_PAGE, READ_PAGE_SIZE];
  const request = new NextRequest(`http://localhost/api/fixeddata/${dataType}/${slugs.join('/')}`);
  const response = await GET(request, { params: Promise.resolve({ dataType, slugs }) });
  expect(response.status, `GET ${dataType} should return OK`).toBe(HTTPResponses.OK);
  const body = (await response.json()) as { output: ReferenceRow[] };
  return body.output;
}

/** Write through the production PATCH route (real authz wrapper + real mapper). */
async function patchReferenceRow(dataType: string, gridIDName: string, oldRow: ReferenceRow, newRow: ReferenceRow): Promise<Response> {
  const slugs = [schema, gridIDName];
  const request = new NextRequest(`http://localhost/api/fixeddata/${dataType}/${slugs.join('/')}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oldRow, newRow })
  });
  return PATCH(request, { params: Promise.resolve({ dataType, slugs }) });
}

function findByField(rows: ReferenceRow[], field: string, value: unknown): ReferenceRow | undefined {
  return rows.find(row => row[field] === value);
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[reference-data-patch] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;
}, 90000);

beforeEach(() => {
  // config.mockReset clears these between tests; re-arm them each time.
  vi.mocked(auth).mockResolvedValue(memberSession() as any);
  vi.mocked(getCookie).mockResolvedValue(TEST_CENSUS_ID);
});

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('reference-data PATCH persistence (species + quadrats) via the production route', () => {
  it('persists a species-name edit and exposes it through the production read path', async () => {
    const before = await readReferenceRows('species');
    const target = findByField(before, 'speciesCode', PERSIST_SPECIES_CODE);
    expect(target, `seed species ${PERSIST_SPECIES_CODE} must exist`).toBeDefined();
    const speciesID = target!.speciesID;
    expect(target!.speciesName).not.toBe(EDITED_SPECIES_NAME);

    const response = await patchReferenceRow('species', 'speciesID', target!, { ...target!, speciesName: EDITED_SPECIES_NAME });
    expect(response.status, 'species PATCH should succeed').toBe(HTTPResponses.OK);

    const after = await readReferenceRows('species');
    const updated = findByField(after, 'speciesID', speciesID);
    expect(updated, 'edited species must still be readable').toBeDefined();
    expect(updated!.speciesName).toBe(EDITED_SPECIES_NAME);
    // Row count unchanged: an UPDATE must not create a new row.
    expect(after.length).toBe(before.length);
  });

  it('persists a quadrat StartY edit and exposes it through the production read path', async () => {
    const before = await readReferenceRows('quadrats');
    const target = findByField(before, 'quadratName', EDITED_QUADRAT_NAME);
    expect(target, `seed quadrat ${EDITED_QUADRAT_NAME} must exist`).toBeDefined();
    const quadratID = target!.quadratID;
    expect(Number(target!.startY)).not.toBe(EDITED_START_Y);

    const response = await patchReferenceRow('quadrats', 'quadratID', target!, { ...target!, startY: EDITED_START_Y });
    expect(response.status, 'quadrat PATCH should succeed').toBe(HTTPResponses.OK);

    const after = await readReferenceRows('quadrats');
    const updated = findByField(after, 'quadratID', quadratID);
    expect(updated, 'edited quadrat must still be readable').toBeDefined();
    expect(Number(updated!.startY)).toBe(EDITED_START_Y);
    expect(after.length).toBe(before.length);
  });
});

describe('reference-data PATCH missing-vs-unchanged distinction', () => {
  it('returns OK for a no-op edit (re-saving an existing row with its current value)', async () => {
    const before = await readReferenceRows('species');
    const target = findByField(before, 'speciesCode', NOOP_SPECIES_CODE);
    expect(target, `seed species ${NOOP_SPECIES_CODE} must exist`).toBeDefined();
    const speciesID = target!.speciesID;

    // First apply establishes a known stored state.
    const newRow = { ...target!, speciesName: NOOP_SPECIES_NAME };
    const firstResponse = await patchReferenceRow('species', 'speciesID', target!, newRow);
    expect(firstResponse.status, 'seeding write must succeed').toBe(HTTPResponses.OK);

    // Second apply sends the IDENTICAL payload: the row exists and already holds
    // every value, so nothing changes. This is the no-op the guard must NOT treat
    // as a missing row. On this pool mysql2's default FOUND_ROWS makes a matched
    // UPDATE report affectedRows >= 1, so the affectedRows===0 guard never fires.
    const secondResponse = await patchReferenceRow('species', 'speciesID', newRow, { ...newRow });
    expect(secondResponse.status, 'an unchanged (no-op) edit on an existing row must succeed, not 404').toBe(HTTPResponses.OK);

    const after = await readReferenceRows('species');
    const stillThere = findByField(after, 'speciesID', speciesID);
    expect(stillThere, 'no-op edit must leave the row present').toBeDefined();
    expect(stillThere!.speciesName).toBe(NOOP_SPECIES_NAME);
    expect(after.length).toBe(before.length);
  });

  it('returns NOT_FOUND for a stale species key, creates no row, and mutates nothing else', async () => {
    const before = await readReferenceRows('species');
    expect(findByField(before, 'speciesID', STALE_SPECIES_ID), 'stale id must not pre-exist').toBeUndefined();
    const witness = findByField(before, 'speciesCode', PERSIST_SPECIES_CODE);
    expect(witness, 'witness species must exist').toBeDefined();
    const witnessNameBefore = witness!.speciesName;

    const staleOldRow: ReferenceRow = {
      id: 1,
      speciesID: STALE_SPECIES_ID,
      speciesCode: 'GHOST',
      speciesName: 'Ghost species (stale key)'
    };
    const response = await patchReferenceRow('species', 'speciesID', staleOldRow, {
      ...staleOldRow,
      speciesName: 'Ghost species EDITED (should not persist)'
    });

    // REGRESSION SENTINEL: without the affectedRows guard this would be 200.
    expect(response.status, 'a zero-row UPDATE must NOT report success').toBe(HTTPResponses.NOT_FOUND);

    const after = await readReferenceRows('species');
    // No row created for the stale key.
    expect(findByField(after, 'speciesID', STALE_SPECIES_ID), 'no row created for stale key').toBeUndefined();
    // Nothing else mutated: same count, witness untouched.
    expect(after.length).toBe(before.length);
    expect(findByField(after, 'speciesCode', PERSIST_SPECIES_CODE)!.speciesName).toBe(witnessNameBefore);
  });
});

describe('reference-data PATCH excludes CensusID from species/quadrat writes', () => {
  it('accepts a species payload carrying censusID (proof it is stripped from the SET clause)', async () => {
    const before = await readReferenceRows('species');
    const target = findByField(before, 'speciesCode', CENSUS_EXCLUSION_SPECIES_CODE);
    expect(target, `seed species ${CENSUS_EXCLUSION_SPECIES_CODE} must exist`).toBeDefined();
    const speciesID = target!.speciesID;

    // Inject censusID into the payload. species has NO CensusID column, so if the
    // handler did not strip it the generated `UPDATE species SET CensusID = ?, ...`
    // would fail with ER_BAD_FIELD_ERROR (surfaced as a 500). A 200 here means the
    // mapper/handler omitted CensusID from the write.
    const response = await patchReferenceRow('species', 'speciesID', target!, {
      ...target!,
      speciesName: CENSUS_EXCLUSION_SPECIES_NAME,
      censusID: 424242
    });
    expect(response.status, 'CensusID must be excluded so the write still succeeds').toBe(HTTPResponses.OK);

    const after = await readReferenceRows('species');
    const updated = findByField(after, 'speciesID', speciesID);
    expect(updated!.speciesName).toBe(CENSUS_EXCLUSION_SPECIES_NAME);
  });
});
