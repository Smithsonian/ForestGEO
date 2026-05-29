/**
 * csv-to-sql-v2 integration tests for the pivoted destination procedure.
 *
 * Composes SQL by calling stage renderers directly — no CLI spawning, no CSV
 * parsing. Feeds MeasurementStagingRow[] / AttributeStagingRow[] straight into
 * Stage 1, then executes the assembled procedure against a real MySQL instance.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { splitSqlFile } from '../../lib/provisioning/sql-runner';
import {
  renderProcedureEnvelope,
  renderStage0,
  renderStage0bReload,
  renderStage1,
  renderStage2,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage9DBHAttributes,
  renderStage10,
  renderPostLoadViewFullTableCall
} from '../../lib/csv-to-sql-v2';
import type { MeasurementStagingRow, AttributeStagingRow } from '../../lib/csv-to-sql-shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/csv-to-sql-v2');
const CANONICAL_DDL_PATH = path.join(FIXTURE_DIR, 'canonical-ddl.sql');
const SEED_CENSUS_1_PATH = path.join(FIXTURE_DIR, 'seed-census-1.sql');
const SEED_WITH_PRIORS_PATH = path.join(FIXTURE_DIR, 'seed-with-priors.sql');
const CTFSWEB_STUB_PATH = path.resolve(__dirname, '../fixtures/ctfs-export/install-ctfsweb-stub.sql');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DESTINATION_PLOT_ID = 1;
const CENSUS_NUMBER_1 = '1';
const CENSUS_NUMBER_2 = '2';
const DEFAULT_PROCEDURE_NAME = 'ctfs_export_test_proc';
const DEFAULT_LOCK_NAME = `ctfs-export:${DESTINATION_PLOT_ID}:${CENSUS_NUMBER_1}`;
const LOCK_NAME_CENSUS_2 = `ctfs-export:${DESTINATION_PLOT_ID}:${CENSUS_NUMBER_2}`;

// ---------------------------------------------------------------------------
// ArtifactInput + buildArtifact
// ---------------------------------------------------------------------------

interface ArtifactInput {
  procedureName?: string;
  lockName?: string;
  destinationPlotId: number;
  censusNumber: string;
  allowReload: boolean;
  reloadDryRun?: boolean;
  measurementRows: MeasurementStagingRow[];
  attributeRows: AttributeStagingRow[];
}

function buildArtifact(input: ArtifactInput): string {
  const procedureName = input.procedureName ?? DEFAULT_PROCEDURE_NAME;
  const lockName = input.lockName ?? `ctfs-export:${input.destinationPlotId}:${input.censusNumber}`;
  const measurementsTable = 'staging_measurements';
  const attributesTable = 'staging_attributes';

  const isReload = input.allowReload || !!input.reloadDryRun;

  const stage0bFragment = isReload ? renderStage0bReload({ mode: input.reloadDryRun ? 'dry-run' : 'real' }) : '';

  const stages = [
    renderStage0({ destinationPlotId: input.destinationPlotId, censusNumber: input.censusNumber, allowReload: isReload }),
    stage0bFragment,
    ...(input.reloadDryRun
      ? []
      : [
          renderStage1({ measurementsTable, attributesTable, measurementRows: input.measurementRows, attributeRows: input.attributeRows }),
          renderStage2({ measurementsTable, attributesTable }),
          renderStage5({ measurementsTable, attributesTable }),
          renderStage6NewTrees({ measurementsTable }),
          renderStage7NewStems({ measurementsTable }),
          renderStage8DBH({ measurementsTable }),
          renderStage9DBHAttributes({ measurementsTable, attributesTable }),
          renderStage10({ measurementsTable, attributesTable })
        ])
  ]
    .filter(Boolean)
    .join('\n\n');

  const envelope = renderProcedureEnvelope({
    procedureName,
    lockName,
    cursorDeclarations: [],
    body: stages
  });

  // The ViewFullTable rebuild CALL runs OUTSIDE the load procedure — see
  // render-procedure.ts for why. Dry-run skips it entirely.
  return input.reloadDryRun ? envelope : envelope + '\n' + renderPostLoadViewFullTableCall();
}

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

let nextTempId = 1;

function makeMeasurement(overrides: Partial<MeasurementStagingRow> = {}): MeasurementStagingRow {
  const id = nextTempId++;
  return {
    CoreMeasurementID: id,
    SourceRowIndex: id,
    Tag: String(id),
    StemTag: '1',
    Mnemonic: 'FOO',
    QuadratName: 'A1',
    PlotCensusNumber: CENSUS_NUMBER_1,
    Family: 'Testaceae',
    Genus: 'Foobaria',
    SpeciesName: 'foo',
    SpeciesAuthority: null,
    SubspeciesName: null,
    DBH: 10,
    HOM: '1.3',
    ExactDate: '2024-01-15',
    Comments: null,
    LX: 1,
    LY: 1,
    PrimaryStem: null,
    ...overrides
  };
}

function makeAttribute(measurementId: number, tsmCode: string, coreMeasurementId?: number): AttributeStagingRow {
  return {
    CoreMeasurementID: coreMeasurementId ?? measurementId,
    TSMCode: tsmCode
  };
}

// ---------------------------------------------------------------------------
// DDL + seed helpers
// ---------------------------------------------------------------------------

/**
 * Production-only objects referenced by DBCHANGES2014f section of canonical-ddl.sql.
 * ALTER / RENAME statements touching these are the only DDL errors we tolerate.
 */
const PRODUCTION_ONLY_OBJECTS = ['ViewTaxonomy', 'ViewFullTable', 'TAX1temp'];

function isTolerableDdlError(errCode: string, stmt: string): boolean {
  if (errCode !== 'ER_NO_SUCH_TABLE') return false;
  return PRODUCTION_ONLY_OBJECTS.some(obj => stmt.includes(obj));
}

function stripBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '');
}

async function loadCanonicalDdl(connection: mysql.Connection, filePath: string): Promise<void> {
  const content = stripBlockComments(readFileSync(filePath, 'utf8'));
  for (const stmt of splitSqlFile(content)) {
    try {
      await connection.query(stmt.sql);
    } catch (err: any) {
      if (isTolerableDdlError(err.code, stmt.sql)) continue;
      const preview = stmt.sql.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Canonical DDL load failed at ${filePath}:${stmt.lineNumber}: ${err.message}\nStatement: ${preview}`);
    }
  }
}

async function loadSeedFile(connection: mysql.Connection, filePath: string): Promise<void> {
  for (const stmt of splitSqlFile(readFileSync(filePath, 'utf8'))) {
    await connection.query(stmt.sql);
  }
}

/**
 * Install the ctfsweb_webuser.CreateFullView stub the Stage 0 probe requires.
 * Idempotent.
 */
async function installCtfswebStub(connection: mysql.Connection): Promise<void> {
  for (const stmt of splitSqlFile(readFileSync(CTFSWEB_STUB_PATH, 'utf8'))) {
    if (!stmt.sql.trim()) continue;
    await connection.query(stmt.sql);
  }
}

/**
 * Execute the assembled procedure SQL against the connection.
 * splitSqlFile handles DELIMITER // blocks.
 */
async function executeArtifact(connection: mysql.Connection, sql: string): Promise<mysql.RowDataPacket[][]> {
  const resultSets: mysql.RowDataPacket[][] = [];
  for (const stmt of splitSqlFile(sql)) {
    if (!stmt.sql.trim()) continue;
    const [result] = await connection.query<mysql.RowDataPacket[]>(stmt.sql);
    // CALL statements return the result sets emitted by SELECT inside the procedure.
    // mysql2 returns an array of result sets when multiple SELECTs are emitted.
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      for (const rs of result as unknown as mysql.RowDataPacket[][]) {
        resultSets.push(rs);
      }
    } else if (Array.isArray(result) && result.length > 0 && !Array.isArray(result[0])) {
      resultSets.push(result as mysql.RowDataPacket[]);
    }
  }
  return resultSets;
}

async function countRows(connection: mysql.Connection, table: string, where = ''): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM \`${table}\`${where ? ` WHERE ${where}` : ''}`;
  const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);
  return Number(rows[0].n);
}

interface DestinationCounts {
  tree: number;
  stem: number;
  dbh: number;
  dbhAttributes: number;
}

async function captureDestinationCounts(connection: mysql.Connection): Promise<DestinationCounts> {
  return {
    tree: await countRows(connection, 'Tree'),
    stem: await countRows(connection, 'Stem'),
    dbh: await countRows(connection, 'DBH'),
    dbhAttributes: await countRows(connection, 'DBHAttributes')
  };
}

function expectCountsUnchanged(after: DestinationCounts, before: DestinationCounts): void {
  expect(after.tree, 'Tree count must be unchanged after rollback').toBe(before.tree);
  expect(after.stem, 'Stem count must be unchanged after rollback').toBe(before.stem);
  expect(after.dbh, 'DBH count must be unchanged after rollback').toBe(before.dbh);
  expect(after.dbhAttributes, 'DBHAttributes count must be unchanged after rollback').toBe(before.dbhAttributes);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('csv-to-sql-v2 pivoted destination procedure (integration)', () => {
  let connection: mysql.Connection;
  // Each describe block gets a distinct dbName to avoid cross-suite collision
  // when vitest runs describe blocks sequentially within this file.
  const dbName = `forestgeo_v2_pivot_${process.pid}_${Date.now()}`;
  const config = { ...DEFAULT_TEST_CONFIG, database: dbName };

  beforeEach(async () => {
    nextTempId = 1;
    connection = await createTestDatabase(config);
    await loadCanonicalDdl(connection, CANONICAL_DDL_PATH);
    // The canonical DDL's DBCHANGES2014f section already drops DBHAttributes.CensusID
    // (line: ALTER TABLE DBHAttributes DROP COLUMN censusid). No further ALTER needed.
    await loadSeedFile(connection, SEED_CENSUS_1_PATH);
    // Install the CTFSWeb post-load stub so the Stage 0 probe passes.
    await installCtfswebStub(connection);
  });

  afterEach(async () => {
    if (connection) await teardownTestDatabase(connection, config);
  });

  // -------------------------------------------------------------------------
  // Happy path: single-row insert (N — new tree, new stem)
  // -------------------------------------------------------------------------

  it('happy path single-row insert: one measurement + zero attributes → Tree, Stem, DBH each +1', async () => {
    const measurementRows = [makeMeasurement({ Tag: 'HP1', StemTag: '1', DBH: 12, HOM: '1.3' })];
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows,
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    expect(await countRows(connection, 'Tree')).toBe(1);
    expect(await countRows(connection, 'Stem')).toBe(1);
    expect(await countRows(connection, 'DBH', 'CensusID = 1')).toBe(1);
    expect(await countRows(connection, 'DBHAttributes')).toBe(0);

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT DBH, HOM FROM DBH WHERE CensusID = 1');
    expect(dbhRows).toHaveLength(1);
    expect(Number(dbhRows[0].DBH)).toBeCloseTo(12, 4);
    expect(String(dbhRows[0].HOM)).toBe('1.3');
  });

  it('new-stem duplicate check allows different new trees with the same StemTag in the same quadrat', async () => {
    const measurementRows = [
      makeMeasurement({ Tag: 'NT1', StemTag: '1', QuadratName: 'A1', LX: 1, LY: 1 }),
      makeMeasurement({ Tag: 'NT2', StemTag: '1', QuadratName: 'A1', LX: 2, LY: 2 })
    ];
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows,
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    expect(await countRows(connection, 'Tree')).toBe(2);
    expect(await countRows(connection, 'Stem')).toBe(2);
    expect(await countRows(connection, 'DBH', 'CensusID = 1')).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Mixed O/M/N scenario
  // -------------------------------------------------------------------------

  it('mixed O/M/N: reuses prior stem (O), new stem on known tree (M), new tree+stem (N); Tree=4 Stem=5 DBH(census2)=3', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    // seed-with-priors inserts Census 2 and 3 prior trees (TreeID 1..3, StemID 1..3, CensusID=1 DBH rows)
    // O: Tag=1/StemTag=1 — existing StemID=1
    // M: Tag=1/StemTag=2 — new stem on TreeID=1
    // N: Tag=99/StemTag=1 — brand new tree
    const row1 = makeMeasurement({
      Tag: '1',
      StemTag: '1',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      DBH: 11,
      PlotCensusNumber: CENSUS_NUMBER_2
    });
    const row2 = makeMeasurement({
      Tag: '1',
      StemTag: '2',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      DBH: 9,
      LX: 1.5,
      LY: 1.5,
      PlotCensusNumber: CENSUS_NUMBER_2
    });
    const row3 = makeMeasurement({
      Tag: '99',
      StemTag: '1',
      Mnemonic: 'BAZ',
      Family: 'Testaceae',
      Genus: 'Bazbaria',
      SpeciesName: 'baz',
      DBH: 20,
      QuadratName: 'B1',
      LX: 5,
      LY: 5,
      PlotCensusNumber: CENSUS_NUMBER_2
    });

    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_2,
      lockName: LOCK_NAME_CENSUS_2,
      allowReload: false,
      measurementRows: [row1, row2, row3],
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    // 3 prior trees + 1 new (Tag=99) = 4
    expect(await countRows(connection, 'Tree')).toBe(4);
    // 3 prior stems + 1 new (Tag=1/StemTag=2) + 1 new (Tag=99/StemTag=1) = 5
    expect(await countRows(connection, 'Stem')).toBe(5);
    // Census-2 DBH rows = 3
    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);

    // O-row reuses StemID=1
    const [oRows] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID FROM DBH WHERE CensusID = 2 AND DBH = 11');
    expect(oRows).toHaveLength(1);
    expect(oRows[0].StemID).toBe(1);

    // M-row attaches a new Stem to TreeID=1
    const [mStems] = await connection.query<mysql.RowDataPacket[]>("SELECT StemID, TreeID FROM Stem WHERE TreeID = 1 AND StemTag = '2'");
    expect(mStems).toHaveLength(1);
    expect(mStems[0].TreeID).toBe(1);

    // N-row creates a new Tree with Tag=99
    const [nTrees] = await connection.query<mysql.RowDataPacket[]>("SELECT TreeID FROM Tree WHERE Tag = '99'");
    expect(nTrees).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // HOM passes through unchanged
  // -------------------------------------------------------------------------

  it('HOM passes through unchanged: app-chosen HOM value lands verbatim in DBH row', async () => {
    const measurementRows = [makeMeasurement({ Tag: 'HT1', StemTag: '1', DBH: 15, HOM: '2.0' })];
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows,
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT HOM FROM DBH WHERE CensusID = 1');
    expect(dbhRows).toHaveLength(1);
    expect(String(dbhRows[0].HOM)).toBe('2.0');
  });

  // -------------------------------------------------------------------------
  // DBH=NULL arrives as NULL in destination (app coerced 0→NULL before staging)
  // -------------------------------------------------------------------------

  it('DBH=NULL staging row inserts NULL into DBH.DBH (app already coerced 0→NULL)', async () => {
    // The app converts DBH=0 to NULL before writing the MeasurementStagingRow.
    // The destination procedure must not touch that NULL — it inserts as-is.
    const measurementRows = [makeMeasurement({ Tag: 'DN1', StemTag: '1', DBH: null })];
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows,
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT DBH FROM DBH WHERE CensusID = 1');
    expect(dbhRows).toHaveLength(1);
    expect(dbhRows[0].DBH).toBeNull();
  });

  // -------------------------------------------------------------------------
  // DBHAttributes single-shape (TSMID + DBHID only, no CensusID column)
  // -------------------------------------------------------------------------

  it('DBHAttributes single-shape: one attribute row has TSMID + DBHID, no CensusID on the table', async () => {
    // Verify ALTER TABLE removed CensusID from the live table definition.
    const [colRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DBHAttributes' AND COLUMN_NAME = 'CensusID'"
    );
    expect(colRows, 'CensusID should not exist on DBHAttributes after post-DBCHANGES2014f ALTER').toHaveLength(0);

    const m = makeMeasurement({ Tag: 'AT1', StemTag: '1' });
    const attributeRows = [makeAttribute(m.CoreMeasurementID, 'LI', m.CoreMeasurementID)];
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows: [m],
      attributeRows
    });

    await executeArtifact(connection, artifact);

    expect(await countRows(connection, 'DBHAttributes')).toBe(1);

    const [attrRows] = await connection.query<mysql.RowDataPacket[]>('SELECT TSMID, DBHID FROM DBHAttributes');
    expect(attrRows).toHaveLength(1);
    expect(attrRows[0].TSMID).toBeGreaterThan(0);
    expect(attrRows[0].DBHID).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Subspecies mapping
  // -------------------------------------------------------------------------

  it('subspecies mapping: staging row with SubspeciesName resolves to Tree.SubSpeciesID', async () => {
    // seed-census-1.sql inserts no SubSpecies rows. Insert one here.
    // SpeciesID=1 (FOO / Foobaria / foo) is already seeded.
    await connection.query("INSERT INTO SubSpecies (SubSpeciesID, SpeciesID, SubSpeciesName, Authority, CurrentTaxonFlag) VALUES (1, 1, 'foovar', 'L.', 1)");

    const m = makeMeasurement({
      Tag: 'SS1',
      StemTag: '1',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      SubspeciesName: 'foovar'
      // SubspeciesAuthority dropped from staging — see csv-to-sql-shared.ts.
    });
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows: [m],
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    const [treeRows] = await connection.query<mysql.RowDataPacket[]>('SELECT SubSpeciesID FROM Tree WHERE Tag = ?', ['SS1']);
    expect(treeRows).toHaveLength(1);
    expect(treeRows[0].SubSpeciesID).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Panama overlap regression
  // -------------------------------------------------------------------------

  it('Panama overlap regression: same Tag in a different plot does not block new-tree insertion in target plot', async () => {
    // Pre-seed a second Site (PlotID=2) and a Tree+Stem there with Tag='P1'.
    // The tree_lookup is scoped to @target_plot_id via Stem->Quadrat->PlotID,
    // so this foreign-plot tree must be invisible to Stage 2.
    // Stage 6 then inserts a NEW Tree for (Tag='P1', SpeciesID=1) and binds via
    // LEFT JOIN Stem (the new row has no stem yet).
    await connection.query("INSERT INTO Country (CountryID, CountryName) VALUES (2, 'Panamaland')");
    await connection.query(
      "INSERT INTO Site (PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite, Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize) VALUES (2, 'PANAMA', 'Panama Forest', 2, 'rectangle', 'Panama test', 4.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y')"
    );
    await connection.query("INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, Area, IsStandardShape) VALUES (10, 2, 'A1', 400.0, 'Y')");
    // Foreign-plot tree has a Stem — it is NOT orphaned, so Stage 6's LEFT JOIN Stem won't bind to it.
    await connection.query("INSERT INTO Tree (TreeID, Tag, SpeciesID, SubSpeciesID) VALUES (100, 'P1', 1, NULL)");
    await connection.query("INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY) VALUES (100, 100, '1', 10, 0, 1.0, 1.0)");

    const m = makeMeasurement({
      Tag: 'P1',
      StemTag: '1',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      QuadratName: 'A1',
      LX: 2,
      LY: 2
    });
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows: [m],
      attributeRows: []
    });

    await executeArtifact(connection, artifact);

    // A NEW Tree for Plot 1 must have been inserted — TreeID ≠ 100.
    const [trees] = await connection.query<mysql.RowDataPacket[]>("SELECT TreeID FROM Tree WHERE Tag = 'P1' ORDER BY TreeID");
    // Should have the foreign-plot tree (100) + one new tree for the target plot
    expect(trees.length).toBe(2);
    const newTreeId = trees.find((r: mysql.RowDataPacket) => r.TreeID !== 100)?.TreeID;
    expect(newTreeId).toBeDefined();

    // The DBH row must reference the new stem on the NEW tree, not the foreign tree.
    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT d.DBHID, s.TreeID FROM DBH d JOIN Stem s ON s.StemID = d.StemID WHERE d.CensusID = 1'
    );
    expect(dbhRows).toHaveLength(1);
    expect(dbhRows[0].TreeID).toBe(newTreeId);
    expect(dbhRows[0].TreeID).not.toBe(100);
  });

  // -------------------------------------------------------------------------
  // Stage 5 contract failure: result SELECT arrives before SIGNAL
  // -------------------------------------------------------------------------

  it('Stage 5 contract failure: procedure SIGNALs "Validation failed" with diagnostic columns (CoreMeasurementID, SourceRowIndex, Errors) in the trace SELECT', async () => {
    // Feed a row referencing quadrat 'Z99' which does not exist in seed-census-1.sql.
    const m = makeMeasurement({ Tag: 'CF1', StemTag: '1', QuadratName: 'Z99' });
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows: [m],
      attributeRows: []
    });

    // The procedure SIGNALs with 'Validation failed; see prior SELECT for per-row details'.
    // mysql2's promise API throws on the SIGNAL error packet and does not expose the
    // per-row SELECT result sets emitted before the SIGNAL — those are available via
    // the MySQL protocol stream but not surfaced through Promise<RowDataPacket>.
    // We verify:
    //   (a) The procedure SIGNALs with the expected stable message.
    //   (b) The SIGNAL message text references "prior SELECT" tracing.
    //   (c) The destination tables are unchanged (rollback occurred).
    // The rendered procedure SQL does emit SELECT with CoreMeasurementID, SourceRowIndex,
    // and Errors columns before the SIGNAL — verified by the mysql CLI tool and by
    // the Stage 5 renderer's own SELECT statement.
    const before = await captureDestinationCounts(connection);

    await expect(executeArtifact(connection, artifact)).rejects.toThrow(/Validation failed/);

    // Verify the Stage 5 SELECT was rendered with the correct diagnostic columns.
    expect(artifact).toContain('CoreMeasurementID');
    expect(artifact).toContain('SourceRowIndex');
    expect(artifact).toContain('Errors');
    expect(artifact).toMatch(/SELECT TempID, CoreMeasurementID, SourceRowIndex.*Errors.*FROM.*staging_measurements.*WHERE Errors IS NOT NULL/s);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // allowReload real run
  // -------------------------------------------------------------------------

  it('allowReload real run: target-census DBH rows replaced; prior-census rows untouched; orphan counts reported', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    // First load into Census 2 (three O-rows reusing prior trees/stems from Census 1).
    const firstRows = [
      makeMeasurement({
        Tag: '1',
        StemTag: '1',
        Mnemonic: 'FOO',
        Family: 'Testaceae',
        Genus: 'Foobaria',
        SpeciesName: 'foo',
        DBH: 11,
        PlotCensusNumber: CENSUS_NUMBER_2
      }),
      makeMeasurement({
        Tag: '2',
        StemTag: '1',
        Mnemonic: 'BAR',
        Family: 'Testaceae',
        Genus: 'Barbaria',
        SpeciesName: 'bar',
        DBH: 19,
        HOM: '2.0',
        PlotCensusNumber: CENSUS_NUMBER_2
      }),
      makeMeasurement({
        Tag: '3',
        StemTag: 'OLD',
        Mnemonic: 'BAZ',
        Family: 'Testaceae',
        Genus: 'Bazbaria',
        SpeciesName: 'baz',
        DBH: 16,
        QuadratName: 'A2',
        LX: 3,
        LY: 3,
        PlotCensusNumber: CENSUS_NUMBER_2
      })
    ];
    const firstArtifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_2,
      lockName: LOCK_NAME_CENSUS_2,
      allowReload: false,
      measurementRows: firstRows,
      attributeRows: []
    });
    await executeArtifact(connection, firstArtifact);
    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);

    // Snapshot Census-1 DBH rows — must survive the reload byte-for-byte.
    const [census1Before] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID, DBH FROM DBH WHERE CensusID = 1 ORDER BY StemID');
    expect(census1Before).toHaveLength(3);

    // Reload Census 2 with different DBH values.
    nextTempId = 100; // Avoid TempID collision with first load (different procedure call)
    const reloadRows = [
      makeMeasurement({
        Tag: '1',
        StemTag: '1',
        Mnemonic: 'FOO',
        Family: 'Testaceae',
        Genus: 'Foobaria',
        SpeciesName: 'foo',
        DBH: 99,
        PlotCensusNumber: CENSUS_NUMBER_2
      }),
      makeMeasurement({
        Tag: '2',
        StemTag: '1',
        Mnemonic: 'BAR',
        Family: 'Testaceae',
        Genus: 'Barbaria',
        SpeciesName: 'bar',
        DBH: 88,
        HOM: '2.0',
        PlotCensusNumber: CENSUS_NUMBER_2
      }),
      makeMeasurement({
        Tag: '3',
        StemTag: 'OLD',
        Mnemonic: 'BAZ',
        Family: 'Testaceae',
        Genus: 'Bazbaria',
        SpeciesName: 'baz',
        DBH: 77,
        QuadratName: 'A2',
        LX: 3,
        LY: 3,
        PlotCensusNumber: CENSUS_NUMBER_2
      })
    ];
    const reloadArtifact = buildArtifact({
      procedureName: 'ctfs_export_reload_proc',
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_2,
      lockName: LOCK_NAME_CENSUS_2,
      allowReload: true,
      reloadDryRun: false,
      measurementRows: reloadRows,
      attributeRows: []
    });
    const reloadResultSets = await executeArtifact(connection, reloadArtifact);

    // Target census replaced, not merged.
    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);
    const [newDbh] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID, DBH FROM DBH WHERE CensusID = 2 ORDER BY StemID');
    expect(newDbh.map((r: mysql.RowDataPacket) => Number(r.DBH))).toEqual([99, 88, 77]);

    // Old values are gone.
    const [stale] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM DBH WHERE CensusID = 2 AND DBH IN (11, 19, 16)');
    expect(Number(stale[0].n)).toBe(0);

    // Census-1 rows untouched.
    const [census1After] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID, DBH FROM DBH WHERE CensusID = 1 ORDER BY StemID');
    expect(census1After).toHaveLength(3);
    for (let i = 0; i < census1Before.length; i++) {
      expect(census1After[i].StemID).toBe(census1Before[i].StemID);
      expect(Number(census1After[i].DBH)).toBeCloseTo(Number(census1Before[i].DBH), 4);
    }

    // Orphan count SELECTs must have been emitted from Stage 0b.
    const orphanStemSet = reloadResultSets.find(rs => rs.length > 0 && 'scope' in rs[0] && String(rs[0].scope).includes('stem'));
    const orphanTreeSet = reloadResultSets.find(rs => rs.length > 0 && 'scope' in rs[0] && String(rs[0].scope).includes('tree'));
    expect(orphanStemSet, 'Stage 0b must emit orphan-stems SELECT').toBeDefined();
    expect(orphanTreeSet, 'Stage 0b must emit orphan-trees SELECT').toBeDefined();
  });

  // -------------------------------------------------------------------------
  // reloadDryRun
  // -------------------------------------------------------------------------

  it('reloadDryRun: count SELECTs emitted; zero rows changed in any destination table', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    // Load census 2 first.
    const firstRows = [
      makeMeasurement({
        Tag: '1',
        StemTag: '1',
        Mnemonic: 'FOO',
        Family: 'Testaceae',
        Genus: 'Foobaria',
        SpeciesName: 'foo',
        DBH: 11,
        PlotCensusNumber: CENSUS_NUMBER_2
      })
    ];
    await executeArtifact(
      connection,
      buildArtifact({
        destinationPlotId: DESTINATION_PLOT_ID,
        censusNumber: CENSUS_NUMBER_2,
        lockName: LOCK_NAME_CENSUS_2,
        allowReload: false,
        measurementRows: firstRows,
        attributeRows: []
      })
    );
    const before = await captureDestinationCounts(connection);

    nextTempId = 200;
    const dryRunRows = [
      makeMeasurement({
        Tag: '1',
        StemTag: '1',
        Mnemonic: 'FOO',
        Family: 'Testaceae',
        Genus: 'Foobaria',
        SpeciesName: 'foo',
        DBH: 55,
        PlotCensusNumber: CENSUS_NUMBER_2
      })
    ];
    const dryRunArtifact = buildArtifact({
      procedureName: 'ctfs_export_dry_run_proc',
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_2,
      lockName: LOCK_NAME_CENSUS_2,
      allowReload: false,
      reloadDryRun: true,
      measurementRows: dryRunRows,
      attributeRows: []
    });
    const resultSets = await executeArtifact(connection, dryRunArtifact);

    // Verify at least one count SELECT was emitted from Stage 0b dry-run.
    const countSet = resultSets.find(rs => rs.length > 0 && 'scope' in rs[0]);
    expect(countSet, 'Stage 0b dry-run must emit count SELECTs').toBeDefined();

    // After dry-run, destination row counts must be unchanged.
    const after = await captureDestinationCounts(connection);
    expectCountsUnchanged(after, before);

    // DBH value must not have changed to the dry-run value.
    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT DBH FROM DBH WHERE CensusID = 2');
    const dbhValues = dbhRows.map((r: mysql.RowDataPacket) => Number(r.DBH));
    expect(dbhValues).not.toContain(55);
  });

  // -------------------------------------------------------------------------
  // Concurrent lock
  // -------------------------------------------------------------------------

  it('concurrent lock: second procedure on same (plotId, censusNumber) SIGNALs with lock-failure message', async () => {
    const lockName = DEFAULT_LOCK_NAME;

    // Acquire the lock on a separate connection to simulate a concurrent run.
    const conn2 = await mysql.createConnection({
      host: DEFAULT_TEST_CONFIG.host,
      user: DEFAULT_TEST_CONFIG.user,
      password: DEFAULT_TEST_CONFIG.password,
      port: DEFAULT_TEST_CONFIG.port,
      database: dbName
    });

    try {
      // Hold the lock on conn2.
      await conn2.query(`SELECT GET_LOCK(${mysql.escape(lockName)}, 0)`);

      // Attempt to run the procedure on the primary connection — it must SIGNAL.
      const m = makeMeasurement({ Tag: 'LK1', StemTag: '1' });
      const artifact = buildArtifact({
        destinationPlotId: DESTINATION_PLOT_ID,
        censusNumber: CENSUS_NUMBER_1,
        lockName,
        allowReload: false,
        measurementRows: [m],
        attributeRows: []
      });

      await expect(executeArtifact(connection, artifact)).rejects.toThrow(/Another ctfs-sql export is running/);
    } finally {
      await conn2.query(`SELECT RELEASE_LOCK(${mysql.escape(lockName)})`);
      await conn2.end();
    }
  });

  // -------------------------------------------------------------------------
  // Mid-flight rollback
  // -------------------------------------------------------------------------

  it.skip('mid-flight rollback: UNIQUE violation on Stem after Stage 6/7/8 wrote rows unwinds all inserts (TODO: engineer reliable constraint trigger)', () => {
    // Engineering a mid-flight rollback cleanly is fiddly because Stage 5 catches
    // most violation patterns before any DML runs. The cleanest approach would be
    // to tamper with TSMAttributes between Stage 5 and Stage 9 (as the spec suggests),
    // but MySQL stored-procedure execution is atomic from the caller's perspective —
    // we cannot inject an operation mid-procedure.
    //
    // Alternative: seed a UNIQUE constraint on Stem(TreeID, StemTag) and craft two
    // staging rows that resolve to the same (TreeID=new, StemTag='1') after Stage 6
    // inserts the tree. Stage 5 check 8 would catch this as "Duplicate new-stem
    // natural key", meaning it never reaches Stage 7. A genuine mid-flight failure
    // requires a scenario that passes all 10 Stage 5 checks but still violates a
    // destination constraint — which the current canonical DDL does not expose.
    //
    // This test is deferred until a suitable constraint injection point is identified.
  });

  // -------------------------------------------------------------------------
  // ViewFullTable handling
  // -------------------------------------------------------------------------

  it('emits explicit ViewFullTable rebuild instruction after successful load', async () => {
    const row = makeMeasurement({ Tag: 'VF1', StemTag: '1', DBH: 10 });
    const artifact = buildArtifact({
      destinationPlotId: DESTINATION_PLOT_ID,
      censusNumber: CENSUS_NUMBER_1,
      allowReload: false,
      measurementRows: [row],
      attributeRows: []
    });

    const resultSets = await executeArtifact(connection, artifact);

    // The post-load step now CALLS the installed stub (not just SELECTs an instruction).
    const stubResultSet = resultSets.find(rs => rs.length > 0 && rs[0].scope === 'ctfsweb_webuser.CreateFullView (test stub)');
    expect(stubResultSet, 'post-load CALL must execute ctfsweb_webuser.CreateFullView').toBeDefined();
    const completedSet = resultSets.find(rs => rs.length > 0 && rs[0].scope === 'ViewFullTable rebuild' && rs[0].status === 'completed');
    expect(completedSet, 'post-load must emit the completed sentinel').toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Rollback: already-loaded census without allowReload
  // -------------------------------------------------------------------------

  it('rollback on already-loaded census without allowReload: SIGNAL "Census already loaded" and counts unchanged', async () => {
    // First load succeeds.
    const firstRow = makeMeasurement({ Tag: 'AL1', StemTag: '1', DBH: 10 });
    await executeArtifact(
      connection,
      buildArtifact({
        destinationPlotId: DESTINATION_PLOT_ID,
        censusNumber: CENSUS_NUMBER_1,
        allowReload: false,
        measurementRows: [firstRow],
        attributeRows: []
      })
    );
    const before = await captureDestinationCounts(connection);
    expect(before.dbh).toBe(1);

    // Second load on same census without --allow-reload must SIGNAL.
    nextTempId = 50;
    const secondRow = makeMeasurement({ Tag: 'AL2', StemTag: '1', DBH: 12 });
    await expect(
      executeArtifact(
        connection,
        buildArtifact({
          procedureName: 'ctfs_export_retry_proc',
          destinationPlotId: DESTINATION_PLOT_ID,
          censusNumber: CENSUS_NUMBER_1,
          allowReload: false,
          measurementRows: [secondRow],
          attributeRows: []
        })
      )
    ).rejects.toThrow(/Census already loaded/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: unknown species mnemonic → taxonomy not resolved → Stage 5 SIGNAL
  // -------------------------------------------------------------------------

  it('rollback on unknown species mnemonic: Stage 5 SIGNALs and counts unchanged', async () => {
    const before = await captureDestinationCounts(connection);

    const m = makeMeasurement({ Tag: 'UM1', StemTag: '1', Mnemonic: 'ZZZ', Genus: 'Unknownus', SpeciesName: 'unknown' });
    await expect(
      executeArtifact(
        connection,
        buildArtifact({ destinationPlotId: DESTINATION_PLOT_ID, censusNumber: CENSUS_NUMBER_1, allowReload: false, measurementRows: [m], attributeRows: [] })
      )
    ).rejects.toThrow(/Validation failed/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: unknown quadrat
  // -------------------------------------------------------------------------

  it('rollback on unknown quadrat: Stage 5 SIGNALs and counts unchanged', async () => {
    const before = await captureDestinationCounts(connection);

    const m = makeMeasurement({ Tag: 'UQ1', StemTag: '1', QuadratName: 'Z99' });
    await expect(
      executeArtifact(
        connection,
        buildArtifact({ destinationPlotId: DESTINATION_PLOT_ID, censusNumber: CENSUS_NUMBER_1, allowReload: false, measurementRows: [m], attributeRows: [] })
      )
    ).rejects.toThrow(/Validation failed/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: unknown TSMCode
  // -------------------------------------------------------------------------

  it('rollback on unknown TSMCode: Stage 5 SIGNALs and counts unchanged', async () => {
    const before = await captureDestinationCounts(connection);

    const m = makeMeasurement({ Tag: 'UT1', StemTag: '1' });
    const attributeRows = [makeAttribute(m.CoreMeasurementID, 'ZZ', m.CoreMeasurementID)];
    await expect(
      executeArtifact(
        connection,
        buildArtifact({
          destinationPlotId: DESTINATION_PLOT_ID,
          censusNumber: CENSUS_NUMBER_1,
          allowReload: false,
          measurementRows: [m],
          attributeRows
        })
      )
    ).rejects.toThrow(/Validation failed/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: missing Census row
  // -------------------------------------------------------------------------

  it('rollback on missing Census row: Stage 0 SIGNALs "Expected exactly one Census row" and counts unchanged', async () => {
    const before = await captureDestinationCounts(connection);

    const m = makeMeasurement({ Tag: 'MC1', StemTag: '1' });
    await expect(
      executeArtifact(
        connection,
        buildArtifact({
          procedureName: 'ctfs_export_no_census_proc',
          destinationPlotId: DESTINATION_PLOT_ID,
          censusNumber: '99',
          lockName: 'ctfs-export:1:99',
          allowReload: false,
          measurementRows: [m],
          attributeRows: []
        })
      )
    ).rejects.toThrow(/Expected exactly one Census row/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: duplicate (StemID, CensusID) destination within the batch
  // -------------------------------------------------------------------------

  it('rollback on duplicate (StemID, CensusID) destination: Stage 5 SIGNALs and counts unchanged', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);
    const before = await captureDestinationCounts(connection);

    // Two rows both reference prior (Tag=1, StemTag=1) → resolves to StemID=1.
    // Both target (StemID=1, CensusID=2): Stage 5 check 7 fires.
    const row1 = makeMeasurement({
      Tag: '1',
      StemTag: '1',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      DBH: 11,
      PlotCensusNumber: CENSUS_NUMBER_2
    });
    const row2 = makeMeasurement({
      Tag: '1',
      StemTag: '1',
      Mnemonic: 'FOO',
      Family: 'Testaceae',
      Genus: 'Foobaria',
      SpeciesName: 'foo',
      DBH: 13,
      PlotCensusNumber: CENSUS_NUMBER_2
    });

    await expect(
      executeArtifact(
        connection,
        buildArtifact({
          procedureName: 'ctfs_export_dup_proc',
          destinationPlotId: DESTINATION_PLOT_ID,
          censusNumber: CENSUS_NUMBER_2,
          lockName: LOCK_NAME_CENSUS_2,
          allowReload: false,
          measurementRows: [row1, row2],
          attributeRows: []
        })
      )
    ).rejects.toThrow(/Validation failed/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  // -------------------------------------------------------------------------
  // Rollback: ambiguous tree lookup (two Trees with same Tag in same plot)
  // -------------------------------------------------------------------------

  it('rollback on ambiguous tree tag: Stage 5 SIGNALs and counts unchanged', async () => {
    // Seed two Tree rows with Tag='X', each with a Stem in Plot 1.
    await connection.query("INSERT INTO Tree (TreeID, Tag, SpeciesID) VALUES (10, 'X', 1), (11, 'X', 1)");
    await connection.query(
      "INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY) VALUES (10, 10, '1', 1, 0, 1.0, 1.0), (11, 11, '1', 1, 0, 2.0, 2.0)"
    );

    const before = await captureDestinationCounts(connection);

    const m = makeMeasurement({ Tag: 'X', StemTag: '1', DBH: 10 });
    await expect(
      executeArtifact(
        connection,
        buildArtifact({ destinationPlotId: DESTINATION_PLOT_ID, censusNumber: CENSUS_NUMBER_1, allowReload: false, measurementRows: [m], attributeRows: [] })
      )
    ).rejects.toThrow(/Validation failed/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });
});
