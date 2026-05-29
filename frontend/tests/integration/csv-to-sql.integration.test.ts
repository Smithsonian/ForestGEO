/**
 * Round-trip integration test for lib/csv-to-sql.ts.
 *
 * Generates SQL using the actual csv-to-sql helpers, executes it against a real
 * MySQL instance via docker-compose, then SELECTs the rows back and asserts
 * that special characters survived the escape-and-load cycle byte-for-byte.
 *
 * This is the test the spec author requested: the unit tests check the *shape*
 * of the output; this test checks that what MySQL actually stores matches what
 * we put in.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { mapCsvRowToStagingRow, parseCsvContent, renderCreateTable, renderInsertChunks, type StagingRow } from '../../lib/csv-to-sql';
import { splitSqlFile } from '../../lib/provisioning/sql-runner';

const TEST_DB = 'csv_to_sql_roundtrip_test';
const TEMP_TABLE = 'TempAllTrees';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_NUMBER = '2';
const STANDARD_CSV_HEADER = 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes';

function buildStagingSql(rows: StagingRow[]): string {
  const ddl = renderCreateTable(TEMP_TABLE);
  const inserts = renderInsertChunks(TEMP_TABLE, rows);
  return [ddl, ...inserts].join('\n');
}

async function runSqlScript(conn: Connection, sql: string): Promise<void> {
  for (const stmt of splitSqlFile(sql)) {
    await conn.query(stmt.sql);
  }
}

function csvFromRows(rows: Array<Record<string, string>>): string {
  const headers = STANDARD_CSV_HEADER.split(',');
  const lines = [STANDARD_CSV_HEADER];
  for (const row of rows) {
    const cells = headers.map(h => csvEscape(row[h] ?? ''));
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

describe('csv-to-sql round-trip (integration)', () => {
  let conn: Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: false,
      // Keep the wire encoding consistent so we can compare bytes accurately.
      charset: 'utf8mb4'
    });
    await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await conn.query(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${TEST_DB}\``);
  }, 60000);

  afterAll(async () => {
    if (conn) {
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      } finally {
        await conn.end();
      }
    }
  });

  beforeEach(async () => {
    await conn.query(`DROP TABLE IF EXISTS \`${TEMP_TABLE}\``);
  });

  it('round-trips a row of normal values exactly', async () => {
    const csv = csvFromRows([
      {
        tag: '10001',
        stemtag: '10001',
        spcode: 'FRPE',
        quadrat: '121',
        lx: '4.1',
        ly: '5.2',
        dbh: '15',
        hom: '1.30',
        date: '2014-05-27',
        codes: 'LI'
      }
    ]);

    const parsed = parseCsvContent(csv);
    const stagingRows = parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER));
    const sql = buildStagingSql(stagingRows);

    await runSqlScript(conn, sql);

    const [loaded] = await conn.query<RowDataPacket[]>(
      `SELECT QuadratName, Tag, StemTag, Mnemonic, DBH, HOM, Codes, ExactDate, X, Y, PlotID, PlotCensusNumber
       FROM \`${TEMP_TABLE}\` ORDER BY TempID`
    );
    expect(loaded).toHaveLength(1);
    const row = loaded[0];
    expect(row.QuadratName).toBe('121');
    expect(row.Tag).toBe('10001');
    expect(row.StemTag).toBe('10001');
    expect(row.Mnemonic).toBe('FRPE');
    expect(Number(row.DBH)).toBe(15);
    expect(Number(row.HOM)).toBe(1.3);
    expect(row.Codes).toBe('LI');
    // ExactDate comes back as a Date object; format to ISO date string.
    expect(formatExactDate(row.ExactDate)).toBe('2014-05-27');
    expect(Number(row.X)).toBeCloseTo(4.1, 5);
    expect(Number(row.Y)).toBeCloseTo(5.2, 5);
    expect(row.PlotID).toBe(TEST_PLOT_ID);
    expect(row.PlotCensusNumber).toBe(TEST_CENSUS_NUMBER);
  });

  it('preserves single-quote, backslash, and multi-byte UTF-8 in string columns', async () => {
    // Each tree carries a name with one of the dangerous chars in the Codes column
    // (the schema allows VARCHAR(50)). Quadrat/Tag stay clean to keep them VARCHAR-safe.
    const csvRows = [
      { tag: 'A1', codes: "O'Brien" }, // single quote
      { tag: 'A2', codes: 'foo\\bar' }, // backslash
      { tag: 'A3', codes: 'café' }, // multi-byte UTF-8 (é)
      { tag: 'A4', codes: 'tree-中文' }, // CJK characters
      { tag: 'A5', codes: "mix-O\\'X" } // both quote and backslash together
    ].map(({ tag, codes }) => ({
      tag,
      stemtag: tag,
      spcode: 'FRPE',
      quadrat: '121',
      lx: '4.1',
      ly: '5.2',
      dbh: '15',
      hom: '1.30',
      date: '2014-05-27',
      codes
    }));

    const csv = csvFromRows(csvRows);
    const parsed = parseCsvContent(csv);
    const stagingRows = parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER));
    const sql = buildStagingSql(stagingRows);

    await runSqlScript(conn, sql);

    const [loaded] = await conn.query<RowDataPacket[]>(`SELECT Tag, Codes FROM \`${TEMP_TABLE}\` ORDER BY Tag`);
    expect(loaded).toHaveLength(csvRows.length);

    const byTag = new Map<string, string>();
    for (const row of loaded) {
      byTag.set(String(row.Tag), String(row.Codes));
    }
    for (const { tag, codes } of csvRows) {
      expect(byTag.get(tag)).toBe(codes);
    }
  });

  it('preserves quadrat names that contain a single quote (e.g. "O\'Brien")', async () => {
    const csv = csvFromRows([
      {
        tag: 'A01',
        stemtag: 'a01',
        spcode: 'FRPE',
        // VARCHAR(12) for QuadratName — keep the value short
        quadrat: "O'Br",
        lx: '4.1',
        ly: '5.2',
        dbh: '15',
        hom: '1.30',
        date: '2014-05-27',
        codes: 'LI'
      }
    ]);

    const parsed = parseCsvContent(csv);
    const stagingRows = parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER));
    const sql = buildStagingSql(stagingRows);

    await runSqlScript(conn, sql);

    const [loaded] = await conn.query<RowDataPacket[]>(`SELECT QuadratName FROM \`${TEMP_TABLE}\``);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].QuadratName).toBe("O'Br");
  });

  it('rejects CSV with hex notation in DBH before SQL generation', () => {
    const csv = csvFromRows([
      {
        tag: 'A01',
        stemtag: 'a01',
        spcode: 'FRPE',
        quadrat: '121',
        lx: '4.1',
        ly: '5.2',
        dbh: '0x10',
        hom: '1.30',
        date: '2014-05-27',
        codes: 'LI'
      }
    ]);

    const parsed = parseCsvContent(csv);
    expect(() => parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER))).toThrow(/dbh.*canonical numeric/);
  });

  it('rejects CSV with scientific notation in coordinate column', () => {
    const csv = csvFromRows([
      {
        tag: 'A01',
        stemtag: 'a01',
        spcode: 'FRPE',
        quadrat: '121',
        lx: '1e3',
        ly: '5.2',
        dbh: '15',
        hom: '1.30',
        date: '2014-05-27',
        codes: 'LI'
      }
    ]);

    const parsed = parseCsvContent(csv);
    expect(() => parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER))).toThrow(/lx.*canonical numeric/);
  });

  it('strips a leading UTF-8 BOM and still produces valid SQL that loads', async () => {
    const utf8Bom = '﻿';
    const csv =
      utf8Bom +
      csvFromRows([
        {
          tag: 'B01',
          stemtag: 'B01',
          spcode: 'FRPE',
          quadrat: '121',
          lx: '4.1',
          ly: '5.2',
          dbh: '15',
          hom: '1.30',
          date: '2014-05-27',
          codes: 'LI'
        }
      ]);

    const parsed = parseCsvContent(csv);
    const stagingRows = parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER));
    const sql = buildStagingSql(stagingRows);

    await runSqlScript(conn, sql);

    const [loaded] = await conn.query<RowDataPacket[]>(`SELECT Tag FROM \`${TEMP_TABLE}\``);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].Tag).toBe('B01');
  });

  it('preserves NULL semantics for empty cells', async () => {
    const csv = csvFromRows([
      {
        tag: 'N01',
        stemtag: 'N01',
        spcode: 'FRPE',
        quadrat: '121',
        lx: '4.1',
        ly: '5.2',
        dbh: '',
        hom: '',
        date: '2014-05-27',
        codes: ''
      }
    ]);

    const parsed = parseCsvContent(csv);
    const stagingRows = parsed.map(r => mapCsvRowToStagingRow(r, TEST_PLOT_ID, TEST_CENSUS_NUMBER));
    const sql = buildStagingSql(stagingRows);

    await runSqlScript(conn, sql);

    const [loaded] = await conn.query<RowDataPacket[]>(`SELECT DBH, HOM, Codes FROM \`${TEMP_TABLE}\``);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].DBH).toBeNull();
    expect(loaded[0].HOM).toBeNull();
    expect(loaded[0].Codes).toBeNull();
  });
});

function formatExactDate(value: unknown): string {
  if (value instanceof Date) {
    const yyyy = value.getFullYear().toString().padStart(4, '0');
    const mm = (value.getMonth() + 1).toString().padStart(2, '0');
    const dd = value.getDate().toString().padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(value);
}
