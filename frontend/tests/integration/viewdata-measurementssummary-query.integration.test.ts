/**
 * View Data's fixeddatafilter measurementssummary branch against real MySQL (View Data spec, Testing → Integration).
 * ConnectionManager is routed to the test connection, as in fixeddatafilter-authz.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { insertDirectMeasurements, seedStatusAttributes, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { refreshMeasurementsSummaryForScope } from '@/lib/measurementviewrefresh';
import { MEASUREMENT_STATUS_RANK, MEASUREMENT_STATUS_VISIBLE_BUCKET } from '@/config/measurementstatefilters';
import { HTTPResponses } from '@/config/macros';
import type ConnectionManager from '@/lib/db/connectionmanager';

const sharedState = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'viewdata-query@forestgeo.test', userStatus: 'global', sites: [] } }) }));
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } }));
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const { runQuery } = await import('@/lib/db/primitives');
      return runQuery(sharedState.connection as never, query, params);
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

const ALL_VISIBLE = ['errors', 'valid', 'pending'];
const ALL_TSS = ['old tree', 'multi stem', 'new recruit'];
const FULL_PAGE = 100;
const SMALL_PAGE = 4;
const SEEDED_ROW_COUNT = 13;
const SMALL_PAGES = Math.ceil(SEEDED_ROW_COUNT / SMALL_PAGE);
const INACTIVE_STATUS_CODE = 'ZA';
const VALIDATION_CODE_INVALID_ATTRIBUTE = '14';
const EFFECTIVE_CODE = 'ZD';
const LITERAL_QUESTION_MARK_TAG = 'VD-Q?1';

let connection: Connection;
let testData: TestData;
let schema: string;
let plotID: number;
let censusID: number;
let plotCensusNumber: number;
const tagToID = new Map<string, number>();

async function errorID(source: string, code: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [source, code]);
  return Number(rows[0].ErrorID);
}

async function logError(tag: string, source: string, code: string) {
  await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)', [
    tagToID.get(tag),
    await errorID(source, code)
  ]);
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  totalCount: number;
}

async function queryWithTotal(body: { filterModel?: Record<string, unknown>; sortModel?: unknown[] }, page = 0, pageSize = FULL_PAGE): Promise<QueryResult> {
  const { POST } = await import('@/app/api/fixeddatafilter/[dataType]/[[...slugs]]/route');
  const filterModel = { items: [], quickFilterValues: [], visible: ALL_VISIBLE, tss: ALL_TSS, ...(body.filterModel ?? {}) };
  const response = await POST(
    new Request('http://localhost/api/fixeddatafilter', {
      method: 'POST',
      body: JSON.stringify({ filterModel, sortModel: body.sortModel }),
      headers: { 'content-type': 'application/json' }
    }) as never,
    {
      params: Promise.resolve({ dataType: 'measurementssummary', slugs: [schema, String(page), String(pageSize), String(plotID), String(plotCensusNumber)] })
    } as never
  );
  const json = await response.json();
  expect(response.status, JSON.stringify(json)).toBe(HTTPResponses.OK);
  const rows = json.output as Array<Record<string, unknown>>;
  console.log('[viewdata query]', JSON.stringify({ body, page, pageSize, tags: rows.map(row => row.treeTag), total: json.totalCount }));
  return { rows, totalCount: Number(json.totalCount) };
}

async function query(body: { filterModel?: Record<string, unknown>; sortModel?: unknown[] }, page = 0, pageSize = FULL_PAGE) {
  return (await queryWithTotal(body, page, pageSize)).rows;
}

async function queryEveryPage(body: { sortModel?: unknown[] }): Promise<Array<Array<Record<string, unknown>>>> {
  const pages: Array<Array<Record<string, unknown>>> = [];
  for (let page = 0; page < SMALL_PAGES; page++) pages.push(await query(body, page, SMALL_PAGE));
  return pages;
}

const idsOf = (rows: Array<Record<string, unknown>>) => rows.map(row => Number(row.coreMeasurementID));

const byTag = (rows: Array<Record<string, unknown>>, tag: string) => rows.find(row => row.treeTag === tag);

beforeAll(async () => {
  const setup = await setupTestDatabase();
  connection = setup.connection;
  testData = setup.testData;
  schema = setup.config.database;
  sharedState.connection = connection;
  plotID = testData.plots[0].plotID;
  censusID = testData.census[0].censusID;
  plotCensusNumber = testData.census[0].plotCensusNumber;

  await seedStatusAttributes(connection);
  await connection.query(
    "INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, 'effective active', 'alive', 1), (?, 'soft-deleted', 'dead', 0)",
    [EFFECTIVE_CODE, EFFECTIVE_CODE]
  );
  await connection.query(
    "INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, 'inactive claims alive', 'alive', 0), (?, 'active says dead', 'dead', 1)",
    [INACTIVE_STATUS_CODE, INACTIVE_STATUS_CODE]
  );

  const species = testData.species[0].SpeciesCode;
  const quadrat = testData.quadrats[0].QuadratName;
  const base = { stemTag: '1', speciesCode: species, quadratName: quadrat, x: 1, y: 1, hom: 1.3 };
  const seeds = [
    { ...base, treeTag: 'VD-PASS', dbh: 10, date: '2024-06-03', codes: 'A' },
    { ...base, treeTag: 'VD-PEND', dbh: 11, date: '2024-06-04' },
    { ...base, treeTag: 'VD-INVL', dbh: 12, date: '2024-06-05' },
    { ...base, treeTag: 'VD-UNRS', dbh: 13, date: '2024-06-06' },
    { ...base, treeTag: 'VD-VAL', dbh: 14, date: '2024-06-07' },
    { ...base, treeTag: 'VD-DA', dbh: 15, date: '2024-06-08', codes: 'D;A' },
    { ...base, treeTag: 'VD-ZD', dbh: 16, date: '2024-06-09', codes: EFFECTIVE_CODE },
    { ...base, treeTag: 'VD-DUP', dbh: 17, date: '2024-06-10' },
    { ...base, treeTag: 'VD-DUP', dbh: 18, date: '2024-06-11' },
    { ...base, treeTag: 'VD-NODATE', dbh: 19, date: '2024-06-12' },
    { ...base, treeTag: LITERAL_QUESTION_MARK_TAG, dbh: 21, date: '2024-06-14' },
    { ...base, treeTag: 'VD-ZA', dbh: 22, date: '2024-06-15', codes: INACTIVE_STATUS_CODE }
  ];
  const { coreMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, seeds);
  seeds.forEach((seed, index) => tagToID.set(index === 8 ? 'VD-DUP-2' : seed.treeTag, coreMeasurementIDs[index]));

  await connection.query('UPDATE coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = ?', [tagToID.get('VD-PEND')]);
  await connection.query('UPDATE coremeasurements SET IsValidated = 0 WHERE CoreMeasurementID IN (?)', [
    [tagToID.get('VD-INVL'), tagToID.get('VD-UNRS'), tagToID.get('VD-VAL')]
  ]);
  await connection.query('UPDATE coremeasurements SET MeasurementDate = NULL WHERE CoreMeasurementID = ?', [tagToID.get('VD-NODATE')]);
  await connection.query("UPDATE coremeasurements SET UserDefinedFields = JSON_OBJECT('treestemstate', 'old tree') WHERE CoreMeasurementID IN (?)", [
    [tagToID.get('VD-PASS'), tagToID.get('VD-DA')]
  ]);
  await connection.query("UPDATE coremeasurements SET UserDefinedFields = JSON_OBJECT('treestemstate', 'new recruit') WHERE CoreMeasurementID = ?", [
    tagToID.get('VD-PEND')
  ]);
  await logError('VD-UNRS', 'validation', VALIDATION_CODE_INVALID_ATTRIBUTE);
  await logError('VD-UNRS', 'ingestion', 'COORDINATE_DRIFT');
  await logError('VD-VAL', 'validation', VALIDATION_CODE_INVALID_ATTRIBUTE);

  const [failed] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, IsActive)
     VALUES (?, NULL, 0, '2024-06-13', 20, 1.3, 'VD-FAIL', '1', 'NOSUCH', ?, 1)`,
    [censusID, quadrat]
  );
  tagToID.set('VD-FAIL', failed.insertId);
  await logError('VD-FAIL', 'ingestion', 'INVALID_SPECIES');

  const shim = { executeQuery: async (sql: string, params?: unknown[]) => (await connection.query(sql, params as never))[0] } as unknown as ConnectionManager;
  await refreshMeasurementsSummaryForScope(shim, schema, plotID, censusID);
  console.log('[viewdata query] seeded', JSON.stringify(Object.fromEntries(tagToID)));
}, 120000);

afterAll(async () => {
  sharedState.connection = null;
  await teardownTestDatabase(connection);
});

describe('measurementssummary branch on real MySQL', () => {
  it('returns one status per seeded row', async () => {
    const rows = await query({});
    const observed = Object.fromEntries(
      ['VD-FAIL', 'VD-UNRS', 'VD-VAL', 'VD-INVL', 'VD-PEND', 'VD-PASS'].map(tag => [tag, byTag(rows, tag)?.measurementStatus])
    );
    console.log('[viewdata query] statuses', JSON.stringify(observed));
    expect(observed).toEqual({
      'VD-FAIL': 'ingestionFailed',
      'VD-UNRS': 'unresolvedErrors',
      'VD-VAL': 'unresolvedErrors',
      'VD-INVL': 'invalidNoLog',
      'VD-PEND': 'pending',
      'VD-PASS': 'passed'
    });
  });

  it('puts every row in exactly one Show bucket, the one its status maps to', async () => {
    const all = await query({});
    const buckets = {
      errors: await query({ filterModel: { visible: ['errors'] } }),
      valid: await query({ filterModel: { visible: ['valid'] } }),
      pending: await query({ filterModel: { visible: ['pending'] } })
    };
    const bucketSizes = Object.values(buckets).reduce((sum, rows) => sum + rows.length, 0);
    expect(bucketSizes).toBe(all.length);
    for (const [bucket, rows] of Object.entries(buckets)) {
      for (const row of rows) expect(MEASUREMENT_STATUS_VISIBLE_BUCKET[row.measurementStatus as keyof typeof MEASUREMENT_STATUS_VISIBLE_BUCKET]).toBe(bucket);
    }
  });

  it('puts the ingestion error first and reads validation text from sitespecificvalidations', async () => {
    const rows = await query({});
    const [driftRows] = await connection.query<RowDataPacket[]>(
      "SELECT ErrorMessage FROM measurement_errors WHERE ErrorSource = 'ingestion' AND ErrorCode = 'COORDINATE_DRIFT'"
    );
    const driftRow = driftRows[0];
    const [validationRows] = await connection.query<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(ve.Description, ''), me.ErrorMessage) AS message FROM measurement_errors me
       LEFT JOIN sitespecificvalidations ve ON ve.ValidationID = CAST(me.ErrorCode AS UNSIGNED) WHERE me.ErrorSource = 'validation' AND me.ErrorCode = ?`,
      [VALIDATION_CODE_INVALID_ATTRIBUTE]
    );
    const validationRow = validationRows[0];
    const unresolved = byTag(rows, 'VD-UNRS');
    const validationOnly = byTag(rows, 'VD-VAL');
    console.log(
      '[viewdata query] primary',
      JSON.stringify({ unresolved, validationOnly, expected: { drift: driftRow.ErrorMessage, validation: validationRow.message } })
    );
    expect(unresolved).toMatchObject({
      primaryErrorSource: 'ingestion',
      primaryErrorMessage: driftRow.ErrorMessage,
      unresolvedErrorCount: 2,
      unresolvedErrorCodes: 'ingestion:COORDINATE_DRIFT,validation:14'
    });
    expect(validationOnly).toMatchObject({ primaryErrorSource: 'validation', primaryErrorMessage: validationRow.message, unresolvedErrorCount: 1 });
  });

  it('sorts by status rank', async () => {
    const full = await query({ sortModel: [{ field: 'measurementStatus', sort: 'asc' }] });
    const returnedStatuses = full.map(row => ({ coreMeasurementID: row.coreMeasurementID, measurementStatus: row.measurementStatus }));
    const knownStatuses = Object.keys(MEASUREMENT_STATUS_RANK);
    console.log('[viewdata query] status rank sort input', JSON.stringify({ knownStatuses, returnedStatuses }));
    expect(full.length).toBeGreaterThan(0);
    for (const { coreMeasurementID, measurementStatus } of returnedStatuses) {
      expect(knownStatuses, `row ${String(coreMeasurementID)} measurementStatus`).toContain(measurementStatus);
    }
    const ranks = full.map(row => MEASUREMENT_STATUS_RANK[row.measurementStatus as keyof typeof MEASUREMENT_STATUS_RANK]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it.each(['asc', 'desc'] as const)('pages a status rank sort (%s) without overlap or gaps, each page ordered by rank then ID', async direction => {
    const sortModel = [{ field: 'measurementStatus', sort: direction }];
    const full = await query({ sortModel });
    const pages = await queryEveryPage({ sortModel });
    const rankOf = (row: Record<string, unknown>) => MEASUREMENT_STATUS_RANK[row.measurementStatus as keyof typeof MEASUREMENT_STATUS_RANK];
    const directionSign = direction === 'asc' ? 1 : -1;
    console.log('[viewdata query] status paging', JSON.stringify({ direction, full: idsOf(full), pages: pages.map(idsOf) }));
    expect(full).toHaveLength(SEEDED_ROW_COUNT);
    const pagedRows = pages.flat();
    expect(new Set(idsOf(pagedRows)).size, 'a row appeared on two pages').toBe(pagedRows.length);
    expect(idsOf(pagedRows), 'union of pages is the full ordered set').toEqual(idsOf(full));
    for (const [pageIndex, pageRows] of pages.entries()) {
      for (let index = 1; index < pageRows.length; index++) {
        const previous = pageRows[index - 1];
        const current = pageRows[index];
        const orderedByRankThenID =
          directionSign * (rankOf(previous) - rankOf(current)) < 0 ||
          (rankOf(previous) === rankOf(current) && Number(previous.coreMeasurementID) < Number(current.coreMeasurementID));
        expect(
          orderedByRankThenID,
          `page ${pageIndex} rows ${index - 1},${index}: ${previous.treeTag}(rank ${rankOf(previous)}) before ${current.treeTag}(rank ${rankOf(current)})`
        ).toBe(true);
      }
    }
  });

  it.each([
    ['DBH descending', [{ field: 'measuredDBH', sort: 'desc' }]],
    ['the default date sort', undefined]
  ])('returns %s in the same order across page boundaries as one unpaged query', async (_name, sortModel) => {
    const unpaged = await query({ sortModel });
    const pages = await queryEveryPage({ sortModel });
    console.log('[viewdata query] non-status paging', JSON.stringify({ unpaged: idsOf(unpaged), pages: pages.map(idsOf) }));
    expect(unpaged).toHaveLength(SEEDED_ROW_COUNT);
    expect(idsOf(pages.flat())).toEqual(idsOf(unpaged));
    expect(pages.flat().map(row => row.measurementStatus)).toEqual(unpaged.map(row => row.measurementStatus));
  });

  it('shows the same count and rows with all three Show buckets as with no Show filter, covering every status', async () => {
    const allBuckets = await queryWithTotal({});
    const noShowFilter = await queryWithTotal({ filterModel: { visible: undefined } });
    const statuses = new Set(allBuckets.rows.map(row => row.measurementStatus));
    console.log(
      '[viewdata query] show all',
      JSON.stringify({ allBuckets: allBuckets.totalCount, noShowFilter: noShowFilter.totalCount, statuses: [...statuses] })
    );
    expect(allBuckets.totalCount).toBe(noShowFilter.totalCount);
    expect(allBuckets.totalCount).toBe(SEEDED_ROW_COUNT);
    expect(idsOf(allBuckets.rows)).toEqual(idsOf(noShowFilter.rows));
    expect([...statuses].sort()).toEqual(Object.keys(MEASUREMENT_STATUS_RANK).sort());
  });

  it('still shows nothing for an empty Show selection', async () => {
    const { rows, totalCount } = await queryWithTotal({ filterModel: { visible: [] } });
    expect({ rows: rows.length, totalCount }).toEqual({ rows: 0, totalCount: 0 });
  });

  it('sorts a NULL date last in both directions', async () => {
    const ascending = await query({ sortModel: [{ field: 'measurementDate', sort: 'asc' }] });
    const descending = await query({ sortModel: [{ field: 'measurementDate', sort: 'desc' }] });
    expect(ascending.at(-1)?.treeTag).toBe('VD-NODATE');
    expect(descending.at(-1)?.treeTag).toBe('VD-NODATE');
  });

  it('returns the intersection of a search and a column filter', async () => {
    const rows = await query({ filterModel: { quickFilterValues: ['VD-'], items: [{ field: 'treeTag', operator: 'equals', value: 'VD-PASS' }] } });
    expect(rows.map(row => row.treeTag)).toEqual(['VD-PASS']);
  });

  it('reports every stem status of a row in order and matches either status; the active attribute row wins', async () => {
    const rows = await query({});
    expect(byTag(rows, 'VD-DA')?.stemStatuses).toBe('alive,dead');
    expect(byTag(rows, 'VD-ZD')?.stemStatuses).toBe('alive');
    const dead = (await query({ filterModel: { stemStatus: ['dead'] } })).map(row => row.treeTag);
    const alive = (await query({ filterModel: { stemStatus: ['alive'] } })).map(row => row.treeTag);
    console.log('[viewdata query] stem status filters', JSON.stringify({ dead, alive }));
    expect(dead).toContain('VD-DA');
    expect(dead).not.toContain('VD-ZD');
    expect(alive).toEqual(expect.arrayContaining(['VD-DA', 'VD-PASS', 'VD-ZD']));
  });

  it('judges a code by its active attribute row: an inactive row carrying the status neither includes nor excludes a row', async () => {
    const dead = (await query({ filterModel: { stemStatus: ['dead'] } })).map(row => row.treeTag);
    const alive = (await query({ filterModel: { stemStatus: ['alive'] } })).map(row => row.treeTag);
    console.log('[viewdata query] inactive attribute rows', JSON.stringify({ dead, alive }));
    expect(dead, `${EFFECTIVE_CODE}: active alive, inactive dead`).not.toContain('VD-ZD');
    expect(alive, `${EFFECTIVE_CODE}: active alive, inactive dead`).toContain('VD-ZD');
    expect(dead, `${INACTIVE_STATUS_CODE}: active dead, inactive alive`).toContain('VD-ZA');
    expect(alive, `${INACTIVE_STATUS_CODE}: active dead, inactive alive`).not.toContain('VD-ZA');
  });

  it('filters by stem state through tss', async () => {
    const rows = await query({ filterModel: { tss: ['old tree'] } });
    expect(rows.map(row => row.treeTag).sort()).toEqual(['VD-DA', 'VD-PASS']);
  });

  it('flags both duplicate tag/stem rows as contradictions and leaves singletons unflagged', async () => {
    const rows = await query({});
    const duplicates = rows.filter(row => row.treeTag === 'VD-DUP');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every(row => row.hasContradiction === true)).toBe(true);
    expect(byTag(rows, 'VD-PASS')?.hasContradiction).toBeUndefined();
  });

  it('keeps a literal ? in a search value through the prepared-statement path', async () => {
    const tagWithQuestionMark = (await query({ filterModel: { quickFilterValues: ['Q?1'] } })).map(row => row.treeTag);
    const bareQuestionMark = (await query({ filterModel: { quickFilterValues: ['?'] } })).map(row => row.treeTag);
    console.log('[viewdata query] literal question mark', JSON.stringify({ tagWithQuestionMark, bareQuestionMark }));
    expect(tagWithQuestionMark).toEqual([LITERAL_QUESTION_MARK_TAG]);
    expect(bareQuestionMark).toEqual([LITERAL_QUESTION_MARK_TAG]);
  });
});
