/**
 * Bounded window walks for the unresolved-row deletes (#562) — Integration Tests
 *
 * Every caller of deleteCoreMeasurementsInBoundedChunksWithAudit (C1 the failed-first-census recovery, C2/C3 the
 * setup cleanups, C4 the batch-family cleanup) reads its scope once without locks, deletes in primary-key windows,
 * and ends on a locking confirmation. These tests run the real ConnectionManager (one pooled connection per
 * transaction) against local MySQL, with test-side barriers around its executeQuery.
 *   I2  one read + one confirmation per walk, every candidate locked exactly once, exact audits, nothing else touched
 *   I3  a slice whose rows stopped matching, or that a peer deleted, between the read and its window
 *   I7  (Task 9) a matching row inserted after the read, committed or still open
 *   I9  (Task 9) what the recovery and C3 windows lock, and what they leave alone
 *   I14 (Task 10) two overlapping C4 walks that deadlock
 *
 * Prerequisites: docker compose up -d mysql. Run only through the relay's integration lock script.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import {
  cleanupTestMeasurements,
  createAdditionalCensus,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import {
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  deleteCoreMeasurementsInBoundedChunksWithAudit,
  lockAuditAndDeleteCoreMeasurementWindow,
  sliceIntoDeleteWindows,
  type CoreMeasurementDeleteScope
} from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS } from '@/lib/uploads/stage-measurements';
import {
  crossFileUnresolvedFailureScope,
  ingestBatch,
  IngestBatchAbortedError,
  recoverFailedInitialCensusInBoundedTransactions,
  sameFileUnresolvedFailureScope,
  SETUP_PHASE_TIMEOUT_MS
} from '@/lib/uploads/ingest-batch';
import { batchFamilyUnresolvedScope, deleteUnresolvedRowsForBatchFamily } from '@/lib/uploads/record-invalid-rows';
import { WALK_SCOPE_MARKER, WINDOW_WALK_STATEMENT } from '../setup/core-measurement-window-statements';
import {
  createStatementHarness,
  matching,
  runBarrierScenario,
  waitForLockWait,
  withinDeadline,
  type RecordedStatement,
  type StatementHarness
} from '../setup/core-measurement-window-harness';
import {
  countOf,
  deleteAuditCounts,
  fingerprintMeasurementsOutside,
  openSideConnection,
  seedUnresolvedMeasurements,
  seedUploadMetric,
  stageIncomingRows,
  stageRowsMirroringMeasurements,
  UPLOAD_STATUS
} from '../setup/unresolved-measurement-fixtures';

vi.mock('@/ailogger', () => ({
  default: {
    info: (message: string, context?: unknown) => console.log(`[ailogger.info] ${message} ${context ? JSON.stringify(context) : ''}`),
    warn: (message: string, context?: unknown) => console.log(`[ailogger.warn] ${message} ${context ? JSON.stringify(context) : ''}`),
    error: (message: string) => console.log(`[ailogger.error] ${message}`),
    debug: () => undefined
  }
}));

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
for (const host of [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost']) {
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite writes and deletes measurement rows.`);
}

const WINDOW = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const ROWS_PAST_TWO_WINDOWS = 137;
const CANDIDATE_ROWS = 2 * WINDOW + ROWS_PAST_TWO_WINDOWS;
const NON_CANDIDATE_ROWS = 25;
const INCOMING_STAGED_ROWS = 3;
const INCOMING_FILE = 'walk-incoming.csv';
const INCOMING_BATCH = 'walk-incoming-batch';
const STALE_FAMILY_BATCH = 'walk-stale-family';
/** ux_cm_uploadbatch_rowindex is unique on (UploadBatchID, SourceRowIndex) across files and censuses, so every seeded group needs its own batch id. */
const CONTROL_CENSUS_BATCH = 'walk-control-census';
const RENAMED_FILE = 'walk-renamed.csv';
const RENAMED_BATCH = 'walk-renamed-batch';
const FAILED_FIRST_LOAD_FILE = 'walk-failed-first-load.csv';
const FAILED_FIRST_LOAD_BATCH = 'walk-failed__sub001';
const OTHER_FILE = 'walk-other.csv';
const MOVED_FILE = 'walk-moved.csv';
const COMPLETED_SUB_BATCH = `${INCOMING_BATCH}__sub003`;
const CHANGED_BY = 'window-walk-integration-test';
const PEER_CHANGED_BY = 'window-walk-peer';
const TARGET_CENSUS = { plotCensusNumber: 93, startDate: '2022-01-01', endDate: '2022-12-31' };
const CONTROL_CENSUS = { plotCensusNumber: 92, startDate: '2021-01-01', endDate: '2021-12-31' };
const WALK_TEST_TIMEOUT_MS = 180_000;
const SIDE_LOCK_WAIT_SECONDS = 30;
const SINGLE_TRANSACTION = 1;

describe('bounded window walks (#562)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let targetCensusID: number;
  let controlCensusID: number;
  let realManager: ConnectionManager;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    plotID = testData.plots[0].plotID;
    targetCensusID = (await createAdditionalCensus(connection, testData, TARGET_CENSUS)).censusID;
    controlCensusID = (await createAdditionalCensus(connection, testData, CONTROL_CENSUS)).censusID;
    const { default: RealConnectionManager } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
    realManager = RealConnectionManager.getInstance();
    console.log(`[setup] schema=${schema} plot=${plotID} target=${targetCensusID} control=${controlCensusID}`);
  }, 120_000);

  afterAll(async () => {
    try {
      await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog'] });
  });

  /** Non-candidates every I2/I3 case seeds: a control census and another file in the target census. */
  async function seedNonCandidates(): Promise<void> {
    await seedUnresolvedMeasurements(connection, {
      censusID: controlCensusID,
      fileID: INCOMING_FILE,
      batchID: CONTROL_CENSUS_BATCH,
      count: NON_CANDIDATE_ROWS,
      tagPrefix: 'CTRL'
    });
    await seedUnresolvedMeasurements(connection, {
      censusID: targetCensusID,
      fileID: OTHER_FILE,
      batchID: 'walk-other-batch',
      count: NON_CANDIDATE_ROWS,
      tagPrefix: 'OTH'
    });
  }

  function lockedIDsOf(statement: RecordedStatement, whereParamCount: number): number[] {
    return statement.params.slice(whereParamCount).map(Number);
  }

  /** ingestBatch's between-sub-batch cancellation probe, true once the setup transaction (the one that discovered the family FOR UPDATE) has committed. */
  function abortAfterSetupCommits(harness: StatementHarness): () => boolean {
    return () => harness.transactionsRunning(matching(WINDOW_WALK_STATEMENT.SETUP_FAMILY_DISCOVERY)).some(id => harness.commitOrder.includes(id));
  }

  interface WalkCase {
    label: 'C1' | 'C2' | 'C3' | 'C4';
    whereParamCount: number;
    seed(): Promise<number[]>;
    run(harness: StatementHarness): Promise<unknown>;
    /** C1 runs one transaction per slice; the others run in one transaction. */
    transactionsPerSlice: boolean;
  }

  const WALK_CASES: WalkCase[] = [
    {
      label: 'C1',
      whereParamCount: 1,
      transactionsPerSlice: true,
      seed: async () => {
        const ids = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: FAILED_FIRST_LOAD_FILE,
          batchID: FAILED_FIRST_LOAD_BATCH,
          count: CANDIDATE_ROWS,
          tagPrefix: 'C1R'
        });
        await seedUploadMetric(connection, {
          schema,
          plotID,
          censusID: targetCensusID,
          fileID: FAILED_FIRST_LOAD_FILE,
          batchID: FAILED_FIRST_LOAD_BATCH,
          status: UPLOAD_STATUS.FAILED
        });
        await stageIncomingRows(connection, {
          fileID: INCOMING_FILE,
          batchID: INCOMING_BATCH,
          plotID,
          censusID: targetCensusID,
          count: INCOMING_STAGED_ROWS,
          tagPrefix: 'IN'
        });
        await seedUnresolvedMeasurements(connection, {
          censusID: controlCensusID,
          fileID: INCOMING_FILE,
          batchID: CONTROL_CENSUS_BATCH,
          count: NON_CANDIDATE_ROWS,
          tagPrefix: 'CTRL'
        });
        return ids;
      },
      run: async () => {
        const result = await recoverFailedInitialCensusInBoundedTransactions(realManager, {
          schema,
          fileID: INCOMING_FILE,
          batchID: INCOMING_BATCH,
          plotID,
          censusID: targetCensusID,
          changedBy: CHANGED_BY
        });
        expect(result.outcome).toBe('recovered');
        return result;
      }
    },
    {
      label: 'C2',
      whereParamCount: 4,
      transactionsPerSlice: false,
      seed: async () => {
        const ids = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: STALE_FAMILY_BATCH,
          count: CANDIDATE_ROWS,
          tagPrefix: 'C2R'
        });
        await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: INCOMING_BATCH,
          count: NON_CANDIDATE_ROWS,
          tagPrefix: 'FAM'
        });
        await seedNonCandidates();
        await seedUploadMetric(connection, {
          schema,
          plotID,
          censusID: targetCensusID,
          fileID: OTHER_FILE,
          batchID: 'walk-completed',
          status: UPLOAD_STATUS.COMPLETED
        });
        await stageIncomingRows(connection, {
          fileID: INCOMING_FILE,
          batchID: INCOMING_BATCH,
          plotID,
          censusID: targetCensusID,
          count: INCOMING_STAGED_ROWS,
          tagPrefix: 'IN'
        });
        return ids;
      },
      run: harness =>
        expect(
          ingestBatch(realManager, {
            schema,
            fileID: INCOMING_FILE,
            batchID: INCOMING_BATCH,
            expectedScope: { plotID, censusID: targetCensusID },
            changedBy: CHANGED_BY,
            isAborted: abortAfterSetupCommits(harness)
          })
        ).rejects.toBeInstanceOf(IngestBatchAbortedError)
    },
    {
      label: 'C3',
      whereParamCount: 7,
      transactionsPerSlice: false,
      seed: async () => {
        const ids = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: RENAMED_FILE,
          batchID: RENAMED_BATCH,
          count: CANDIDATE_ROWS,
          tagPrefix: 'C3R'
        });
        await stageRowsMirroringMeasurements(connection, { fileID: INCOMING_FILE, batchID: INCOMING_BATCH, plotID, measurementIDs: ids });
        await seedNonCandidates();
        await seedUploadMetric(connection, {
          schema,
          plotID,
          censusID: targetCensusID,
          fileID: OTHER_FILE,
          batchID: 'walk-completed',
          status: UPLOAD_STATUS.COMPLETED
        });
        return ids;
      },
      run: harness =>
        expect(
          ingestBatch(realManager, {
            schema,
            fileID: INCOMING_FILE,
            batchID: INCOMING_BATCH,
            expectedScope: { plotID, censusID: targetCensusID },
            changedBy: CHANGED_BY,
            isAborted: abortAfterSetupCommits(harness)
          })
        ).rejects.toBeInstanceOf(IngestBatchAbortedError)
    },
    {
      label: 'C4',
      whereParamCount: 5,
      transactionsPerSlice: false,
      seed: async () => {
        const first = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: `${INCOMING_BATCH}__sub001`,
          count: WINDOW + ROWS_PAST_TWO_WINDOWS,
          tagPrefix: 'C4A'
        });
        const second = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: `${INCOMING_BATCH}__sub002`,
          count: WINDOW,
          tagPrefix: 'C4B'
        });
        await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: COMPLETED_SUB_BATCH,
          count: NON_CANDIDATE_ROWS,
          tagPrefix: 'DONE'
        });
        await seedNonCandidates();
        return [...first, ...second].sort((left, right) => left - right);
      },
      run: () =>
        deleteUnresolvedRowsForBatchFamily(
          realManager,
          schema,
          INCOMING_FILE,
          INCOMING_BATCH,
          targetCensusID,
          undefined,
          [COMPLETED_SUB_BATCH],
          CHANGED_BY,
          plotID
        )
    }
  ];

  it.each(WALK_CASES)(
    'I2 $label: one non-locking read and one confirmation, every candidate locked exactly once in ≤ W windows, exact audits, every non-candidate untouched (catches: per-window re-reads; double locking; scope drift)',
    async walkCase => {
      const candidateIDs = await walkCase.seed();
      expect(candidateIDs).toHaveLength(CANDIDATE_ROWS);
      const before = await fingerprintMeasurementsOutside(connection, candidateIDs);
      const harness = createStatementHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await withinDeadline(harness.track(Promise.resolve(walkCase.run(harness))), `${walkCase.label} walk`, harness.renderStatementLog);
      });
      const marker = WALK_SCOPE_MARKER[walkCase.label];
      const ofThisWalk = (pattern: RegExp) => harness.statements.filter(statement => pattern.test(statement.sql) && marker.test(statement.sql));
      const reads =
        walkCase.label === 'C1'
          ? harness.statements.filter(statement => WINDOW_WALK_STATEMENT.RECOVERY_SCOPE_READ.test(statement.sql))
          : ofThisWalk(WINDOW_WALK_STATEMENT.SCOPE_READ);
      const confirmations =
        walkCase.label === 'C1'
          ? harness.statements.filter(statement => WINDOW_WALK_STATEMENT.RECOVERY_FINAL_READ.test(statement.sql))
          : ofThisWalk(WINDOW_WALK_STATEMENT.CONFIRMATION);
      const locks = ofThisWalk(WINDOW_WALK_STATEMENT.WINDOW_LOCK);
      const lockedIDs = locks.flatMap(lock => lockedIDsOf(lock, walkCase.whereParamCount));
      const audits = await deleteAuditCounts(connection, targetCensusID);
      const after = await fingerprintMeasurementsOutside(connection, candidateIDs);
      const survivors = await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [candidateIDs]);
      console.log(
        `[I2 ${walkCase.label}] reads=${reads.length} confirmations=${confirmations.length} locks=${locks.length} sizes=${JSON.stringify(locks.map(lock => lockedIDsOf(lock, walkCase.whereParamCount).length))} ` +
          `lockTx=${JSON.stringify(locks.map(lock => lock.transactionID))} survivors=${survivors} audited=${audits.size} before=${JSON.stringify(before)} after=${JSON.stringify(after)}\n${harness.renderStatementLog()}`
      );

      expect(reads, 'exactly one read of the scope').toHaveLength(1);
      expect(confirmations, 'exactly one confirmation of the scope').toHaveLength(1);
      expect(locks.map(lock => lockedIDsOf(lock, walkCase.whereParamCount).length)).toEqual([WINDOW, WINDOW, ROWS_PAST_TWO_WINDOWS]);
      expect(
        [...lockedIDs].sort((left, right) => left - right),
        'every candidate in exactly one lock statement'
      ).toEqual(candidateIDs);
      const lockTransactions = new Set(locks.map(lock => lock.transactionID));
      expect(lockTransactions.size, 'C1 commits one transaction per slice; C2-C4 stay in one').toBe(
        walkCase.transactionsPerSlice ? sliceIntoDeleteWindows(candidateIDs).length : SINGLE_TRANSACTION
      );
      if (walkCase.label === 'C1') {
        expect(locks.at(-1)!.transactionID, 'the last slice is deleted in the final transaction').toBe(confirmations[0].transactionID);
      } else {
        expect(reads[0].transactionID, 'the read runs in the caller transaction').toBe(locks[0].transactionID);
      }
      expect(survivors, 'every candidate deleted').toBe(0);
      for (const id of candidateIDs) {
        const audit = audits.get(id);
        if (audit?.count !== 1) throw new Error(`[I2 ${walkCase.label}] candidate ${id} has ${audit?.count ?? 0} DELETE-audit rows, expected 1`);
        expect(audit.changedBy).toBe(CHANGED_BY);
      }
      expect(after, 'every non-candidate row byte-identical').toEqual(before);
    },
    WALK_TEST_TIMEOUT_MS
  );

  type StaleSliceCase = {
    label: 'C2' | 'C3' | 'C4';
    seed(): Promise<number[]>;
    scope(): CoreMeasurementDeleteScope;
    run(): Promise<number>;
    stopMatching(ids: number[]): Promise<void>;
  };

  const runScopeInOwnTransaction = (scope: CoreMeasurementDeleteScope) =>
    realManager.withTransaction(
      tx =>
        deleteCoreMeasurementsInBoundedChunksWithAudit(
          realManager,
          schema,
          scope.whereSQL,
          scope.whereParams,
          CHANGED_BY,
          plotID,
          targetCensusID,
          tx.id,
          scope.fromSQL,
          scope.lockedAliases
        ),
      { timeoutMs: SETUP_PHASE_TIMEOUT_MS }
    );

  const STALE_SLICE_CASES: StaleSliceCase[] = [
    {
      label: 'C2',
      seed: () =>
        seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: STALE_FAMILY_BATCH,
          count: CANDIDATE_ROWS,
          tagPrefix: 'S2R'
        }),
      scope: () => sameFileUnresolvedFailureScope(INCOMING_FILE, INCOMING_BATCH, targetCensusID),
      run: () => runScopeInOwnTransaction(sameFileUnresolvedFailureScope(INCOMING_FILE, INCOMING_BATCH, targetCensusID)),
      stopMatching: ids =>
        connection.query('UPDATE coremeasurements SET UploadFileID = ? WHERE CoreMeasurementID IN (?)', [MOVED_FILE, ids]).then(() => undefined)
    },
    {
      label: 'C3',
      seed: async () => {
        const ids = await seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: RENAMED_FILE,
          batchID: RENAMED_BATCH,
          count: CANDIDATE_ROWS,
          tagPrefix: 'S3R'
        });
        await stageRowsMirroringMeasurements(connection, { fileID: INCOMING_FILE, batchID: INCOMING_BATCH, plotID, measurementIDs: ids });
        return ids;
      },
      scope: () => crossFileUnresolvedFailureScope(INCOMING_FILE, INCOMING_BATCH, targetCensusID),
      run: () => runScopeInOwnTransaction(crossFileUnresolvedFailureScope(INCOMING_FILE, INCOMING_BATCH, targetCensusID)),
      stopMatching: ids => connection.query('UPDATE measurement_error_log SET IsResolved = TRUE WHERE MeasurementID IN (?)', [ids]).then(() => undefined)
    },
    {
      label: 'C4',
      seed: () =>
        seedUnresolvedMeasurements(connection, {
          censusID: targetCensusID,
          fileID: INCOMING_FILE,
          batchID: `${INCOMING_BATCH}__sub001`,
          count: CANDIDATE_ROWS,
          tagPrefix: 'S4R'
        }),
      scope: () => batchFamilyUnresolvedScope(INCOMING_FILE, INCOMING_BATCH, targetCensusID, []),
      run: () => deleteUnresolvedRowsForBatchFamily(realManager, schema, INCOMING_FILE, INCOMING_BATCH, targetCensusID, undefined, [], CHANGED_BY, plotID),
      stopMatching: ids =>
        connection.query('UPDATE coremeasurements SET UploadFileID = ? WHERE CoreMeasurementID IN (?)', [MOVED_FILE, ids]).then(() => undefined)
    }
  ];

  it.each(STALE_SLICE_CASES)(
    'I3 $label: rows of a slice that stopped matching, and a whole slice a peer deleted, between the read and their windows are skipped without error or audit (catches: a missing early return — EmptyInListError; auditing the read’s ids)',
    async staleCase => {
      const candidateIDs = await staleCase.seed();
      const [firstSlice, movedSlice, peerSlice] = sliceIntoDeleteWindows(candidateIDs);
      // Half of the second slice stops matching, so its lock statement returns a strict subset: a window that
      // audited or deleted the read's ids instead of the locked ones would touch the stopped half.
      const stoppedHalf = movedSlice.slice(0, Math.floor(movedSlice.length / 2));
      const stillMatchingHalf = movedSlice.slice(stoppedHalf.length);
      const harness = createStatementHarness(realManager);
      let walkResult: number | undefined;
      await runBarrierScenario(harness, async () => {
        const afterRead = harness.placeBarrier(matching(WINDOW_WALK_STATEMENT.SCOPE_READ), 1, 'after');
        const walk = harness.track(staleCase.run());
        await withinDeadline(afterRead.reached, `${staleCase.label} walk past its read`, harness.renderStatementLog);

        await staleCase.stopMatching(stoppedHalf);
        await realManager.withTransaction(
          tx => lockAuditAndDeleteCoreMeasurementWindow(realManager, schema, staleCase.scope(), peerSlice, PEER_CHANGED_BY, plotID, targetCensusID, tx.id),
          { timeoutMs: CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS }
        );
        afterRead.release();
        walkResult = await withinDeadline(walk, `${staleCase.label} walk to finish`, harness.renderStatementLog);
      });

      const audits = await deleteAuditCounts(connection, targetCensusID);
      const movedSurvivors = await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [stoppedHalf]);
      const peerSurvivors = await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)', [peerSlice]);
      console.log(
        `[I3 ${staleCase.label}] walkResult=${walkResult} movedSurvivors=${movedSurvivors} peerSurvivors=${peerSurvivors} audited=${audits.size}\n${harness.renderStatementLog()}`
      );

      expect(walkResult, 'the walk deletes the first slice and the still-matching half of the second').toBe(firstSlice.length + stillMatchingHalf.length);
      expect(movedSurvivors, 'the rows that stopped matching survive').toBe(stoppedHalf.length);
      expect(
        stoppedHalf.every(id => !audits.has(id)),
        'no DELETE-audit row for a row that was not deleted'
      ).toBe(true);
      for (const id of stillMatchingHalf) {
        expect(audits.get(id), `still-matching ${id}: deleted with exactly one audit row`).toEqual({ count: 1, changedBy: CHANGED_BY });
      }
      expect(peerSurvivors).toBe(0);
      for (const id of peerSlice) {
        expect(audits.get(id), `peer-deleted ${id}: exactly one audit row, the peer's`).toEqual({ count: 1, changedBy: PEER_CHANGED_BY });
      }
      for (const id of firstSlice) {
        expect(audits.get(id)).toEqual({ count: 1, changedBy: CHANGED_BY });
      }
    },
    WALK_TEST_TIMEOUT_MS
  );
});
