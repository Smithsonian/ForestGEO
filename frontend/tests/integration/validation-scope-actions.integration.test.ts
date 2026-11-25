import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mysql from 'mysql2/promise';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'scope-actions-admin@forestgeo.test';
const AUTH_POLL_URL = 'https://auth.forestgeo.test/poll';
const TEST_TRANSACTION_ID_PREFIX = 'validation-scope-transaction-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  executeQueryCalls: 0,
  failOnce: null as RegExp | null,
  /** Runs (once) just before the first statement matching `pattern`, on that statement's turn. */
  beforeStatement: null as { pattern: RegExp; run: () => Promise<void> } | null
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'scope-actions-admin@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const { runQueryDispatch } = await vi.importActual<typeof import('../setup/runquerydispatch')>('../setup/runquerydispatch');
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      sharedState.executeQueryCalls += 1;
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const hook = sharedState.beforeStatement;
      if (hook && hook.pattern.test(query)) {
        sharedState.beforeStatement = null;
        await hook.run();
      }
      if (sharedState.failOnce && sharedState.failOnce.test(query)) {
        sharedState.failOnce = null;
        throw new Error('injected failure');
      }
      return runQueryDispatch(sharedState.connection, query, params);
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
      await sharedState.connection.query('SELECT RELEASE_ALL_LOCKS()');
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
      await sharedState.connection.query('SELECT RELEASE_ALL_LOCKS()');
    },
    // Takes the real MySQL lock so contention, and the lock being held across the writes, are observable.
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return (rows as { acquired: number }[])[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import { buildMeasurementScopeLockName } from '@/config/measurementscopelock';
import { buildMeasurementOverrideEligibleSql } from '@/config/measurementstatefilters';
import { VALIDATION_SCOPE_ACTION_CODES, VALIDATION_SCOPE_SUMMARY_KIND } from '@/config/validationscopeactions';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_LOCKED = 423;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const LOCK_ACQUIRED = 1;
const LOCK_NOT_ACQUIRED = 0;

const ERROR_SOURCE_VALIDATION = 'validation';
const ERROR_SOURCE_INGESTION = 'ingestion';
const VALIDATION_CODE_INVALID_ATTRIBUTE = '14';
const VALIDATION_CODE_INGESTION_STAGE = '20';
const INGESTION_CODE_INVALID_SPECIES = 'INVALID_SPECIES';
const HISTORY_RESOLVED_AT = '2024-01-02 03:04:05';
const MEASUREMENT_DATE = '2024-06-01';
const SIBLING_CENSUS_NUMBER = 2;
const STEM_BASE_GUID = 465_000;
const STEM_TAG = '1';
const CHANGELOG_TABLE = 'coremeasurements';
const UPLOAD_SESSION_ID = 'scope-actions-upload';
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const ACTIVE_UPLOAD_STATE = 'uploading';

/** IsValidated + 0 of the BIT column; null is pending. */
const PASSED = 1;
const FAILED = 0;

const ROUTES = [
  { name: 'override', path: '/api/validations/override', load: () => import('@/app/api/validations/override/route') },
  { name: 'reset', path: '/api/validations/reset', load: () => import('@/app/api/validations/reset/route') }
] as const;

type RouteName = (typeof ROUTES)[number]['name'];

interface SeededRows {
  /** linked, failed, one unresolved validation error */
  validationFailed: number;
  /** linked, pending, no log */
  pending: number;
  /** linked, passed, carrying a resolved validation error from an earlier run */
  passedWithHistory: number;
  /** StemGUID NULL ingestion failure with a validation and an ingestion error */
  ingestionFailure: number;
  /** linked, failed, with an unresolved ingestion-source error and a validation error */
  ingestionLogged: number;
  /** linked, failed, only an ingestion-stage validation code (20) */
  ingestionStageCode: number;
  /** linked, inactive, failed, one validation error */
  inactive: number;
  /** a failed row of the plot's other census */
  siblingCensusFailed: number;
}

interface DatabaseSnapshot {
  measurements: Array<{ id: number; isValidated: number | null }>;
  logs: Array<{ id: number; errorID: number; isResolved: number; resolvedAt: string | null }>;
}

describe('POST /api/validations/override and /reset against real MySQL (issue #465)', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let plotCensusNumber: number;
  let siblingCensusID: number;
  let quadratID: number;
  let speciesID: number;
  let rows: SeededRows;

  async function errorID(source: string, code: string): Promise<number> {
    const [found] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [source, code]);
    return Number(found[0].ErrorID);
  }

  async function logError(measurementID: number, source: string, code: string): Promise<void> {
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)', [
      measurementID,
      await errorID(source, code)
    ]);
  }

  async function seedLinkedRow(targetCensusID: number, offset: number, isValidated: boolean | null, isActive = true): Promise<number> {
    const stemGUID = STEM_BASE_GUID + offset;
    const [tree] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID) VALUES (?, ?, ?)', [
      `SCOPE-${offset}`,
      speciesID,
      targetCensusID
    ]);
    await connection.query('INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      stemGUID,
      tree.insertId,
      quadratID,
      targetCensusID,
      STEM_TAG,
      offset,
      offset
    ]);
    const [measurement] = await connection.query<ResultSetHeader>(
      'INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [targetCensusID, stemGUID, isValidated, MEASUREMENT_DATE, 10 + offset, 1.3, isActive ? 1 : 0]
    );
    return measurement.insertId;
  }

  async function clearSeededData(): Promise<void> {
    const censusIDs = [censusID, siblingCensusID];
    await connection.query(
      'DELETE mel FROM measurement_error_log mel JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID WHERE cm.CensusID IN (?, ?)',
      censusIDs
    );
    await connection.query('DELETE FROM coremeasurements WHERE CensusID IN (?, ?)', censusIDs);
    await connection.query('DELETE FROM stems WHERE CensusID IN (?, ?)', censusIDs);
    await connection.query('DELETE FROM trees WHERE CensusID IN (?, ?)', censusIDs);
    await connection.query('DELETE FROM unifiedchangelog WHERE CensusID IN (?, ?)', censusIDs);
    await connection.query('DELETE FROM validation_runs WHERE CensusID IN (?, ?)', censusIDs);
    await connection.query('DELETE FROM upload_sessions WHERE census_id IN (?, ?)', censusIDs);
  }

  async function seedMixedCensus(): Promise<SeededRows> {
    await clearSeededData();
    const validationFailed = await seedLinkedRow(censusID, 1, false);
    const pending = await seedLinkedRow(censusID, 2, null);
    const passedWithHistory = await seedLinkedRow(censusID, 3, true);
    const ingestionLogged = await seedLinkedRow(censusID, 4, false);
    const ingestionStageCode = await seedLinkedRow(censusID, 5, false);
    const inactive = await seedLinkedRow(censusID, 6, false, false);
    const siblingCensusFailed = await seedLinkedRow(siblingCensusID, 7, false);
    const [failedInsert] = await connection.query<ResultSetHeader>(
      'INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, IsActive, RawTreeTag) VALUES (?, NULL, FALSE, ?, 1, ?)',
      [censusID, MEASUREMENT_DATE, 'SCOPE-FAILED']
    );
    const ingestionFailure = failedInsert.insertId;

    await logError(validationFailed, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt) VALUES (?, ?, 1, ?)', [
      passedWithHistory,
      await errorID(ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE),
      HISTORY_RESOLVED_AT
    ]);
    await logError(ingestionFailure, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
    await logError(ingestionFailure, ERROR_SOURCE_INGESTION, INGESTION_CODE_INVALID_SPECIES);
    await logError(ingestionLogged, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
    await logError(ingestionLogged, ERROR_SOURCE_INGESTION, INGESTION_CODE_INVALID_SPECIES);
    await logError(ingestionStageCode, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INGESTION_STAGE);
    await logError(inactive, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
    await logError(siblingCensusFailed, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
    return { validationFailed, pending, passedWithHistory, ingestionFailure, ingestionLogged, ingestionStageCode, inactive, siblingCensusFailed };
  }

  async function snapshot(): Promise<DatabaseSnapshot> {
    const [measurements] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID AS id, IsValidated + 0 AS isValidated FROM coremeasurements WHERE CensusID IN (?, ?) ORDER BY CoreMeasurementID',
      [censusID, siblingCensusID]
    );
    const [logs] = await connection.query<RowDataPacket[]>(
      `SELECT mel.MeasurementID AS id, mel.ErrorID AS errorID, mel.IsResolved + 0 AS isResolved,
              CASE WHEN mel.ResolvedAt = ? THEN 'history' WHEN mel.ResolvedAt IS NULL THEN NULL ELSE 'resolved-now' END AS resolvedAt
         FROM measurement_error_log mel JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
        WHERE cm.CensusID IN (?, ?) ORDER BY mel.MeasurementID, mel.ErrorID`,
      [HISTORY_RESOLVED_AT, censusID, siblingCensusID]
    );
    return {
      measurements: measurements.map(row => ({ id: Number(row.id), isValidated: row.isValidated === null ? null : Number(row.isValidated) })),
      logs: logs.map(row => ({ id: Number(row.id), errorID: Number(row.errorID), isResolved: Number(row.isResolved), resolvedAt: row.resolvedAt }))
    };
  }

  function isValidatedOf(state: DatabaseSnapshot, id: number): number | null | undefined {
    return state.measurements.find(row => row.id === id)?.isValidated;
  }

  function logsOf(state: DatabaseSnapshot, id: number) {
    return state.logs.filter(row => row.id === id).map(({ errorID, isResolved, resolvedAt }) => ({ errorID, isResolved, resolvedAt }));
  }

  async function changelogRows(): Promise<RowDataPacket[]> {
    const [changelog] = await connection.query<RowDataPacket[]>('SELECT * FROM unifiedchangelog WHERE CensusID IN (?, ?) ORDER BY ChangeID', [
      censusID,
      siblingCensusID
    ]);
    return changelog;
  }

  /**
   * The SQL the browser sent to /api/query before #465, copied from 1df7035c
   * (config/measurementstatefilters.ts buildValidationOverrideStatements and
   * components/datagrids/measurementscommonsutils.ts createResetValidation*Query). The eligibility predicate is the
   * shared one the new route also uses; what is pinned here is each statement's scope and shape.
   */
  function legacyStatements(action: RouteName): Array<{ query: string; params: unknown[] }> {
    if (action === 'override') {
      const eligible = buildMeasurementOverrideEligibleSql(schema, 'cm');
      const scope = `c.CensusID IN (SELECT CensusID FROM ${schema}.census WHERE PlotID = ? AND PlotCensusNumber = ?)
        AND c.PlotID = ?`;
      const params = [plotID, plotCensusNumber, plotID];
      return [
        {
          query: `DELETE mel FROM ${schema}.measurement_error_log AS mel
            JOIN ${schema}.measurement_errors AS me ON me.ErrorID = mel.ErrorID
            JOIN ${schema}.coremeasurements AS cm ON mel.MeasurementID = cm.CoreMeasurementID
            JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
            WHERE ${scope} AND me.ErrorSource = 'validation' AND ${eligible}`,
          params
        },
        {
          query: `UPDATE ${schema}.coremeasurements AS cm JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
            SET cm.IsValidated = TRUE WHERE ${scope} AND ${eligible}`,
          params
        }
      ];
    }
    return [
      {
        query: `UPDATE ${schema}.measurement_error_log mel
            JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
            JOIN ${schema}.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
            JOIN ${schema}.census c ON c.CensusID = cm.CensusID
            SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
            WHERE c.CensusID = ? AND c.PlotID = ? AND me.ErrorSource = 'validation' AND mel.IsResolved = FALSE`,
        params: [censusID, plotID]
      },
      {
        query: `UPDATE ${schema}.coremeasurements cm JOIN ${schema}.census c ON c.CensusID = cm.CensusID
            SET cm.IsValidated = NULL WHERE c.CensusID = ? AND c.PlotID = ?`,
        params: [censusID, plotID]
      }
    ];
  }

  async function stateAfterLegacySql(action: RouteName): Promise<DatabaseSnapshot> {
    await connection.beginTransaction();
    try {
      for (const statement of legacyStatements(action)) await connection.query(statement.query, statement.params);
      return await snapshot();
    } finally {
      await connection.rollback();
    }
  }

  async function post(action: RouteName, body: Record<string, unknown> = { schema, plotID, censusID }) {
    const route = ROUTES.find(candidate => candidate.name === action)!;
    const { POST } = await route.load();
    return POST(
      new NextRequest(`http://localhost${route.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      { params: Promise.resolve({}) }
    );
  }

  async function openHolderConnection(): Promise<Connection> {
    return mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = setup.config.database;
    plotID = setup.testData.plots[0].plotID;
    censusID = setup.testData.census[0].censusID;
    plotCensusNumber = setup.testData.census[0].plotCensusNumber;
    sharedState.connection = connection;
    vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', AUTH_POLL_URL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ userStatus: 'global', allowedSites: [] }), { status: HTTP_OK }))
    );

    const [quadrats] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    quadratID = Number(quadrats[0].QuadratID);
    const [species] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    speciesID = Number(species[0].SpeciesID);
    const [sibling] = await connection.query<ResultSetHeader>(
      "INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate) VALUES (?, ?, '2025-01-01', '2025-12-31')",
      [plotID, SIBLING_CENSUS_NUMBER]
    );
    siblingCensusID = sibling.insertId;
  }, 90000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.failOnce = null;
    sharedState.beforeStatement = null;
    rows = await seedMixedCensus();
  });

  describe('override', () => {
    it('changes exactly the rows the pre-#465 browser SQL changed, and reports the counts', async () => {
      const expected = await stateAfterLegacySql('override');
      const response = await post('override');
      const body = await response.json();
      const actual = await snapshot();
      console.log('[scope override equivalence]', response.status, JSON.stringify(body), JSON.stringify({ rows, expected, actual }));
      expect(response.status).toBe(HTTP_OK);
      expect(actual, 'same IsValidated and same surviving log entries as the old SQL').toEqual(expected);
      expect(body).toEqual({ overriddenMeasurementCount: 4, removedValidationErrorCount: 3 });
    });

    it('overrides linked failed and pending rows, never ingestion failures, rows with ingestion errors, passed rows or the sibling census', async () => {
      const before = await snapshot();
      await post('override');
      const after = await snapshot();
      console.log('[scope override rows]', JSON.stringify({ rows, before, after }));
      expect(isValidatedOf(after, rows.validationFailed)).toBe(PASSED);
      expect(logsOf(after, rows.validationFailed), 'its validation error is removed').toEqual([]);
      expect(isValidatedOf(after, rows.pending)).toBe(PASSED);
      expect(isValidatedOf(after, rows.ingestionFailure), 'StemGUID NULL is never overridden').toBe(FAILED);
      expect(logsOf(after, rows.ingestionFailure), 'both of its errors stay').toEqual(logsOf(before, rows.ingestionFailure));
      expect(isValidatedOf(after, rows.ingestionLogged), 'an unresolved ingestion error blocks the override').toBe(FAILED);
      expect(logsOf(after, rows.ingestionLogged)).toEqual(logsOf(before, rows.ingestionLogged));
      expect(isValidatedOf(after, rows.passedWithHistory)).toBe(PASSED);
      expect(logsOf(after, rows.passedWithHistory), 'resolved history is kept').toEqual([
        { errorID: await errorID(ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE), isResolved: 1, resolvedAt: 'history' }
      ]);
      expect(isValidatedOf(after, rows.siblingCensusFailed), 'the other census is untouched').toBe(FAILED);
      expect(logsOf(after, rows.siblingCensusFailed)).toEqual(logsOf(before, rows.siblingCensusFailed));
    });

    it('keeps the old scope for an ingestion-stage code 20 row and an inactive row: both are overridden, as before', async () => {
      await post('override');
      const after = await snapshot();
      console.log('[scope override stage/inactive]', JSON.stringify({ stage: logsOf(after, rows.ingestionStageCode), inactive: logsOf(after, rows.inactive) }));
      expect(isValidatedOf(after, rows.ingestionStageCode)).toBe(PASSED);
      expect(logsOf(after, rows.ingestionStageCode)).toEqual([]);
      expect(isValidatedOf(after, rows.inactive)).toBe(PASSED);
      expect(logsOf(after, rows.inactive)).toEqual([]);
    });

    it('records one summary row naming the user, the previous split and the removed error codes', async () => {
      await post('override');
      const changelog = await changelogRows();
      console.log('[scope override changelog]', JSON.stringify(changelog));
      expect(changelog, 'one row for the census, none per measurement').toHaveLength(1);
      const [row] = changelog;
      expect({
        TableName: row.TableName,
        RecordID: row.RecordID,
        Operation: row.Operation,
        ChangedBy: row.ChangedBy,
        PlotID: row.PlotID,
        CensusID: row.CensusID
      }).toEqual({
        TableName: CHANGELOG_TABLE,
        RecordID: `census:${censusID}`,
        Operation: 'UPDATE',
        ChangedBy: AUTH_USER_EMAIL,
        PlotID: plotID,
        CensusID: censusID
      });
      expect(row.OldRowState).toEqual({
        summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.override,
        MeasurementCount: 4,
        IsValidated: { failed: 3, pending: 1 },
        ValidationErrors: [
          { ErrorCode: VALIDATION_CODE_INVALID_ATTRIBUTE, Count: 2 },
          { ErrorCode: VALIDATION_CODE_INGESTION_STAGE, Count: 1 }
        ]
      });
      expect(row.NewRowState).toEqual({
        summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.override,
        MeasurementCount: 4,
        IsValidated: { passed: 4 },
        ValidationErrors: []
      });
    });

    it('rolls the log DELETE back when the IsValidated UPDATE fails after it, and records nothing', async () => {
      const before = await snapshot();
      sharedState.failOnce = /SET cm\.IsValidated = TRUE/;
      const response = await post('override');
      const after = await snapshot();
      console.log('[scope override rollback]', response.status, JSON.stringify({ before, after }));
      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(after, 'the deleted validation errors are back').toEqual(before);
      expect(await changelogRows()).toEqual([]);
    });
  });

  describe('reset', () => {
    it('changes exactly the rows the pre-#465 browser SQL changed, and reports the counts', async () => {
      const expected = await stateAfterLegacySql('reset');
      const response = await post('reset');
      const body = await response.json();
      const actual = await snapshot();
      console.log('[scope reset equivalence]', response.status, JSON.stringify(body), JSON.stringify({ rows, expected, actual }));
      expect(response.status).toBe(HTTP_OK);
      expect(actual, 'same IsValidated and same log states as the old SQL').toEqual(expected);
      expect(body).toEqual({ resetMeasurementCount: 7, resolvedValidationErrorCount: 5 });
    });

    it('sends every row of the census to pending, resolves (keeps) its validation errors, leaves ingestion errors and the sibling census alone', async () => {
      const before = await snapshot();
      await post('reset');
      const after = await snapshot();
      const validationErrorID = await errorID(ERROR_SOURCE_VALIDATION, VALIDATION_CODE_INVALID_ATTRIBUTE);
      const ingestionErrorID = await errorID(ERROR_SOURCE_INGESTION, INGESTION_CODE_INVALID_SPECIES);
      console.log('[scope reset rows]', JSON.stringify({ rows, before, after }));
      for (const id of [
        rows.validationFailed,
        rows.pending,
        rows.passedWithHistory,
        rows.ingestionFailure,
        rows.ingestionLogged,
        rows.ingestionStageCode,
        rows.inactive
      ]) {
        expect(isValidatedOf(after, id), `row ${id} is pending`).toBeNull();
      }
      expect(logsOf(after, rows.validationFailed), 'resolved, not deleted').toEqual([
        { errorID: validationErrorID, isResolved: 1, resolvedAt: 'resolved-now' }
      ]);
      expect(logsOf(after, rows.ingestionLogged)).toEqual(
        [
          { errorID: validationErrorID, isResolved: 1, resolvedAt: 'resolved-now' },
          { errorID: ingestionErrorID, isResolved: 0, resolvedAt: null }
        ].sort((left, right) => left.errorID - right.errorID)
      );
      expect(logsOf(after, rows.passedWithHistory), 'an already-resolved entry keeps its original ResolvedAt').toEqual(logsOf(before, rows.passedWithHistory));
      expect(isValidatedOf(after, rows.siblingCensusFailed)).toBe(FAILED);
      expect(logsOf(after, rows.siblingCensusFailed)).toEqual(logsOf(before, rows.siblingCensusFailed));
    });

    it('records one summary row with the previous split and the resolved error count', async () => {
      await post('reset');
      const changelog = await changelogRows();
      console.log('[scope reset changelog]', JSON.stringify(changelog));
      expect(changelog).toHaveLength(1);
      const [row] = changelog;
      expect({ RecordID: row.RecordID, ChangedBy: row.ChangedBy, CensusID: row.CensusID }).toEqual({
        RecordID: `census:${censusID}`,
        ChangedBy: AUTH_USER_EMAIL,
        CensusID: censusID
      });
      expect(row.OldRowState).toEqual({
        summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.reset,
        MeasurementCount: 7,
        IsValidated: { passed: 1, failed: 5, pending: 1 },
        UnresolvedValidationErrorCount: 5
      });
      expect(row.NewRowState).toEqual({
        summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.reset,
        MeasurementCount: 7,
        IsValidated: { pending: 7 },
        UnresolvedValidationErrorCount: 0
      });
    });

    it('rolls the resolve back when the IsValidated UPDATE fails after it, and records nothing', async () => {
      const before = await snapshot();
      sharedState.failOnce = /SET cm\.IsValidated = NULL/;
      const response = await post('reset');
      const after = await snapshot();
      console.log('[scope reset rollback]', response.status, JSON.stringify({ before, after }));
      expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
      expect(after).toEqual(before);
      expect(await changelogRows()).toEqual([]);
    });
  });

  describe.each(ROUTES.map(route => route.name))('%s: busy census and authorization', action => {
    it('refuses a census with a running validation run with 423 and writes nothing', async () => {
      await connection.query("INSERT INTO validation_runs (PlotID, CensusID, TotalSteps, Status, StartedAt) VALUES (?, ?, 7, 'running', UTC_TIMESTAMP())", [
        plotID,
        censusID
      ]);
      const before = await snapshot();
      const response = await post(action);
      const body = await response.json();
      const after = await snapshot();
      console.log(`[scope ${action} busy run]`, response.status, JSON.stringify(body));
      expect(response.status).toBe(HTTP_LOCKED);
      expect(body.code).toBe(VALIDATION_SCOPE_ACTION_CODES.scopeBusy);
      expect(after).toEqual(before);
      expect(await changelogRows()).toEqual([]);
    });

    it('refuses a census with an active upload session with 423 and writes nothing', async () => {
      await connection.query('INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state) VALUES (?, ?, ?, ?, ?, ?)', [
        UPLOAD_SESSION_ID,
        schema,
        plotID,
        censusID,
        AUTH_USER_EMAIL,
        ACTIVE_UPLOAD_STATE
      ]);
      const before = await snapshot();
      const response = await post(action);
      const after = await snapshot();
      console.log(`[scope ${action} busy upload]`, response.status);
      expect(response.status).toBe(HTTP_LOCKED);
      expect(after).toEqual(before);
    });

    it('is not blocked by a validation run in the sibling census', async () => {
      await connection.query("INSERT INTO validation_runs (PlotID, CensusID, TotalSteps, Status, StartedAt) VALUES (?, ?, 7, 'running', UTC_TIMESTAMP())", [
        plotID,
        siblingCensusID
      ]);
      const response = await post(action);
      expect(response.status).toBe(HTTP_OK);
    });

    it('answers 423 and writes nothing while another session holds the measurement-scope lock, and succeeds once it is released', async () => {
      const lockName = buildMeasurementScopeLockName(schema, plotID, censusID);
      const holder = await openHolderConnection();
      try {
        const [held] = await holder.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
        expect(Number(held[0].acquired)).toBe(LOCK_ACQUIRED);
        const before = await snapshot();
        const response = await post(action);
        const after = await snapshot();
        console.log(`[scope ${action} lock held]`, response.status);
        expect(response.status).toBe(HTTP_LOCKED);
        expect(after).toEqual(before);
      } finally {
        await holder.query('SELECT RELEASE_LOCK(?)', [lockName]);
        await holder.end();
      }
      expect((await post(action)).status).toBe(HTTP_OK);
    });

    it('holds the scope lock while it writes, so an upload or validation run cannot start between the busy check and the write', async () => {
      const lockName = buildMeasurementScopeLockName(schema, plotID, censusID);
      const contender = await openHolderConnection();
      let contenderAcquired: number | null = null;
      sharedState.beforeStatement = {
        pattern: /UPDATE `[^`]+`\.coremeasurements/,
        run: async () => {
          const [attempt] = await contender.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
          contenderAcquired = Number(attempt[0].acquired);
        }
      };
      try {
        const response = await post(action);
        console.log(`[scope ${action} lock across write]`, response.status, contenderAcquired);
        expect(response.status).toBe(HTTP_OK);
        expect(contenderAcquired, 'a second session cannot take the lock during the write').toBe(LOCK_NOT_ACQUIRED);
      } finally {
        await contender.query('SELECT RELEASE_LOCK(?)', [lockName]);
        await contender.end();
      }
    });

    it('refuses a census of another plot with 403 and writes nothing', async () => {
      const before = await snapshot();
      const response = await post(action, { schema, plotID: plotID + 1000, censusID });
      expect(response.status).toBe(HTTP_FORBIDDEN);
      expect(await snapshot()).toEqual(before);
    });

    it('denies a non-admin whose sites exclude the schema with 403 and runs no SQL', async () => {
      const { auth } = await import('@/auth');
      vi.mocked(auth).mockResolvedValueOnce({
        user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
      } as never);
      sharedState.executeQueryCalls = 0;
      const response = await post(action);
      console.log(`[scope ${action} out of scope]`, response.status, sharedState.executeQueryCalls);
      expect(response.status).toBe(HTTP_FORBIDDEN);
      expect(sharedState.executeQueryCalls).toBe(0);
    });

    it('denies a site member who is not an admin with 403 ADMIN_REQUIRED and writes nothing', async () => {
      const { auth } = await import('@/auth');
      const memberSession = { user: { email: 'lead@forestgeo.test', userStatus: 'lead technician', sites: [{ schemaName: schema }] } } as never;
      vi.mocked(auth).mockResolvedValueOnce(memberSession).mockResolvedValueOnce(memberSession);
      const before = await snapshot();
      const response = await post(action);
      const body = await response.json();
      console.log(`[scope ${action} non-admin]`, response.status, JSON.stringify(body));
      expect(response.status).toBe(HTTP_FORBIDDEN);
      expect(body.code).toBe(VALIDATION_SCOPE_ACTION_CODES.adminRequired);
      expect(await snapshot()).toEqual(before);
    });

    it('rejects a malformed body with 400 and writes nothing', async () => {
      const before = await snapshot();
      const response = await post(action, { schema, plotID, censusID: 'all' });
      expect(response.status).toBe(HTTP_BAD_REQUEST);
      expect(await snapshot()).toEqual(before);
    });
  });
});
