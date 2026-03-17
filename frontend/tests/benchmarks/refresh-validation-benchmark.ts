import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

type Variant = 'head' | 'working';
type BenchmarkMode = 'all' | 'refresh' | 'validations' | 'shared-dbh';

interface SeedMeta {
  plotID: number;
  census1ID: number;
  census2ID: number;
  speciesByCode: Record<string, number>;
  quadratByName: Record<string, number>;
  quadratNames: string[];
}

interface MeasurementRow {
  treeTag: string;
  stemTag: string;
  speciesCode: string;
  quadratName: string;
  x: number;
  y: number;
  dbh: number;
  hom: number;
  date: string;
}

interface RefreshResult {
  procedure: 'RefreshMeasurementsSummary' | 'RefreshViewFullTable';
  warmupMs: number;
  measuredMs: number;
  rowCount: number;
}

interface ValidationResult {
  validationID: number;
  elapsedMs: number;
  errorCount: number;
}

interface SharedDbhResult {
  elapsedMs: number;
  growthErrorCount: number;
  shrinkageErrorCount: number;
}

interface ScenarioResult {
  variant: Variant;
  rowCount: number;
  refreshSummary: RefreshResult;
  refreshFull: RefreshResult;
  validations?: ValidationResult[];
  sharedDbh?: SharedDbhResult;
}

const DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword',
  multipleStatements: true
};

const REPO_ROOT = path.resolve(process.cwd(), '..');
const FRONTEND_ROOT = process.cwd();
const BULK_INSERT_CHUNK = 1000;
const QUADRAT_COUNT = 100;
const SPECIES_CODES = ['ACERRU', 'QUERCO', 'PINUST', 'FAGUGR', 'BETUAL', 'TILIAA', 'FRAXAM', 'ULMUSA', 'CARYAG', 'LIQUIS'];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

function getStoredProcedureContent(variant: Variant): string {
  if (variant === 'working') {
    return fs.readFileSync(path.join(FRONTEND_ROOT, 'sqlscripting', 'storedprocedures.sql'), 'utf-8');
  }

  return execSync('git show HEAD:frontend/sqlscripting/storedprocedures.sql', {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function loadSchema(conn: mysql.Connection): Promise<void> {
  const schemaPath = path.join(FRONTEND_ROOT, 'sqlscripting', 'tablestructures.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const stmt of schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))) {
    try {
      await conn.query(stmt);
    } catch (err: any) {
      if (!err.message.includes("doesn't exist") && !err.message.includes('already exists')) {
        throw err;
      }
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function loadStoredProcedures(conn: mysql.Connection, content: string): Promise<void> {
  const cleanedContent = content.replace(/DELIMITER\s+\$\$/gi, '').replace(/DELIMITER\s+;/gi, '');

  for (const stmt of cleanedContent
    .split('$$')
    .map(s => s.trim())
    .filter(s => s.length >= 10)) {
    const cleaned = stmt.replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, '');
    try {
      await conn.query(cleaned);
    } catch (err: any) {
      if (!err.message.includes('already exists') && !err.message.includes('does not exist')) {
        throw err;
      }
    }
  }
}

async function seedValidationCatalog(conn: mysql.Connection): Promise<void> {
  await conn.query('CALL reinsertdefaultvalidations()');
  await conn.query(`
    INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
    SELECT 'validation', CAST(ValidationID AS CHAR), CONCAT('Validation ', ValidationID, ': ', COALESCE(NULLIF(Description, ''), ProcedureName))
    FROM sitespecificvalidations
  `);
}

async function seedBaseData(conn: mysql.Connection): Promise<SeedMeta> {
  for (const code of SPECIES_CODES) {
    await conn.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
       VALUES (?, ?, 'species', 1)
       ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
      [code, `${code} species`]
    );
  }

  await conn.query(`
    INSERT INTO attributes (Code, Description, Status, IsActive)
    VALUES
      ('A', 'Alive', 'alive', 1),
      ('L', 'Lean', 'alive', 1),
      ('M', 'Marked', 'alive-not measured', 1),
      ('D', 'Dead', 'dead', 1)
    ON DUPLICATE KEY UPDATE
      Description = VALUES(Description),
      Status = VALUES(Status)
  `);

  await conn.query(
    `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area,
       GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription, DefaultDBHUnits)
     VALUES ('Refresh Benchmark Plot','Benchmark','Panama',1000,1000,100000,0,0,0,'square','Refresh benchmark','mm')`
  );
  const [[plotRow]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS PlotID');
  const plotID = Number(plotRow.PlotID);

  const quadratNames: string[] = [];
  for (let i = 0; i < QUADRAT_COUNT; i++) {
    const name = `Q${String(i + 1).padStart(3, '0')}`;
    quadratNames.push(name);
    await conn.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, ?, ?, 10, 10, 100, 'square', 1)`,
      [plotID, name, (i % 10) * 10, Math.floor(i / 10) * 10]
    );
  }

  await conn.query(
    `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive)
     VALUES (?, 1, '2024-01-01', '2024-12-31', 'Benchmark census 1', 1)`,
    [plotID]
  );
  const [[c1]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');

  await conn.query(
    `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive)
     VALUES (?, 2, '2025-01-01', '2025-12-31', 'Benchmark census 2', 1)`,
    [plotID]
  );
  const [[c2]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');

  const [speciesRows] = await conn.query<mysql.RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?)', [SPECIES_CODES]);
  const [quadratRows] = await conn.query<mysql.RowDataPacket[]>('SELECT QuadratID, QuadratName FROM quadrats WHERE PlotID = ?', [plotID]);

  return {
    plotID,
    census1ID: Number(c1.CensusID),
    census2ID: Number(c2.CensusID),
    speciesByCode: Object.fromEntries(speciesRows.map((r: any) => [r.SpeciesCode, Number(r.SpeciesID)])),
    quadratByName: Object.fromEntries(quadratRows.map((r: any) => [r.QuadratName, Number(r.QuadratID)])),
    quadratNames
  };
}

function generateMeasurements(rowCount: number, quadratNames: string[], censusNum: number): MeasurementRow[] {
  const date = censusNum === 1 ? '2024-06-15' : '2025-06-15';
  const rows: MeasurementRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i % QUADRAT_COUNT;
    rows.push({
      treeTag: `TREE${String(i + 1).padStart(6, '0')}`,
      stemTag: '1',
      speciesCode: SPECIES_CODES[i % SPECIES_CODES.length],
      quadratName: quadratNames[i % quadratNames.length],
      x: Number(((base % 10) + 0.25).toFixed(2)),
      y: Number((Math.floor(base / 10) + 0.25).toFixed(2)),
      dbh: Number((10 + (i % 50) * 0.1 + (censusNum === 2 ? 0.5 : 0)).toFixed(2)),
      hom: 1.3,
      date
    });
  }
  return rows;
}

async function seedCensus(conn: mysql.Connection, meta: SeedMeta, rows: MeasurementRow[], censusID: number, isValidated: 0 | 1 | null): Promise<void> {
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: Array<string | number> = [];
    const placeholders = chunk
      .map(row => {
        values.push(row.treeTag, meta.speciesByCode[row.speciesCode], censusID);
        return '(?, ?, ?, 1)';
      })
      .join(',');
    await conn.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES ${placeholders}`, values);
  }

  const [treeRows] = await conn.query<mysql.RowDataPacket[]>('SELECT TreeID, TreeTag FROM trees WHERE CensusID = ?', [censusID]);
  const treeByTag = Object.fromEntries(treeRows.map((r: any) => [r.TreeTag, Number(r.TreeID)]));

  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: Array<string | number> = [];
    const placeholders = chunk
      .map(row => {
        values.push(treeByTag[row.treeTag], meta.quadratByName[row.quadratName], censusID, row.stemTag, row.x, row.y);
        return '(?, ?, ?, ?, ?, ?, 1)';
      })
      .join(',');
    await conn.query(`INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES ${placeholders}`, values);
  }

  const [stemRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT s.StemGUID, t.TreeTag
     FROM stems s
     JOIN trees t ON t.TreeID = s.TreeID
     WHERE s.CensusID = ?`,
    [censusID]
  );
  const stemByTreeTag = Object.fromEntries(stemRows.map((r: any) => [r.TreeTag, Number(r.StemGUID)]));

  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: Array<string | number> = [];
    const placeholders = chunk
      .map(row => {
        values.push(stemByTreeTag[row.treeTag], censusID, row.dbh, row.hom, row.date);
        return isValidated === null ? '(?, ?, ?, ?, ?, NULL, 1)' : '(?, ?, ?, ?, ?, ?, 1)';
      })
      .join(',');

    if (isValidated === null) {
      await conn.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES ${placeholders}`,
        values
      );
    } else {
      const withValidated: Array<string | number> = [];
      for (let i = 0; i < values.length; i += 5) {
        withValidated.push(values[i], values[i + 1], values[i + 2], values[i + 3], values[i + 4], isValidated);
      }
      await conn.query(
        `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
         VALUES ${placeholders}`,
        withValidated
      );
    }
  }
}

async function seedAttributesForCensus(conn: mysql.Connection, censusID: number, extraCode: 'L' | 'M'): Promise<void> {
  await conn.query(
    `INSERT INTO cmattributes (CoreMeasurementID, Code)
     SELECT CoreMeasurementID, 'A'
     FROM coremeasurements
     WHERE CensusID = ?`,
    [censusID]
  );

  await conn.query(
    `INSERT INTO cmattributes (CoreMeasurementID, Code)
     SELECT CoreMeasurementID, ?
     FROM coremeasurements
     WHERE CensusID = ? AND MOD(CoreMeasurementID, 3) = 0`,
    [extraCode, censusID]
  );

  await conn.query(
    `INSERT INTO cmattributes (CoreMeasurementID, Code)
     SELECT CoreMeasurementID, 'M'
     FROM coremeasurements
     WHERE CensusID = ? AND MOD(CoreMeasurementID, 5) = 0`,
    [censusID]
  );
}

async function seedRefreshErrors(conn: mysql.Connection, censusID: number): Promise<void> {
  await conn.query(
    `INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
     SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
     FROM coremeasurements cm
     JOIN measurement_errors me ON me.ErrorSource = 'validation' AND me.ErrorCode = '1'
     WHERE cm.CensusID = ? AND MOD(cm.CoreMeasurementID, 97) = 0`,
    [censusID]
  );

  await conn.query(
    `INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
     SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
     FROM coremeasurements cm
     JOIN measurement_errors me ON me.ErrorSource = 'validation' AND me.ErrorCode = '2'
     WHERE cm.CensusID = ? AND MOD(cm.CoreMeasurementID, 131) = 0`,
    [censusID]
  );
}

async function runRefreshProcedure(
  conn: mysql.Connection,
  procedure: 'RefreshMeasurementsSummary' | 'RefreshViewFullTable',
  table: 'measurementssummary' | 'viewfulltable'
): Promise<RefreshResult> {
  const warmupStart = Date.now();
  await conn.query(`CALL ${procedure}()`);
  const warmupMs = Date.now() - warmupStart;

  const measuredStart = Date.now();
  await conn.query(`CALL ${procedure}()`);
  const measuredMs = Date.now() - measuredStart;

  const [[row]] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${table}`);

  return {
    procedure,
    warmupMs,
    measuredMs,
    rowCount: Number(row.cnt)
  };
}

async function runValidation(conn: mysql.Connection, validationID: 1 | 2, censusID: number, plotID: number): Promise<ValidationResult> {
  await conn.query(
    `DELETE mel
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     JOIN census c ON cm.CensusID = c.CensusID
     WHERE me.ErrorSource = 'validation'
       AND me.ErrorCode = CAST(? AS CHAR)
       AND cm.IsValidated IS NULL
       AND cm.IsActive = TRUE
       AND cm.CensusID = ?
       AND c.PlotID = ?`,
    [validationID, censusID, plotID]
  );

  const [[defRow]] = await conn.query<mysql.RowDataPacket[]>('SELECT Definition FROM sitespecificvalidations WHERE ValidationID = ? AND IsEnabled = 1', [
    validationID
  ]);

  const formattedQuery = String(defRow.Definition)
    .replace(/@p_CensusID/g, String(censusID))
    .replace(/@p_PlotID/g, String(plotID))
    .replace(/@validationProcedureID/g, String(validationID));

  const start = Date.now();
  await conn.query(formattedQuery);
  const elapsedMs = Date.now() - start;

  const [[countRow]] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     WHERE me.ErrorSource = 'validation'
       AND me.ErrorCode = CAST(? AS CHAR)
       AND cm.CensusID = ?`,
    [validationID, censusID]
  );

  return {
    validationID,
    elapsedMs,
    errorCount: Number(countRow.cnt)
  };
}

async function runSharedDbhPrototype(conn: mysql.Connection, censusID: number, plotID: number): Promise<SharedDbhResult> {
  await conn.query(
    `DELETE mel
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     JOIN census c ON cm.CensusID = c.CensusID
     WHERE me.ErrorSource = 'validation'
       AND me.ErrorCode IN ('1', '2')
       AND cm.IsValidated IS NULL
       AND cm.IsActive = TRUE
       AND cm.CensusID = ?
       AND c.PlotID = ?`,
    [censusID, plotID]
  );

  await conn.query('DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates');

  const start = Date.now();
  await conn.query(
    `CREATE TEMPORARY TABLE dbh_change_candidates AS
     SELECT cm_present.CoreMeasurementID,
            (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (CASE p.DefaultDBHUnits
                WHEN 'km' THEN 1000000
                WHEN 'hm' THEN 100000
                WHEN 'dam' THEN 10000
                WHEN 'm' THEN 1000
                WHEN 'dm' THEN 100
                WHEN 'cm' THEN 10
                WHEN 'mm' THEN 1
                ELSE 1
            END) AS GrowthMm,
            cm_present.MeasuredDBH AS PresentDBH,
            cm_past.MeasuredDBH AS PastDBH
     FROM coremeasurements cm_present
              JOIN census c_present ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive = 1
              JOIN stems s_present ON s_present.StemGUID = cm_present.StemGUID AND s_present.CensusID = cm_present.CensusID AND s_present.IsActive = 1
              JOIN trees t_present ON t_present.TreeID = s_present.TreeID AND t_present.CensusID = s_present.CensusID AND t_present.IsActive = 1
              JOIN plots p ON c_present.PlotID = p.PlotID
              JOIN census c_past ON c_past.PlotID = c_present.PlotID
                   AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
                   AND c_past.IsActive = 1
              JOIN trees t_past ON t_past.CensusID = c_past.CensusID
                   AND t_past.TreeTag = t_present.TreeTag
                   AND t_past.IsActive = 1
              JOIN stems s_past ON s_past.TreeID = t_past.TreeID
                   AND s_past.CensusID = c_past.CensusID
                   AND s_past.StemTag = s_present.StemTag
                   AND s_past.IsActive = 1
              JOIN coremeasurements cm_past ON cm_past.StemGUID = s_past.StemGUID
                   AND cm_past.CensusID = c_past.CensusID
                   AND cm_past.IsActive = 1
                   AND cm_past.IsValidated = 1
     WHERE cm_present.IsActive = 1
       AND cm_present.IsValidated IS NULL
       AND cm_present.CensusID = ?
       AND c_present.PlotID = ?
       AND cm_past.MeasuredDBH > 0
       AND NOT EXISTS (
           SELECT 1
           FROM cmattributes cma_present
                    JOIN attributes a_present ON a_present.Code = cma_present.Code AND a_present.IsActive = 1
           WHERE cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
             AND a_present.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
       )
       AND NOT EXISTS (
           SELECT 1
           FROM cmattributes cma_past
                    JOIN attributes a_past ON a_past.Code = cma_past.Code AND a_past.IsActive = 1
           WHERE cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
             AND a_past.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
       )`,
    [censusID, plotID]
  );

  await conn.query('ALTER TABLE dbh_change_candidates ADD PRIMARY KEY (CoreMeasurementID)');

  const [[growthError]] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '1' LIMIT 1`
  );
  const [[shrinkageError]] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '2' LIMIT 1`
  );

  await conn.query(
    `INSERT INTO measurement_error_log (MeasurementID, ErrorID)
     SELECT CoreMeasurementID, ?
     FROM dbh_change_candidates
     WHERE GrowthMm > 65
     ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL`,
    [growthError.ErrorID]
  );

  await conn.query(
    `INSERT INTO measurement_error_log (MeasurementID, ErrorID)
     SELECT CoreMeasurementID, ?
     FROM dbh_change_candidates
     WHERE PresentDBH < (PastDBH * 0.95)
     ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL`,
    [shrinkageError.ErrorID]
  );
  const elapsedMs = Date.now() - start;

  const [[growthCount]] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     WHERE me.ErrorSource = 'validation' AND me.ErrorCode = '1' AND cm.CensusID = ?`,
    [censusID]
  );
  const [[shrinkageCount]] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM measurement_error_log mel
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     WHERE me.ErrorSource = 'validation' AND me.ErrorCode = '2' AND cm.CensusID = ?`,
    [censusID]
  );

  await conn.query('DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates');

  return {
    elapsedMs,
    growthErrorCount: Number(growthCount.cnt),
    shrinkageErrorCount: Number(shrinkageCount.cnt)
  };
}

async function runScenario(
  variant: Variant,
  rowCount: number,
  options: { runRefresh: boolean; runValidations: boolean; runSharedDbh?: boolean }
): Promise<ScenarioResult> {
  const dbName = `bench_refresh_${variant}_${rowCount}_${Date.now()}`;
  const conn = await mysql.createConnection({ ...DB_CONFIG, database: undefined });

  try {
    console.log(`  creating benchmark database ${dbName}...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${dbName}\``);
    await conn.query(`SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`SET collation_connection = 'utf8mb4_0900_ai_ci'`);

    console.log('  loading schema...');
    await loadSchema(conn);
    console.log('  loading stored procedures...');
    await loadStoredProcedures(conn, getStoredProcedureContent(variant));
    console.log('  seeding validation catalog...');
    await seedValidationCatalog(conn);

    console.log('  seeding reference data...');
    const meta = await seedBaseData(conn);
    const census1Rows = generateMeasurements(rowCount, meta.quadratNames, 1);
    const census2Rows = generateMeasurements(rowCount, meta.quadratNames, 2);

    console.log('  seeding census 1...');
    await seedCensus(conn, meta, census1Rows, meta.census1ID, 1);
    console.log('  seeding census 2...');
    await seedCensus(conn, meta, census2Rows, meta.census2ID, null);

    console.log('  seeding attributes and validation errors...');
    await seedAttributesForCensus(conn, meta.census1ID, 'L');
    await seedAttributesForCensus(conn, meta.census2ID, 'L');
    await seedRefreshErrors(conn, meta.census2ID);

    let refreshSummary: RefreshResult = {
      procedure: 'RefreshMeasurementsSummary',
      warmupMs: 0,
      measuredMs: 0,
      rowCount: 0
    };
    let refreshFull: RefreshResult = {
      procedure: 'RefreshViewFullTable',
      warmupMs: 0,
      measuredMs: 0,
      rowCount: 0
    };

    if (options.runRefresh) {
      console.log('  running RefreshMeasurementsSummary...');
      refreshSummary = await runRefreshProcedure(conn, 'RefreshMeasurementsSummary', 'measurementssummary');
      console.log(`    measured ${formatDuration(refreshSummary.measuredMs)} (${refreshSummary.rowCount} rows)`);
      console.log('  running RefreshViewFullTable...');
      refreshFull = await runRefreshProcedure(conn, 'RefreshViewFullTable', 'viewfulltable');
      console.log(`    measured ${formatDuration(refreshFull.measuredMs)} (${refreshFull.rowCount} rows)`);
    }

    let validations: ValidationResult[] | undefined;
    if (options.runValidations) {
      console.log('  running validation 1...');
      const validation1 = await runValidation(conn, 1, meta.census2ID, meta.plotID);
      console.log(`    measured ${formatDuration(validation1.elapsedMs)} (${validation1.errorCount} errors)`);
      console.log('  running validation 2...');
      const validation2 = await runValidation(conn, 2, meta.census2ID, meta.plotID);
      console.log(`    measured ${formatDuration(validation2.elapsedMs)} (${validation2.errorCount} errors)`);
      validations = [validation1, validation2];
    }

    let sharedDbh: SharedDbhResult | undefined;
    if (options.runSharedDbh) {
      console.log('  running shared DBH candidate prototype...');
      sharedDbh = await runSharedDbhPrototype(conn, meta.census2ID, meta.plotID);
      console.log(
        `    measured ${formatDuration(sharedDbh.elapsedMs)} ` + `(growth=${sharedDbh.growthErrorCount}, shrinkage=${sharedDbh.shrinkageErrorCount})`
      );
    }

    return {
      variant,
      rowCount,
      refreshSummary,
      refreshFull,
      validations,
      sharedDbh
    };
  } finally {
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    } catch {
      // ignore cleanup failures
    }
    await conn.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const requestedVariant = args.find(arg => arg.startsWith('--variant='))?.split('=')[1] as Variant | undefined;
  const requestedMode = (args.find(arg => arg.startsWith('--mode='))?.split('=')[1] as BenchmarkMode | undefined) || 'all';
  const sizes = args
    .filter(arg => !arg.startsWith('--variant=') && !arg.startsWith('--mode='))
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0);
  const rowCounts = sizes.length > 0 ? sizes : [10000, 400000];
  const variants: Variant[] = requestedVariant ? [requestedVariant] : ['head', 'working'];
  const results: ScenarioResult[] = [];

  console.log('=== Refresh + Validation Benchmark ===');
  console.log(`MySQL: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
  console.log(`Sizes: ${rowCounts.join(', ')}`);
  console.log(`Variants: ${variants.join(', ')}`);
  console.log(`Mode: ${requestedMode}`);

  for (const rowCount of rowCounts) {
    for (const variant of variants) {
      console.log(`\n--- ${variant} / ${rowCount} rows ---`);
      if (requestedMode === 'refresh' && variant === 'working') {
        results.push(await runScenario(variant, rowCount, { runRefresh: true, runValidations: false }));
      } else if (requestedMode === 'refresh') {
        results.push(await runScenario(variant, rowCount, { runRefresh: true, runValidations: false }));
      } else if (requestedMode === 'validations' && variant === 'working') {
        results.push(await runScenario(variant, rowCount, { runRefresh: false, runValidations: true }));
      } else if (requestedMode === 'shared-dbh' && variant === 'working') {
        results.push(await runScenario(variant, rowCount, { runRefresh: false, runValidations: true, runSharedDbh: true }));
      } else if (requestedMode === 'all') {
        results.push(await runScenario(variant, rowCount, { runRefresh: true, runValidations: variant === 'working' }));
      }
    }
  }

  if (requestedMode !== 'validations') {
    console.log('\n=== Refresh Summary ===');
    console.log('Variant | Rows     | Summary    | Full Table | Summary Rows | Full Rows');
    console.log('--------|----------|------------|------------|--------------|----------');
    for (const result of results) {
      console.log(
        `${result.variant.padEnd(7)}| ` +
          `${String(result.rowCount).padEnd(9)}| ` +
          `${formatDuration(result.refreshSummary.measuredMs).padEnd(11)}| ` +
          `${formatDuration(result.refreshFull.measuredMs).padEnd(11)}| ` +
          `${String(result.refreshSummary.rowCount).padEnd(13)}| ` +
          `${result.refreshFull.rowCount}`
      );
    }
  }

  if (requestedMode !== 'refresh') {
    console.log('\n=== Validation Summary (working tree) ===');
    console.log('Rows     | Validation 1 | Errors 1 | Validation 2 | Errors 2 | Combined | Shared DBH');
    console.log('---------|--------------|----------|--------------|----------|----------|-----------');
    for (const result of results.filter(r => r.variant === 'working' && r.validations)) {
      const v1 = result.validations?.find(v => v.validationID === 1);
      const v2 = result.validations?.find(v => v.validationID === 2);
      console.log(
        `${String(result.rowCount).padEnd(8)}| ` +
          `${formatDuration(v1?.elapsedMs ?? 0).padEnd(13)}| ` +
          `${String(v1?.errorCount ?? 0).padEnd(9)}| ` +
          `${formatDuration(v2?.elapsedMs ?? 0).padEnd(13)}| ` +
          `${String(v2?.errorCount ?? 0).padEnd(9)}| ` +
          `${formatDuration((v1?.elapsedMs ?? 0) + (v2?.elapsedMs ?? 0)).padEnd(9)}| ` +
          `${result.sharedDbh ? formatDuration(result.sharedDbh.elapsedMs) : '-'}`
      );
    }
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
