/** Real-DB contract tests for the comparison facts BuildDBHChangePairs computes for DBH validations 1 and 2. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  insertCrossCensusMeasurements,
  seedStatusAttributes,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

type PairFacts = {
  presentCoreMeasurementID: number;
  presentIsValidated: boolean | null;
  unitToMm: number;
  intervalDays: number | null;
  statusExempt: boolean;
  dbhsMeetFloor: boolean;
  homEligible: boolean;
  intervalSkipReason: string | null;
  comparisonBasis: string | null;
  isEligible: boolean;
  growthViolates: boolean;
  shrinkageViolates: boolean;
};

const flag = (value: unknown): boolean => Number(value) === 1;

describe('BuildDBHChangePairs comparison facts', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1ID: number;
  let census2ID: number;
  let plotID: number;
  let speciesCode: string;
  let quadratName: string;
  let seedNumber = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    ({
      census1: { censusID: census1ID },
      census2: { censusID: census2ID }
    } = await setupTwoCensusScenario(connection, testData));
    plotID = testData.plots[0].plotID;
    speciesCode = testData.species[0].SpeciesCode || testData.species[0].Mnemonic;
    quadratName = testData.quadrats[0].QuadratName || testData.quadrats[0].Quadrat;
    await seedStatusAttributes(connection);
  }, 90000);
  afterAll(async () => teardownTestDatabase(connection, config));
  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await connection.query("UPDATE plots SET DefaultDBHUnits = 'mm' WHERE PlotID = ?", [plotID]);
  });

  async function seed(tag: string, prior = 100, present = 200, date = '2025-01-01') {
    const uniqueTag = `${tag.slice(0, 9)}${++seedNumber}`;
    const inserted = await insertCrossCensusMeasurements(connection, testData, census1ID, census2ID, [
      {
        treeTag: uniqueTag,
        stemTag: `S${seedNumber}`,
        speciesCode,
        quadratName,
        x: 1,
        y: 1,
        census1DBH: prior,
        census2DBH: present,
        hom: 1.3,
        census1Date: '2024-01-01',
        census2Date: date,
        codes: 'A'
      }
    ]);
    return { priorID: inserted.census1MeasurementIDs[0], presentID: inserted.census2MeasurementIDs[0] };
  }

  /** Builds pairs for one measurement in the given schema and always drops the session temp table. */
  async function readPairFacts(presentID: number): Promise<PairFacts[]> {
    const schema = `\`${config.database}\``;
    try {
      await connection.query(`CALL ${schema}.BuildDBHChangePairs(?, ?, ?)`, [census2ID, plotID, presentID]);
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT * FROM ${schema}.dbh_change_pairs WHERE PresentCoreMeasurementID = ? ORDER BY PriorCoreMeasurementID DESC`,
        [presentID]
      );
      return rows.map(row => ({
        presentCoreMeasurementID: Number(row.PresentCoreMeasurementID),
        presentIsValidated: row.PresentIsValidated == null ? null : flag(row.PresentIsValidated),
        unitToMm: Number(row.UnitToMm),
        intervalDays: row.IntervalDays == null ? null : Number(row.IntervalDays),
        statusExempt: flag(row.StatusExempt),
        dbhsMeetFloor: flag(row.DbhsMeetFloor),
        homEligible: flag(row.HomEligible),
        intervalSkipReason: row.IntervalSkipReason ?? null,
        comparisonBasis: row.ComparisonBasis ?? null,
        isEligible: flag(row.IsEligible),
        growthViolates: flag(row.GrowthViolates),
        shrinkageViolates: flag(row.ShrinkageViolates)
      }));
    } finally {
      await connection.query(`DROP TEMPORARY TABLE IF EXISTS ${schema}.dbh_change_pairs`);
    }
  }

  it('computes identical facts for NULL, TRUE, and FALSE present rows when asked for one measurement, without durable writes', async () => {
    const { presentID } = await seed('PAIR_STATES');
    for (const value of [null, 1, 0]) {
      await connection.query('UPDATE coremeasurements SET IsValidated = ? WHERE CoreMeasurementID = ?', [value, presentID]);
      const pairs = await readPairFacts(presentID);
      expect(pairs, `present IsValidated=${value}`).toHaveLength(1);
      expect(pairs[0]).toMatchObject({
        presentIsValidated: value === null ? null : value === 1,
        growthViolates: true,
        shrinkageViolates: false,
        dbhsMeetFloor: true,
        homEligible: true
      });
    }
    const [errors] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurement_error_log WHERE MeasurementID = ?', [presentID]);
    expect(Number(errors[0].count), 'building pairs must not write occurrences').toBe(0);
  });

  it('builds its temporary table in the routine schema when the connection default database differs', async () => {
    const { presentID } = await seed('PAIR_DEFAULT_SCHEMA');
    await connection.query('USE information_schema');
    try {
      expect((await readPairFacts(presentID)).map(pair => pair.presentCoreMeasurementID)).toEqual([presentID]);
    } finally {
      await connection.query(`USE \`${config.database}\``);
    }
  });

  it('builds only pending pairs in validation mode while an explicit measurement ID covers pending, FALSE, and TRUE rows', async () => {
    const pending = await seed('PAIR_PENDING');
    const invalid = await seed('PAIR_FALSE');
    const valid = await seed('PAIR_TRUE');
    await connection.query('UPDATE coremeasurements SET IsValidated=NULL WHERE CoreMeasurementID=?', [pending.presentID]);
    await connection.query('UPDATE coremeasurements SET IsValidated=FALSE WHERE CoreMeasurementID=?', [invalid.presentID]);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [valid.presentID]);

    await connection.query('CALL BuildDBHChangePairs(?, ?, NULL)', [census2ID, plotID]);
    try {
      const [validationPairs] = await connection.query<RowDataPacket[]>(
        'SELECT PresentCoreMeasurementID FROM dbh_change_pairs WHERE PresentCoreMeasurementID IN (?, ?, ?)',
        [pending.presentID, invalid.presentID, valid.presentID]
      );
      expect(validationPairs.map(row => Number(row.PresentCoreMeasurementID))).toEqual([pending.presentID]);
    } finally {
      await connection.query('DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs');
    }

    for (const id of [pending.presentID, invalid.presentID, valid.presentID]) {
      expect(
        (await readPairFacts(id)).map(pair => pair.presentCoreMeasurementID),
        `explicit pairs for ${id}`
      ).toEqual([id]);
    }
  });

  it('reports DBH floor on either side, centimetre conversion, null DBH, HOM and status eligibility', async () => {
    const cases = [
      { tag: 'PAIR_FLOOR_PRESENT', prior: 100, present: 9, expect: { dbhsMeetFloor: false } },
      { tag: 'PAIR_FLOOR_PRIOR', prior: 9, present: 100, expect: { dbhsMeetFloor: false } },
      {
        tag: 'PAIR_NULL_DBH',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredDBH = NULL WHERE CoreMeasurementID = ?',
        expect: { dbhsMeetFloor: false }
      },
      {
        tag: 'PAIR_HOM_DIFF',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredHOM = 2 WHERE CoreMeasurementID = ?',
        expect: { homEligible: false }
      },
      {
        tag: 'PAIR_HOM_NULL',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredHOM = NULL WHERE CoreMeasurementID = ?',
        expect: { homEligible: true }
      },
      {
        tag: 'PAIR_STATUS',
        prior: 100,
        present: 200,
        sql: "UPDATE cmattributes SET Code = 'D' WHERE CoreMeasurementID = ?",
        expect: { statusExempt: true }
      }
    ];
    for (const testCase of cases) {
      const ids = await seed(testCase.tag, testCase.prior, testCase.present);
      if (testCase.sql) await connection.query(testCase.sql, [ids.presentID]);
      const pairs = await readPairFacts(ids.presentID);
      expect(pairs, testCase.tag).toHaveLength(1);
      expect(pairs[0], testCase.tag).toMatchObject(testCase.expect);
    }
    await connection.query("UPDATE plots SET DefaultDBHUnits = 'cm' WHERE PlotID = ?", [plotID]);
    const centimetres = await seed('PAIR_CM_FLOOR', 2, 0.9);
    expect(await readPairFacts(centimetres.presentID)).toMatchObject([{ unitToMm: 10, dbhsMeetFloor: false }]);
  });

  it('reports actionable DBH-floor skips separately from interval skips', async () => {
    const pendingFloor = await seed('FLOOR_PENDING', 100, 9);
    const processedFloor = await seed('FLOOR_DONE', 100, 9);
    const statusFloor = await seed('FLOOR_STATUS', 100, 9);
    const missingFloor = await seed('FLOOR_NODATE', 100, 9);
    const missingDbh = await seed('FLOOR_NULLDBH', 100, 200);
    const missingEligible = await seed('INTERVAL_NODATE', 100, 200);
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID=?', [processedFloor.presentID]);
    await connection.query("UPDATE cmattributes SET Code='D' WHERE CoreMeasurementID=?", [statusFloor.presentID]);
    await connection.query('UPDATE coremeasurements SET MeasurementDate=NULL WHERE CoreMeasurementID IN (?, ?)', [
      missingFloor.presentID,
      missingEligible.presentID
    ]);
    await connection.query('UPDATE coremeasurements SET MeasuredDBH=NULL WHERE CoreMeasurementID=?', [missingDbh.presentID]);

    const [millimetreSets] = await connection.query<any[]>('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID]);
    const millimetreFloor = millimetreSets.find((set: unknown) => Array.isArray(set) && set[0]?.SkippedBelowDbhFloor)?.[0];
    const millimetreIntervals = millimetreSets.find((set: unknown) => Array.isArray(set) && set[0]?.SkippedNoInterval)?.[0];
    // The failed-floor counter includes pending comparisons with a missing DBH
    // as well as below-floor values, even without a date. Completed and
    // status-exempt rows do not count. A missing date is compared with the
    // absolute thresholds, so it is not an interval skip.
    expect(millimetreFloor).toMatchObject({ SkippedBelowDbhFloor: '3' });
    expect(millimetreIntervals).toMatchObject({ SkippedNoInterval: '0' });

    // Reinterpretation under centimetres would otherwise make the pending NULL
    // DBH fixture carry into this independent conversion-boundary assertion.
    await connection.query('UPDATE coremeasurements SET IsValidated=TRUE WHERE CoreMeasurementID IN (?, ?, ?, ?, ?, ?)', [
      pendingFloor.presentID,
      processedFloor.presentID,
      statusFloor.presentID,
      missingFloor.presentID,
      missingDbh.presentID,
      missingEligible.presentID
    ]);
    await connection.query("UPDATE plots SET DefaultDBHUnits='cm' WHERE PlotID=?", [plotID]);
    await seed('CM_BELOW', 0.9, 2);
    await seed('CM_ABOVE', 1.1, 2);
    const [centimetreSets] = await connection.query<any[]>('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID]);
    const centimetreFloor = centimetreSets.find((set: unknown) => Array.isArray(set) && set[0]?.SkippedBelowDbhFloor)?.[0];
    expect(centimetreFloor).toMatchObject({ SkippedBelowDbhFloor: '1' });
  });

  it('annualises only intervals of at least one year and applies the absolute legacy thresholds to shorter or undated comparisons', async () => {
    const cases = [
      {
        label: 'missing present date, 100 -> 200 mm: absolute growth of 100 mm exceeds 65 mm',
        tag: 'BASIS_NODATE',
        prior: 100,
        present: 200,
        date: '2025-01-01',
        clearPresentDate: true,
        expect: { comparisonBasis: 'absolute', intervalDays: null, growthViolates: true, shrinkageViolates: false }
      },
      {
        label: 'same-day remeasure, 100 -> 200 mm: absolute growth of 100 mm exceeds 65 mm',
        tag: 'BASIS_ZERO',
        prior: 100,
        present: 200,
        date: '2024-01-01',
        expect: { comparisonBasis: 'absolute', intervalDays: 0, growthViolates: true, shrinkageViolates: false }
      },
      {
        label: '60 days, 50 -> 49 mm: a 2% drop is within the absolute 5% shrinkage limit (annualised it would be -12%/yr)',
        tag: 'BASIS_SHORT_SHRINK',
        prior: 50,
        present: 49,
        date: '2024-03-01',
        expect: { comparisonBasis: 'absolute', intervalDays: 60, growthViolates: false, shrinkageViolates: false }
      },
      {
        label: '60 days, 100 -> 160 mm: 60 mm is within the absolute 65 mm growth limit (annualised it would be 365 mm/yr)',
        tag: 'BASIS_SHORT_GROW',
        prior: 100,
        present: 160,
        date: '2024-03-01',
        expect: { comparisonBasis: 'absolute', intervalDays: 60, growthViolates: false, shrinkageViolates: false }
      },
      {
        label: '364 days, 100 -> 94 mm: a 6% drop exceeds the absolute 5% shrinkage limit',
        tag: 'BASIS_364_SHRINK',
        prior: 100,
        present: 94,
        date: '2024-12-30',
        expect: { comparisonBasis: 'absolute', intervalDays: 364, growthViolates: false, shrinkageViolates: true }
      },
      {
        label: '365 days, 100 -> 166 mm: first annualised interval, 66 mm over 365 days exceeds 65 mm per year',
        tag: 'BASIS_365_GROW',
        prior: 100,
        present: 166,
        date: '2024-12-31',
        expect: { comparisonBasis: 'annualised', intervalDays: 365, growthViolates: true, shrinkageViolates: false }
      },
      {
        label: '20 years (7305 days), 100 -> 1300 mm: the longest plausible interval is annualised, 60 mm per year passes',
        tag: 'BASIS_20Y',
        prior: 100,
        present: 1300,
        date: '2044-01-01',
        expect: { comparisonBasis: 'annualised', intervalDays: 7305, intervalSkipReason: null, growthViolates: false, shrinkageViolates: false }
      }
    ];
    for (const testCase of cases) {
      const ids = await seed(testCase.tag, testCase.prior, testCase.present, testCase.date);
      if (testCase.clearPresentDate) await connection.query('UPDATE coremeasurements SET MeasurementDate = NULL WHERE CoreMeasurementID = ?', [ids.presentID]);
      const pairs = await readPairFacts(ids.presentID);
      expect(pairs, testCase.label).toHaveLength(1);
      expect(pairs[0], testCase.label).toMatchObject({ isEligible: true, intervalSkipReason: null, ...testCase.expect });
    }
  });

  it('returns every interval skip reason, excludes noneligible rows from skip counts, and builds no pair for a measurement without a prior', async () => {
    const negative = await seed('DIAG_NEGATIVE', 100, 200, '2023-01-01');
    const implausible = await seed('DIAG_IMPLAUSIBLE', 100, 200, '2044-01-02');
    const floor = await seed('DIAG_SKIP_FLOOR', 100, 9, '2024-01-01');
    for (const [id, reason] of [
      [negative.presentID, 'negative-interval'],
      [implausible.presentID, 'implausible-interval']
    ] as const) {
      const pairs = await readPairFacts(id);
      expect(pairs, reason).toHaveLength(1);
      expect(pairs[0], `a ${reason} pair must be skipped with no comparison basis and no verdict`).toMatchObject({
        intervalSkipReason: reason,
        comparisonBasis: null,
        isEligible: false,
        growthViolates: false,
        shrinkageViolates: false
      });
    }
    const [sets] = await connection.query<any[]>('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID]);
    const counts = sets.find((set: unknown) => Array.isArray(set) && set[0]?.SkippedNoInterval)?.[0];
    expect(counts, 'the below-floor pair is excluded from interval skip counts').toMatchObject({
      SkippedNoInterval: '2',
      SkippedNegativeInterval: '1',
      SkippedImplausibleInterval: '1'
    });
    expect(floor.presentID).toBeTruthy();
    const [orphan] = await connection.query<any>('INSERT INTO coremeasurements (CensusID, MeasuredDBH, IsActive) VALUES (?, 20, 1)', [census2ID]);
    expect(await readPairFacts(orphan.insertId), 'a measurement with no prior stem has no comparison').toEqual([]);
  });
});
