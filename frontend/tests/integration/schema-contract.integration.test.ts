/**
 * Schema-contract parity (integration, real MySQL).
 *
 * Guards the incident where an application write column (PublishedStemID) was
 * added to the temporarymeasurements INSERT but a live schema lacked it,
 * producing a runtime 500 "Unknown column 'PublishedStemID' in 'field list'".
 *
 * It provisions a fresh schema from the canonical DDL (`db/sql/tablestructures.sql`)
 * and asserts, against that live schema:
 *   - every production insert column exists in temporarymeasurements;
 *   - the keyed insert builder emits exactly one value per canonical column;
 *   - canonical DDL metadata matches provisioned metadata for every critical table
 *     (type/width, nullability, default, generated/extra, collation);
 *   - the database default and every non-exempt text column use utf8mb4_0900_ai_ci;
 *   - the required named constraints/indexes exist;
 *   - the ingestion stored procedures are present.
 *
 * Because the live schema is provisioned FROM the canonical DDL, a green run
 * means the DDL is internally consistent and the production write contract is a
 * subset of it. A failure names the exact drifted object so it is debuggable at
 * PR time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import {
  loadCanonicalSchemaContract,
  readLiveSchemaContract,
  compareSchemaContracts,
  formatContractFailures,
  CRITICAL_TABLES,
  REQUIRED_INDEXES_BY_TABLE,
  TARGET_TEXT_COLLATION,
  type SchemaContract,
  type SchemaQueryRow
} from '@/lib/db/schema-contract';
import {
  TEMPORARY_MEASUREMENT_INSERT_COLUMNS,
  buildTemporaryMeasurementInsertRecord,
  toTemporaryMeasurementInsertValues
} from '@/lib/ingestion/temporary-measurements';
import { SourceFormat } from '@/config/macros/formdetails';

const REQUIRED_INGESTION_PROCEDURES = ['bulkingestionprocess'] as const;

// Text columns legitimately allowed to diverge from the target collation.
// Empty today; every critical-table text column must use utf8mb4_0900_ai_ci.
const EXEMPT_TEXT_COLLATION_COLUMNS = new Set<string>();

describe('Schema Contract Parity', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let canonicalContract: SchemaContract;
  let liveContract: SchemaContract;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    const exec = async (sql: string, params: unknown[]): Promise<SchemaQueryRow[]> => {
      const [rows] = await connection.query<RowDataPacket[]>(sql, params);
      return rows as SchemaQueryRow[];
    };

    canonicalContract = loadCanonicalSchemaContract();
    liveContract = await readLiveSchemaContract(exec, config.database, CRITICAL_TABLES);
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  it('provisions all critical tables from the canonical DDL', () => {
    expect(testData.species.length).toBeGreaterThan(0); // setup actually ran
    for (const table of CRITICAL_TABLES) {
      expect(liveContract.tables[table], `critical table missing from provisioned schema: ${table}`).toBeDefined();
      expect(canonicalContract.tables[table], `critical table missing from canonical DDL: ${table}`).toBeDefined();
    }
  });

  it('has every production temporarymeasurements insert column present in the provisioned table', () => {
    const provisionedColumns = new Set(Object.values(liveContract.tables['temporarymeasurements'].columns).map(c => c.name.toLowerCase()));
    const missing = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.filter(col => !provisionedColumns.has(col.toLowerCase()));
    expect(missing, `temporarymeasurements is missing insert column(s): ${missing.join(', ')}`).toEqual([]);
  });

  it('emits exactly one insert value per canonical column, in column order', () => {
    const record = buildTemporaryMeasurementInsertRecord(
      {
        tag: 'T1',
        stemtag: '1',
        spcode: 'sp',
        quadrat: 'q1',
        lx: '1',
        ly: '2',
        dbh: '10',
        hom: '1.3',
        date: '2026-01-01',
        codes: null,
        comments: null,
        publishedstemid: '5001'
      },
      'file.csv',
      'batch-1',
      null,
      SourceFormat.csv,
      1,
      2
    );
    expect(Object.keys(record).sort()).toEqual([...TEMPORARY_MEASUREMENT_INSERT_COLUMNS].sort());

    const values = toTemporaryMeasurementInsertValues(record);
    expect(values).toHaveLength(TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length);
    // Value order must follow the canonical column order exactly.
    TEMPORARY_MEASUREMENT_INSERT_COLUMNS.forEach((column, index) => {
      expect(values[index]).toBe(record[column]);
    });
  });

  it('matches canonical DDL metadata against the provisioned schema for every critical table', () => {
    const { failures, extras } = compareSchemaContracts(canonicalContract, liveContract);

    if (failures.length > 0) {
      throw new Error(`Schema contract violations (${failures.length}):\n${formatContractFailures(failures)}`);
    }

    // Extras are informational only (e.g. inline PRIMARY keys, which are outside the named
    // index contract), but surface them so genuine drift stays visible in logs.
    if (extras.length > 0) {
      const rendered = extras.map(e => `[${e.table}] extra ${e.category} "${e.object}" (${e.actual})`).join('\n');
      console.info(`Live schema has ${extras.length} object(s) beyond the canonical contract (informational):\n${rendered}`);
    }
    expect(failures).toEqual([]);
  });

  it('uses utf8mb4_0900_ai_ci for the database default and every non-exempt text column', () => {
    expect(liveContract.defaultCollation).toBe(TARGET_TEXT_COLLATION);

    const violations: string[] = [];
    for (const table of CRITICAL_TABLES) {
      for (const column of Object.values(liveContract.tables[table].columns)) {
        if (!column.isText) continue;
        const key = `${table}.${column.name}`.toLowerCase();
        if (EXEMPT_TEXT_COLLATION_COLUMNS.has(key)) continue;
        if (column.collation !== TARGET_TEXT_COLLATION) {
          violations.push(`${table}.${column.name} => ${column.collation}`);
        }
      }
    }
    expect(violations, `text columns not using ${TARGET_TEXT_COLLATION}: ${violations.join(', ')}`).toEqual([]);
  });

  it('has every required named constraint/index present with the contracted shape', () => {
    for (const [table, indexNames] of Object.entries(REQUIRED_INDEXES_BY_TABLE)) {
      const liveIndexes = liveContract.tables[table].indexes;
      for (const indexName of indexNames) {
        const index = liveIndexes[indexName.toLowerCase()];
        expect(index, `required index missing from ${table}: ${indexName}`).toBeDefined();
        expect(index.columns.length, `required index has no columns in ${table}: ${indexName}`).toBeGreaterThan(0);
      }
    }
  });

  it('has the ingestion stored procedures present', async () => {
    const [procedures] = await connection.query<RowDataPacket[]>(
      `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
      [config.database]
    );
    const procedureNames = procedures.map(p => String(p.ROUTINE_NAME).toLowerCase());
    for (const expected of REQUIRED_INGESTION_PROCEDURES) {
      expect(procedureNames, `missing stored procedure: ${expected}`).toContain(expected.toLowerCase());
    }
  });
});
