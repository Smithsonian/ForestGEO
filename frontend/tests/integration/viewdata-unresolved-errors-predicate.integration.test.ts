/**
 * The unresolved-error predicate (an IN list built once per statement) against real MySQL: resolved log
 * entries must not make a measurement unresolved, whichever statement shape consumes the predicate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { insertDirectMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import {
  buildMeasurementHasUnresolvedErrorsSql,
  buildMeasurementStateCountsSql,
  buildMeasurementStatusRankSql,
  buildMeasurementVisibleConditionSql,
  MEASUREMENT_STATUS_RANK
} from '@/config/measurementstatefilters';

const SUMMARY_ALIAS = 'mss';
const ERROR_SOURCE = 'ingestion';
const ERROR_CODE = 'COORDINATE_DRIFT';
const RESOLVED = 1;
const UNRESOLVED = 0;

let connection: Connection;
let testData: TestData;
let schema: string;
let censusID: number;
const idByTag = new Map<string, number>();

async function logError(tag: string, isResolved: number, errorCode = ERROR_CODE) {
  const [errors] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [
    ERROR_SOURCE,
    errorCode
  ]);
  await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, ?)', [
    idByTag.get(tag),
    errors[0].ErrorID,
    isResolved
  ]);
}

async function idsMatching(predicateSql: string): Promise<number[]> {
  const sql = `SELECT ${SUMMARY_ALIAS}.CoreMeasurementID AS id FROM ${schema}.coremeasurements ${SUMMARY_ALIAS}
               WHERE ${SUMMARY_ALIAS}.CensusID = ? AND ${predicateSql} ORDER BY id`;
  const [rows] = await connection.query<RowDataPacket[]>(sql, [censusID]);
  console.log('[unresolved predicate] ids', JSON.stringify(rows.map(row => row.id)), 'for', predicateSql.replace(/\s+/g, ' ').slice(0, 120));
  return rows.map(row => Number(row.id));
}

beforeAll(async () => {
  const setup = await setupTestDatabase();
  connection = setup.connection;
  testData = setup.testData;
  schema = setup.config.database;
  censusID = testData.census[0].censusID;

  const base = {
    stemTag: '1',
    speciesCode: testData.species[0].SpeciesCode,
    quadratName: testData.quadrats[0].QuadratName,
    x: 1,
    y: 1,
    hom: 1.3,
    date: '2024-06-03'
  };
  const tags = ['UP-CLEAN', 'UP-ONLY-RESOLVED', 'UP-ONLY-UNRESOLVED', 'UP-MIXED'];
  const { coreMeasurementIDs } = await insertDirectMeasurements(
    connection,
    testData,
    censusID,
    tags.map((treeTag, index) => ({ ...base, treeTag, dbh: 10 + index }))
  );
  tags.forEach((tag, index) => idByTag.set(tag, coreMeasurementIDs[index]));
  await connection.query('UPDATE coremeasurements SET IsValidated = 1 WHERE CoreMeasurementID IN (?)', [coreMeasurementIDs]);

  await logError('UP-ONLY-RESOLVED', RESOLVED);
  await logError('UP-ONLY-UNRESOLVED', UNRESOLVED);
  await logError('UP-MIXED', RESOLVED);
  await logError('UP-MIXED', UNRESOLVED, 'INVALID_SPECIES');
}, 120000);

afterAll(async () => {
  await teardownTestDatabase(connection);
});

describe('unresolved-error predicate on real MySQL', () => {
  it('matches exactly the measurements holding at least one unresolved log entry', async () => {
    const matched = await idsMatching(buildMeasurementHasUnresolvedErrorsSql(schema, SUMMARY_ALIAS));
    expect(matched).toEqual([idByTag.get('UP-ONLY-UNRESOLVED'), idByTag.get('UP-MIXED')].sort((a, b) => a! - b!));
  });

  it('lets a measurement with only resolved entries through the negated predicate', async () => {
    const unmatched = await idsMatching(`NOT ${buildMeasurementHasUnresolvedErrorsSql(schema, SUMMARY_ALIAS)}`);
    expect(unmatched).toEqual([idByTag.get('UP-CLEAN'), idByTag.get('UP-ONLY-RESOLVED')].sort((a, b) => a! - b!));
  });

  it('keeps a validated measurement with only resolved entries in the valid bucket and out of errors', async () => {
    const valid = await idsMatching(buildMeasurementVisibleConditionSql(schema, SUMMARY_ALIAS, 'valid'));
    const errors = await idsMatching(buildMeasurementVisibleConditionSql(schema, SUMMARY_ALIAS, 'errors'));
    expect(valid).toContain(idByTag.get('UP-ONLY-RESOLVED'));
    expect(errors).not.toContain(idByTag.get('UP-ONLY-RESOLVED'));
    expect(errors).toEqual([idByTag.get('UP-ONLY-UNRESOLVED'), idByTag.get('UP-MIXED')].sort((a, b) => a! - b!));
  });

  it('ranks and counts the same rows as unresolved', async () => {
    const [ranked] = await connection.query<RowDataPacket[]>(
      `SELECT ${SUMMARY_ALIAS}.CoreMeasurementID AS id, ${buildMeasurementStatusRankSql(schema, SUMMARY_ALIAS)} AS statusRank
       FROM ${schema}.coremeasurements ${SUMMARY_ALIAS} WHERE ${SUMMARY_ALIAS}.CensusID = ?`,
      [censusID]
    );
    const rankByID = new Map(ranked.map(row => [Number(row.id), Number(row.statusRank)]));
    console.log('[unresolved predicate] ranks', JSON.stringify([...rankByID]));
    expect(rankByID.get(idByTag.get('UP-ONLY-RESOLVED')!)).toBe(MEASUREMENT_STATUS_RANK.passed);
    expect(rankByID.get(idByTag.get('UP-ONLY-UNRESOLVED')!)).toBe(MEASUREMENT_STATUS_RANK.unresolvedErrors);
    expect(rankByID.get(idByTag.get('UP-MIXED')!)).toBe(MEASUREMENT_STATUS_RANK.unresolvedErrors);

    const [counts] = await connection.query<RowDataPacket[]>(
      `SELECT ${buildMeasurementStateCountsSql(schema, SUMMARY_ALIAS)} FROM ${schema}.coremeasurements ${SUMMARY_ALIAS} WHERE ${SUMMARY_ALIAS}.CensusID = ?`,
      [censusID]
    );
    console.log('[unresolved predicate] counts', JSON.stringify(counts[0]));
    expect(Number(counts[0].CountUnresolvedLogged)).toBe(2);
    expect(Number(counts[0].CountValid)).toBe(2);
  });
});
