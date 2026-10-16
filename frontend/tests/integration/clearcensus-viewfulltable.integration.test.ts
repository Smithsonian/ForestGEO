/**
 * clearcensusfull / clearcensusmsmts — materialized viewfulltable + failure-safety
 *
 * Issue #509: deleting a census left its rows behind in the materialized
 * viewfulltable table (it is populated by RefreshViewFullTable's INSERT, not
 * recomputed on every read, so nothing else ever cleans it up). Neither
 * procedure had an EXIT HANDLER either: a mid-procedure SQL error left a
 * dangling open transaction AND left foreign_key_checks=0 / @disable_triggers=1
 * set on the pooled connection for whichever request borrowed it next.
 * clearcensusfull's single-remaining-census branch also used TRUNCATE (an
 * implicit-commit DDL statement), which silently broke the "every write here
 * is one atomic transaction" guarantee, and it TRUNCATEd unifiedchangelog,
 * destroying audit history on every full clear.
 *
 * This suite exercises the ACTUAL shipped procedures (loaded verbatim from
 * db/sql/storedprocedures.sql by tests/setup/local-db-setup.ts) against a real
 * local MySQL instance:
 *
 *   1. clearcensusmsmts removes every target-census row — including
 *      viewfulltable — while a bystander census on a different plot is left
 *      byte-for-byte untouched.
 *   2. clearcensusfull does the same in the multi-census case.
 *   3. clearcensusfull's single-remaining-census path empties the reference
 *      tables and viewfulltable, but now PRESERVES unifiedchangelog.
 *   4/5. Fault-injection: a throwaway-schema-only variant of each procedure
 *      (built by splicing a SIGNAL immediately before COMMIT into the REAL,
 *      currently-shipped procedure body — never the deployed SQL) proves the
 *      new EXIT HANDLER rolls back every change, including viewfulltable and
 *      (on the single-census path) the reference tables, and restores
 *      foreign_key_checks / @disable_triggers on the SAME connection.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs run \
 *     --config vitest.integration.config.mts \
 *     tests/integration/clearcensus-viewfulltable.integration.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

if (!LOCAL_HOSTS.includes(TEST_DB_HOST as (typeof LOCAL_HOSTS)[number])) {
  throw new Error(
    `[clearcensus-viewfulltable] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Named constants (no magic strings/numbers)
// ---------------------------------------------------------------------------

const CLEAR_CENSUS_MSMTS_PROCEDURE = 'clearcensusmsmts';
const CLEAR_CENSUS_FULL_PROCEDURE = 'clearcensusfull';
const CLEAR_CENSUS_MSMTS_FAULT_PROCEDURE = 'clearcensusmsmts_faultinjected';
const CLEAR_CENSUS_FULL_FAULT_PROCEDURE = 'clearcensusfull_faultinjected';

/**
 * Stable anchor that both procedures carry immediately before COMMIT, once
 * the historical (viewfulltable) and source deletes are complete. The fault
 * injector splices a SIGNAL immediately before this line so the REAL,
 * unmodified EXIT HANDLER is the thing under test.
 */
const PRE_COMMIT_ANCHOR = '-- Historical (viewfulltable) and source deletes above are complete; commit now.';

const FAULT_INJECTION_MARKER = '-- TEST-ONLY fault injection';
const FAULT_INJECTION_SQL = `    ${FAULT_INJECTION_MARKER} (throwaway-schema variant procedure only): force a SQL
    -- exception AFTER the historical (viewfulltable) and source deletes but BEFORE COMMIT,
    -- to prove the EXIT HANDLER rolls back every seeded row and restores
    -- foreign_key_checks / @disable_triggers on this same connection.
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST-ONLY fault injection: forced failure before COMMIT';

`;

const ENABLED_FK_CHECKS = 1;

/** Each reference table's own primary key, used to order its snapshot deterministically. */
const REFERENCE_TABLE_ORDER_BY_COLUMN: Record<string, string> = {
  attributes: 'Code',
  personnel: 'PersonnelID',
  roles: 'RoleID',
  quadrats: 'QuadratID',
  species: 'SpeciesID',
  specieslimits: 'SpeciesLimitID',
  genus: 'GenusID',
  family: 'FamilyID',
  reference: 'ReferenceID'
};

const REFERENCE_TABLES_CLEARED_ON_FULL_CLEAR = Object.keys(REFERENCE_TABLE_ORDER_BY_COLUMN) as Array<keyof typeof REFERENCE_TABLE_ORDER_BY_COLUMN>;

const CENSUS_SCOPED_TABLES = [
  'coremeasurements',
  'stems',
  'trees',
  'measurementssummary',
  'temporarymeasurements',
  'viewfulltable',
  'cmattributes',
  'measurement_error_log',
  'census'
] as const;

type CensusScopedTable = (typeof CENSUS_SCOPED_TABLES)[number];

/** Per-table query to fetch every row belonging to one census, in a deterministic order. */
function censusScopedSnapshotQuery(table: CensusScopedTable, censusID: number): [string, unknown[]] {
  switch (table) {
    case 'coremeasurements':
      return ['SELECT * FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID', [censusID]];
    case 'stems':
      return ['SELECT * FROM stems WHERE CensusID = ? ORDER BY StemGUID', [censusID]];
    case 'trees':
      return ['SELECT * FROM trees WHERE CensusID = ? ORDER BY TreeID', [censusID]];
    case 'measurementssummary':
      return ['SELECT * FROM measurementssummary WHERE CensusID = ? ORDER BY CoreMeasurementID', [censusID]];
    case 'temporarymeasurements':
      return ['SELECT * FROM temporarymeasurements WHERE CensusID = ? ORDER BY id', [censusID]];
    case 'viewfulltable':
      return ['SELECT * FROM viewfulltable WHERE CensusID = ? ORDER BY CoreMeasurementID', [censusID]];
    case 'cmattributes':
      return [
        `SELECT cma.* FROM cmattributes cma
         JOIN coremeasurements cm ON cma.CoreMeasurementID = cm.CoreMeasurementID
         WHERE cm.CensusID = ? ORDER BY cma.CMAID`,
        [censusID]
      ];
    case 'measurement_error_log':
      return [
        `SELECT mel.* FROM measurement_error_log mel
         JOIN coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID
         WHERE cm.CensusID = ? ORDER BY mel.MeasurementID, mel.ErrorID`,
        [censusID]
      ];
    case 'census':
      return ['SELECT * FROM census WHERE CensusID = ?', [censusID]];
  }
}

/**
 * Byte-for-byte snapshot (JSON of every column, in deterministic row order) of
 * every table that stores rows for one census. Used both as the "nothing
 * changed" proof for the bystander census and as the "every seeded row came
 * back" proof after a rolled-back fault-injected CALL.
 */
async function snapshotCensusRows(connection: Connection, censusID: number): Promise<Record<CensusScopedTable, string>> {
  const snapshot = {} as Record<CensusScopedTable, string>;
  for (const table of CENSUS_SCOPED_TABLES) {
    const [sql, params] = censusScopedSnapshotQuery(table, censusID);
    const [rows] = await connection.query<RowDataPacket[]>(sql, params);
    snapshot[table] = JSON.stringify(rows);
  }
  return snapshot;
}

async function countCensusRows(connection: Connection, table: CensusScopedTable, censusID: number): Promise<number> {
  const [sql, params] = censusScopedSnapshotQuery(table, censusID);
  const [rows] = await connection.query<RowDataPacket[]>(sql, params);
  return rows.length;
}

async function snapshotWholeTable(connection: Connection, table: string, orderBy: string): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  return JSON.stringify(rows);
}

/** Byte-for-byte snapshot of one reference table, ordered by its own primary key. */
async function snapshotReferenceTable(connection: Connection, table: (typeof REFERENCE_TABLES_CLEARED_ON_FULL_CLEAR)[number]): Promise<string> {
  return snapshotWholeTable(connection, table, REFERENCE_TABLE_ORDER_BY_COLUMN[table]);
}

/** NULL means @disable_triggers is still its connection-default, unset state. */
interface SessionFlags {
  foreignKeyChecks: number;
  disableTriggers: number | null;
}

async function readSessionFlags(connection: Connection): Promise<SessionFlags> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT @@foreign_key_checks AS fkChecks, @disable_triggers AS disableTriggers');
  const row = rows[0];
  return {
    foreignKeyChecks: Number(row.fkChecks),
    disableTriggers: row.disableTriggers === null ? null : Number(row.disableTriggers)
  };
}

async function setSessionFlags(connection: Connection, flags: SessionFlags): Promise<void> {
  await connection.query('SET foreign_key_checks = ?', [flags.foreignKeyChecks]);
  if (flags.disableTriggers === null) {
    await connection.query('SET @disable_triggers = NULL');
  } else {
    await connection.query('SET @disable_triggers = ?', [flags.disableTriggers]);
  }
}

/** Both procedures must restore the caller's EXACT entry session state (issue #509), not a hard-coded default. */
function expectSessionFlagsRestored(after: SessionFlags, before: SessionFlags, context: string): void {
  expect(after.foreignKeyChecks, `${context}: foreign_key_checks must be restored to its entry value (${before.foreignKeyChecks})`).toBe(
    before.foreignKeyChecks
  );
  expect(after.disableTriggers, `${context}: @disable_triggers must be restored to its entry value (${before.disableTriggers})`).toBe(before.disableTriggers);
}

/** The fixture-safe session state beforeEach resets to before every test (and resetToBlankSchema's DELETE-cascades need foreign_key_checks=1). */
const DEFAULT_SESSION_FLAGS: SessionFlags = { foreignKeyChecks: ENABLED_FK_CHECKS, disableTriggers: null };

// ---------------------------------------------------------------------------
// Fault injection — derive a throwaway-schema-only variant from the REAL,
// currently-shipped procedure body, reusing the same splitSqlFile parser that
// loads storedprocedures.sql for real deployment (tests/setup/local-db-setup.ts),
// so this suite is parsing the file exactly the way production code does.
// Mirrors buildProcedureVariant in bulkingestion-atomicity.integration.test.ts.
// ---------------------------------------------------------------------------

function buildFaultInjectedClearCensusProcedureSql(canonicalProcedureName: string, faultInjectedProcedureName: string): string {
  const proceduresPath = join(process.cwd(), 'db/sql', 'storedprocedures.sql');
  const statements = splitSqlFile(readFileSync(proceduresPath, 'utf-8'));

  // storedprocedures.sql declares these procedures as `create procedure <name>(`
  // (lowercase), unlike bulkingestionprocess's `CREATE PROCEDURE`; match case-insensitively.
  const procedureToken = new RegExp(`create\\s+procedure\\s+${canonicalProcedureName}\\s*\\(`, 'i');
  const createStatement = statements.find(({ sql }) => procedureToken.test(sql));
  if (!createStatement) {
    throw new Error(`Could not locate the CREATE for ${canonicalProcedureName} in ${proceduresPath}`);
  }

  const definerStripped = createStatement.sql.replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, '');
  const renamed = definerStripped.replace(procedureToken, `create procedure ${faultInjectedProcedureName}(`);

  if (!renamed.includes(PRE_COMMIT_ANCHOR)) {
    throw new Error(
      `PRE_COMMIT_ANCHOR not found in ${canonicalProcedureName}; the fault-injection splice would be a no-op. ` +
        `The procedure in db/sql/storedprocedures.sql may have been reformatted — update PRE_COMMIT_ANCHOR.`
    );
  }

  const spliced = renamed.replace(PRE_COMMIT_ANCHOR, `${FAULT_INJECTION_SQL}    ${PRE_COMMIT_ANCHOR}`);
  const markerCount = (spliced.match(new RegExp(FAULT_INJECTION_MARKER, 'g')) || []).length;
  if (markerCount !== 1) {
    throw new Error(`Fault-injection splice for ${canonicalProcedureName} inserted ${markerCount} markers; expected exactly 1.`);
  }
  return spliced;
}

async function createFaultInjectedProcedure(connection: Connection, canonicalProcedureName: string, faultInjectedProcedureName: string): Promise<void> {
  await connection.query(`DROP PROCEDURE IF EXISTS ${faultInjectedProcedureName}`);
  await connection.query(buildFaultInjectedClearCensusProcedureSql(canonicalProcedureName, faultInjectedProcedureName));
}

// ---------------------------------------------------------------------------
// Fixture seeding — fully self-contained per test. Every census-clear path
// under test (including the single-remaining-census full-clear branch) needs
// exclusive control over which census rows exist in the whole schema, so each
// test wipes every plot/reference-table row in beforeEach and seeds exactly
// the dataset(s) it needs. insertDirectMeasurements in local-db-setup.ts is
// NOT reused here because it is hard-pinned to testData.plots[0] — the
// bystander-census proof below requires a SECOND, independent plot.
// ---------------------------------------------------------------------------

interface SeededDataset {
  plotID: number;
  censusID: number;
  quadratID: number;
  speciesID: number;
  treeID: number;
  stemGUID: number;
  coreMeasurementID: number;
  attributeCode: string;
}

/** Existing catalog row (seeded once by tablestructures.sql, never wiped here) reused for measurement_error_log. */
const EXISTING_INGESTION_ERROR_CODE = 'DUPLICATE_ENTRY';

async function resolveExistingErrorID(connection: Connection): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT ErrorID FROM measurement_errors WHERE ErrorCode = ? LIMIT 1`, [EXISTING_INGESTION_ERROR_CODE]);
  if (rows.length === 0) {
    throw new Error(`Fixture setup requires the seeded '${EXISTING_INGESTION_ERROR_CODE}' catalog row in measurement_errors, but none was found.`);
  }
  return Number(rows[0].ErrorID);
}

/**
 * Wipes every row this suite could have created: deleting `plots` cascades
 * (via FK ON DELETE CASCADE) through census, quadrats, specieslimits, trees,
 * stems, coremeasurements, cmattributes, and measurement_error_log. The
 * remaining tables below have NO enforced FK to plots/census and must be
 * cleared explicitly every time.
 */
async function resetToBlankSchema(connection: Connection): Promise<void> {
  await connection.query('DELETE FROM viewfulltable');
  await connection.query('DELETE FROM measurementssummary');
  await connection.query('DELETE FROM temporarymeasurements');
  await connection.query('DELETE FROM unifiedchangelog');
  await connection.query('DELETE FROM plots');
  await connection.query('DELETE FROM personnel');
  await connection.query('DELETE FROM roles');
  await connection.query('DELETE FROM species');
  await connection.query('DELETE FROM genus');
  await connection.query('DELETE FROM family');
  await connection.query('DELETE FROM reference');
  await connection.query('DELETE FROM attributes');
}

/**
 * Seeds one fully independent plot + census + taxonomy + measurement, with a
 * row in every table clearcensusfull/clearcensusmsmts touch: census,
 * coremeasurements, stems, trees, measurementssummary, cmattributes,
 * measurement_error_log, temporarymeasurements, and viewfulltable.
 *
 * @param suffix short, unique per-test-dataset tag (e.g. 'TGT' / 'BYS') used
 *   to keep every unique-constrained name/code distinct between datasets.
 */
async function seedDataset(connection: Connection, suffix: string): Promise<SeededDataset> {
  const existingErrorID = await resolveExistingErrorID(connection);

  const [referenceResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO reference (PublicationTitle, FullReference, DateOfPublication, Citation) VALUES (?, ?, '2020-01-01', ?)`,
    [`Reference ${suffix}`, `Full reference text for ${suffix}`, `Cite${suffix}`]
  );
  const referenceID = Number(referenceResult.insertId);

  const [familyResult] = await connection.query<ResultSetHeader>(`INSERT INTO family (Family, ReferenceID) VALUES (?, ?)`, [`Family${suffix}`, referenceID]);
  const familyID = Number(familyResult.insertId);

  const [genusResult] = await connection.query<ResultSetHeader>(`INSERT INTO genus (FamilyID, Genus, ReferenceID, GenusAuthority) VALUES (?, ?, ?, ?)`, [
    familyID,
    `Genus${suffix}`,
    referenceID,
    `Auth${suffix}`
  ]);
  const genusID = Number(genusResult.insertId);

  const [speciesResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO species (GenusID, SpeciesCode, SpeciesName, IDLevel, ReferenceID, IsActive) VALUES (?, ?, ?, 'species', ?, 1)`,
    [genusID, `SP${suffix}`, `Species ${suffix}`, referenceID]
  );
  const speciesID = Number(speciesResult.insertId);

  const [roleResult] = await connection.query<ResultSetHeader>(`INSERT INTO roles (RoleName, RoleDescription) VALUES (?, ?)`, [
    `Role${suffix}`,
    `Role for ${suffix}`
  ]);
  const roleID = Number(roleResult.insertId);

  await connection.query(`INSERT INTO personnel (FirstName, LastName, RoleID) VALUES (?, ?, ?)`, [`First${suffix}`, `Last${suffix}`, roleID]);

  const attributeCode = `A${suffix}`.slice(0, 10);
  await connection.query(`INSERT INTO attributes (Code, Description, Status) VALUES (?, ?, 'alive')`, [attributeCode, `Attribute for ${suffix}`]);

  const [plotResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
     VALUES (?, 'Test Location', 'Panama', 100, 100, 10000, 0, 0, 0, 'square', ?)`,
    [`Plot ${suffix}`, `Plot for ${suffix}`]
  );
  const plotID = Number(plotResult.insertId);

  const [quadratResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape) VALUES (?, ?, 0, 0, 20, 20, 400, 'square')`,
    [plotID, `Q${suffix}`]
  );
  const quadratID = Number(quadratResult.insertId);

  const [censusResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate) VALUES (?, 1, '2024-01-01', '2024-12-31')`,
    [plotID]
  );
  const censusID = Number(censusResult.insertId);

  await connection.query(`INSERT INTO specieslimits (SpeciesID, PlotID, CensusID, LimitType, UpperBound, LowerBound) VALUES (?, ?, ?, 'DBH', 500, 1)`, [
    speciesID,
    plotID,
    censusID
  ]);

  const [treeResult] = await connection.query<ResultSetHeader>(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [
    `TREE${suffix}`,
    speciesID,
    censusID
  ]);
  const treeID = Number(treeResult.insertId);

  const [stemResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, '1', 5, 5, 1)`,
    [treeID, quadratID, censusID]
  );
  const stemGUID = Number(stemResult.insertId);

  const [coreMeasurementResult] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive) VALUES (?, ?, 12.5, 1.3, '2024-06-01', 1, 1)`,
    [censusID, stemGUID]
  );
  const coreMeasurementID = Number(coreMeasurementResult.insertId);

  await connection.query(`INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`, [coreMeasurementID, attributeCode]);
  await connection.query(`INSERT INTO measurement_error_log (MeasurementID, ErrorID) VALUES (?, ?)`, [coreMeasurementID, existingErrorID]);

  await connection.query(
    `INSERT INTO measurementssummary (CoreMeasurementID, StemGUID, TreeID, SpeciesID, QuadratID, PlotID, CensusID, SpeciesName, TreeTag, StemTag, MeasurementDate, MeasuredDBH, MeasuredHOM)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1', '2024-06-01', 12.5, 1.3)`,
    [coreMeasurementID, stemGUID, treeID, speciesID, quadratID, plotID, censusID, `Species ${suffix}`, `TREE${suffix}`]
  );

  await connection.query(
    `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
     VALUES (?, ?, ?, ?, ?, '1', ?, ?, 5, 5, 12.5, 1.3, '2024-06-01')`,
    [`file-${suffix}`, `batch-${suffix}`, plotID, censusID, `TREE${suffix}`, `SP${suffix}`, `Q${suffix}`]
  );

  await connection.query(
    `INSERT INTO viewfulltable (CoreMeasurementID, CensusID, PlotID, QuadratID, MeasurementDate, MeasuredDBH, MeasuredHOM) VALUES (?, ?, ?, ?, '2024-06-01', 12.5, 1.3)`,
    [coreMeasurementID, censusID, plotID, quadratID]
  );

  return { plotID, censusID, quadratID, speciesID, treeID, stemGUID, coreMeasurementID, attributeCode };
}

async function seedUnifiedChangelogRow(connection: Connection, censusID: number, plotID: number): Promise<void> {
  await connection.query(
    `INSERT INTO unifiedchangelog (TableName, RecordID, Operation, PlotID, CensusID, ChangedBy) VALUES ('census', ?, 'INSERT', ?, ?, 'integration-test')`,
    [String(censusID), plotID, censusID]
  );
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('clearcensusfull / clearcensusmsmts — viewfulltable cleanup + failure-safety (issue #509)', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    await createFaultInjectedProcedure(connection, CLEAR_CENSUS_MSMTS_PROCEDURE, CLEAR_CENSUS_MSMTS_FAULT_PROCEDURE);
    await createFaultInjectedProcedure(connection, CLEAR_CENSUS_FULL_PROCEDURE, CLEAR_CENSUS_FULL_FAULT_PROCEDURE);
  }, 120000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Session flags first: resetToBlankSchema's DELETE FROM plots relies on an
    // FK cascade, which needs foreign_key_checks=1 (a prior nondefault-entry
    // test may have left it at 0 before its own CALL).
    await setSessionFlags(connection, DEFAULT_SESSION_FLAGS);
    await resetToBlankSchema(connection);
  });

  // -------------------------------------------------------------------------
  // 1. clearcensusmsmts — multi-census case
  // -------------------------------------------------------------------------

  it('clearcensusmsmts removes every target-census row INCLUDING viewfulltable, leaving a bystander census on another plot byte-for-byte unchanged', async () => {
    const target = await seedDataset(connection, 'TGT');
    const bystander = await seedDataset(connection, 'BYS');

    for (const table of CENSUS_SCOPED_TABLES) {
      const count = await countCensusRows(connection, table, target.censusID);
      expect(count, `sanity: target census should have a seeded row in ${table} before clearing`).toBeGreaterThan(0);
    }

    const bystanderSnapshotBefore = await snapshotCensusRows(connection, bystander.censusID);
    const flagsBefore = await readSessionFlags(connection);

    await connection.query(`CALL ${CLEAR_CENSUS_MSMTS_PROCEDURE}(?)`, [target.censusID]);

    for (const table of CENSUS_SCOPED_TABLES) {
      const count = await countCensusRows(connection, table, target.censusID);
      expect(count, `clearcensusmsmts must remove every ${table} row for the cleared census (including the materialized viewfulltable)`).toBe(0);
    }

    const bystanderSnapshotAfter = await snapshotCensusRows(connection, bystander.censusID);
    for (const table of CENSUS_SCOPED_TABLES) {
      expect(bystanderSnapshotAfter[table], `bystander census's ${table} rows must be byte-for-byte unchanged after clearing an unrelated census`).toBe(
        bystanderSnapshotBefore[table]
      );
    }

    const flagsAfter = await readSessionFlags(connection);
    expectSessionFlagsRestored(flagsAfter, flagsBefore, 'successful clearcensusmsmts call');
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. clearcensusfull — multi-census case
  // -------------------------------------------------------------------------

  it('clearcensusfull (multi-census case) removes every target-census row INCLUDING viewfulltable, leaving a bystander census on another plot byte-for-byte unchanged', async () => {
    const target = await seedDataset(connection, 'TGT');
    const bystander = await seedDataset(connection, 'BYS');

    const bystanderSnapshotBefore = await snapshotCensusRows(connection, bystander.censusID);
    const flagsBefore = await readSessionFlags(connection);

    await connection.query(`CALL ${CLEAR_CENSUS_FULL_PROCEDURE}(?)`, [target.censusID]);

    for (const table of CENSUS_SCOPED_TABLES) {
      const count = await countCensusRows(connection, table, target.censusID);
      expect(count, `clearcensusfull must remove every ${table} row for the cleared census (including the materialized viewfulltable)`).toBe(0);
    }

    // Two censuses existed, so the single-remaining-census branch must NOT
    // have fired: the bystander's own reference-table dependencies (species,
    // genus, etc.) are untouched because clearcensusfull never truncates
    // reference tables while more than one census remains.
    const bystanderSnapshotAfter = await snapshotCensusRows(connection, bystander.censusID);
    for (const table of CENSUS_SCOPED_TABLES) {
      expect(bystanderSnapshotAfter[table], `bystander census's ${table} rows must be byte-for-byte unchanged after clearing an unrelated census`).toBe(
        bystanderSnapshotBefore[table]
      );
    }

    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM species WHERE SpeciesID = ?', [bystander.speciesID]);
    expect(Number(speciesRows[0].count), "bystander's species row must survive the multi-census clearcensusfull call").toBe(1);

    const flagsAfter = await readSessionFlags(connection);
    expectSessionFlagsRestored(flagsAfter, flagsBefore, 'successful multi-census clearcensusfull call');
  }, 60000);

  // -------------------------------------------------------------------------
  // 3. clearcensusfull — single-remaining-census path
  // -------------------------------------------------------------------------

  it('clearcensusfull on the LAST remaining census empties reference tables + viewfulltable but PRESERVES unifiedchangelog', async () => {
    const only = await seedDataset(connection, 'TGT');
    await seedUnifiedChangelogRow(connection, only.censusID, only.plotID);

    const [censusCountBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM census');
    expect(Number(censusCountBefore[0].count), 'sanity: exactly one census must exist to exercise the single-remaining-census branch').toBe(1);

    const [unifiedChangelogBefore] = await connection.query<RowDataPacket[]>(
      'SELECT ChangeID, TableName, RecordID, Operation, PlotID, CensusID FROM unifiedchangelog ORDER BY ChangeID'
    );
    expect(unifiedChangelogBefore.length, 'sanity: a unifiedchangelog row must be seeded before clearing').toBeGreaterThan(0);

    const flagsBefore = await readSessionFlags(connection);

    await connection.query(`CALL ${CLEAR_CENSUS_FULL_PROCEDURE}(?)`, [only.censusID]);

    for (const table of REFERENCE_TABLES_CLEARED_ON_FULL_CLEAR) {
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
      expect(Number(rows[0].count), `${table} must be fully emptied once the last census is cleared (DELETE replaces the old TRUNCATE)`).toBe(0);
    }

    const viewfulltableCount = await countCensusRows(connection, 'viewfulltable', only.censusID);
    expect(viewfulltableCount, 'viewfulltable rows for the cleared (and only) census must be gone').toBe(0);

    const [censusCountAfter] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM census');
    expect(Number(censusCountAfter[0].count), 'the census row itself must be gone').toBe(0);

    const [unifiedChangelogAfter] = await connection.query<RowDataPacket[]>(
      'SELECT ChangeID, TableName, RecordID, Operation, PlotID, CensusID FROM unifiedchangelog ORDER BY ChangeID'
    );
    expect(
      unifiedChangelogAfter.length,
      'unifiedchangelog must be PRESERVED on a full clear — it is audit history, not census data (previously destroyed by TRUNCATE)'
    ).toBe(unifiedChangelogBefore.length);
    expect(JSON.stringify(unifiedChangelogAfter), 'unifiedchangelog rows must be byte-for-byte unchanged, not merely equal in count').toBe(
      JSON.stringify(unifiedChangelogBefore)
    );

    const flagsAfter = await readSessionFlags(connection);
    expectSessionFlagsRestored(flagsAfter, flagsBefore, 'successful single-remaining-census clearcensusfull call');
  }, 60000);

  // -------------------------------------------------------------------------
  // 4. Failure-safety — clearcensusmsmts
  // -------------------------------------------------------------------------

  it('FAULT-INJECTED clearcensusmsmts: a SQL error before COMMIT rolls back every change (including viewfulltable) and restores session flags on the SAME connection', async () => {
    const target = await seedDataset(connection, 'TGT');
    const bystander = await seedDataset(connection, 'BYS');

    const targetSnapshotBefore = await snapshotCensusRows(connection, target.censusID);
    const bystanderSnapshotBefore = await snapshotCensusRows(connection, bystander.censusID);
    const flagsBefore = await readSessionFlags(connection);

    await expect(
      connection.query(`CALL ${CLEAR_CENSUS_MSMTS_FAULT_PROCEDURE}(?)`, [target.censusID]),
      'the fault-injected procedure must surface the forced SQLSTATE 45000 error'
    ).rejects.toThrow(/TEST-ONLY fault injection/);

    const targetSnapshotAfter = await snapshotCensusRows(connection, target.censusID);
    for (const table of CENSUS_SCOPED_TABLES) {
      expect(
        targetSnapshotAfter[table],
        `ROLLBACK inside the EXIT HANDLER must restore every ${table} row for the target census, including viewfulltable`
      ).toBe(targetSnapshotBefore[table]);
    }

    const bystanderSnapshotAfter = await snapshotCensusRows(connection, bystander.censusID);
    for (const table of CENSUS_SCOPED_TABLES) {
      expect(bystanderSnapshotAfter[table], `the bystander census must never have been touched by a failed clear of a different census (${table})`).toBe(
        bystanderSnapshotBefore[table]
      );
    }

    const flagsAfter = await readSessionFlags(connection);
    expectSessionFlagsRestored(flagsAfter, flagsBefore, 'EXIT HANDLER after a fault-injected clearcensusmsmts failure');

    // The connection must be usable afterward: no dangling open transaction.
    const [pingRows] = await connection.query<RowDataPacket[]>('SELECT 1 AS ok');
    expect(Number(pingRows[0].ok), 'the connection must remain usable (no leaked transaction) after the EXIT HANDLER rolls back').toBe(1);
  }, 60000);

  // -------------------------------------------------------------------------
  // 5. Failure-safety — clearcensusfull, single-remaining-census path
  //
  // This is specifically the scenario that required TRUNCATE -> DELETE: with
  // only the target census present, the fault must prove the reference-table
  // deletes roll back too (TRUNCATE's implicit commit would have made that
  // impossible).
  // -------------------------------------------------------------------------

  it('FAULT-INJECTED clearcensusfull (single-remaining-census path): rolls back viewfulltable, reference tables, AND the census row, restoring session flags', async () => {
    const only = await seedDataset(connection, 'TGT');
    await seedUnifiedChangelogRow(connection, only.censusID, only.plotID);

    const [censusCountBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM census');
    expect(
      Number(censusCountBefore[0].count),
      'sanity: exactly one census must exist so the fault-injected CALL takes the single-remaining-census branch'
    ).toBe(1);

    const targetSnapshotBefore = await snapshotCensusRows(connection, only.censusID);
    const referenceSnapshotsBefore: Record<string, string> = {};
    for (const table of REFERENCE_TABLES_CLEARED_ON_FULL_CLEAR) {
      referenceSnapshotsBefore[table] = await snapshotReferenceTable(connection, table);
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
      expect(Number(rows[0].count), `sanity: ${table} must have at least one row before the fault-injected clear`).toBeGreaterThan(0);
    }

    const flagsBefore = await readSessionFlags(connection);

    await expect(
      connection.query(`CALL ${CLEAR_CENSUS_FULL_FAULT_PROCEDURE}(?)`, [only.censusID]),
      'the fault-injected procedure must surface the forced SQLSTATE 45000 error'
    ).rejects.toThrow(/TEST-ONLY fault injection/);

    const targetSnapshotAfter = await snapshotCensusRows(connection, only.censusID);
    for (const table of CENSUS_SCOPED_TABLES) {
      expect(
        targetSnapshotAfter[table],
        `ROLLBACK inside the EXIT HANDLER must restore every ${table} row, including viewfulltable and the census row itself`
      ).toBe(targetSnapshotBefore[table]);
    }

    for (const table of REFERENCE_TABLES_CLEARED_ON_FULL_CLEAR) {
      const afterSnapshot = await snapshotReferenceTable(connection, table);
      expect(afterSnapshot, `${table} must be fully restored by rollback — this is exactly why TRUNCATE (implicit commit) had to become DELETE`).toBe(
        referenceSnapshotsBefore[table]
      );
    }

    const flagsAfter = await readSessionFlags(connection);
    expectSessionFlagsRestored(flagsAfter, flagsBefore, 'EXIT HANDLER after a fault-injected single-remaining-census clearcensusfull failure');

    const [pingRows] = await connection.query<RowDataPacket[]>('SELECT 1 AS ok');
    expect(Number(pingRows[0].ok), 'the connection must remain usable (no leaked transaction) after the EXIT HANDLER rolls back').toBe(1);
  }, 60000);

  // -------------------------------------------------------------------------
  // 6-13. Nondefault entry session state (issue #509 regression coverage) —
  // a caller may invoke either procedure from within its own already-
  // overridden scope (foreign_key_checks=0, @disable_triggers=1), or on a
  // fresh connection where @disable_triggers is still NULL. Both procedures
  // must restore the EXACT entry value, not a hard-coded default, whether the
  // CALL succeeds or the EXIT HANDLER fires.
  // -------------------------------------------------------------------------

  const NONDEFAULT_ENTRY_SCENARIOS: ReadonlyArray<{ name: string; flags: SessionFlags }> = [
    { name: 'foreign_key_checks=0, @disable_triggers=1 (nested-caller scope)', flags: { foreignKeyChecks: 0, disableTriggers: 1 } },
    { name: 'foreign_key_checks=1, @disable_triggers=NULL (fresh-connection default)', flags: { foreignKeyChecks: 1, disableTriggers: null } }
  ];

  const NONDEFAULT_ENTRY_PROCEDURES: ReadonlyArray<{ label: string; procedure: string; faultProcedure: string }> = [
    { label: CLEAR_CENSUS_MSMTS_PROCEDURE, procedure: CLEAR_CENSUS_MSMTS_PROCEDURE, faultProcedure: CLEAR_CENSUS_MSMTS_FAULT_PROCEDURE },
    { label: CLEAR_CENSUS_FULL_PROCEDURE, procedure: CLEAR_CENSUS_FULL_PROCEDURE, faultProcedure: CLEAR_CENSUS_FULL_FAULT_PROCEDURE }
  ];

  for (const { label, procedure, faultProcedure } of NONDEFAULT_ENTRY_PROCEDURES) {
    for (const scenario of NONDEFAULT_ENTRY_SCENARIOS) {
      it(`${label} restores entry session state exactly on SUCCESS — entry: ${scenario.name}`, async () => {
        const target = await seedDataset(connection, 'TGT');

        await setSessionFlags(connection, scenario.flags);
        const flagsBefore = await readSessionFlags(connection);

        await connection.query(`CALL ${procedure}(?)`, [target.censusID]);

        const flagsAfter = await readSessionFlags(connection);
        expectSessionFlagsRestored(flagsAfter, flagsBefore, `successful ${label} call with nondefault entry state (${scenario.name})`);
      }, 60000);

      it(`${label} restores entry session state exactly on FAULT-INJECTED FAILURE — entry: ${scenario.name}`, async () => {
        const target = await seedDataset(connection, 'TGT');

        await setSessionFlags(connection, scenario.flags);
        const flagsBefore = await readSessionFlags(connection);

        await expect(
          connection.query(`CALL ${faultProcedure}(?)`, [target.censusID]),
          'the fault-injected procedure must surface the forced SQLSTATE 45000 error'
        ).rejects.toThrow(/TEST-ONLY fault injection/);

        const flagsAfter = await readSessionFlags(connection);
        expectSessionFlagsRestored(flagsAfter, flagsBefore, `EXIT HANDLER with nondefault entry state (${scenario.name})`);
      }, 60000);
    }
  }
});
