/** Real-DB contract tests for the read-only DBH explanation path. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const state = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: async (fn: (tx: { id: string; query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
        if (!state.connection) throw new Error('test connection unavailable');
        await state.connection.beginTransaction();
        try {
          const result = await fn({ id: 'diagnostics-test', query: async (sql, values = []) => (await state.connection!.query(sql, values as any))[0] });
          await state.connection.rollback();
          return result;
        } catch (error) {
          await state.connection.rollback();
          throw error;
        }
      }
    })
  }
}));

import { explainDbhChangePairs } from '@/lib/validations/dbh-change-diagnostics';

describe('DBH change diagnostics integration', () => {
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
    state.connection = connection;
    ({
      census1: { censusID: census1ID },
      census2: { censusID: census2ID }
    } = await setupTwoCensusScenario(connection, testData));
    plotID = testData.plots[0].plotID;
    speciesCode = testData.species[0].SpeciesCode || testData.species[0].Mnemonic;
    quadratName = testData.quadrats[0].QuadratName || testData.quadrats[0].Quadrat;
    await seedStatusAttributes(connection);
  }, 90000);
  afterAll(async () => {
    state.connection = null;
    await teardownTestDatabase(connection, config);
  });
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
  async function explain(id: number) {
    return explainDbhChangePairs({ schema: config.database, coreMeasurementID: id, censusID: census2ID, plotID });
  }

  it('explains NULL, TRUE, and FALSE present rows with identical comparison facts without durable writes', async () => {
    const { presentID } = await seed('DIAG_STATES');
    const before = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [presentID]);
    for (const value of [null, 1, 0]) {
      await connection.query('UPDATE coremeasurements SET IsValidated = ? WHERE CoreMeasurementID = ?', [value, presentID]);
      const result = await explain(presentID);
      expect(result.outcome).toBe('pairs-found');
      if (result.outcome === 'pairs-found') {
        expect(result.present.isValidated).toBe(value === null ? null : value === 1);
        expect(result.pairs[0]).toMatchObject({ growthViolates: true, shrinkageViolates: false, dbhsMeetFloor: true, homEligible: true });
      }
    }
    const [after] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurement_error_log WHERE MeasurementID = ?', [presentID]);
    expect(after[0].count).toBe(0);
    expect(before[0][0].IsValidated).toBeNull();
  });

  it('uses the requested schema for the routine temporary table when the connection default database differs', async () => {
    const { presentID } = await seed('DIAG_DEFAULT_SCHEMA');
    await connection.query('USE information_schema');
    try {
      await expect(explain(presentID)).resolves.toMatchObject({
        outcome: 'pairs-found',
        pairs: [{ presentCoreMeasurementID: presentID }]
      });
    } finally {
      await connection.query(`USE \`${config.database}\``);
    }
  });

  it('builds pending pairs in validation mode while explicit diagnostic calls explain pending, FALSE, and TRUE rows', async () => {
    const pending = await seed('DIAG_PENDING');
    const invalid = await seed('DIAG_FALSE');
    const valid = await seed('DIAG_TRUE');
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
      await expect(explain(id)).resolves.toMatchObject({ outcome: 'pairs-found', pairs: [{ presentCoreMeasurementID: id }] });
    }
  });

  it('reports DBH floor on either side, centimetre conversion, null DBH, HOM and status eligibility directly from SQL facts', async () => {
    const cases = [
      { tag: 'DIAG_FLOOR_PRESENT', prior: 100, present: 9, expect: { dbhsMeetFloor: false } },
      { tag: 'DIAG_FLOOR_PRIOR', prior: 9, present: 100, expect: { dbhsMeetFloor: false } },
      {
        tag: 'DIAG_NULL_DBH',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredDBH = NULL WHERE CoreMeasurementID = ?',
        target: 'presentID',
        expect: { dbhsMeetFloor: false }
      },
      {
        tag: 'DIAG_HOM_DIFF',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredHOM = 2 WHERE CoreMeasurementID = ?',
        target: 'presentID',
        expect: { homEligible: false }
      },
      {
        tag: 'DIAG_HOM_NULL',
        prior: 100,
        present: 200,
        sql: 'UPDATE coremeasurements SET MeasuredHOM = NULL WHERE CoreMeasurementID = ?',
        target: 'presentID',
        expect: { homEligible: true }
      },
      {
        tag: 'DIAG_STATUS',
        prior: 100,
        present: 200,
        sql: "UPDATE cmattributes SET Code = 'D' WHERE CoreMeasurementID = ?",
        target: 'presentID',
        expect: { statusExempt: true }
      }
    ];
    for (const testCase of cases) {
      const ids = await seed(testCase.tag, testCase.prior, testCase.present);
      if (testCase.sql) await connection.query(testCase.sql, [ids[testCase.target as keyof typeof ids]]);
      const result = await explain(ids.presentID);
      expect(result.outcome).toBe('pairs-found');
      if (result.outcome === 'pairs-found') expect(result.pairs[0]).toMatchObject(testCase.expect);
    }
    await connection.query("UPDATE plots SET DefaultDBHUnits = 'cm' WHERE PlotID = ?", [plotID]);
    const cm = await seed('DIAG_CM_FLOOR', 2, 0.9);
    const cmResult = await explain(cm.presentID);
    expect(cmResult.outcome).toBe('pairs-found');
    if (cmResult.outcome === 'pairs-found') expect(cmResult.pairs[0]).toMatchObject({ unitToMm: 10, dbhsMeetFloor: false });
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
    // status-exempt rows do not count. The existing interval counter stays
    // gated by DBH eligibility, so the failed-floor missing-date row is not
    // double-counted.
    expect(millimetreFloor).toMatchObject({ SkippedBelowDbhFloor: '3' });
    expect(millimetreIntervals).toMatchObject({ SkippedNoInterval: '1', SkippedMissingDate: '1' });

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

  it('returns every interval reason, excludes noneligible rows from skip counts, and distinguishes no prior comparison', async () => {
    const missing = await seed('DIAG_MISSING', 100, 200, '2025-01-01');
    await connection.query('UPDATE coremeasurements SET MeasurementDate = NULL WHERE CoreMeasurementID = ?', [missing.presentID]);
    const zero = await seed('DIAG_ZERO', 100, 200, '2024-01-01');
    const negative = await seed('DIAG_NEGATIVE', 100, 200, '2023-01-01');
    const floor = await seed('DIAG_SKIP_FLOOR', 100, 9, '2024-01-01');
    for (const [id, reason] of [
      [missing.presentID, 'missing-date'],
      [zero.presentID, 'zero-interval'],
      [negative.presentID, 'negative-interval']
    ] as const) {
      const result = await explain(id);
      expect(result.outcome).toBe('pairs-found');
      if (result.outcome === 'pairs-found') expect(result.pairs[0].intervalSkipReason).toBe(reason);
    }
    const [sets] = await connection.query<any[]>('CALL RunSharedDBHChangeValidations(?, ?, 1, 1)', [census2ID, plotID]);
    const counts = sets.find((set: unknown) => Array.isArray(set) && set[0]?.SkippedNoInterval)?.[0];
    expect(counts).toMatchObject({ SkippedNoInterval: '3', SkippedMissingDate: '1', SkippedZeroInterval: '1', SkippedNegativeInterval: '1' });
    expect(floor.presentID).toBeTruthy();
    const [orphan] = await connection.query<any>('INSERT INTO coremeasurements (CensusID, MeasuredDBH, IsActive) VALUES (?, 20, 1)', [census1ID]);
    await expect(explainDbhChangePairs({ schema: config.database, coreMeasurementID: orphan.insertId })).resolves.toMatchObject({
      outcome: 'no-eligible-prior-comparison'
    });
  });
});
