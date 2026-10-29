/**
 * Plan pins for the coremeasurements indexes #560 keeps (I7): integration, real MySQL.
 *
 * D3: bulkingestioncollapser runs `UPDATE coremeasurements SET MeasuredDBH = NULL WHERE MeasuredDBH = 0
 * AND CensusID = ?` (and the HOM twin) after every upload. Without idx_measureddbh / idx_measuredhom each
 * one scans the whole table across every census (design E4).
 * D2: a validation run with no census selected reads `IsValidated IS NULL` across the whole plot. After a
 * census is validated almost nothing is pending, and idx_isvalidated turns that read into a short ref
 * (design section 4, d2-paired-r2.json).
 * The spec's StemGUID-lookup pin is not here: MySQL refuses to drop the last StemGUID-led index while
 * FK_CoreMeasurements_Stems exists (error 1553), so that pin could never fail (plan review T4).
 *
 * The seed runs with foreign_key_checks = 0 on a throwaway canonical schema: a plan pin needs the data
 * distribution, not 20,000 referential stems.
 *
 * Prerequisites: docker compose up -d mysql. Run alone, through the shared integration lock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { COREMEASUREMENTS_TABLE, dropThrowawaySchema, LOCAL_DB_HOSTS, provisionCanonicalSchema } from '../setup/coremeasurements-index-fixtures';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!(LOCAL_DB_HOSTS as readonly string[]).includes(TEST_DB_HOST)) {
  throw new Error(`[coremeasurements-kept-index-plans] REFUSING TO RUN: TEST_DB_HOST="${TEST_DB_HOST}" is not local.`);
}

const SUFFIX = '_cmt_i7';
const CENSUS_COUNT = 20;
const ROWS_PER_CENSUS = 1_000;
const SEEDED_ROW_COUNT = CENSUS_COUNT * ROWS_PER_CENSUS;
const TARGET_CENSUS_ID = 7;
const ZERO_DBH_ROW_IN_CENSUS = 0;
const ZERO_HOM_ROW_IN_CENSUS = 1;
const PENDING_EVERY_N_ROWS = 100;
const FIRST_MEASUREMENT_DATE = '2024-01-01';
const DAYS_SPREAD = 365;
const BASE_DBH = 10;
const DBH_SPREAD = 500;
const DBH_SPREAD_DIVISOR = 10;
const DEFAULT_HOM = 1.3;
const VALIDATED = 1;
const FULL_SCAN_ACCESS = 'ALL';
const REF_ACCESS = 'ref';
const INDEX_MERGE_ACCESS = 'index_merge';
const SETUP_TIMEOUT_MS = 180_000;

interface PlannedTableAccess {
  table: string;
  accessType: string;
  key: string | null;
}

/** Every table access in an EXPLAIN FORMAT=JSON tree. */
function plannedAccesses(node: unknown, found: PlannedTableAccess[] = []): PlannedTableAccess[] {
  if (Array.isArray(node)) {
    node.forEach(child => plannedAccesses(child, found));
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record.table_name === 'string' && typeof record.access_type === 'string') {
    found.push({ table: record.table_name, accessType: record.access_type, key: typeof record.key === 'string' ? record.key : null });
  }
  Object.values(record).forEach(child => plannedAccesses(child, found));
  return found;
}

/** The index names an access uses: the key itself, or the components of an index_merge such as intersect(a,b). */
function keysUsedBy(access: PlannedTableAccess): string[] {
  if (access.key === null) return [];
  if (access.accessType !== INDEX_MERGE_ACCESS) return [access.key];
  return access.key
    .split(/[(),]/)
    .map(part => part.trim())
    .filter(Boolean);
}

describe('(I7) plans that justify the indexes #560 keeps', () => {
  let schema: string;
  let connection: Connection;

  async function coremeasurementsAccess(sql: string, params: unknown[]): Promise<PlannedTableAccess> {
    const [rows] = await connection.query<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${sql}`, params);
    const plan = JSON.parse(String(rows[0].EXPLAIN));
    const accesses = plannedAccesses(plan).filter(access => access.table === COREMEASUREMENTS_TABLE);
    console.log(`[I7] ${sql}\n[I7] coremeasurements accesses=${JSON.stringify(accesses)}\n[I7] plan=${JSON.stringify(plan)}`);
    expect(accesses, 'the plan must read coremeasurements exactly once').toHaveLength(1);
    return accesses[0];
  }

  beforeAll(async () => {
    ({ schema, connection } = await provisionCanonicalSchema(SUFFIX));
    await connection.query('SET SESSION foreign_key_checks = 0');
    await connection.query(`SET SESSION cte_max_recursion_depth = ${SEEDED_ROW_COUNT}`);
    await connection.query(
      `INSERT INTO ${COREMEASUREMENTS_TABLE} (CensusID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated)
       WITH RECURSIVE seq (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ? - 1)
       SELECT n DIV ? + 1,
              n % ? + 1,
              DATE_ADD(?, INTERVAL (n % ?) DAY),
              IF(n % ? = ?, 0, ? + (n % ?) / ?),
              IF(n % ? = ?, 0, ?),
              IF(n % ? = 0, NULL, ?)
       FROM seq`,
      [
        SEEDED_ROW_COUNT,
        ROWS_PER_CENSUS,
        ROWS_PER_CENSUS,
        FIRST_MEASUREMENT_DATE,
        DAYS_SPREAD,
        ROWS_PER_CENSUS,
        ZERO_DBH_ROW_IN_CENSUS,
        BASE_DBH,
        DBH_SPREAD,
        DBH_SPREAD_DIVISOR,
        ROWS_PER_CENSUS,
        ZERO_HOM_ROW_IN_CENSUS,
        DEFAULT_HOM,
        PENDING_EVERY_N_ROWS,
        VALIDATED
      ]
    );
    await connection.query('SET SESSION foreign_key_checks = 1');
    await connection.query(`ANALYZE TABLE ${COREMEASUREMENTS_TABLE}`);
    const [counts] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT CensusID) AS censuses, SUM(MeasuredDBH = 0) AS zeroDBH, SUM(MeasuredHOM = 0) AS zeroHOM,
              SUM(IsValidated IS NULL) AS pending FROM ${COREMEASUREMENTS_TABLE}`
    );
    console.log(`[I7] seeded ${schema}: ${JSON.stringify(counts[0])}`);
    expect(Number(counts[0].total)).toBe(SEEDED_ROW_COUNT);
    expect(Number(counts[0].censuses)).toBe(CENSUS_COUNT);
    expect(Number(counts[0].zeroDBH)).toBe(CENSUS_COUNT);
    expect(Number(counts[0].pending)).toBe(SEEDED_ROW_COUNT / PENDING_EVERY_N_ROWS);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (connection) await dropThrowawaySchema(connection, schema);
  });

  it.each([
    { column: 'MeasuredDBH', expectedIndex: 'idx_measureddbh' },
    { column: 'MeasuredHOM', expectedIndex: 'idx_measuredhom' }
  ])('(D3) pins the access path of a stand-in for the collapser zero-$column UPDATE: $expectedIndex', async ({ column, expectedIndex }) => {
    const access = await coremeasurementsAccess(`UPDATE ${COREMEASUREMENTS_TABLE} SET ${column} = NULL WHERE ${column} = 0 AND CensusID = ?`, [
      TARGET_CENSUS_ID
    ]);
    expect(access.accessType, 'a full scan of every census is the regression this pin exists for').not.toBe(FULL_SCAN_ACCESS);
    expect(keysUsedBy(access)).toContain(expectedIndex);
  });

  it('(D2) pins the access path of a stand-in for the plot-wide pending-row read: a ref on idx_isvalidated', async () => {
    const access = await coremeasurementsAccess(
      `SELECT CoreMeasurementID, StemGUID, MeasuredDBH FROM ${COREMEASUREMENTS_TABLE} WHERE IsValidated IS NULL AND IsActive = 1`,
      []
    );
    expect(access.accessType).toBe(REF_ACCESS);
    expect(access.key).toBe('idx_isvalidated');
  });
});
