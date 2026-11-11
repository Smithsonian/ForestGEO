/**
 * Dashboard Measured-Count Regression Tests (Issue #508)
 *
 * The Census Overview "Total Trees" / "Total Stems" tiles used to count
 * `trees`/`stems` rows directly. Measurement delete is a HARD delete of
 * `coremeasurements` only (see coreapifunctions.ts) — it never touches
 * `trees`/`stems` — so those tiles never shrank when a user deleted the
 * last measurement for a stem/tree.
 *
 * The fix joins through `coremeasurements` so a stem/tree only counts while
 * it has at least one ACTIVE measurement in the selected census. This file
 * proves that join against a real MySQL instance, using the exact SQL the
 * two dashboardmetrics routes execute (via the shared builders in
 * `@/config/dashboardmetricsqueries`), and that deleting a measurement the
 * same way the app does (`DELETE FROM coremeasurements WHERE
 * CoreMeasurementID = ?`) never mutates the `stems`/`trees` identity rows.
 *
 * NOTE for whoever runs this: do not run it opportunistically — the shared
 * local-db-setup.ts test-database catalog is serialized by the integrator.
 * Run it explicitly with:
 *   cd frontend && npm run test:integration -- dashboard-measured-counts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertDirectMeasurements,
  createAdditionalCensus,
  type TestData,
  type DirectMeasurement
} from '../setup/local-db-setup';
import { buildMeasuredStemCountSql, buildMeasuredTreeCountSql } from '@/config/dashboardmetricsqueries';
import type { Connection, RowDataPacket } from 'mysql2/promise';

// ===== Named constants driving the seeded scenario (no magic numbers) =====

/** Single-stem trees seeded: each contributes exactly one stem and one tree. */
const SINGLE_STEM_TREE_COUNT = 50;
/** The multi-stem tree's two stems (one tree, two stems — must count once in CountTrees). */
const MULTI_STEM_TREE_STEM_COUNT = 2;

const TOTAL_MEASURED_STEMS = SINGLE_STEM_TREE_COUNT + MULTI_STEM_TREE_STEM_COUNT; // 52
const TOTAL_MEASURED_TREES = SINGLE_STEM_TREE_COUNT + 1; // 50 single-stem trees + 1 multi-stem tree = 51

/** After hard-deleting the ONLY measurement of a single-stem tree's only stem. */
const STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT = TOTAL_MEASURED_STEMS - 1; // 51
const TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT = TOTAL_MEASURED_TREES - 1; // 50

/** Index (0-based) within the seeded single-stem trees used for each scenario role. */
const DOUBLE_MEASURED_TREE_INDEX = 0; // gets a 2nd measurement on the same stem
const DELETED_STEM_TREE_INDEX = 1; // its only measurement gets hard-deleted

const SINGLE_STEM_TREE_TAG_PREFIX = 'MCNT_SINGLE_';
const MULTI_STEM_TREE_TAG = 'MCNT_MULTI_01';
const MULTI_STEM_STEM_TAGS = ['S001', 'S002'] as const;

const SEED_MEASUREMENT_DATE = '2024-06-15';
const SECOND_MEASUREMENT_DATE = '2024-09-15'; // must differ from SEED_MEASUREMENT_DATE: coremeasurements has
// a unique key on (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)
const SEED_DBH = 100.0;
const SEED_HOM = 1.3;

const ZERO_MEASURED_COUNT = 0;

// ===== Additional running-total constants (review-round-1 corrections, issue #508) =====
// Each constant below documents the expected CountStems/CountTrees for the ORIGINAL
// (censusID, plotID) pair at that point in the suite, continuing the bookkeeping from
// STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT / TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT
// (51 / 50) left behind by the first `it` block above.

// --- (a) a second plot, with its own census/quadrat/measured stem, must never leak into
// the original plot's counts. Identifiers for the second plot/census, so later blocks
// (b)-(d) can re-query its own scoping.
const OTHER_PLOT_NAME = 'MCNT_OTHER_PLOT';
const OTHER_PLOT_QUADRAT_NAME = 'MCNT_OTHER_PLOT_Q1';
const OTHER_PLOT_TREE_TAG = 'MCNT_OTHER_PLOT_TREE';
const OTHER_PLOT_STEM_TAG = 'S001';
const OTHER_PLOT_CENSUS_NUMBER = 1;
const OTHER_PLOT_START_DATE = '2024-01-01';
const OTHER_PLOT_END_DATE = '2024-12-31';
/** The second plot seeds exactly one measured stem on one tree. */
const OTHER_PLOT_EXPECTED_STEMS = 1;
const OTHER_PLOT_EXPECTED_TREES = 1;

// --- (b) a tree marked IsActive = 0: CountStems does not join `trees`, so the tree's
// active stem+measurement still counts; CountTrees joins `trees` ON IsActive = 1, so the
// tree itself is excluded.
const INACTIVE_TREE_ONLY_TAG = 'MCNT_INACTIVE_TREE'; // trees.TreeTag is varchar(20); this is 18 chars
const STEMS_AFTER_INACTIVE_TREE = STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT + 1; // 52
const TREES_AFTER_INACTIVE_TREE = TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT; // 50 (unchanged)

// --- (c) the multi-stem tree's two measurements are deleted one at a time. CountTrees
// must only drop once the tree loses its LAST measured stem.
const STEMS_AFTER_FIRST_MULTISTEM_DELETE = STEMS_AFTER_INACTIVE_TREE - 1; // 51
const TREES_AFTER_FIRST_MULTISTEM_DELETE = TREES_AFTER_INACTIVE_TREE; // 50 (tree still has 1 measured stem)
const STEMS_AFTER_SECOND_MULTISTEM_DELETE = STEMS_AFTER_FIRST_MULTISTEM_DELETE - 1; // 50
const TREES_AFTER_SECOND_MULTISTEM_DELETE = TREES_AFTER_FIRST_MULTISTEM_DELETE - 1; // 49 (last measured stem gone)

describe('Dashboard measured-count SQL (issue #508 regression)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let plotID: number;
  let censusID: number;
  let speciesCode: string;
  let quadratName: string;
  /** CoreMeasurementIDs for the multi-stem tree's two stems, captured for later deletion (scenario c). */
  let multiStemMeasurementIDs: number[];
  /** Identifiers for the second plot seeded in scenario (a), re-queried in (b)-(d). */
  let otherPlotID: number;
  let otherPlotCensusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    speciesCode = testData.species[0]?.SpeciesCode ?? testData.species[0]?.Mnemonic;
    quadratName = testData.quadrats[0]?.QuadratName ?? testData.quadrats[0]?.Quadrat;

    if (!speciesCode || !quadratName) {
      throw new Error('Test setup failed: seedSampleData did not provide a species or quadrat to measure against');
    }
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  function singleStemMeasurement(index: number, overrides: Partial<DirectMeasurement> = {}): DirectMeasurement {
    return {
      treeTag: `${SINGLE_STEM_TREE_TAG_PREFIX}${index}`,
      stemTag: 'S001',
      speciesCode,
      quadratName,
      x: index, // distinct coordinates are not load-bearing here, just avoid any accidental collision
      y: index,
      dbh: SEED_DBH,
      hom: SEED_HOM,
      date: SEED_MEASUREMENT_DATE,
      ...overrides
    };
  }

  /**
   * Defaults to the ORIGINAL (censusID, plotID) pair so every existing call site keeps its
   * exact prior behavior; scenarios that need to prove cross-plot/cross-census scoping pass
   * an explicit pair instead.
   */
  async function getMeasuredCounts(targetCensusID: number = censusID, targetPlotID: number = plotID): Promise<{ stems: number; trees: number }> {
    const [stemRows] = await connection.query<RowDataPacket[]>(buildMeasuredStemCountSql(config.database), [targetCensusID, targetPlotID]);
    const [treeRows] = await connection.query<RowDataPacket[]>(buildMeasuredTreeCountSql(config.database), [targetCensusID, targetPlotID]);
    return { stems: stemRows[0].CountStems, trees: treeRows[0].CountTrees };
  }

  it('counts only active, measured stems/trees for the selected census+plot, and shrinks on hard-delete without mutating stems/trees', async () => {
    // ===== (a) Seed 52 distinct measured stems across 51 trees =====
    const singleStemMeasurements = Array.from({ length: SINGLE_STEM_TREE_COUNT }, (_, i) => singleStemMeasurement(i));
    const multiStemMeasurements: DirectMeasurement[] = MULTI_STEM_STEM_TAGS.map(stemTag => ({
      treeTag: MULTI_STEM_TREE_TAG,
      stemTag,
      speciesCode,
      quadratName,
      x: 1000,
      y: 1000,
      dbh: SEED_DBH,
      hom: SEED_HOM,
      date: SEED_MEASUREMENT_DATE
    }));

    const { coreMeasurementIDs: singleStemMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, singleStemMeasurements);
    const { coreMeasurementIDs: capturedMultiStemMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, multiStemMeasurements);
    // Captured (not discarded) so scenario (c) below can hard-delete each stem's measurement
    // individually and prove the multi-stem "last measured stem" semantics.
    multiStemMeasurementIDs = capturedMultiStemMeasurementIDs;

    const afterInitialSeed = await getMeasuredCounts();
    expect(afterInitialSeed.stems, `expected ${TOTAL_MEASURED_STEMS} distinct measured stems after seeding, got ${afterInitialSeed.stems}`).toBe(
      TOTAL_MEASURED_STEMS
    );
    expect(
      afterInitialSeed.trees,
      `expected ${TOTAL_MEASURED_TREES} distinct measured trees after seeding (multi-stem tree counts once), got ${afterInitialSeed.trees}`
    ).toBe(TOTAL_MEASURED_TREES);

    // Add a SECOND measurement on the same stem as DOUBLE_MEASURED_TREE_INDEX. This must NOT
    // change the distinct stem/tree counts — proving COUNT(DISTINCT ...) is doing its job.
    const { coreMeasurementIDs: secondMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      singleStemMeasurement(DOUBLE_MEASURED_TREE_INDEX, { date: SECOND_MEASUREMENT_DATE, dbh: SEED_DBH + 5 })
    ]);
    const secondMeasurementOnDoubleStemID = secondMeasurementIDs[0];

    const afterSecondMeasurement = await getMeasuredCounts();
    expect(
      afterSecondMeasurement.stems,
      `a second measurement on an already-measured stem must not inflate CountStems; expected ${TOTAL_MEASURED_STEMS}, got ${afterSecondMeasurement.stems}`
    ).toBe(TOTAL_MEASURED_STEMS);
    expect(
      afterSecondMeasurement.trees,
      `a second measurement must not inflate CountTrees; expected ${TOTAL_MEASURED_TREES}, got ${afterSecondMeasurement.trees}`
    ).toBe(TOTAL_MEASURED_TREES);

    // ===== (b) Hard-delete the ONLY measurement of a single-measurement stem, exactly like the app =====
    const deletedTreeMeasurementID = singleStemMeasurementIDs[DELETED_STEM_TREE_INDEX];

    const [[deletedStemRowBefore]] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID, s.TreeID, s.IsActive AS StemIsActive, t.IsActive AS TreeIsActive
       FROM coremeasurements cm
       JOIN stems s ON cm.StemGUID = s.StemGUID
       JOIN trees t ON s.TreeID = t.TreeID
       WHERE cm.CoreMeasurementID = ?`,
      [deletedTreeMeasurementID]
    );
    expect(deletedStemRowBefore, 'expected to find the stem/tree backing the measurement we are about to delete').toBeDefined();
    const { StemGUID: deletedStemGUID, TreeID: deletedTreeID } = deletedStemRowBefore;

    // This is the SAME delete coreapifunctions.ts performs: a hard DELETE of the coremeasurements
    // row only. It must never touch stems/trees.
    await connection.query('DELETE FROM coremeasurements WHERE CoreMeasurementID = ?', [deletedTreeMeasurementID]);

    const afterSingleStemDelete = await getMeasuredCounts();
    expect(
      afterSingleStemDelete.stems,
      `deleting a stem's only measurement must drop CountStems from ${TOTAL_MEASURED_STEMS} to ${STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT}; got ${afterSingleStemDelete.stems}`
    ).toBe(STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT);
    expect(
      afterSingleStemDelete.trees,
      `deleting that tree's only stem's only measurement must drop CountTrees from ${TOTAL_MEASURED_TREES} to ${TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT}; got ${afterSingleStemDelete.trees}`
    ).toBe(TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT);

    const [[deletedStemRowAfter]] = await connection.query<RowDataPacket[]>('SELECT StemGUID, IsActive FROM stems WHERE StemGUID = ?', [deletedStemGUID]);
    const [[deletedTreeRowAfter]] = await connection.query<RowDataPacket[]>('SELECT TreeID, IsActive FROM trees WHERE TreeID = ?', [deletedTreeID]);
    expect(deletedStemRowAfter, 'the stem row itself must still exist after its measurement is hard-deleted (no identity mutation)').toBeDefined();
    expect(deletedStemRowAfter.IsActive, 'the stem row must remain IsActive = 1; deleting a measurement must never soft-delete the stem').toBe(1);
    expect(deletedTreeRowAfter, 'the tree row itself must still exist after its only stem lost its only measurement').toBeDefined();
    expect(deletedTreeRowAfter.IsActive, 'the tree row must remain IsActive = 1; deleting a measurement must never soft-delete the tree').toBe(1);

    // ===== (c) Delete ONE of the two measurements on the double-measured stem =====
    await connection.query('DELETE FROM coremeasurements WHERE CoreMeasurementID = ?', [secondMeasurementOnDoubleStemID]);

    const afterDoubleStemPartialDelete = await getMeasuredCounts();
    expect(
      afterDoubleStemPartialDelete.stems,
      `the double-measured stem still has one live measurement; CountStems must stay ${STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterDoubleStemPartialDelete.stems}`
    ).toBe(STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT);
    expect(
      afterDoubleStemPartialDelete.trees,
      `CountTrees must stay ${TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterDoubleStemPartialDelete.trees}`
    ).toBe(TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT);

    // ===== (d) Exclusions: none of these may inflate the selected census's counts =====

    // d1: a measurement with IsActive = 0 on an otherwise-fresh tree/stem.
    const { coreMeasurementIDs: inactiveMeasIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      {
        treeTag: 'MCNT_INACTIVE_MEAS',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 2000,
        y: 2000,
        dbh: SEED_DBH,
        hom: SEED_HOM,
        date: SEED_MEASUREMENT_DATE
      }
    ]);
    await connection.query('UPDATE coremeasurements SET IsActive = 0 WHERE CoreMeasurementID = ?', [inactiveMeasIDs[0]]);

    // d2: an active measurement whose STEM row is IsActive = 0.
    const { coreMeasurementIDs: inactiveStemMeasIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      {
        treeTag: 'MCNT_INACTIVE_STEM',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 2001,
        y: 2001,
        dbh: SEED_DBH,
        hom: SEED_HOM,
        date: SEED_MEASUREMENT_DATE
      }
    ]);
    const [[inactiveStemLookup]] = await connection.query<RowDataPacket[]>('SELECT StemGUID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      inactiveStemMeasIDs[0]
    ]);
    await connection.query('UPDATE stems SET IsActive = 0 WHERE StemGUID = ?', [inactiveStemLookup.StemGUID]);

    // d3: an active measurement in a SECOND census must not count toward census 1.
    const secondCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: 2,
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });
    await insertDirectMeasurements(connection, testData, secondCensus.censusID, [
      {
        treeTag: 'MCNT_OTHER_CENSUS',
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 2002,
        y: 2002,
        dbh: SEED_DBH,
        hom: SEED_HOM,
        date: '2025-06-15'
      }
    ]);

    // d4: a legitimate unmeasured tree/stem (no coremeasurements row at all) must be preserved
    // but excluded from the counts.
    const [[speciesRow]] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
    const [[quadratRow]] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [
      quadratName,
      plotID
    ]);
    await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      'MCNT_UNMEASURED_TREE',
      speciesRow.SpeciesID,
      censusID
    ]);
    const [[unmeasuredTreeRow]] = await connection.query<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND CensusID = ?', [
      'MCNT_UNMEASURED_TREE',
      censusID
    ]);
    await connection.query('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)', [
      unmeasuredTreeRow.TreeID,
      quadratRow.QuadratID,
      censusID,
      'S001',
      2003,
      2003
    ]);

    const afterExclusions = await getMeasuredCounts();
    expect(
      afterExclusions.stems,
      `an IsActive=0 measurement, an IsActive=0 stem, a second-census measurement, and an unmeasured stem must not inflate CountStems; ` +
        `expected ${STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterExclusions.stems}`
    ).toBe(STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT);
    expect(
      afterExclusions.trees,
      `the same exclusions must not inflate CountTrees; expected ${TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterExclusions.trees}`
    ).toBe(TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT);

    // The unmeasured tree/stem must still exist (preserved), just not counted.
    const [[unmeasuredStemRow]] = await connection.query<RowDataPacket[]>('SELECT StemGUID, IsActive FROM stems WHERE TreeID = ? AND CensusID = ?', [
      unmeasuredTreeRow.TreeID,
      censusID
    ]);
    expect(unmeasuredStemRow, 'an unmeasured but legitimate stem row must still exist').toBeDefined();
    expect(unmeasuredStemRow.IsActive, 'an unmeasured stem is not soft-deleted; it is simply not yet measured').toBe(1);
  }, 120000);

  // The four `it` blocks below run sequentially after the one above, in the SAME describe,
  // against the SAME database connection/testData. They continue the running-total
  // bookkeeping left at (stems=STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT=51,
  // trees=TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT=50) for the original (censusID, plotID).

  it("seeding a second plot's own census/quadrat/measured stem must not change the original plot's counts, and a mismatched census/plot pair must return zero", async () => {
    // ===== (a) Build a second plot end-to-end via direct SQL. insertDirectMeasurements()
    // always resolves its plot from testData.plots[0], so it cannot target a second plot;
    // every row below is inserted the same way the d4 "unmeasured tree" section above does. =====
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, PlotShape, PlotDescription)
       VALUES (?, 'Other Plot Location', 'Panama', 500, 500, 250000, 'square', 'Second plot seeded for issue #508 scoping checks')`,
      [OTHER_PLOT_NAME]
    );
    const [[otherPlotRow]] = await connection.query<RowDataPacket[]>('SELECT PlotID FROM plots WHERE PlotName = ?', [OTHER_PLOT_NAME]);
    otherPlotID = otherPlotRow.PlotID;

    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, ?, 0, 0, 20, 20, 400, 'square')`,
      [otherPlotID, OTHER_PLOT_QUADRAT_NAME]
    );
    const [[otherPlotQuadratRow]] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [
      OTHER_PLOT_QUADRAT_NAME,
      otherPlotID
    ]);

    await connection.query('INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, ?, ?, ?, 1)', [
      otherPlotID,
      OTHER_PLOT_CENSUS_NUMBER,
      OTHER_PLOT_START_DATE,
      OTHER_PLOT_END_DATE
    ]);
    const [[otherPlotCensusRow]] = await connection.query<RowDataPacket[]>('SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?', [
      otherPlotID,
      OTHER_PLOT_CENSUS_NUMBER
    ]);
    otherPlotCensusID = otherPlotCensusRow.CensusID;

    const [[otherPlotSpeciesRow]] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
    await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      OTHER_PLOT_TREE_TAG,
      otherPlotSpeciesRow.SpeciesID,
      otherPlotCensusID
    ]);
    const [[otherPlotTreeRow]] = await connection.query<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND CensusID = ?', [
      OTHER_PLOT_TREE_TAG,
      otherPlotCensusID
    ]);

    await connection.query('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 0, 0, 1)', [
      otherPlotTreeRow.TreeID,
      otherPlotQuadratRow.QuadratID,
      otherPlotCensusID,
      OTHER_PLOT_STEM_TAG
    ]);
    const [[otherPlotStemRow]] = await connection.query<RowDataPacket[]>('SELECT StemGUID FROM stems WHERE TreeID = ? AND StemTag = ? AND CensusID = ?', [
      otherPlotTreeRow.TreeID,
      OTHER_PLOT_STEM_TAG,
      otherPlotCensusID
    ]);

    await connection.query(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [otherPlotStemRow.StemGUID, otherPlotCensusID, SEED_DBH, SEED_HOM, SEED_MEASUREMENT_DATE]
    );

    // The original plot's counts must be completely unaffected by the second plot's data.
    const afterOtherPlotSeed = await getMeasuredCounts();
    expect(
      afterOtherPlotSeed.stems,
      `seeding an entirely separate plot must not change the original plot's CountStems; expected ${STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterOtherPlotSeed.stems}`
    ).toBe(STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT);
    expect(
      afterOtherPlotSeed.trees,
      `seeding an entirely separate plot must not change the original plot's CountTrees; expected ${TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT}, got ${afterOtherPlotSeed.trees}`
    ).toBe(TREES_AFTER_DELETING_LAST_STEM_MEASUREMENT);

    // A MISMATCHED (otherPlotCensusID, plotID) pair proves the `c.PlotID = ?` scoping join
    // actually binds: the other plot's census belongs to otherPlotID, not plotID, so pairing
    // it with the ORIGINAL plotID must return zero for both counts.
    const mismatchedPairCounts = await getMeasuredCounts(otherPlotCensusID, plotID);
    expect(
      mismatchedPairCounts.stems,
      `otherPlotCensusID belongs to otherPlotID, not the original plotID; querying that mismatched pair must return 0 CountStems, got ${mismatchedPairCounts.stems}`
    ).toBe(ZERO_MEASURED_COUNT);
    expect(
      mismatchedPairCounts.trees,
      `otherPlotCensusID belongs to otherPlotID, not the original plotID; querying that mismatched pair must return 0 CountTrees, got ${mismatchedPairCounts.trees}`
    ).toBe(ZERO_MEASURED_COUNT);

    // The CORRECTLY matched (otherPlotCensusID, otherPlotID) pair must see exactly the one
    // measured stem/tree seeded above; scenario (d) re-checks this after the original
    // census's measurements are purged, to prove purging one census never affects another.
    const otherPlotOwnCounts = await getMeasuredCounts(otherPlotCensusID, otherPlotID);
    expect(
      otherPlotOwnCounts.stems,
      `the second plot's own (censusID, plotID) pair must see its one seeded stem; expected ${OTHER_PLOT_EXPECTED_STEMS}, got ${otherPlotOwnCounts.stems}`
    ).toBe(OTHER_PLOT_EXPECTED_STEMS);
    expect(
      otherPlotOwnCounts.trees,
      `the second plot's own (censusID, plotID) pair must see its one seeded tree; expected ${OTHER_PLOT_EXPECTED_TREES}, got ${otherPlotOwnCounts.trees}`
    ).toBe(OTHER_PLOT_EXPECTED_TREES);
  }, 120000);

  it('a tree marked IsActive = 0 is excluded from CountTrees (which joins trees ON IsActive = 1) but its active stem+measurement still counts in CountStems (which does not join trees)', async () => {
    const { coreMeasurementIDs: inactiveTreeMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      {
        treeTag: INACTIVE_TREE_ONLY_TAG,
        stemTag: 'S001',
        speciesCode,
        quadratName,
        x: 3000,
        y: 3000,
        dbh: SEED_DBH,
        hom: SEED_HOM,
        date: SEED_MEASUREMENT_DATE
      }
    ]);

    const [[inactiveTreeLookup]] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeID
       FROM coremeasurements cm
       JOIN stems s ON cm.StemGUID = s.StemGUID
       JOIN trees t ON s.TreeID = t.TreeID
       WHERE cm.CoreMeasurementID = ?`,
      [inactiveTreeMeasurementIDs[0]]
    );
    expect(inactiveTreeLookup, 'expected to find the tree backing the measurement we just inserted').toBeDefined();

    // This is the asymmetry under test: deactivating the TREE (not the stem, not the
    // measurement) must affect CountTrees and CountStems differently, per each builder's
    // own join definition in dashboardmetricsqueries.ts.
    await connection.query('UPDATE trees SET IsActive = 0 WHERE TreeID = ?', [inactiveTreeLookup.TreeID]);

    const afterInactiveTree = await getMeasuredCounts();
    expect(
      afterInactiveTree.stems,
      `buildMeasuredStemCountSql joins only stems+census, never trees, so a fresh active stem with an active measurement must still count even though its owning tree is now IsActive=0; expected ${STEMS_AFTER_INACTIVE_TREE} (${STEMS_AFTER_DELETING_LAST_STEM_MEASUREMENT} + 1 new stem), got ${afterInactiveTree.stems}`
    ).toBe(STEMS_AFTER_INACTIVE_TREE);
    expect(
      afterInactiveTree.trees,
      `buildMeasuredTreeCountSql joins trees ON t.IsActive = 1, so a tree with IsActive=0 must never be counted, even though its stem and measurement are both still active; expected CountTrees to stay ${TREES_AFTER_INACTIVE_TREE}, got ${afterInactiveTree.trees}`
    ).toBe(TREES_AFTER_INACTIVE_TREE);
  }, 120000);

  it("deleting the multi-stem tree's two measurements one at a time proves CountTrees only drops on the LAST measured stem, while both stem rows and the tree row keep IsActive = 1", async () => {
    expect(
      multiStemMeasurementIDs,
      `expected the first it() block to have captured exactly ${MULTI_STEM_TREE_STEM_COUNT} coreMeasurementIDs for the multi-stem tree's stems (${MULTI_STEM_STEM_TAGS.join(', ')})`
    ).toHaveLength(MULTI_STEM_TREE_STEM_COUNT);
    const [firstStemMeasurementID, secondStemMeasurementID] = multiStemMeasurementIDs;

    // Delete stem S001's measurement: the tree still has S002 measured, so CountTrees must
    // not move yet.
    await connection.query('DELETE FROM coremeasurements WHERE CoreMeasurementID = ?', [firstStemMeasurementID]);
    const afterFirstMultiStemDelete = await getMeasuredCounts();
    expect(
      afterFirstMultiStemDelete.stems,
      `deleting one of the multi-stem tree's two measured stems must drop CountStems by 1 to ${STEMS_AFTER_FIRST_MULTISTEM_DELETE}; got ${afterFirstMultiStemDelete.stems}`
    ).toBe(STEMS_AFTER_FIRST_MULTISTEM_DELETE);
    expect(
      afterFirstMultiStemDelete.trees,
      `the multi-stem tree still has one measured stem (${MULTI_STEM_STEM_TAGS[1]}), so CountTrees must stay at ${TREES_AFTER_FIRST_MULTISTEM_DELETE}; got ${afterFirstMultiStemDelete.trees}`
    ).toBe(TREES_AFTER_FIRST_MULTISTEM_DELETE);

    // Delete stem S002's measurement too: this was the tree's LAST measured stem, so
    // CountTrees must now drop as well.
    await connection.query('DELETE FROM coremeasurements WHERE CoreMeasurementID = ?', [secondStemMeasurementID]);
    const afterSecondMultiStemDelete = await getMeasuredCounts();
    expect(
      afterSecondMultiStemDelete.stems,
      `deleting the multi-stem tree's remaining measured stem must drop CountStems by 1 more to ${STEMS_AFTER_SECOND_MULTISTEM_DELETE}; got ${afterSecondMultiStemDelete.stems}`
    ).toBe(STEMS_AFTER_SECOND_MULTISTEM_DELETE);
    expect(
      afterSecondMultiStemDelete.trees,
      `the multi-stem tree just lost its LAST measured stem, so CountTrees must drop to ${TREES_AFTER_SECOND_MULTISTEM_DELETE}; got ${afterSecondMultiStemDelete.trees}`
    ).toBe(TREES_AFTER_SECOND_MULTISTEM_DELETE);

    // Both stems and the tree keep their identity rows, IsActive = 1, despite having zero
    // live measurements left.
    const [[multiStemTreeRow]] = await connection.query<RowDataPacket[]>('SELECT TreeID, IsActive FROM trees WHERE TreeTag = ? AND CensusID = ?', [
      MULTI_STEM_TREE_TAG,
      censusID
    ]);
    expect(multiStemTreeRow, 'the multi-stem tree row must still exist after both of its measurements are hard-deleted').toBeDefined();
    expect(multiStemTreeRow.IsActive, 'the multi-stem tree row must remain IsActive = 1; losing its last measured stem must never soft-delete the tree').toBe(
      1
    );

    const [multiStemStemRows] = await connection.query<RowDataPacket[]>('SELECT StemGUID, StemTag, IsActive FROM stems WHERE TreeID = ? AND CensusID = ?', [
      multiStemTreeRow.TreeID,
      censusID
    ]);
    expect(
      multiStemStemRows,
      `expected both of the multi-stem tree's stems (${MULTI_STEM_STEM_TAGS.join(', ')}) to still exist as rows after their measurements were hard-deleted`
    ).toHaveLength(MULTI_STEM_TREE_STEM_COUNT);
    for (const stemRow of multiStemStemRows) {
      expect(stemRow.IsActive, `stem ${stemRow.StemTag} must remain IsActive = 1; deleting its measurement must never soft-delete the stem`).toBe(1);
    }
  }, 120000);

  it("hard-deleting every remaining measurement for the original census zeroes both counts while preserving the census's stem/tree identity rows, and the other plot's own census remains unaffected", async () => {
    // Baseline active identity-row counts for the original census, captured BEFORE the
    // purge. Using a captured baseline (rather than a hand-computed magic number) is the
    // accurate way to prove "hard-deleting measurements never touches stems/trees": whatever
    // the exact row count is, it must be IDENTICAL before and after.
    const [[activeStemsBeforePurge]] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS activeStemCount FROM stems WHERE CensusID = ? AND IsActive = 1',
      [censusID]
    );
    const [[activeTreesBeforePurge]] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS activeTreeCount FROM trees WHERE CensusID = ? AND IsActive = 1',
      [censusID]
    );
    expect(
      activeStemsBeforePurge.activeStemCount,
      'sanity check: the original census must still have active stem rows before the final measurement purge'
    ).toBeGreaterThan(ZERO_MEASURED_COUNT);
    expect(
      activeTreesBeforePurge.activeTreeCount,
      'sanity check: the original census must still have active tree rows before the final measurement purge'
    ).toBeGreaterThan(ZERO_MEASURED_COUNT);

    // The same hard delete the app performs, just applied to EVERY remaining measurement in
    // the census at once.
    await connection.query('DELETE FROM coremeasurements WHERE CensusID = ?', [censusID]);

    const afterFinalPurge = await getMeasuredCounts();
    expect(
      afterFinalPurge.stems,
      `deleting every remaining coremeasurements row for the original census must drop CountStems to ${ZERO_MEASURED_COUNT}; got ${afterFinalPurge.stems}`
    ).toBe(ZERO_MEASURED_COUNT);
    expect(
      afterFinalPurge.trees,
      `deleting every remaining coremeasurements row for the original census must drop CountTrees to ${ZERO_MEASURED_COUNT}; got ${afterFinalPurge.trees}`
    ).toBe(ZERO_MEASURED_COUNT);

    const [[activeStemsAfterPurge]] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS activeStemCount FROM stems WHERE CensusID = ? AND IsActive = 1',
      [censusID]
    );
    const [[activeTreesAfterPurge]] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS activeTreeCount FROM trees WHERE CensusID = ? AND IsActive = 1',
      [censusID]
    );
    expect(
      activeStemsAfterPurge.activeStemCount,
      `hard-deleting every measurement for the census must never touch the stems identity rows; expected the same ${activeStemsBeforePurge.activeStemCount} active stems as before the purge, got ${activeStemsAfterPurge.activeStemCount}`
    ).toBe(activeStemsBeforePurge.activeStemCount);
    expect(
      activeTreesAfterPurge.activeTreeCount,
      `hard-deleting every measurement for the census must never touch the trees identity rows; expected the same ${activeTreesBeforePurge.activeTreeCount} active trees as before the purge, got ${activeTreesAfterPurge.activeTreeCount}`
    ).toBe(activeTreesBeforePurge.activeTreeCount);

    // The other plot's own (censusID, plotID) pair must still see its measured stem/tree:
    // purging census #1's measurements must never reach into census #2's.
    const otherPlotCountsAfterPurge = await getMeasuredCounts(otherPlotCensusID, otherPlotID);
    expect(
      otherPlotCountsAfterPurge.stems,
      `purging the original census's measurements must not affect the other plot's own census; expected ${OTHER_PLOT_EXPECTED_STEMS}, got ${otherPlotCountsAfterPurge.stems}`
    ).toBe(OTHER_PLOT_EXPECTED_STEMS);
    expect(
      otherPlotCountsAfterPurge.trees,
      `purging the original census's measurements must not affect the other plot's own census; expected ${OTHER_PLOT_EXPECTED_TREES}, got ${otherPlotCountsAfterPurge.trees}`
    ).toBe(OTHER_PLOT_EXPECTED_TREES);
  }, 120000);
});
