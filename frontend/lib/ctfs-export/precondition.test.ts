/**
 * Integration tests for checkFinishedCensus precondition.
 *
 * Each `it` block validates one specific failure kind independently by mutating
 * the seed data in a targeted way. Tests are verbose by design to help debug
 * failures against the live MySQL schema.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: npm run test:integration -- lib/ctfs-export/precondition
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, teardownTestDatabase, loadSchema, DEFAULT_TEST_CONFIG } from '../../tests/setup/local-db-setup';
import { checkFinishedCensus, MAX_DISPLAY_FAILURES } from './precondition';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_PATH = path.resolve(__dirname, '../../tests/fixtures/ctfs-export/app-db-seed.sql');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENSUS_ID = 1;
const PLOT_ID = 1;

// Unique DB name per test process to avoid cross-run collisions.
const DB_NAME = `forestgeo_precondition_${process.pid}_${Date.now()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSeedFile(conn: Connection): Promise<void> {
  const raw = readFileSync(SEED_PATH, 'utf8');
  // Strip single-line comments before splitting on semicolons, so that a
  // comment block at the top of the file does not absorb the first real statement.
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

describe('checkFinishedCensus', () => {
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
  // Happy path
  // -------------------------------------------------------------------------

  it('returns ok=true with count=1 when all preconditions pass', async () => {
    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=true for a fully valid census').toBe(true);
    if (result.ok) {
      expect(result.count, 'count should reflect the single exportable row').toBe(1);
    }
  });

  it('treats the route plotId as part of the export scope', async () => {
    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: 999, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when CensusID exists under a different PlotID').toBe(false);
    if (!result.ok) {
      expect(result.reasons.map(r => r.kind)).toContain('zero-exportable-rows');
    }
  });

  // -------------------------------------------------------------------------
  // Check 1: not-validated
  // -------------------------------------------------------------------------

  it('fails with not-validated when IsValidated = FALSE', async () => {
    await conn.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for unvalidated measurement').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'not-validated');
      expect(failure, 'not-validated failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds, 'should include the unvalidated CoreMeasurementID').toContain(1);
    }
  });

  it('fails with not-validated when IsValidated = NULL', async () => {
    await conn.query('UPDATE coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for NULL-validated measurement').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'not-validated');
      expect(failure, 'not-validated failure should be present for NULL IsValidated').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  // -------------------------------------------------------------------------
  // Check 2: unresolved-error
  // -------------------------------------------------------------------------

  it('fails with unresolved-error when an unresolved measurement_error_log row exists', async () => {
    // measurement_errors requires a row before measurement_error_log can reference it.
    // Insert a minimal error type then log an unresolved entry.
    await conn.query(`
      INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage)
      VALUES (9001, 'validation', 'TEST_ERR', 'Test error for precondition')
    `);
    await conn.query(`
      INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
      VALUES (1, 9001, 0)
    `);

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when unresolved error log exists').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'unresolved-error');
      expect(failure, 'unresolved-error failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  it('does not fail with unresolved-error when all measurement_error_log rows are resolved', async () => {
    await conn.query(`
      INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage)
      VALUES (9002, 'validation', 'RESOLVED_ERR', 'Resolved error')
    `);
    await conn.query(`
      INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
      VALUES (1, 9002, 1)
    `);

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    // Resolved errors should not block export.
    expect(result.ok, 'resolved error log rows should not block export').toBe(true);
  });

  // -------------------------------------------------------------------------
  // Check 3: no-stem-guid
  // -------------------------------------------------------------------------

  it('fails with no-stem-guid when StemGUID IS NULL', async () => {
    // Must disable FK checks to NULL out StemGUID (FK points to stems table).
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('UPDATE coremeasurements SET StemGUID = NULL WHERE CoreMeasurementID = 1');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for measurement with NULL StemGUID').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'no-stem-guid');
      expect(failure, 'no-stem-guid failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  // -------------------------------------------------------------------------
  // Check 4: inactive-join
  // -------------------------------------------------------------------------

  it('fails with inactive-join when the joined stem has IsActive = 0', async () => {
    await conn.query('UPDATE stems SET IsActive = 0 WHERE StemGUID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for measurement joined to inactive stem').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'inactive-join');
      expect(failure, 'inactive-join failure should be present for inactive stem').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  it('fails with inactive-join when the joined stem has DeletedAt set', async () => {
    await conn.query("UPDATE stems SET DeletedAt = '2024-12-31 23:59:59' WHERE StemGUID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for measurement joined to soft-deleted stem').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'inactive-join');
      expect(failure, 'inactive-join failure should be present for soft-deleted stem').toBeDefined();
    }
  });

  it('fails with inactive-join when the joined tree has IsActive = 0', async () => {
    await conn.query('UPDATE trees SET IsActive = 0 WHERE TreeID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for measurement joined to inactive tree').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'inactive-join');
      expect(failure, 'inactive-join failure should be present for inactive tree').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  // -------------------------------------------------------------------------
  // Check 5: unknown-attribute-code
  // -------------------------------------------------------------------------

  it('fails with unknown-attribute-code when cmattributes.Code has no active attributes row', async () => {
    // Deactivate the 'LI' attribute so the LEFT JOIN produces a NULL hit.
    await conn.query("UPDATE attributes SET IsActive = 0 WHERE Code = 'LI'");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for unknown attribute code').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'unknown-attribute-code');
      expect(failure, 'unknown-attribute-code failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  it('fails with unknown-attribute-code when cmattributes.Code is entirely absent from attributes', async () => {
    // Insert an attribute entry that references a code not in the attributes table.
    await conn.query("INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (99, 1, 'BOGUS')");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for entirely absent attribute code').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'unknown-attribute-code');
      expect(failure, 'unknown-attribute-code failure should be present for absent code').toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Check 6: missing-taxonomy-fields
  // -------------------------------------------------------------------------

  it('fails with missing-taxonomy-fields when species.SpeciesCode is NULL', async () => {
    await conn.query('UPDATE species SET SpeciesCode = NULL WHERE SpeciesID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when SpeciesCode is NULL').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'missing-taxonomy-fields');
      expect(failure, 'missing-taxonomy-fields failure should be present for NULL SpeciesCode').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  it('fails with missing-taxonomy-fields when species.SpeciesName is empty string', async () => {
    await conn.query("UPDATE species SET SpeciesName = '' WHERE SpeciesID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when SpeciesName is empty string').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'missing-taxonomy-fields');
      expect(failure, 'missing-taxonomy-fields failure should be present for empty SpeciesName').toBeDefined();
    }
  });

  it('fails with missing-taxonomy-fields when genus.Genus is NULL', async () => {
    await conn.query('UPDATE genus SET Genus = NULL WHERE GenusID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when Genus is NULL').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'missing-taxonomy-fields');
      expect(failure, 'missing-taxonomy-fields failure should be present for NULL Genus').toBeDefined();
    }
  });

  it('fails with missing-taxonomy-fields when family.Family is NULL', async () => {
    await conn.query('UPDATE family SET Family = NULL WHERE FamilyID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false when Family is NULL').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'missing-taxonomy-fields');
      expect(failure, 'missing-taxonomy-fields failure should be present for NULL Family').toBeDefined();
    }
  });

  it('does not fail for subspecies rows (SubspeciesName IS NOT NULL is allowed)', async () => {
    // Subspecies rows are supported per Suzanne; presence of SubspeciesName alone
    // must not trigger a rejection. All required fields (SpeciesCode, SpeciesName,
    // Genus, Family) are still populated.
    await conn.query("UPDATE species SET SubspeciesName = 'foobarius' WHERE SpeciesID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'subspecies row with all required fields should pass').toBe(true);
  });

  // -------------------------------------------------------------------------
  // Check 7: string-too-long
  // -------------------------------------------------------------------------

  it('fails with string-too-long when TreeTag exceeds 10 characters (CTFS Tree.Tag limit)', async () => {
    // trees.TreeTag is varchar(20), so 11-char value is within app schema but over CTFS limit.
    await conn.query("UPDATE trees SET TreeTag = '12345678901' WHERE TreeID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 11-char TreeTag').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized TreeTag').toBeDefined();
      expect(failure!.coreMeasurementIds).toContain(1);
    }
  });

  it('fails with string-too-long when QuadratName exceeds 8 characters (CTFS Quadrat.QuadratName limit)', async () => {
    // quadrats.QuadratName is varchar(255); must update while relaxing the unique constraint.
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query("UPDATE quadrats SET QuadratName = 'QUADNAME9' WHERE QuadratID = 1");
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 9-char QuadratName').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized QuadratName').toBeDefined();
    }
  });

  it('fails with string-too-long when SpeciesCode exceeds 10 characters (CTFS Mnemonic limit)', async () => {
    // species.SpeciesCode is varchar(25); 11-char value exceeds CTFS Mnemonic limit of 10.
    await conn.query("UPDATE species SET SpeciesCode = 'TOOLONGCODE' WHERE SpeciesID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 11-char SpeciesCode').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized SpeciesCode').toBeDefined();
    }
  });

  it('fails with string-too-long when SubspeciesName exceeds 64 characters', async () => {
    await conn.query('ALTER TABLE species MODIFY SubspeciesName varchar(96)');
    await conn.query('UPDATE species SET SubspeciesName = ? WHERE SpeciesID = 1', ['S'.repeat(65)]);

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 65-char SubspeciesName').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized SubspeciesName').toBeDefined();
    }
  });

  it('fails with string-too-long when cmattributes.Code exceeds 10 characters', async () => {
    await conn.query('ALTER TABLE cmattributes MODIFY Code varchar(32)');
    await conn.query("UPDATE cmattributes SET Code = 'TOOLONGCODE' WHERE CoreMeasurementID = 1");

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 11-char cmattributes.Code').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized cmattributes.Code').toBeDefined();
    }
  });

  it('fails with string-too-long when Description exceeds 128 characters (CTFS DBH.Comments limit)', async () => {
    // coremeasurements.Description is varchar(255); 129-char value exceeds CTFS DBH.Comments limit.
    const longComment = 'X'.repeat(129);
    await conn.query('UPDATE coremeasurements SET Description = ? WHERE CoreMeasurementID = 1', [longComment]);

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for 129-char Description').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'string-too-long');
      expect(failure, 'string-too-long failure should be present for oversized Description').toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Check 8: zero-exportable-rows
  // -------------------------------------------------------------------------

  it('fails with zero-exportable-rows when the census has no measurements at all', async () => {
    // Delete all measurements for the census, which forces count=0.
    await conn.query('DELETE FROM measurement_error_log WHERE MeasurementID = 1');
    await conn.query('DELETE FROM cmattributes WHERE CoreMeasurementID = 1');
    await conn.query('DELETE FROM coremeasurements WHERE CensusID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok, 'expected ok=false for census with zero measurements').toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'zero-exportable-rows');
      expect(failure, 'zero-exportable-rows failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds, 'zero-exportable-rows carries no individual IDs').toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------------
  // Cap behaviour: MAX_DISPLAY_FAILURES
  // -------------------------------------------------------------------------

  it('caps coreMeasurementIds at MAX_DISPLAY_FAILURES even when more rows fail', async () => {
    // Insert MAX_DISPLAY_FAILURES + 10 invalid measurements (all IsValidated=FALSE).
    // Each needs a unique StemGUID; re-use existing stem but add new coremeasurements.
    const extraCount = MAX_DISPLAY_FAILURES + 10;
    for (let i = 2; i <= extraCount + 1; i++) {
      await conn.query(
        `INSERT INTO coremeasurements
           (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
         VALUES (?, 1, 1, FALSE, '2024-07-01', ?, 1.3, 1)`,
        [i + 100, i * 0.1 + 1]
      );
    }
    // Also mark the original row as unvalidated.
    await conn.query('UPDATE coremeasurements SET IsValidated = FALSE WHERE CoreMeasurementID = 1');

    const result = await checkFinishedCensus(conn, { schema: DB_NAME, plotId: PLOT_ID, censusId: CENSUS_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const failure = result.reasons.find(r => r.kind === 'not-validated');
      expect(failure, 'not-validated failure should be present').toBeDefined();
      expect(failure!.coreMeasurementIds.length, `coreMeasurementIds must be capped at ${MAX_DISPLAY_FAILURES}`).toBeLessThanOrEqual(MAX_DISPLAY_FAILURES);
    }
  });

  // -------------------------------------------------------------------------
  // Schema injection safety
  // -------------------------------------------------------------------------

  it('throws on invalid schema names that would allow SQL injection', async () => {
    await expect(checkFinishedCensus(conn, { schema: 'bad; DROP TABLE coremeasurements; --', plotId: PLOT_ID, censusId: CENSUS_ID })).rejects.toThrow(
      'Invalid schema name'
    );

    await expect(checkFinishedCensus(conn, { schema: 'bad`name', plotId: PLOT_ID, censusId: CENSUS_ID })).rejects.toThrow('Invalid schema name');
  });
});
