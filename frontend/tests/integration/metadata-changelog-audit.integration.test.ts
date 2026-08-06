/**
 * Regression: grid-driven metadata mutations are recorded in `unifiedchangelog`.
 *
 * Before this work, no ForestGEO schema held a single `plots`, `census` or
 * `quadrats` row in its changelog. The table looked healthy — it was full of
 * `file_upload` and ingestion rows — which is exactly what disguised the gap.
 * The motivating defect: on 2026-08-05 `plots.DefaultDBHUnits` was corrected
 * from `mm` to `cm` for Harvard Forest, and the edit was recorded nowhere. That
 * column is the multiplier in two validation thresholds, so an unlogged edit
 * there silently rescales what the system considers a valid measurement.
 *
 * These tests drive the PRODUCTION fixeddata route handlers against real local
 * MySQL — real withRouteAuthz wrapper, real MapperFactory, real
 * ConnectionManager, real SQL — and then read `unifiedchangelog` directly. No
 * hand-built INSERT, no reimplemented writer.
 *
 * The load-bearing test is the atomicity one: it fails if the changelog write
 * ever drifts back to a bare `executeQuery`, which would autocommit
 * independently and leave a log row describing an edit that was rolled back.
 *
 * SAFETY: identical guard to coreapifunctions-patch-atomicity — the suite
 * HARD-FAILS before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import type { Connection, RowDataPacket } from 'mysql2/promise';

// The write path calls getCookie('censusID'); every route calls auth(). Mock
// both so the real handlers + real mapper + real DB run unimpeded. The
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
import { DELETE, PATCH, POST } from '@/app/api/fixeddata/[dataType]/[[...slugs]]/route';
import { NextRequest } from 'next/server';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

const TEST_USER_EMAIL = 'metadata-changelog@forestgeo.test';
const TEST_CENSUS_ID = '1';

// The motivating defect: mm is the schema default, cm is what Harvard collects.
const SEEDED_DBH_UNITS = 'mm';
const CORRECTED_DBH_UNITS = 'cm';

// A primary key guaranteed not to exist in the freshly-seeded quadrats table.
const STALE_QUADRAT_ID = 999999;

// Past the range of a signed INT, so the changelog INSERT is the statement that
// fails while the mutation preceding it has already succeeded.
const OUT_OF_RANGE_CENSUS_ID = 99999999999;

const CHANGELOG_OPERATION = { INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' } as const;

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

interface ChangelogRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: string;
  OldRowState: Record<string, unknown> | string | null;
  NewRowState: Record<string, unknown> | string | null;
  ChangedBy: string | null;
  PlotID: number | null;
  CensusID: number | null;
}

function memberSession(email: string = TEST_USER_EMAIL) {
  return {
    user: {
      email,
      userStatus: 'global',
      sites: [{ schemaName: schema }],
      allsites: [{ schemaName: schema }]
    }
  };
}

/**
 * Reads the changelog through a connection OUTSIDE any of the handler's
 * transactions, so a row is only visible here once it has actually committed.
 */
async function readChangelog(tableName?: string): Promise<ChangelogRow[]> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>(
    tableName
      ? `SELECT * FROM \`${schema}\`.unifiedchangelog WHERE TableName = ? ORDER BY ChangeID`
      : `SELECT * FROM \`${schema}\`.unifiedchangelog ORDER BY ChangeID`,
    tableName ? [tableName] : []
  );
  return rows as unknown as ChangelogRow[];
}

async function truncateChangelog(): Promise<void> {
  await setupConnection!.query(`DELETE FROM \`${schema}\`.unifiedchangelog`);
}

/** The MySQL driver may hand back JSON columns already parsed. */
function rowState(value: ChangelogRow['OldRowState']): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function logChangelog(label: string, rows: ChangelogRow[]): void {
  // eslint-disable-next-line no-console
  console.log(
    `[metadata-changelog-audit] ${label}:`,
    rows.map(row => ({
      TableName: row.TableName,
      RecordID: row.RecordID,
      Operation: row.Operation,
      OldRowState: rowState(row.OldRowState),
      NewRowState: rowState(row.NewRowState),
      ChangedBy: row.ChangedBy,
      PlotID: row.PlotID,
      CensusID: row.CensusID
    }))
  );
}

function buildRequest(method: string, dataType: string, slugs: string[], body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/fixeddata/${dataType}/${slugs.join('/')}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function patchRow(dataType: string, gridIDName: string, oldRow: unknown, newRow: unknown): Promise<Response> {
  const slugs = [schema, gridIDName];
  return PATCH(buildRequest('PATCH', dataType, slugs, { oldRow, newRow }), { params: Promise.resolve({ dataType, slugs }) });
}

async function postRow(dataType: string, gridIDName: string, newRow: unknown): Promise<Response> {
  const slugs = [schema, gridIDName, '1', TEST_CENSUS_ID];
  return POST(buildRequest('POST', dataType, slugs, { newRow }), { params: Promise.resolve({ dataType, slugs }) });
}

async function deleteRow(dataType: string, gridIDName: string, newRow: unknown): Promise<Response> {
  const slugs = [schema, gridIDName, '0'];
  return DELETE(buildRequest('DELETE', dataType, slugs, { newRow }), { params: Promise.resolve({ dataType, slugs }) });
}

async function seededPlot(): Promise<Record<string, unknown>> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>(`SELECT * FROM \`${schema}\`.plots LIMIT 1`);
  expect(rows.length, 'the harness must seed one plot').toBe(1);
  return rows[0] as Record<string, unknown>;
}

/** RDS-shaped (camelCase) plot row, the shape the grid PATCHes with. */
function plotGridRow(plot: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    plotID: Number(plot.PlotID),
    plotName: plot.PlotName,
    locationName: plot.LocationName,
    countryName: plot.CountryName,
    defaultDBHUnits: plot.DefaultDBHUnits
  };
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[metadata-changelog-audit] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;
}, 90000);

beforeEach(async () => {
  // config.mockReset clears these between tests; re-arm them each time.
  vi.mocked(auth).mockResolvedValue(memberSession() as any);
  vi.mocked(getCookie).mockResolvedValue(TEST_CENSUS_ID);
  // Each test asserts on exact row counts, so it starts from an empty log.
  await truncateChangelog();
});

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('the motivating case: an unlogged plots.DefaultDBHUnits correction', () => {
  it('records exactly one UPDATE row that differs on DefaultDBHUnits alone', async () => {
    const plot = await seededPlot();
    expect(plot.DefaultDBHUnits, 'seed must start at the schema default').toBe(SEEDED_DBH_UNITS);

    // The client deliberately lies about another old value. The key is used to
    // locate the row, but neither audit state may trust this stale/forged copy.
    const oldRow = { ...plotGridRow(plot), plotName: 'FORGED CLIENT HISTORY' };
    const response = await patchRow('plots', 'plotID', oldRow, { defaultDBHUnits: CORRECTED_DBH_UNITS });
    expect(response.status, 'the plots PATCH must succeed').toBe(HTTPResponses.OK);

    const rows = await readChangelog('plots');
    logChangelog('plots DefaultDBHUnits correction', rows);

    expect(rows).toHaveLength(1);
    const [entry] = rows;
    expect(entry.Operation).toBe(CHANGELOG_OPERATION.UPDATE);
    expect(entry.RecordID).toBe(String(plot.PlotID));
    expect(entry.ChangedBy).toBe(TEST_USER_EMAIL);
    expect(entry.PlotID).toBe(Number(plot.PlotID));

    const before = rowState(entry.OldRowState)!;
    const after = rowState(entry.NewRowState)!;
    expect(before.DefaultDBHUnits).toBe(SEEDED_DBH_UNITS);
    expect(after.DefaultDBHUnits).toBe(CORRECTED_DBH_UNITS);
    expect(before.PlotName).toBe(plot.PlotName);
    expect(after.PlotName).toBe(plot.PlotName);

    // Field-by-field: the log must show WHICH column moved. Asserting only that
    // a row exists would pass even if both states were identical.
    const changedFields = Object.keys(after).filter(field => JSON.stringify(after[field]) !== JSON.stringify(before[field]));
    expect(changedFields).toEqual(['DefaultDBHUnits']);

    // And the correction actually landed in the plots table.
    const [plotsAfter] = await setupConnection!.query<RowDataPacket[]>(`SELECT DefaultDBHUnits FROM \`${schema}\`.plots WHERE PlotID = ?`, [plot.PlotID]);
    expect(plotsAfter[0].DefaultDBHUnits).toBe(CORRECTED_DBH_UNITS);
  });
});

describe('operation shapes', () => {
  it('records an INSERT with a null OldRowState and the generated key as RecordID', async () => {
    const quadratName = 'CHANGELOG-INSERT-Q';
    const plot = await seededPlot();

    const response = await postRow('quadrats', 'quadratID', {
      quadratID: 0,
      plotID: Number(plot.PlotID),
      quadratName,
      startX: 5,
      startY: 5,
      dimensionX: 20,
      dimensionY: 20,
      area: 400,
      quadratShape: 'square',
      isNew: true
    });
    expect(response.status, 'the quadrats POST must succeed').toBe(HTTPResponses.OK);

    const rows = await readChangelog('quadrats');
    logChangelog('quadrats INSERT', rows);

    expect(rows).toHaveLength(1);
    expect(rows[0].Operation).toBe(CHANGELOG_OPERATION.INSERT);
    expect(rows[0].OldRowState).toBeNull();

    // RecordID must be the key the database generated, not anything the client
    // sent — the payload above claims quadratID 0.
    const [created] = await setupConnection!.query<RowDataPacket[]>(`SELECT QuadratID FROM \`${schema}\`.quadrats WHERE QuadratName = ?`, [quadratName]);
    expect(created).toHaveLength(1);
    expect(rows[0].RecordID).toBe(String(created[0].QuadratID));
    expect(rowState(rows[0].NewRowState)!.QuadratName).toBe(quadratName);
  });

  it('records a DELETE with a null NewRowState and the removed row in OldRowState', async () => {
    const quadratName = 'CHANGELOG-DELETE-Q';
    const plot = await seededPlot();
    await setupConnection!.query(
      `INSERT INTO \`${schema}\`.quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, ?, 1, 2, 20, 20, 400, 'square')`,
      [plot.PlotID, quadratName]
    );
    const [seeded] = await setupConnection!.query<RowDataPacket[]>(`SELECT QuadratID FROM \`${schema}\`.quadrats WHERE QuadratName = ?`, [quadratName]);
    const quadratID = Number(seeded[0].QuadratID);
    await truncateChangelog();

    const response = await deleteRow('quadrats', 'quadratID', { id: 1, quadratID, quadratName });
    expect(response.status, 'the quadrats DELETE must succeed').toBe(HTTPResponses.OK);

    const rows = await readChangelog('quadrats');
    logChangelog('quadrats DELETE', rows);

    expect(rows).toHaveLength(1);
    expect(rows[0].Operation).toBe(CHANGELOG_OPERATION.DELETE);
    expect(rows[0].RecordID).toBe(String(quadratID));
    expect(rows[0].NewRowState).toBeNull();

    // The full removed row, read from the table before it was deleted — not the
    // partial payload the request carried.
    const removed = rowState(rows[0].OldRowState)!;
    expect(removed.QuadratID).toBe(quadratID);
    expect(removed.QuadratName).toBe(quadratName);
    expect(Number(removed.StartX)).toBe(1);
    expect(Number(removed.StartY)).toBe(2);

    const [gone] = await setupConnection!.query<RowDataPacket[]>(`SELECT QuadratID FROM \`${schema}\`.quadrats WHERE QuadratID = ?`, [quadratID]);
    expect(gone).toHaveLength(0);
  });

  it('fans a single alltaxonomiesview POST out into family, genus and species rows', async () => {
    const speciesCode = 'CHGLOG';
    const response = await postRow('alltaxonomiesview', 'speciesID', {
      speciesID: 0,
      family: 'Changelogaceae',
      genus: 'Changelogus',
      genusAuthority: 'Test.',
      speciesCode,
      speciesName: 'auditus',
      idLevel: 'species',
      isNew: true
    });
    expect(response.status, 'the alltaxonomiesview POST must succeed').toBe(HTTPResponses.OK);

    const rows = await readChangelog();
    logChangelog('alltaxonomiesview fan-out', rows);

    // One row per REAL table. A single row named after the view would hide which
    // of the three actually changed.
    expect(rows.map(row => row.TableName)).toEqual(['family', 'genus', 'species']);

    const [createdSpecies] = await setupConnection!.query<RowDataPacket[]>(`SELECT SpeciesID, GenusID FROM \`${schema}\`.species WHERE SpeciesCode = ?`, [
      speciesCode
    ]);
    expect(createdSpecies).toHaveLength(1);
    // The species id used to be discarded entirely by the handler.
    expect(rows[2].RecordID).toBe(String(createdSpecies[0].SpeciesID));
    expect(rows[1].RecordID).toBe(String(createdSpecies[0].GenusID));
  });
});

describe('the log never describes a change that did not commit', () => {
  it('writes no changelog row when the mutation fails mid-transaction', async () => {
    const plot = await seededPlot();
    const oldRow = plotGridRow(plot);

    // DefaultDBHUnits is an ENUM; a value outside it is rejected by MySQL under
    // STRICT_TRANS_TABLES, failing the UPDATE inside the handler's transaction.
    const response = await patchRow('plots', 'plotID', oldRow, { ...oldRow, defaultDBHUnits: 'parsecs' });
    expect(response.status, 'an invalid enum value must not report success').not.toBe(HTTPResponses.OK);

    const rows = await readChangelog();
    logChangelog('after a failed plots PATCH', rows);

    // REGRESSION SENTINEL: if the changelog write ever drifts back to a bare
    // executeQuery it will autocommit on its own pool connection, and this row
    // will survive the rollback of the edit it claims to describe.
    expect(rows, 'a rolled-back edit must leave no log row').toHaveLength(0);

    const [unchanged] = await setupConnection!.query<RowDataPacket[]>(`SELECT DefaultDBHUnits FROM \`${schema}\`.plots WHERE PlotID = ?`, [plot.PlotID]);
    expect(unchanged[0].DefaultDBHUnits).toBe(plot.DefaultDBHUnits);
  });

  it('rejects an out-of-range census scope before opening a mutation transaction', async () => {
    const quadratName = 'CHANGELOG-AUDIT-FAILURE-Q';
    const plot = await seededPlot();

    // CensusID is an INT. Rejecting the slug at the HTTP boundary avoids doing a
    // valid data write that would only fail later in the audit insert.
    const slugs = [schema, 'quadratID', '1', String(OUT_OF_RANGE_CENSUS_ID)];
    const response = await POST(
      buildRequest('POST', 'quadrats', slugs, {
        newRow: {
          quadratID: 0,
          plotID: Number(plot.PlotID),
          quadratName,
          startX: 5,
          startY: 5,
          dimensionX: 20,
          dimensionY: 20,
          area: 400,
          quadratShape: 'square',
          isNew: true
        }
      }),
      { params: Promise.resolve({ dataType: 'quadrats', slugs }) }
    );
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);

    const [orphan] = await setupConnection!.query<RowDataPacket[]>(`SELECT QuadratID FROM \`${schema}\`.quadrats WHERE QuadratName = ?`, [quadratName]);
    expect(orphan, 'invalid scope input must not reach the mutation').toHaveLength(0);
    expect(await readChangelog()).toHaveLength(0);
  });

  it('writes no changelog row when a PATCH matches zero rows', async () => {
    const staleRow = {
      id: 1,
      quadratID: STALE_QUADRAT_ID,
      quadratName: 'Ghost quadrat (stale key)',
      startX: 0
    };

    const response = await patchRow('quadrats', 'quadratID', staleRow, { ...staleRow, startX: 99 });
    expect(response.status, 'a zero-row UPDATE must surface NOT_FOUND').toBe(HTTPResponses.NOT_FOUND);

    const rows = await readChangelog();
    logChangelog('after a stale-key PATCH', rows);
    // A stale-key edit is not a change; logging it would put a row in the
    // changelog that no committed mutation corresponds to.
    expect(rows).toHaveLength(0);
  });

  it('writes no changelog row when a DELETE matches zero rows', async () => {
    const response = await deleteRow('quadrats', 'quadratID', { id: 1, quadratID: STALE_QUADRAT_ID });
    expect(response.status).toBe(HTTPResponses.OK);

    const rows = await readChangelog();
    logChangelog('after a no-match DELETE', rows);
    expect(rows).toHaveLength(0);
  });
});

describe('ChangedBy attribution', () => {
  it('truncates an over-length session identity instead of rolling the edit back', async () => {
    // ChangedBy is varchar(64). Under STRICT_TRANS_TABLES an over-length value
    // raises ER_DATA_TOO_LONG — and because the changelog write shares the
    // mutation's transaction, that would roll back the user's legitimate edit.
    const longEmail = `${'a'.repeat(100 - '@si.edu'.length)}@si.edu`;
    expect(longEmail.length).toBeGreaterThan(CHANGED_BY_MAX_LENGTH);
    vi.mocked(auth).mockResolvedValue(memberSession(longEmail) as any);

    const plot = await seededPlot();
    const oldRow = plotGridRow(plot);
    const editedName = 'Test Plot LONG-IDENTITY';

    const response = await patchRow('plots', 'plotID', oldRow, { ...oldRow, plotName: editedName });
    expect(response.status, 'a long identity must not cost the user their edit').toBe(HTTPResponses.OK);

    const rows = await readChangelog('plots');
    logChangelog('long session identity', rows);

    expect(rows).toHaveLength(1);
    expect(rows[0].ChangedBy).toHaveLength(CHANGED_BY_MAX_LENGTH);
    expect(rows[0].ChangedBy).toBe(longEmail.slice(0, CHANGED_BY_MAX_LENGTH));

    const [persisted] = await setupConnection!.query<RowDataPacket[]>(`SELECT PlotName FROM \`${schema}\`.plots WHERE PlotID = ?`, [plot.PlotID]);
    expect(persisted[0].PlotName).toBe(editedName);
  });
});
