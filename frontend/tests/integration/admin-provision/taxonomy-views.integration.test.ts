/**
 * Regression test: provisioning must create the taxonomy views.
 *
 * The alltaxonomies / stemtaxonomies datagrids (and the species-upload review
 * step) read from the SQL views `alltaxonomiesview` and `stemtaxonomiesview`,
 * NOT from the base tables. For a long time those views were defined only in a
 * commented-out mysqldump placeholder and in an empty `updatedviews.sql` stub —
 * no provisioning script created them. Result: any app-provisioned site was
 * missing the views, so the species viewer failed with "error fetching data"
 * and rendered an empty grid even though the upload had populated the base
 * `species`/`genus`/`family` tables.
 *
 * This test provisions a fresh schema through the real `initTablesStep.run`
 * (which runs tablestructures.sql via executeSqlFile — the production path) and
 * proves the views exist and return the flattened taxonomy the mapper expects.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTestPool, TEST_SCHEMA_PREFIX } from './_shared';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { initTablesStep } from '@/lib/provisioning/steps/sql-steps';
import MapperFactory from '@/config/datamapper';
import type { StepContext, ProvisioningRunInput } from '@/lib/provisioning/types';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'taxviews';

// Column set the alltaxonomies datagrid mapper consumes (PascalCase DB columns
// that GenericMapper decapitalizes into AllTaxonomiesViewRDS fields).
const EXPECTED_ALLTAXONOMIES_COLUMNS = [
  'SpeciesID',
  'FamilyID',
  'GenusID',
  'Family',
  'Genus',
  'GenusAuthority',
  'SpeciesCode',
  'SpeciesName',
  'SubspeciesName',
  'IDLevel',
  'SpeciesAuthority',
  'SubspeciesAuthority',
  'ValidCode',
  'FieldFamily',
  'Description'
] as const;

const EXPECTED_STEMTAXONOMIES_COLUMNS = [
  'StemGUID',
  'TreeID',
  'SpeciesID',
  'GenusID',
  'FamilyID',
  'QuadratID',
  'StemTag',
  'TreeTag',
  'SpeciesCode',
  'Family',
  'Genus',
  'SpeciesName',
  'SubspeciesName',
  'ValidCode',
  'GenusAuthority',
  'SpeciesAuthority',
  'SubspeciesAuthority',
  'IDLevel',
  'FieldFamily'
] as const;

describe('provisioning creates taxonomy views', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await pool.query(`CREATE DATABASE \`${TEST_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  });

  afterAll(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await pool.end();
  });

  function buildCtx(): StepContext {
    return {
      runId: 0,
      schemaName: TEST_SCHEMA,
      input: {} as ProvisioningRunInput,
      catalogPool: pool,
      sitePool: pool,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };
  }

  async function listViews(): Promise<Set<string>> {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`, [TEST_SCHEMA]);
    return new Set(rows.map(r => String(r.name)));
  }

  async function viewColumns(viewName: string): Promise<string[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [TEST_SCHEMA, viewName]
    );
    return rows.map(r => String(r.name));
  }

  it('creates both alltaxonomiesview and stemtaxonomiesview', async () => {
    await initTablesStep.run(buildCtx());
    const views = await listViews();
    expect(views.has('alltaxonomiesview')).toBe(true);
    expect(views.has('stemtaxonomiesview')).toBe(true);
  });

  it('alltaxonomiesview exposes exactly the columns the datagrid mapper reads', async () => {
    await initTablesStep.run(buildCtx());
    expect(await viewColumns('alltaxonomiesview')).toEqual([...EXPECTED_ALLTAXONOMIES_COLUMNS]);
  });

  it('stemtaxonomiesview exposes exactly the columns the datagrid mapper reads', async () => {
    await initTablesStep.run(buildCtx());
    expect(await viewColumns('stemtaxonomiesview')).toEqual([...EXPECTED_STEMTAXONOMIES_COLUMNS]);
  });

  it('alltaxonomiesview flattens species -> genus -> family for uploaded species', async () => {
    await initTablesStep.run(buildCtx());

    // Mirror the first two rows of a real species upload (CBFDP_SPECIES.csv):
    // spcode,family,genus,species,idlevel,authority
    await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.family (Family) VALUES ('Lamiaceae'), ('Juglandaceae')`);
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.genus (Genus, FamilyID)
       VALUES ('Callicarpa', (SELECT FamilyID FROM \`${TEST_SCHEMA}\`.family WHERE Family = 'Lamiaceae')),
              ('Carya',      (SELECT FamilyID FROM \`${TEST_SCHEMA}\`.family WHERE Family = 'Juglandaceae'))`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.species (GenusID, SpeciesCode, SpeciesName, IDLevel, SpeciesAuthority)
       VALUES ((SELECT GenusID FROM \`${TEST_SCHEMA}\`.genus WHERE Genus = 'Callicarpa'), 'CALAME', 'americana', 'species', 'L.'),
              ((SELECT GenusID FROM \`${TEST_SCHEMA}\`.genus WHERE Genus = 'Carya'),      'CARTEX', 'texana',    'species', 'Buckley')`
    );

    // Exact query the fixeddata route runs for the alltaxonomiesview grid.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT SQL_CALC_FOUND_ROWS atv.* FROM \`${TEST_SCHEMA}\`.alltaxonomiesview atv ORDER BY atv.SpeciesCode ASC LIMIT 0, 10`
    );
    const [countRows] = await pool.query<RowDataPacket[]>(`SELECT FOUND_ROWS() AS totalRows`);

    expect(Number(countRows[0].totalRows)).toBe(2);
    expect(rows).toHaveLength(2);

    const calame = rows.find(r => r.SpeciesCode === 'CALAME');
    expect(calame).toBeDefined();
    expect(calame!.Genus).toBe('Callicarpa');
    expect(calame!.Family).toBe('Lamiaceae');
    expect(calame!.SpeciesName).toBe('americana');
    expect(calame!.SpeciesAuthority).toBe('L.');
    expect(calame!.IDLevel).toBe('species');

    const mapped = MapperFactory.getMapper<any, any>('alltaxonomiesview').mapData(rows);
    expect(mapped.find(row => row.speciesCode === 'CALAME')).toMatchObject({
      genus: 'Callicarpa',
      family: 'Lamiaceae',
      speciesName: 'americana',
      speciesAuthority: 'L.',
      idLevel: 'species'
    });
  });

  it('stemtaxonomiesview flattens active stem -> tree -> species taxonomy into mapped rows', async () => {
    await initTablesStep.run(buildCtx());

    await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.family (Family) VALUES ('Fabaceae')`);
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.genus (Genus, FamilyID, GenusAuthority)
       VALUES ('Inga', (SELECT FamilyID FROM \`${TEST_SCHEMA}\`.family WHERE Family = 'Fabaceae'), 'Mill.')`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.species (GenusID, SpeciesCode, SpeciesName, IDLevel, SpeciesAuthority, ValidCode, FieldFamily)
       VALUES (
         (SELECT GenusID FROM \`${TEST_SCHEMA}\`.genus WHERE Genus = 'Inga'),
         'INGSPP',
         'spuria',
         'species',
         'Humb.',
         'INGSPP',
         'FieldFabaceae'
       )`
    );
    await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.plots (PlotName) VALUES ('Taxonomy View Test Plot')`);
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.census (PlotID, PlotCensusNumber, StartDate, EndDate)
       VALUES ((SELECT PlotID FROM \`${TEST_SCHEMA}\`.plots WHERE PlotName = 'Taxonomy View Test Plot'), 1, '2024-01-01', '2024-12-31')`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area)
       VALUES ((SELECT PlotID FROM \`${TEST_SCHEMA}\`.plots WHERE PlotName = 'Taxonomy View Test Plot'), '0001', 0, 0, 20, 20, 400)`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.trees (TreeTag, SpeciesID, CensusID)
       VALUES (
         'T-001',
         (SELECT SpeciesID FROM \`${TEST_SCHEMA}\`.species WHERE SpeciesCode = 'INGSPP'),
         (SELECT CensusID FROM \`${TEST_SCHEMA}\`.census WHERE PlotCensusNumber = 1)
       )`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY)
       VALUES (
         (SELECT TreeID FROM \`${TEST_SCHEMA}\`.trees WHERE TreeTag = 'T-001'),
         (SELECT QuadratID FROM \`${TEST_SCHEMA}\`.quadrats WHERE QuadratName = '0001'),
         (SELECT CensusID FROM \`${TEST_SCHEMA}\`.census WHERE PlotCensusNumber = 1),
         '1',
         10.5,
         11.5
       )`
    );

    // Exact query the fixeddata route runs for the stemtaxonomiesview grid.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT SQL_CALC_FOUND_ROWS stv.* FROM \`${TEST_SCHEMA}\`.stemtaxonomiesview stv ORDER BY stv.StemTag ASC LIMIT 0, 10`
    );
    const [countRows] = await pool.query<RowDataPacket[]>(`SELECT FOUND_ROWS() AS totalRows`);

    expect(Number(countRows[0].totalRows)).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      StemTag: '1',
      TreeTag: 'T-001',
      SpeciesCode: 'INGSPP',
      Family: 'Fabaceae',
      Genus: 'Inga',
      IDLevel: 'species',
      FieldFamily: 'FieldFabaceae'
    });

    const mapped = MapperFactory.getMapper<any, any>('stemtaxonomiesview').mapData(rows);
    expect(mapped[0]).toMatchObject({
      stemTag: '1',
      treeTag: 'T-001',
      speciesCode: 'INGSPP',
      family: 'Fabaceae',
      genus: 'Inga',
      idLevel: 'species',
      fieldFamily: 'FieldFabaceae'
    });
  });

  it('alltaxonomiesview hides soft-deleted species (IsActive = 0)', async () => {
    await initTablesStep.run(buildCtx());
    await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.family (Family) VALUES ('Fabaceae')`);
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.genus (Genus, FamilyID) VALUES ('Inga', (SELECT FamilyID FROM \`${TEST_SCHEMA}\`.family WHERE Family = 'Fabaceae'))`
    );
    await pool.query(
      `INSERT INTO \`${TEST_SCHEMA}\`.species (GenusID, SpeciesCode, SpeciesName, IsActive)
       VALUES ((SELECT GenusID FROM \`${TEST_SCHEMA}\`.genus WHERE Genus = 'Inga'), 'INGSPP', 'spuria', 0)`
    );

    const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM \`${TEST_SCHEMA}\`.alltaxonomiesview WHERE SpeciesCode = 'INGSPP'`);
    expect(rows).toHaveLength(0);
  });
});
