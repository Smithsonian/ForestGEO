/**
 * Post-census statistics queries (S1 #506): Q4/Q5/Q6 correctness + repair migration.
 *
 * `postvalidationqueries` seeds three raw-SQL "statistics" definitions
 * (corequeries.sql) that the /api/postvalidationbyquery route fetches, formats
 * with `${schema}` / `${currentPlotID}` / `${currentCensusID}`, and executes
 * verbatim. All three shipped with bugs that this suite both reproduces (against
 * the ORIGINAL seeded text, so the regression is provable) and proves fixed.
 *
 * The "fixed" text is never hardcoded here: `setupTestDatabase` does not seed
 * `postvalidationqueries` at all, so this suite seeds it itself by extracting
 * the `truncate`/`insert` statements for that table straight out of the live
 * db/sql/corequeries.sql file (via splitSqlFile) and fetches each query's
 * current QueryDefinition from the table by name. That makes corequeries.sql
 * the single source of truth; if a future edit changes the fixed text, these
 * tests re-derive their expectations from the same file instead of silently
 * comparing against a stale copy-pasted constant.
 *
 *   Q4 'Number of all trees' joined trees on CensusID alone (no TreeID
 *       predicate), cross-joining every measurement row against every tree in
 *       the census and counting join rows instead of trees.
 *   Q5 'All dead or missing stems and count by census' had no plot/census scope
 *       at all, and counted a stem once per dead/missing cmattributes row
 *       instead of once per stem.
 *   Q6 'All trees outside plot limits' ANDed its plot/census scope onto only
 *       the last OR branch (AND binds tighter than OR), leaking null-coordinate
 *       and X-overflow violations from every plot/census; it also had no lower
 *       -bound check and could duplicate a stem with more than one measurement.
 *
 * The second describe block proves the guarded repair migration
 * (db/migrations/schema-contract-repair/2026-10-14-01-...) converges a
 * buggy-seeded row to the fixed text, is idempotent, inserts a missing row,
 * never touches a site's structural customization, and that the fixed text it
 * installs matches what `reinsertdefaultpostvalidations()` (the stored
 * procedure corequeries.sql also drives) independently produces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, createAdditionalCensus, type TestData, type CensusInfo } from '../setup/local-db-setup';
import { splitSqlFile } from '@/lib/provisioning/sql-runner';
import { loadMigrationSources } from '@/scripts/apply-schema-migrations';

// ---------------------------------------------------------------------------
// Query identity (must match corequeries.sql / the migration exactly)
// ---------------------------------------------------------------------------
const Q4_NAME = 'Number of all trees';
const Q5_NAME = 'All dead or missing stems and count by census';
const Q6_NAME = 'All trees outside plot limits';

const MIGRATION_ID = '2026-10-14-01-repair-postvalidation-statistics-queries';
const COREQUERIES_SQL_PATH = path.join(process.cwd(), 'db', 'sql', 'corequeries.sql');

// The ORIGINAL buggy seed text (verbatim, pre-fix) for each query. Kept here so
// the bug is provable independent of the live corequeries.sql file, and reused
// to seed the migration's "repair a buggy row" fixtures. These are fixtures of
// a known-bad historical state, not predictions about the current fixed text,
// so hardcoding them is correct (unlike the FIXED_* constants this suite used
// to have, which were deleted in favor of reading the live table).
const BUGGY_Q4_SQL = `select count(t.TreeID) as TotalTrees
from \${schema}.coremeasurements cm
join \${schema}.stems s on s.StemGUID = cm.StemGUID and s.IsActive is true
join \${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
join \${schema}.trees t on t.CensusID = c.CensusID and t.IsActive is true
join \${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where c.CensusID = \${currentCensusID} and c.PlotID = \${currentPlotID}`;

const BUGGY_Q5_SQL = `SELECT cm.CensusID,
           COUNT(s.StemGUID) AS DeadOrMissingStems,
           GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
           FROM \${schema}.stems s
           JOIN \${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true
           JOIN \${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN \${schema}.attributes a ON a.Code = cma.Code and a.IsActive is true
           WHERE a.Status IN ('dead', 'missing') and s.IsActive is true
           GROUP BY cm.CensusID;`;

const BUGGY_Q6_SQL = `select t.TreeTag,
       (s.LocalX + q.StartX + p.GlobalX) as GlobalStemX,
       (s.LocalY + q.StartY + p.GlobalY) as GlobalStemY
from \${schema}.coremeasurements cm
         join \${schema}.stems s on s.StemGUID = cm.StemGUID
         join \${schema}.census c on c.CensusID = cm.CensusID
         join \${schema}.plots p on p.PlotID = c.PlotID
         join \${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
         join \${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where (s.LocalX is null or q.StartX is null or p.GlobalX is null or p.DimensionX is null)
   or (s.LocalY is null or q.StartY is null or p.GlobalY is null or p.DimensionY is null)
   or (s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)
   or (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY)
    and (p.PlotID = \${currentPlotID} and c.CensusID = \${currentCensusID});`;

const SPECIES_CODE = 'ACERRU';
const DEFAULT_DBH = 100;
const DEFAULT_HOM = 130;
const DEFAULT_MEASUREMENT_DATE = '2024-06-01';

/** Mirrors the route's own `${token}` substitution (route.ts) exactly. */
function formatQueryDefinition(definition: string, replacements: Record<string, string | number>): string {
  return definition.replace(/\$\{(.*?)\}/g, (_match, token) => {
    const value = replacements[token];
    if (value === undefined) {
      throw new Error(`formatQueryDefinition: unknown template token "${token}"`);
    }
    return String(value);
  });
}

/** Mirrors the migration's TRIM(REGEXP_REPLACE(text, '\\s+', ' ')) comparison. */
function normalizeWhitespace(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}

/** postvalidationqueries.IsEnabled (and attributes-adjacent bit columns) come back as a Buffer. */
function isEnabledFlag(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

interface SeededQueryRow {
  QueryDefinition: string;
  Description: string;
  IsEnabled: unknown;
}

/**
 * setupTestDatabase() does NOT seed postvalidationqueries (it only loads
 * sitespecificvalidations). This suite seeds it itself by pulling the
 * truncate+insert statements for that one table straight out of the live
 * corequeries.sql, so "the fixed text" always means "whatever corequeries.sql
 * currently says", never a copy pasted-and-forgotten string constant.
 */
async function seedPostvalidationQueriesFromCoreQueries(connection: Connection): Promise<void> {
  const statements = splitSqlFile(fs.readFileSync(COREQUERIES_SQL_PATH, 'utf-8'));
  const relevant = statements.filter(statement => /^\s*(truncate|insert\s+into)\s+postvalidationqueries\b/i.test(statement.sql));
  if (relevant.length === 0) {
    throw new Error(`No postvalidationqueries truncate/insert statements found in ${COREQUERIES_SQL_PATH} — did the table or file get renamed?`);
  }
  for (const statement of relevant) {
    await connection.query(statement.sql);
  }
}

async function fetchQueryDefinition(connection: Connection, queryName: string): Promise<SeededQueryRow> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT QueryDefinition, Description, IsEnabled FROM postvalidationqueries WHERE QueryName = ?', [
    queryName
  ]);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one postvalidationqueries row for QueryName "${queryName}", found ${rows.length}`);
  }
  return { QueryDefinition: String(rows[0].QueryDefinition), Description: String(rows[0].Description), IsEnabled: rows[0].IsEnabled };
}

async function resetRow(connection: Connection, queryName: string, definition: string, description: string): Promise<void> {
  await connection.query('DELETE FROM postvalidationqueries WHERE QueryName = ?', [queryName]);
  await connection.query('INSERT INTO postvalidationqueries (QueryName, QueryDefinition, Description, IsEnabled) VALUES (?, ?, ?, 1)', [
    queryName,
    definition,
    description
  ]);
}

async function deleteRow(connection: Connection, queryName: string): Promise<void> {
  await connection.query('DELETE FROM postvalidationqueries WHERE QueryName = ?', [queryName]);
}

interface DirectStemParams {
  treeTag: string;
  stemTag: string;
  quadratID: number;
  censusID: number;
  localX: number | null;
  localY: number | null;
  codes?: string[];
  /** Defaults to true (active measurement). Set false to prove IsActive filters work. */
  coreMeasurementIsActive?: boolean;
}

/**
 * Inserts a tree + stem + coremeasurement directly, bypassing bulk ingestion.
 * Gets-or-creates the tree by (TreeTag, SpeciesID, CensusID) first: that triple
 * is covered by ux_trees_treetag_speciesid_censusid, and several Q4/Q5
 * fixtures below add a second stem onto an already-inserted tree in the same
 * census, which would otherwise violate that unique key.
 */
async function insertStemDirect(connection: Connection, speciesID: number, params: DirectStemParams): Promise<{ coreMeasurementID: number; stemGUID: number }> {
  const [existingTreeRows] = await connection.query<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?', [
    params.treeTag,
    speciesID,
    params.censusID
  ]);

  let treeID: number;
  if (existingTreeRows.length > 0) {
    treeID = existingTreeRows[0].TreeID;
  } else {
    await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [params.treeTag, speciesID, params.censusID]);
    const [treeRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS TreeID');
    treeID = treeRows[0].TreeID;
  }

  await connection.query(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [treeID, params.quadratID, params.censusID, params.stemTag, params.localX, params.localY]
  );
  const [stemRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS StemGUID');
  const stemGUID = stemRows[0].StemGUID;

  const coreMeasurementIsActive = params.coreMeasurementIsActive === false ? 0 : 1;
  await connection.query(
    `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [stemGUID, params.censusID, DEFAULT_DBH, DEFAULT_HOM, DEFAULT_MEASUREMENT_DATE, coreMeasurementIsActive]
  );
  const [cmRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CoreMeasurementID');
  const coreMeasurementID = cmRows[0].CoreMeasurementID;

  for (const code of params.codes ?? []) {
    await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [coreMeasurementID, code]);
  }

  return { coreMeasurementID, stemGUID };
}

async function insertBareTree(connection: Connection, speciesID: number, treeTag: string, censusID: number): Promise<void> {
  await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [treeTag, speciesID, censusID]);
}

async function fetchQuadratID(connection: Connection, quadratName: string, plotID: number): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [quadratName, plotID]);
  if (rows.length === 0) throw new Error(`Quadrat not found: ${quadratName} on plot ${plotID}`);
  return rows[0].QuadratID;
}

describe('Post-census statistics queries (S1 #506): Q4/Q5/Q6 correctness', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let speciesID: number;

  // Fixed definitions as currently seeded from corequeries.sql, captured once
  // in beforeAll. Every "fixed query" test below executes this live text
  // rather than a hardcoded copy.
  let seededQ4: SeededQueryRow;
  let seededQ5: SeededQueryRow;
  let seededQ6: SeededQueryRow;

  // Plot 1 (testData.plots[0]) censuses, one dedicated to each bug so the
  // queries' own plot/census scope keeps the fixtures from interfering.
  let plot1ID: number;
  let plot1Quadrat1ID: number;
  let plot1Quadrat2ID: number;
  let censusQ4: CensusInfo;
  let censusQ5a: CensusInfo;
  let censusQ5b: CensusInfo;
  let censusQ5c: CensusInfo;
  let censusQ6: CensusInfo;
  let censusQ6b: CensusInfo;

  // A second, independent plot proves the fixed queries never leak across
  // plots (the bug Q5/Q6 had before the scope was added).
  let plot2ID: number;
  let plot2QuadratID: number;
  let censusP2: number;

  // Q4 fixture identifiers
  const Q4_TREE_A = 'Q4-TreeA';
  const Q4_TREE_B = 'Q4-TreeB';
  const Q4_TREE_C_NO_STEM = 'Q4-TreeC';
  const Q4_TREE_D_INACTIVE_ONLY = 'Q4-TreeD';

  // Q5 fixture identifiers
  const Q5_STEM_DEAD = 'D1';
  const Q5_STEM_MISSING = 'D2';
  const Q5_STEM_DUPLICATE_DEAD = 'D3';
  const Q5_SECOND_DEAD_CODE = 'DD';
  const Q5_OTHER_CENSUS_STEM = 'E1';
  const Q5_OTHER_PLOT_STEM = 'F1';
  const Q5_SHARED_TAG = 'SHARED1';

  // Q6 fixture identifiers
  const Q6_TREE_IN_BOUNDS = 'Q6-InBounds';
  const Q6_TREE_NULL_COORD = 'Q6-NullCoord';
  const Q6_TREE_X_OVER = 'Q6-XOver';
  const Q6_TREE_Y_OVER = 'Q6-YOver';
  const Q6_TREE_NEGATIVE = 'Q6-Negative';
  const Q6_TREE_MULTI_MEASURE_OUT = 'Q6-MultiOut';
  const Q6_TREE_NEG_BUT_INBOUNDS = 'Q6-NegButInBounds';
  const Q6_TREE_EXACT_BOUNDARY = 'Q6-ExactBoundary';
  const Q6_OTHER_CENSUS_TREE = 'Q6-OtherCensus';
  const Q6_OTHER_PLOT_TREE = 'Q6-OtherPlot';

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plot1ID = testData.plots[0].plotID;
    plot1Quadrat1ID = await fetchQuadratID(connection, 'Q01', plot1ID);
    // Q02 starts at (StartX=20, StartY=0): used below to prove the fixed Q6
    // flags on GLOBAL coordinates, not raw LocalX, since a negative LocalX on
    // this quadrat still lands in-bounds globally.
    plot1Quadrat2ID = await fetchQuadratID(connection, 'Q02', plot1ID);

    await seedPostvalidationQueriesFromCoreQueries(connection);
    seededQ4 = await fetchQueryDefinition(connection, Q4_NAME);
    seededQ5 = await fetchQueryDefinition(connection, Q5_NAME);
    seededQ6 = await fetchQueryDefinition(connection, Q6_NAME);

    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [SPECIES_CODE]);
    speciesID = speciesRows[0].SpeciesID;

    // Extra dead-status attribute code: proves COUNT/GROUP_CONCAT DISTINCT is
    // necessary even when a stem is flagged dead by two different codes.
    await connection.query(`INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, ?, 'dead', 1)`, [
      Q5_SECOND_DEAD_CODE,
      'Dead (duplicate code, test fixture)'
    ]);

    censusQ4 = await createAdditionalCensus(connection, testData, { plotCensusNumber: 2, startDate: '2024-01-01', endDate: '2024-12-31' });
    censusQ5a = await createAdditionalCensus(connection, testData, { plotCensusNumber: 3, startDate: '2024-01-01', endDate: '2024-12-31' });
    censusQ5b = await createAdditionalCensus(connection, testData, { plotCensusNumber: 4, startDate: '2024-01-01', endDate: '2024-12-31' });
    censusQ6 = await createAdditionalCensus(connection, testData, { plotCensusNumber: 5, startDate: '2024-01-01', endDate: '2024-12-31' });
    censusQ6b = await createAdditionalCensus(connection, testData, { plotCensusNumber: 6, startDate: '2024-01-01', endDate: '2024-12-31' });
    censusQ5c = await createAdditionalCensus(connection, testData, { plotCensusNumber: 7, startDate: '2024-01-01', endDate: '2024-12-31' });

    // --- Q4 fixture: TreeA has two stems (two measurements), TreeB one stem,
    // TreeC is an active tree in the census with NO stem/measurement at all,
    // TreeD's only measurement is IsActive=0 (proves the fixed query's
    // "where cm.IsActive is true" filter, not just the DISTINCT join). ---
    await insertStemDirect(connection, speciesID, {
      treeTag: Q4_TREE_A,
      stemTag: 'Q4-A-S1',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ4.censusID,
      localX: 5,
      localY: 5
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q4_TREE_A,
      stemTag: 'Q4-A-S2',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ4.censusID,
      localX: 6,
      localY: 6
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q4_TREE_B,
      stemTag: 'Q4-B-S1',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ4.censusID,
      localX: 7,
      localY: 7
    });
    await insertBareTree(connection, speciesID, Q4_TREE_C_NO_STEM, censusQ4.censusID);
    await insertStemDirect(connection, speciesID, {
      treeTag: Q4_TREE_D_INACTIVE_ONLY,
      stemTag: 'Q4-D-S1',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ4.censusID,
      localX: 8,
      localY: 8,
      coreMeasurementIsActive: false
    });

    // --- Q5 fixture: three dead/missing stems in censusQ5a (one double-coded
    // as dead via two cmattributes rows), one in censusQ5b (same plot, other
    // census), one on plot2 (other plot entirely), and two DIFFERENT stems
    // sharing the same StemTag in their own dedicated census (proves the
    // fixed query counts/lists by StemGUID, not by the human-readable tag). ---
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeD1',
      stemTag: Q5_STEM_DEAD,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5a.censusID,
      localX: 1,
      localY: 1,
      codes: ['D']
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeD2',
      stemTag: Q5_STEM_MISSING,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5a.censusID,
      localX: 2,
      localY: 2,
      codes: ['M']
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeD3',
      stemTag: Q5_STEM_DUPLICATE_DEAD,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5a.censusID,
      localX: 3,
      localY: 3,
      codes: ['D', Q5_SECOND_DEAD_CODE]
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeE1',
      stemTag: Q5_OTHER_CENSUS_STEM,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5b.censusID,
      localX: 1,
      localY: 1,
      codes: ['D']
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeShared1',
      stemTag: Q5_SHARED_TAG,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5c.censusID,
      localX: 1,
      localY: 1,
      codes: ['D']
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeShared2',
      stemTag: Q5_SHARED_TAG,
      quadratID: plot1Quadrat1ID,
      censusID: censusQ5c.censusID,
      localX: 2,
      localY: 2,
      codes: ['D']
    });

    // --- Q6 fixture: in-bounds control, NULL coordinate, X-overflow,
    // Y-overflow, negative-GLOBAL-coordinate, a double-measured X-overflow
    // stem (must appear exactly once thanks to SELECT DISTINCT), a negative
    // LocalX that is still in-bounds once q.StartX is added (must NOT be
    // flagged — the fixed query compares global coordinates, not raw
    // LocalX < 0), and an exact-boundary stem (global X == GlobalX+DimensionX,
    // must NOT be flagged since the fixed query's upper-bound check is strict
    // `>`, not `>=`). ---
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_IN_BOUNDS,
      stemTag: 'Q6-In',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: 10,
      localY: 10
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_NULL_COORD,
      stemTag: 'Q6-Null',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: null,
      localY: 10
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_X_OVER,
      stemTag: 'Q6-XOver',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: 600,
      localY: 10
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_Y_OVER,
      stemTag: 'Q6-YOver',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: 10,
      localY: 600
    });
    // Q01 starts at (StartX=0, StartY=0): global X = -5 + 0 + 0 = -5, below
    // the plot's GlobalX (0) -> must be flagged by the fixed query's lower
    // -bound check.
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_NEGATIVE,
      stemTag: 'Q6-Neg',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: -5,
      localY: 10
    });
    const multi = await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_MULTI_MEASURE_OUT,
      stemTag: 'Q6-Multi',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: 700,
      localY: 10
    });
    // A second measurement on the SAME stem: proves the fixed query's
    // SELECT DISTINCT collapses this to one row instead of duplicating it.
    await connection.query(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [multi.stemGUID, censusQ6.censusID, DEFAULT_DBH + 1, DEFAULT_HOM, '2024-07-01']
    );
    // Q02 starts at (StartX=20, StartY=0): global X = -1 + 20 + 0 = 19, well
    // inside [0, 500] -> must NOT be flagged even though LocalX is negative.
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_NEG_BUT_INBOUNDS,
      stemTag: 'Q6-NegIn',
      quadratID: plot1Quadrat2ID,
      censusID: censusQ6.censusID,
      localX: -1,
      localY: 10
    });
    // Q01 starts at (StartX=0, StartY=0): global X = 500 + 0 + 0 = 500, which
    // equals GlobalX(0)+DimensionX(500) exactly -> the fixed query's upper
    // -bound check is strict `>`, so this must NOT be flagged.
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_TREE_EXACT_BOUNDARY,
      stemTag: 'Q6-Exact',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6.censusID,
      localX: 500,
      localY: 10
    });

    // Same plot, different census: must not leak into censusQ6's result.
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_OTHER_CENSUS_TREE,
      stemTag: 'Q6-OthCns',
      quadratID: plot1Quadrat1ID,
      censusID: censusQ6b.censusID,
      localX: 600,
      localY: 10
    });

    // --- Second plot: proves Q5/Q6 scope by plot, not just by census. ---
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
       VALUES ('Test Plot Two', 'Test Location Two', 'Panama', 500, 500, 250000, 1000, 1000, 0, 'square', 'Second plot for cross-plot scope assertions')`
    );
    const [plot2Rows] = await connection.query<RowDataPacket[]>('SELECT PlotID FROM plots WHERE PlotName = ?', ['Test Plot Two']);
    plot2ID = plot2Rows[0].PlotID;

    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, 'P2-Q01', 0, 0, 20, 20, 400, 'square')`,
      [plot2ID]
    );
    plot2QuadratID = await fetchQuadratID(connection, 'P2-Q01', plot2ID);

    await connection.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, 1, '2024-01-01', '2024-12-31', 1)`, [
      plot2ID
    ]);
    const [census2Rows] = await connection.query<RowDataPacket[]>('SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1', [plot2ID]);
    censusP2 = census2Rows[0].CensusID;

    await insertStemDirect(connection, speciesID, {
      treeTag: 'Q5-TreeF1',
      stemTag: Q5_OTHER_PLOT_STEM,
      quadratID: plot2QuadratID,
      censusID: censusP2,
      localX: 1,
      localY: 1,
      codes: ['D']
    });
    await insertStemDirect(connection, speciesID, {
      treeTag: Q6_OTHER_PLOT_TREE,
      stemTag: 'Q6-OthPlt',
      quadratID: plot2QuadratID,
      censusID: censusP2,
      localX: 600,
      localY: 10
    });
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection);
  });

  describe('Q4: Number of all trees', () => {
    it('fixed query counts each tree once (DISTINCT, joined on TreeID, IsActive-filtered) instead of multiplying measurements by trees', async () => {
      const fixedSql = formatQueryDefinition(seededQ4.QueryDefinition, { schema, currentPlotID: plot1ID, currentCensusID: censusQ4.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      expect(rows, `fixed Q4 should return exactly one summary row, got ${JSON.stringify(rows)}`).toHaveLength(1);
      // Only TreeA and TreeB have an ACTIVE measurement; TreeC has no stem at
      // all and TreeD's only measurement is IsActive=0, so both are excluded.
      expect(
        rows[0].TotalTrees,
        `expected 2 distinct trees (TreeA, TreeB); TreeC has no stem and TreeD's only measurement is inactive, both must be excluded. Row: ${JSON.stringify(rows[0])}`
      ).toBe(2);
    });

    it('buggy (pre-fix) query cross-joins every measurement against every tree in the census, including inactive measurements', async () => {
      const buggySql = formatQueryDefinition(BUGGY_Q4_SQL, { schema, currentPlotID: plot1ID, currentCensusID: censusQ4.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(buggySql);

      // 4 measurement rows (A-S1, A-S2, B-S1, and D-S1 -- the buggy query has
      // no cm.IsActive filter, so TreeD's inactive measurement still counts)
      // x 4 trees in the census (A, B, C, D) = 16, because the missing
      // t.TreeID = s.TreeID predicate lets every measurement join every tree,
      // and COUNT(t.TreeID) counts those join rows rather than distinct trees.
      expect(
        rows[0].TotalTrees,
        `expected the unfixed cross-join bug to inflate the count to 16 (4 measurements x 4 trees); got ${JSON.stringify(rows[0])}`
      ).toBe(16);
    });
  });

  describe('Q5: All dead or missing stems and count by census', () => {
    it('fixed query scopes to the requested plot/census and counts each stem once even when double-coded dead', async () => {
      const fixedSql = formatQueryDefinition(seededQ5.QueryDefinition, { schema, currentPlotID: plot1ID, currentCensusID: censusQ5a.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      expect(rows, `fixed Q5 scoped to censusQ5a should return exactly one row, got ${JSON.stringify(rows)}`).toHaveLength(1);
      expect(rows[0].CensusID).toBe(censusQ5a.censusID);
      expect(
        rows[0].DeadOrMissingStems,
        `D3 is coded dead by two attribute rows; COUNT(*) over the DISTINCT-StemGUID derived table must still read 3. Row: ${JSON.stringify(rows[0])}`
      ).toBe(3);
      expect(rows[0].DeadOrMissingStemList).toBe(`${Q5_STEM_DEAD},${Q5_STEM_MISSING},${Q5_STEM_DUPLICATE_DEAD}`);
    });

    it('fixed query scoped to a different census on the same plot sees only that census', async () => {
      const fixedSql = formatQueryDefinition(seededQ5.QueryDefinition, { schema, currentPlotID: plot1ID, currentCensusID: censusQ5b.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      expect(rows).toHaveLength(1);
      expect(rows[0].CensusID).toBe(censusQ5b.censusID);
      expect(rows[0].DeadOrMissingStems).toBe(1);
      expect(rows[0].DeadOrMissingStemList).toBe(Q5_OTHER_CENSUS_STEM);
    });

    it('fixed query scoped to the second plot sees only that plot', async () => {
      const fixedSql = formatQueryDefinition(seededQ5.QueryDefinition, { schema, currentPlotID: plot2ID, currentCensusID: censusP2 });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      expect(rows).toHaveLength(1);
      expect(rows[0].DeadOrMissingStems).toBe(1);
      expect(rows[0].DeadOrMissingStemList).toBe(Q5_OTHER_PLOT_STEM);
    });

    it('fixed query counts two different stems that share a human-readable StemTag as two, not one', async () => {
      const fixedSql = formatQueryDefinition(seededQ5.QueryDefinition, { schema, currentPlotID: plot1ID, currentCensusID: censusQ5c.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      expect(rows, `fixed Q5 scoped to censusQ5c should return exactly one row, got ${JSON.stringify(rows)}`).toHaveLength(1);
      expect(
        rows[0].DeadOrMissingStems,
        `two distinct stems both tagged "${Q5_SHARED_TAG}" must count as 2 (DISTINCT is on StemGUID, not StemTag). Row: ${JSON.stringify(rows[0])}`
      ).toBe(2);
      expect(rows[0].DeadOrMissingStemList).toBe(`${Q5_SHARED_TAG},${Q5_SHARED_TAG}`);
    });

    it('buggy (pre-fix) query has no plot/census scope and double-counts the duplicate-coded stem', async () => {
      // The buggy definition has no ${currentPlotID}/${currentCensusID} tokens
      // at all; only ${schema} needs replacing.
      const buggySql = formatQueryDefinition(BUGGY_Q5_SQL, { schema, currentPlotID: plot1ID, currentCensusID: censusQ5a.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(buggySql);

      // Every census with a dead/missing stem leaks into one ungrouped result:
      // censusQ5a, censusQ5b, plot2's census, and now censusQ5c.
      expect(rows, `missing scope should leak all 4 censuses with dead/missing stems into one result; got ${JSON.stringify(rows)}`).toHaveLength(4);

      const q5aRow = rows.find(row => row.CensusID === censusQ5a.censusID);
      expect(q5aRow, `censusQ5a row missing from unscoped result: ${JSON.stringify(rows)}`).toBeDefined();
      // D1 (1) + D2 (1) + D3 counted twice via its two cmattributes rows (2) = 4.
      expect(q5aRow!.DeadOrMissingStems, `non-DISTINCT COUNT should inflate censusQ5a to 4 (D3 counted twice)`).toBe(4);
    });
  });

  describe('Q6: All trees outside plot limits', () => {
    it('fixed query returns exactly the out-of-bounds stems for the requested plot/census, once each, on global coordinates with a strict upper bound', async () => {
      const fixedSql = formatQueryDefinition(seededQ6.QueryDefinition, { schema, currentPlotID: plot1ID, currentCensusID: censusQ6.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(fixedSql);

      const treeTags = rows.map(row => row.TreeTag).sort();
      const expectedTags = [Q6_TREE_NULL_COORD, Q6_TREE_X_OVER, Q6_TREE_Y_OVER, Q6_TREE_NEGATIVE, Q6_TREE_MULTI_MEASURE_OUT].sort();

      expect(treeTags, `fixed Q6 returned ${JSON.stringify(treeTags)}, expected exactly ${JSON.stringify(expectedTags)}`).toEqual(expectedTags);
      expect(treeTags, 'in-bounds control stem must not appear').not.toContain(Q6_TREE_IN_BOUNDS);
      expect(
        treeTags,
        'a negative LocalX that still lands in-bounds once q.StartX is added must not be flagged (global coordinates, not raw LocalX < 0)'
      ).not.toContain(Q6_TREE_NEG_BUT_INBOUNDS);
      expect(treeTags, 'a stem exactly at GlobalX+DimensionX must not be flagged (strict > upper bound, not >=)').not.toContain(Q6_TREE_EXACT_BOUNDARY);
      expect(treeTags, 'out-of-bounds stem from a different census on the same plot must not leak in').not.toContain(Q6_OTHER_CENSUS_TREE);
      expect(treeTags, 'out-of-bounds stem from a different plot must not leak in').not.toContain(Q6_OTHER_PLOT_TREE);
    });

    it('buggy (pre-fix) query leaks null/X-overflow violations across censuses and plots, misses the negative-coordinate case, and duplicates a multi-measurement stem', async () => {
      const buggySql = formatQueryDefinition(BUGGY_Q6_SQL, { schema, currentPlotID: plot1ID, currentCensusID: censusQ6.censusID });
      const [rows] = await connection.query<RowDataPacket[]>(buggySql);

      const tagCounts = new Map<string, number>();
      for (const row of rows) {
        tagCounts.set(row.TreeTag, (tagCounts.get(row.TreeTag) ?? 0) + 1);
      }

      // AND binds tighter than OR: only the Y-overflow branch is actually
      // ANDed with the plot/census scope. The null-coordinate and X-overflow
      // branches run completely unscoped, so they leak in from the other
      // census on the same plot AND from the other plot entirely.
      expect(
        tagCounts.has(Q6_OTHER_CENSUS_TREE),
        `expected the unscoped X-overflow branch to leak in the other-census stem; tags seen: ${JSON.stringify([...tagCounts.keys()])}`
      ).toBe(true);
      expect(
        tagCounts.has(Q6_OTHER_PLOT_TREE),
        `expected the unscoped X-overflow branch to leak in the other-plot stem; tags seen: ${JSON.stringify([...tagCounts.keys()])}`
      ).toBe(true);

      // No lower-bound check at all in the buggy text.
      expect(tagCounts.has(Q6_TREE_NEGATIVE), 'buggy query has no lower-bound check and must never flag the negative-coordinate stem').toBe(false);

      // No SELECT DISTINCT: the double-measured stem duplicates.
      expect(
        tagCounts.get(Q6_TREE_MULTI_MEASURE_OUT),
        `buggy query lacks SELECT DISTINCT; the double-measured stem should appear twice, got ${tagCounts.get(Q6_TREE_MULTI_MEASURE_OUT)}`
      ).toBe(2);
    });
  });
});

describe('Migration 2026-10-14-01: repair postvalidation statistics queries', () => {
  let connection: Connection;
  let migrationSql: string;

  // Snapshots of the as-seeded (fixed) rows, captured BEFORE any test
  // overwrites them with buggy/customized fixtures. The migration tests
  // assert repaired rows converge to these snapshots, never to a string
  // constant duplicated from corequeries.sql.
  let seededQ4: SeededQueryRow;
  let seededQ5: SeededQueryRow;
  let seededQ6: SeededQueryRow;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;

    await seedPostvalidationQueriesFromCoreQueries(connection);
    seededQ4 = await fetchQueryDefinition(connection, Q4_NAME);
    seededQ5 = await fetchQueryDefinition(connection, Q5_NAME);
    seededQ6 = await fetchQueryDefinition(connection, Q6_NAME);

    const sources = loadMigrationSources();
    const migration = sources.find(source => source.id === MIGRATION_ID);
    if (!migration) {
      throw new Error(`Migration "${MIGRATION_ID}" not found in the manifest; sources: ${sources.map(source => source.id).join(', ')}`);
    }
    migrationSql = migration.contents;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection);
  });

  async function readRepairCounters(name: 'q4' | 'q5' | 'q6'): Promise<{ repaired: number; inserted: number; customized: number }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT @${name}_repaired AS repaired, @${name}_inserted AS inserted, @${name}_customized AS customized`
    );
    return { repaired: Number(rows[0].repaired), inserted: Number(rows[0].inserted), customized: Number(rows[0].customized) };
  }

  it('repairs a verbatim-buggy row, preserves a customized row, and inserts a missing row', async () => {
    const customQ5Definition = `${seededQ5.QueryDefinition} /* site customization: extra ordering hint */`;

    await resetRow(connection, Q4_NAME, BUGGY_Q4_SQL, 'stale description');
    await resetRow(connection, Q5_NAME, customQ5Definition, 'customized by a site');
    await deleteRow(connection, Q6_NAME);

    await connection.query(migrationSql);

    const q4Row = await fetchQueryDefinition(connection, Q4_NAME);
    const q5Row = await fetchQueryDefinition(connection, Q5_NAME);
    const q6Row = await fetchQueryDefinition(connection, Q6_NAME);

    expect(normalizeWhitespace(q4Row.QueryDefinition), 'Q4 (verbatim-buggy) should be repaired to the fixed text').toBe(
      normalizeWhitespace(seededQ4.QueryDefinition)
    );
    expect(q5Row.QueryDefinition, 'Q5 (structurally customized) must be left byte-identical to what was seeded, untouched').toBe(customQ5Definition);
    expect(normalizeWhitespace(q6Row.QueryDefinition), 'Q6 (missing) should be inserted with the fixed text').toBe(
      normalizeWhitespace(seededQ6.QueryDefinition)
    );
    expect(q6Row.Description).toBe(seededQ6.Description);
    expect(isEnabledFlag(q6Row.IsEnabled), 'inserted row should default to enabled').toBe(true);

    const q4Counters = await readRepairCounters('q4');
    const q5Counters = await readRepairCounters('q5');
    const q6Counters = await readRepairCounters('q6');
    expect(q4Counters, 'Q4: one verbatim-buggy row repaired').toEqual({ repaired: 1, inserted: 0, customized: 0 });
    expect(q5Counters, 'Q5: one customized row skipped and reported, not repaired').toEqual({ repaired: 0, inserted: 0, customized: 1 });
    expect(q6Counters, 'Q6: one missing row inserted').toEqual({ repaired: 0, inserted: 1, customized: 0 });
  });

  it('repairs all three verbatim-buggy definitions to the fixed text with cache invalidation', async () => {
    // Seed all three as buggy with fake cached results
    const fakeCache = {
      lastRunAt: '2024-06-01 12:00:00',
      lastRunResult: '{"count": 999}',
      lastRunStatus: 'success',
      lastRunPlotID: 1,
      lastRunCensusID: 1
    };

    await resetRow(connection, Q4_NAME, BUGGY_Q4_SQL, 'stale');
    await resetRow(connection, Q5_NAME, BUGGY_Q5_SQL, 'stale');
    await resetRow(connection, Q6_NAME, BUGGY_Q6_SQL, 'stale');

    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName IN (?, ?, ?)`,
      [fakeCache.lastRunAt, fakeCache.lastRunResult, fakeCache.lastRunStatus, fakeCache.lastRunPlotID, fakeCache.lastRunCensusID, Q4_NAME, Q5_NAME, Q6_NAME]
    );

    await connection.query(migrationSql);

    // All three should be repaired
    const q4Row = await fetchQueryDefinition(connection, Q4_NAME);
    const q5Row = await fetchQueryDefinition(connection, Q5_NAME);
    const q6Row = await fetchQueryDefinition(connection, Q6_NAME);

    expect(normalizeWhitespace(q4Row.QueryDefinition), 'Q4 repaired').toBe(normalizeWhitespace(seededQ4.QueryDefinition));
    expect(normalizeWhitespace(q5Row.QueryDefinition), 'Q5 repaired').toBe(normalizeWhitespace(seededQ5.QueryDefinition));
    expect(normalizeWhitespace(q6Row.QueryDefinition), 'Q6 repaired').toBe(normalizeWhitespace(seededQ6.QueryDefinition));

    // All three should have cache cleared
    const [cacheRows] = await connection.query<RowDataPacket[]>(
      'SELECT QueryName, LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName IN (?, ?, ?)',
      [Q4_NAME, Q5_NAME, Q6_NAME]
    );
    for (const row of cacheRows) {
      expect(row.LastRunAt, `${row.QueryName} cache cleared: LastRunAt`).toBeNull();
      expect(row.LastRunResult, `${row.QueryName} cache cleared: LastRunResult`).toBeNull();
      expect(row.LastRunStatus, `${row.QueryName} cache cleared: LastRunStatus`).toBeNull();
      expect(row.LastRunPlotID, `${row.QueryName} cache cleared: LastRunPlotID`).toBeNull();
      expect(row.LastRunCensusID, `${row.QueryName} cache cleared: LastRunCensusID`).toBeNull();
    }

    const q4Counters = await readRepairCounters('q4');
    const q5Counters = await readRepairCounters('q5');
    const q6Counters = await readRepairCounters('q6');
    expect(q4Counters).toEqual({ repaired: 1, inserted: 0, customized: 0 });
    expect(q5Counters).toEqual({ repaired: 1, inserted: 0, customized: 0 });
    expect(q6Counters).toEqual({ repaired: 1, inserted: 0, customized: 0 });
  });

  it('is idempotent: a second run on already-fixed rows repairs nothing and preserves all cache fields', async () => {
    // Set up fresh state: all three fixed with cached results
    await seedPostvalidationQueriesFromCoreQueries(connection);
    const fakeCache = {
      lastRunAt: '2024-06-01 12:00:00',
      lastRunResult: '{"count": 999}',
      lastRunStatus: 'success',
      lastRunPlotID: 1,
      lastRunCensusID: 1
    };
    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName IN (?, ?, ?)`,
      [fakeCache.lastRunAt, fakeCache.lastRunResult, fakeCache.lastRunStatus, fakeCache.lastRunPlotID, fakeCache.lastRunCensusID, Q4_NAME, Q5_NAME, Q6_NAME]
    );

    // First run: should be no-op (already fixed)
    await connection.query(migrationSql);

    const q4Counters1 = await readRepairCounters('q4');
    const q5Counters1 = await readRepairCounters('q5');
    const q6Counters1 = await readRepairCounters('q6');
    expect(q4Counters1, 'first run: Q4 already fixed').toEqual({ repaired: 0, inserted: 0, customized: 0 });
    expect(q5Counters1, 'first run: Q5 already fixed').toEqual({ repaired: 0, inserted: 0, customized: 0 });
    expect(q6Counters1, 'first run: Q6 already fixed').toEqual({ repaired: 0, inserted: 0, customized: 0 });

    // Second run: still no-op
    await connection.query(migrationSql);

    const q4Counters2 = await readRepairCounters('q4');
    expect(q4Counters2, 'second run: still no-op').toEqual({ repaired: 0, inserted: 0, customized: 0 });

    // Cache should be preserved through both runs
    const [cacheRows] = await connection.query<RowDataPacket[]>(
      'SELECT QueryName, LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName IN (?, ?, ?)',
      [Q4_NAME, Q5_NAME, Q6_NAME]
    );
    for (const row of cacheRows) {
      expect(row.LastRunAt, `${row.QueryName} cache preserved: LastRunAt must not be null`).not.toBeNull();
      expect(row.LastRunResult, `${row.QueryName} cache preserved: LastRunResult`).toBe(fakeCache.lastRunResult);
      expect(row.LastRunStatus, `${row.QueryName} cache preserved: LastRunStatus`).toBe(fakeCache.lastRunStatus);
      expect(row.LastRunPlotID, `${row.QueryName} cache preserved: LastRunPlotID`).toBe(fakeCache.lastRunPlotID);
      expect(row.LastRunCensusID, `${row.QueryName} cache preserved: LastRunCensusID`).toBe(fakeCache.lastRunCensusID);
    }
  });

  it('preserves a row with NULL QueryDefinition and counts it as customized', async () => {
    await seedPostvalidationQueriesFromCoreQueries(connection);

    // Set up cache on Q4 before making it NULL
    const fakeCacheBefore = {
      lastRunAt: '2024-06-01 12:00:00',
      lastRunResult: '{"count": 999}',
      lastRunStatus: 'success',
      lastRunPlotID: 1,
      lastRunCensusID: 1
    };
    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName = ?`,
      [
        fakeCacheBefore.lastRunAt,
        fakeCacheBefore.lastRunResult,
        fakeCacheBefore.lastRunStatus,
        fakeCacheBefore.lastRunPlotID,
        fakeCacheBefore.lastRunCensusID,
        Q4_NAME
      ]
    );

    // Set Q4 to have NULL QueryDefinition
    await connection.query('UPDATE postvalidationqueries SET QueryDefinition = NULL WHERE QueryName = ?', [Q4_NAME]);

    await connection.query(migrationSql);

    // Row should still exist with NULL definition
    const [rows] = await connection.query<RowDataPacket[]>('SELECT QueryDefinition FROM postvalidationqueries WHERE QueryName = ?', [Q4_NAME]);
    expect(rows).toHaveLength(1);
    expect(rows[0].QueryDefinition, 'NULL QueryDefinition must be preserved').toBeNull();

    // Cache must be preserved
    const [cacheRows] = await connection.query<RowDataPacket[]>(
      'SELECT LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName = ?',
      [Q4_NAME]
    );
    expect(cacheRows[0].LastRunAt, 'NULL row cache preserved: LastRunAt must not be null').not.toBeNull();
    expect(cacheRows[0].LastRunResult, 'NULL row cache preserved: LastRunResult').toBe(fakeCacheBefore.lastRunResult);
    expect(cacheRows[0].LastRunStatus, 'NULL row cache preserved: LastRunStatus').toBe(fakeCacheBefore.lastRunStatus);
    expect(cacheRows[0].LastRunPlotID, 'NULL row cache preserved: LastRunPlotID').toBe(fakeCacheBefore.lastRunPlotID);
    expect(cacheRows[0].LastRunCensusID, 'NULL row cache preserved: LastRunCensusID').toBe(fakeCacheBefore.lastRunCensusID);

    const q4Counters = await readRepairCounters('q4');
    expect(q4Counters, 'NULL definition should be counted as customized').toEqual({ repaired: 0, inserted: 0, customized: 1 });
  });

  it('preserves a case-only variant of the buggy text and counts it as customized (proves BINARY guard)', async () => {
    await seedPostvalidationQueriesFromCoreQueries(connection);

    // A case-only change to the buggy text: if the migration's guard were case-insensitive,
    // this would match the buggy signature and be "repaired" -- we assert it is NOT.
    const caseOnlyBuggy = BUGGY_Q4_SQL.replace('select count', 'SELECT COUNT');

    // Snapshot cache before migration
    const fakeCacheBefore = {
      lastRunAt: '2024-06-01 12:00:00',
      lastRunResult: '{"count": 999}',
      lastRunStatus: 'success',
      lastRunPlotID: 1,
      lastRunCensusID: 1
    };
    await resetRow(connection, Q4_NAME, caseOnlyBuggy, 'case variant');
    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName = ?`,
      [
        fakeCacheBefore.lastRunAt,
        fakeCacheBefore.lastRunResult,
        fakeCacheBefore.lastRunStatus,
        fakeCacheBefore.lastRunPlotID,
        fakeCacheBefore.lastRunCensusID,
        Q4_NAME
      ]
    );

    await connection.query(migrationSql);

    // Definition must be byte-identical (not repaired)
    const q4Row = await fetchQueryDefinition(connection, Q4_NAME);
    expect(q4Row.QueryDefinition, 'case-only buggy variant must be preserved byte-for-byte, not repaired').toBe(caseOnlyBuggy);

    // All five cache fields must be preserved
    const [cacheRows] = await connection.query<RowDataPacket[]>(
      'SELECT LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName = ?',
      [Q4_NAME]
    );
    expect(cacheRows[0].LastRunResult, 'cache preserved: LastRunResult').toBe(fakeCacheBefore.lastRunResult);
    expect(cacheRows[0].LastRunStatus, 'cache preserved: LastRunStatus').toBe(fakeCacheBefore.lastRunStatus);
    expect(cacheRows[0].LastRunPlotID, 'cache preserved: LastRunPlotID').toBe(fakeCacheBefore.lastRunPlotID);
    expect(cacheRows[0].LastRunCensusID, 'cache preserved: LastRunCensusID').toBe(fakeCacheBefore.lastRunCensusID);
    // LastRunAt comparison: check it's not null (preserved) rather than exact datetime to avoid timezone issues
    expect(cacheRows[0].LastRunAt, 'cache preserved: LastRunAt must not be null').not.toBeNull();

    const q4Counters = await readRepairCounters('q4');
    expect(q4Counters, 'case-only buggy variant should be counted as customized').toEqual({ repaired: 0, inserted: 0, customized: 1 });
  });

  it('CALL reinsertdefaultpostvalidations() independently produces the same fixed text the migration converges to', async () => {
    await connection.query('CALL reinsertdefaultpostvalidations()');

    const q4Row = await fetchQueryDefinition(connection, Q4_NAME);
    const q5Row = await fetchQueryDefinition(connection, Q5_NAME);
    const q6Row = await fetchQueryDefinition(connection, Q6_NAME);

    expect(normalizeWhitespace(q4Row.QueryDefinition), 'procedure-reinserted Q4 must match the file-seeded fixed text').toBe(
      normalizeWhitespace(seededQ4.QueryDefinition)
    );
    expect(normalizeWhitespace(q5Row.QueryDefinition), 'procedure-reinserted Q5 must match the file-seeded fixed text').toBe(
      normalizeWhitespace(seededQ5.QueryDefinition)
    );
    expect(normalizeWhitespace(q6Row.QueryDefinition), 'procedure-reinserted Q6 must match the file-seeded fixed text').toBe(
      normalizeWhitespace(seededQ6.QueryDefinition)
    );
  });

  it('clears cached results for repaired rows but preserves them for already-correct and customized rows', async () => {
    // Reset to fresh state
    await seedPostvalidationQueriesFromCoreQueries(connection);

    // Set up fake cached results on all three rows
    const fakeCache = {
      lastRunAt: '2024-06-01 12:00:00',
      lastRunResult: '{"count": 999}',
      lastRunStatus: 'success',
      lastRunPlotID: 1,
      lastRunCensusID: 1
    };
    await connection.query(
      `UPDATE postvalidationqueries
       SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ?
       WHERE QueryName IN (?, ?, ?)`,
      [fakeCache.lastRunAt, fakeCache.lastRunResult, fakeCache.lastRunStatus, fakeCache.lastRunPlotID, fakeCache.lastRunCensusID, Q4_NAME, Q5_NAME, Q6_NAME]
    );

    // Q4: make it buggy (should be repaired, cache cleared)
    await resetRow(connection, Q4_NAME, BUGGY_Q4_SQL, 'stale description');
    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName = ?`,
      [fakeCache.lastRunAt, fakeCache.lastRunResult, fakeCache.lastRunStatus, fakeCache.lastRunPlotID, fakeCache.lastRunCensusID, Q4_NAME]
    );

    // Q5: leave as already-correct (should preserve cache)
    // Q6: make it customized (should preserve cache)
    const customQ6Definition = `${seededQ6.QueryDefinition} /* custom */`;
    await resetRow(connection, Q6_NAME, customQ6Definition, 'customized');
    await connection.query(
      `UPDATE postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ?, LastRunPlotID = ?, LastRunCensusID = ? WHERE QueryName = ?`,
      [fakeCache.lastRunAt, fakeCache.lastRunResult, fakeCache.lastRunStatus, fakeCache.lastRunPlotID, fakeCache.lastRunCensusID, Q6_NAME]
    );

    await connection.query(migrationSql);

    // Verify Q4 (repaired): cache should be cleared
    const [q4Rows] = await connection.query<RowDataPacket[]>(
      'SELECT LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName = ?',
      [Q4_NAME]
    );
    expect(q4Rows[0].LastRunAt, 'repaired Q4 should have LastRunAt cleared').toBeNull();
    expect(q4Rows[0].LastRunResult, 'repaired Q4 should have LastRunResult cleared').toBeNull();
    expect(q4Rows[0].LastRunStatus, 'repaired Q4 should have LastRunStatus cleared').toBeNull();
    expect(q4Rows[0].LastRunPlotID, 'repaired Q4 should have LastRunPlotID cleared').toBeNull();
    expect(q4Rows[0].LastRunCensusID, 'repaired Q4 should have LastRunCensusID cleared').toBeNull();

    // Verify Q5 (already-correct): cache should be preserved
    const [q5Rows] = await connection.query<RowDataPacket[]>(
      'SELECT LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName = ?',
      [Q5_NAME]
    );
    expect(q5Rows[0].LastRunResult, 'already-correct Q5 should preserve LastRunResult').toBe(fakeCache.lastRunResult);
    expect(q5Rows[0].LastRunStatus, 'already-correct Q5 should preserve LastRunStatus').toBe(fakeCache.lastRunStatus);

    // Verify Q6 (customized): cache should be preserved
    const [q6Rows] = await connection.query<RowDataPacket[]>(
      'SELECT LastRunAt, LastRunResult, LastRunStatus, LastRunPlotID, LastRunCensusID FROM postvalidationqueries WHERE QueryName = ?',
      [Q6_NAME]
    );
    expect(q6Rows[0].LastRunResult, 'customized Q6 should preserve LastRunResult').toBe(fakeCache.lastRunResult);
    expect(q6Rows[0].LastRunStatus, 'customized Q6 should preserve LastRunStatus').toBe(fakeCache.lastRunStatus);
  });
});
