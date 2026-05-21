/**
 * Integration tests for selectMeasurements.
 *
 * Each test isolates one behaviour: happy path field mapping, stable
 * TempMeasurementID indexing across multiple measurements, attribute
 * pass-through without marker filtering, subspecies taxonomy, and skip
 * behaviour for rows that fail the IsValidated/IsActive gate.
 *
 * Tests are verbose by design so test output is useful for debugging
 * failures against the live schema.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: npm run test:integration -- lib/ctfs-export/select-measurements
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, teardownTestDatabase, loadSchema, DEFAULT_TEST_CONFIG } from '../../tests/setup/local-db-setup';
import { selectMeasurements } from './select-measurements';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_PATH = path.resolve(__dirname, '../../tests/fixtures/ctfs-export/app-db-seed.sql');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENSUS_ID = 1;
const PLOT_ID = 1;

// Unique DB name per test process to avoid cross-run collisions.
const DB_NAME = `forestgeo_selectmeas_${process.pid}_${Date.now()}`;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function loadSeedFile(conn: Connection): Promise<void> {
  const raw = readFileSync(SEED_PATH, 'utf8');
  // Strip single-line SQL comments before splitting on semicolons, so that a
  // comment block at the top of the file does not absorb the first statement.
  const stripped = raw
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements = stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('selectMeasurements', () => {
  let conn: Connection;
  const config = { ...DEFAULT_TEST_CONFIG, database: DB_NAME };

  beforeEach(async () => {
    conn = await createTestDatabase(config);
    await loadSchema(conn);
    await loadSeedFile(conn);
  });

  afterEach(async () => {
    await teardownTestDatabase(conn, config);
  });

  // -------------------------------------------------------------------------
  // Happy path — field mapping
  // -------------------------------------------------------------------------

  it('returns one measurement row with all resolved fields and PrimaryStem=null', async () => {
    // The seed has exactly one fully-valid measurement (CoreMeasurementID=1).
    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows).toHaveLength(1);

    const row = measurementRows[0];

    // Traceability
    expect(row.CoreMeasurementID, 'CoreMeasurementID should be 1').toBe(1);
    // Seed did not supply SourceRowIndex; coremeasurements row has it as NULL.
    expect(row.SourceRowIndex, 'SourceRowIndex should be null when not set in seed').toBeNull();

    // Natural keys
    expect(row.Tag, 'Tag maps from trees.TreeTag').toBe('1');
    expect(row.StemTag, 'StemTag maps from stems.StemTag').toBe('1');
    expect(row.Mnemonic, 'Mnemonic maps from species.SpeciesCode').toBe('FOO');
    expect(row.QuadratName, 'QuadratName maps from quadrats.QuadratName').toBe('A1');
    expect(row.PlotCensusNumber, 'PlotCensusNumber maps from census.PlotCensusNumber').toBe('1');

    // Taxonomy context — IDLevel and SubspeciesAuthority were dropped from
    // staging because no downstream stage reads them after the pivot.
    expect(row.Family, 'Family maps from family.Family').toBe('Testaceae');
    expect(row.Genus, 'Genus maps from genus.Genus').toBe('Foobaria');
    expect(row.SpeciesName, 'SpeciesName maps from species.SpeciesName').toBe('foo');
    expect(row.SpeciesAuthority, 'SpeciesAuthority should be null when not populated in seed').toBeNull();
    expect(row.SubspeciesName, 'SubspeciesName should be null for the seed species row').toBeNull();

    // Measurement values
    expect(row.DBH, 'DBH maps from coremeasurements.MeasuredDBH').toBeCloseTo(12.3, 3);
    expect(row.HOM, 'HOM is serialized as a string (lexical form preserved)').toBe('1.300000');
    expect(row.ExactDate, 'ExactDate is a YYYY-MM-DD string').toBe('2024-06-01');
    expect(row.Comments, 'Comments maps from coremeasurements.Description; seed value is NULL').toBeNull();
    expect(row.LX, 'LX maps from stems.LocalX').toBeCloseTo(1.0, 5);
    expect(row.LY, 'LY maps from stems.LocalY').toBeCloseTo(1.0, 5);

    // MVP invariant: PrimaryStem is always null
    expect(row.PrimaryStem, 'PrimaryStem is always null in MVP').toBeNull();

    // Attribute — linked to parent measurement by CoreMeasurementID only.
    expect(attributeRows).toHaveLength(1);
    expect(attributeRows[0].TSMCode, 'TSMCode from cmattributes.Code').toBe('LI');
    expect(attributeRows[0].CoreMeasurementID, 'attribute references parent measurement').toBe(1);
  });

  it('returns no rows when the requested plotId does not own the census', async () => {
    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: 999,
      censusId: CENSUS_ID
    });

    expect(measurementRows, 'plot/census mismatch should not export measurements').toHaveLength(0);
    expect(attributeRows, 'plot/census mismatch should not export attributes').toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // SourceRowIndex projected when set
  // -------------------------------------------------------------------------

  it('projects SourceRowIndex as a number when the column is populated', async () => {
    await conn.query('UPDATE coremeasurements SET SourceRowIndex = 42 WHERE CoreMeasurementID = 1');

    const { measurementRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows).toHaveLength(1);
    expect(measurementRows[0].SourceRowIndex, 'SourceRowIndex should equal the stored value').toBe(42);
  });

  // -------------------------------------------------------------------------
  // CoreMeasurementID linkage between staging tables
  // -------------------------------------------------------------------------

  it('returns measurements ordered by CoreMeasurementID ASC with matching attribute CoreMeasurementID linkage', async () => {
    await conn.query(
      `INSERT INTO coremeasurements
         (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
       VALUES (2, 1, 1, TRUE, '2024-06-02', 13.4, 1.3, 1)`
    );
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (20, 2, 'LI')");

    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows).toHaveLength(2);
    expect(measurementRows[0].CoreMeasurementID, 'first row is CoreMeasurementID=1').toBe(1);
    expect(measurementRows[1].CoreMeasurementID, 'second row is CoreMeasurementID=2').toBe(2);

    const attr1 = attributeRows.find(a => a.CoreMeasurementID === 1);
    const attr2 = attributeRows.find(a => a.CoreMeasurementID === 2);
    expect(attr1, 'attribute for measurement 1 must exist').toBeDefined();
    expect(attr2, 'attribute for measurement 2 must exist').toBeDefined();
  });

  it('preserves CoreMeasurementID linkage even when ids are non-contiguous', async () => {
    await conn.query(
      `INSERT INTO coremeasurements
         (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
       VALUES (100, 1, 1, TRUE, '2024-07-01', 20.0, 1.3, 1)`
    );
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (50, 100, 'LI')");

    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows).toHaveLength(2);
    expect(measurementRows.map(m => m.CoreMeasurementID)).toEqual([1, 100]);

    const attrFor100 = attributeRows.find(a => a.CoreMeasurementID === 100);
    expect(attrFor100, 'attribute references CoreMeasurementID=100 directly (no positional mapping)').toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Multiple attributes per measurement
  // -------------------------------------------------------------------------

  it('returns all active attribute codes for a measurement with multiple codes', async () => {
    // Add a second attribute code for the same measurement.
    await conn.query("INSERT INTO attributes (Code, Description, Status, IsActive) VALUES ('D', 'dead', 'dead', 1)");
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (10, 1, 'D')");

    const { attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    const codes = attributeRows.map(a => a.TSMCode).sort();
    expect(codes, 'both active attribute codes should appear').toEqual(['D', 'LI']);
    // Both attributes reference the same measurement via CoreMeasurementID.
    expect(
      attributeRows.every(a => a.CoreMeasurementID === 1),
      'all attributes for the only measurement reference CoreMeasurementID=1'
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // No marker filtering — every active code passes through
  // -------------------------------------------------------------------------

  it('exports every active attribute code without filtering by code value or description', async () => {
    // Insert an attribute with a code that could look like a "marker" keyword.
    await conn.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('M', 'main', 1)");
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (30, 1, 'M')");

    const { attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(
      attributeRows.some(a => a.TSMCode === 'M'),
      '"M" code should not be filtered'
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Subspecies taxonomy
  // -------------------------------------------------------------------------

  it('maps SubspeciesName when species row has subspecies fields set', async () => {
    await conn.query("UPDATE species SET SubspeciesName = 'fooianus', SubspeciesAuthority = 'Smith 1999' WHERE SpeciesID = 1");

    const { measurementRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows).toHaveLength(1);
    expect(measurementRows[0].SubspeciesName, 'SubspeciesName should be populated').toBe('fooianus');
    expect(measurementRows[0].CoreMeasurementID, 'CoreMeasurementID is unchanged').toBe(1);
  });

  // -------------------------------------------------------------------------
  // Filter: IsValidated = FALSE
  // -------------------------------------------------------------------------

  it('excludes measurements where IsValidated = FALSE', async () => {
    await conn.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = 1');

    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows, 'unvalidated measurement should be excluded').toHaveLength(0);
    expect(attributeRows, 'attributes of excluded measurement should also be absent').toHaveLength(0);
  });

  it('excludes measurements where IsValidated = NULL', async () => {
    await conn.query('UPDATE coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = 1');

    const { measurementRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows, 'NULL-validated measurement should be excluded').toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Filter: inactive stem
  // -------------------------------------------------------------------------

  it('excludes measurements whose joined stem has IsActive = 0', async () => {
    await conn.query('UPDATE stems SET IsActive = 0 WHERE StemGUID = 1');

    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows, 'measurement with inactive stem should be excluded').toHaveLength(0);
    expect(attributeRows, 'attributes of excluded measurement should also be absent').toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Filter: inactive tree
  // -------------------------------------------------------------------------

  it('excludes measurements whose joined tree has IsActive = 0', async () => {
    await conn.query('UPDATE trees SET IsActive = 0 WHERE TreeID = 1');

    const { measurementRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    expect(measurementRows, 'measurement with inactive tree should be excluded').toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Filter: inactive attribute code
  // -------------------------------------------------------------------------

  it('excludes attribute rows whose code is inactive in the attributes table', async () => {
    await conn.query("UPDATE attributes SET IsActive = 0 WHERE Code = 'LI'");

    const { measurementRows, attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    // The measurement itself should still appear (the filter is only on attribute codes).
    expect(measurementRows).toHaveLength(1);
    expect(
      attributeRows.some(a => a.TSMCode === 'LI'),
      'inactive attribute code should be excluded from attributeRows'
    ).toBe(false);
    expect(attributeRows).toHaveLength(0);
  });

  it('returns only active attribute codes when a measurement has a mix of active and inactive codes', async () => {
    // Add a second attribute that will remain active.
    await conn.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('A', 'alive', 1)");
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (11, 1, 'A')");
    // Deactivate the existing 'LI' code.
    await conn.query("UPDATE attributes SET IsActive = 0 WHERE Code = 'LI'");

    const { attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    const codes = attributeRows.map(a => a.TSMCode);
    expect(codes, 'only active code "A" should appear; inactive "LI" should be absent').toEqual(['A']);
  });

  // -------------------------------------------------------------------------
  // Filter: wrong census
  // -------------------------------------------------------------------------

  it('excludes measurements from a different censusId', async () => {
    // Query for a census that has no data.
    const { measurementRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: 999
    });

    expect(measurementRows, 'no rows should be returned for a non-existent census').toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Schema injection safety
  // -------------------------------------------------------------------------

  it('throws on schema names containing SQL injection payloads', async () => {
    await expect(selectMeasurements(conn, { schema: 'bad; DROP TABLE coremeasurements; --', plotId: PLOT_ID, censusId: CENSUS_ID })).rejects.toThrow(
      /Invalid or unauthorized schema/
    );

    await expect(selectMeasurements(conn, { schema: 'bad`name', plotId: PLOT_ID, censusId: CENSUS_ID })).rejects.toThrow(/Invalid or unauthorized schema/);
  });

  // -------------------------------------------------------------------------
  // Attribute ordering — deterministic within a measurement
  // -------------------------------------------------------------------------

  it('orders attributes by CoreMeasurementID then CMAID for determinism', async () => {
    // Add three attributes to the same measurement in non-sequential CMAID order.
    await conn.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('Z', 'z-code', 1)");
    await conn.query("INSERT INTO attributes (Code, Description, IsActive) VALUES ('B', 'b-code', 1)");
    // CMAID 5 < CMAID 10 < CMAID 20 — insert in reverse order to verify ORDER BY.
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (20, 1, 'Z')");
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (5,  1, 'B')");

    const { attributeRows } = await selectMeasurements(conn, {
      schema: DB_NAME,
      plotId: PLOT_ID,
      censusId: CENSUS_ID
    });

    // Expected CMAID order: 1 (LI), 5 (B), 20 (Z).
    const codes = attributeRows.map(a => a.TSMCode);
    expect(codes, 'attributes should be ordered by CMAID ASC within a measurement').toEqual(['LI', 'B', 'Z']);
  });
});
