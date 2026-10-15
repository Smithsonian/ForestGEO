/** Real local-MySQL correctness checks for the scoped keyset setup splitter. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '../../lib/db/connectionmanager';
import { buildIngestionLockName, ingestBatch, IngestBatchAbortedError, type SetupDiagnostic } from '../../lib/uploads/ingest-batch';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let oldBatchSize: string | undefined;
let nextFileID = 0;
const knownFiles: string[] = [];

function assertLocalHost(): void {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING splitter integration test on non-local app host '${host}'`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host))
    throw new Error(`REFUSING splitter integration test on non-local test host '${DEFAULT_TEST_CONFIG.host}'`);
}

function newFamily(name: string): { fileID: string; batchID: string } {
  const fileID = `keyset_${name}_${process.pid}_${++nextFileID}.csv`;
  const batchID = `batch_${name}_${nextFileID}`;
  knownFiles.push(fileID);
  return { fileID, batchID };
}

async function insertRow(fileID: string, batchID: string, suffix: number): Promise<void> {
  await connection.query(
    `INSERT INTO temporarymeasurements
     (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
     VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, 10, 1.3, '2024-03-15')`,
    [
      fileID,
      batchID,
      testData.plots[0].plotID,
      testData.census[0].censusID,
      `KS${String(suffix).padStart(9, '0')}`,
      testData.species[0].SpeciesCode,
      testData.quadrats[0].QuadratName,
      suffix,
      suffix
    ]
  );
}

async function memberships(fileID: string): Promise<Array<{ rowID: string; BatchID: string }>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS rowID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY temporarymeasurements.id',
    [fileID]
  );
  return rows.map(row => ({ rowID: String(row.rowID), BatchID: String(row.BatchID) }));
}

async function runSetupOnly(fileID: string, batchID: string): Promise<SetupDiagnostic[]> {
  const diagnostics: SetupDiagnostic[] = [];
  let setupCommitted = false;
  try {
    await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID,
      batchID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
      isAborted: () => setupCommitted,
      onSetupProgress: diagnostic => {
        diagnostics.push(diagnostic);
        if (diagnostic.terminal && diagnostic.outcome === 'committed') setupCommitted = true;
      }
    });
    throw new Error('Setup-only test unexpectedly reached procedure completion');
  } catch (error) {
    if (!(error instanceof IngestBatchAbortedError) || !setupCommitted) throw error;
  }
  return diagnostics;
}

describe('ingestBatch scoped keyset splitter (real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHost();
    oldBatchSize = process.env.INGESTION_SUB_BATCH_ROWS;
    process.env.INGESTION_SUB_BATCH_ROWS = '4';
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 120_000);

  afterAll(async () => {
    if (connection) {
      for (const fileID of knownFiles) await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [fileID]);
      await teardownTestDatabase(connection, config);
    }
    if (oldBatchSize === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
    else process.env.INGESTION_SUB_BATCH_ROWS = oldBatchSize;
  }, 120_000);

  it('preserves exact ascending membership for boundary, partial, sparse/interleaved, and >2^53 IDs', async () => {
    const boundary = newFamily('boundary');
    for (let i = 1; i <= 4; i++) await insertRow(boundary.fileID, boundary.batchID, i);
    const boundaryBefore = await memberships(boundary.fileID);
    await runSetupOnly(boundary.fileID, boundary.batchID);
    expect(await memberships(boundary.fileID)).toEqual(boundaryBefore.map(row => ({ ...row, BatchID: boundary.batchID })));

    const sparse = newFamily('sparse_%\\family');
    await connection.query('ALTER TABLE temporarymeasurements AUTO_INCREMENT = 9007199254741000');
    const expected: Array<{ rowID: string; BatchID: string }> = [];
    for (let i = 1; i <= 9; i++) {
      await insertRow(sparse.fileID, sparse.batchID, i);
      await insertRow(`${sparse.fileID}.other`, 'unrelated', 100 + i);
    }
    const originalRows = await memberships(sparse.fileID);
    expect(BigInt(originalRows[0].rowID)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    await runSetupOnly(sparse.fileID, sparse.batchID);
    originalRows.forEach((row, index) =>
      expected.push({ rowID: row.rowID, BatchID: `${sparse.batchID}__sub${String(Math.floor(index / 4) + 1).padStart(3, '0')}` })
    );
    expect(await memberships(sparse.fileID)).toEqual(expected);

    const distractorRows = await memberships(`${sparse.fileID}.other`);
    expect(distractorRows.every(row => row.BatchID === 'unrelated')).toBe(true);
  });

  it('returns an empty setup result for a genuinely empty family', async () => {
    const family = newFamily('empty');
    const result = await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID }
    });
    expect(result.noDataFound).toBe(true);
    expect(result.processedSubBatches).toBe(0);
  });

  it('rejects a mixed-scope family and leaves every row untouched', async () => {
    const family = newFamily('mixed_scope');
    await insertRow(family.fileID, family.batchID, 1);
    await insertRow(family.fileID, family.batchID, 2);
    await connection.query('UPDATE temporarymeasurements SET PlotID = ? WHERE FileID = ? AND TreeTag = ?', [
      testData.plots[0].plotID + 100_000,
      family.fileID,
      'KS000000002'
    ]);
    const before = await memberships(family.fileID);
    await expect(runSetupOnly(family.fileID, family.batchID)).rejects.toThrow(/single plot\/census/);
    expect(await memberships(family.fileID)).toEqual(before);
  });

  it('keeps orphan membership and allocates later ordinals for a resumed family', async () => {
    const family = newFamily('orphans');
    for (let i = 1; i <= 2; i++) await insertRow(family.fileID, `${family.batchID}__sub001`, i);
    for (let i = 3; i <= 8; i++) await insertRow(family.fileID, family.batchID, i);
    const oldOrphan = (await memberships(family.fileID)).filter(row => row.BatchID.endsWith('__sub001'));
    await runSetupOnly(family.fileID, family.batchID);
    const final = await memberships(family.fileID);
    expect(final.filter(row => row.BatchID === `${family.batchID}__sub001`)).toEqual(oldOrphan);
    expect(final.filter(row => row.BatchID === `${family.batchID}__sub002`)).toHaveLength(4);
    expect(final.filter(row => row.BatchID === `${family.batchID}__sub003`)).toHaveLength(2);
  });

  it('supports the maximum source BatchID length that leaves room for a sub-batch suffix', async () => {
    const family = { ...newFamily('length'), batchID: 'b'.repeat(28) }; // temporarymeasurements.BatchID is varchar(36), suffix is 8 characters.
    for (let i = 1; i <= 5; i++) await insertRow(family.fileID, family.batchID, i);
    await runSetupOnly(family.fileID, family.batchID);
    const final = await memberships(family.fileID);
    expect(final.map(row => row.BatchID)).toEqual([
      `${family.batchID}__sub001`,
      `${family.batchID}__sub001`,
      `${family.batchID}__sub001`,
      `${family.batchID}__sub001`,
      `${family.batchID}__sub002`
    ]);
    expect(final.every(row => row.BatchID.length === 36)).toBe(true);
  });

  it('rolls back all assignments when a later keyset iteration fails', async () => {
    const family = newFamily('fault');
    for (let i = 1; i <= 9; i++) await insertRow(family.fileID, family.batchID, i);
    const before = await memberships(family.fileID);
    const manager = ConnectionManager.getInstance();
    const originalQuery = manager.executeQuery.bind(manager);
    let selectCount = 0;
    manager.executeQuery = async (sql: string, params?: unknown[], transactionID?: string) => {
      if (String(sql).includes('AS rowID')) {
        selectCount++;
        if (selectCount === 2) throw new Error('injected later keyset iteration failure');
      }
      return originalQuery(sql, params, transactionID);
    };
    try {
      await expect(runSetupOnly(family.fileID, family.batchID)).rejects.toThrow('injected later keyset iteration failure');
    } finally {
      manager.executeQuery = originalQuery;
    }
    expect(await memberships(family.fileID)).toEqual(before);
  });

  it('rolls back on affected-count mismatch and cancellation between iterations', async () => {
    const family = newFamily('affected');
    for (let i = 1; i <= 9; i++) await insertRow(family.fileID, family.batchID, i);
    const before = await memberships(family.fileID);
    const manager = ConnectionManager.getInstance();
    const originalQuery = manager.executeQuery.bind(manager);
    let assignmentCount = 0;
    manager.executeQuery = async (sql: string, params?: unknown[], transactionID?: string) => {
      const result = await originalQuery(sql, params, transactionID);
      if (String(sql).includes('SET BatchID = ?') && String(sql).includes('id > CAST')) {
        assignmentCount++;
        if (assignmentCount === 1) return { ...(result as object), affectedRows: 3 };
      }
      return result;
    };
    try {
      await expect(runSetupOnly(family.fileID, family.batchID)).rejects.toThrow(/selected 4 rows but assigned 3/);
    } finally {
      manager.executeQuery = originalQuery;
    }
    expect(await memberships(family.fileID)).toEqual(before);

    const cancelFamily = newFamily('cancel');
    for (let i = 1; i <= 9; i++) await insertRow(cancelFamily.fileID, cancelFamily.batchID, i);
    const cancelBefore = await memberships(cancelFamily.fileID);
    const diagnostics: SetupDiagnostic[] = [];
    let setupCommitted = false;
    let cancel = false;
    await expect(
      ingestBatch(manager, {
        schema: config.database,
        fileID: cancelFamily.fileID,
        batchID: cancelFamily.batchID,
        expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
        isAborted: () => setupCommitted || cancel,
        onSetupProgress: event => {
          diagnostics.push(event);
          if (event.step === 'splitting' && event.assignedRows && event.assignedRows > 0) cancel = true;
          if (event.terminal && event.outcome === 'committed') setupCommitted = true;
        }
      })
    ).rejects.toBeInstanceOf(IngestBatchAbortedError);
    expect(diagnostics.some(event => event.terminal && event.outcome === 'rolled_back')).toBe(true);
    expect(await memberships(cancelFamily.fileID)).toEqual(cancelBefore);

    const leaseFamily = newFamily('lease_loss');
    for (let i = 1; i <= 9; i++) await insertRow(leaseFamily.fileID, leaseFamily.batchID, i);
    const leaseBefore = await memberships(leaseFamily.fileID);
    let leaseLost = false;
    await expect(
      ingestBatch(manager, {
        schema: config.database,
        fileID: leaseFamily.fileID,
        batchID: leaseFamily.batchID,
        expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
        isAborted: () => leaseLost,
        onSetupProgress: event => {
          if (event.step === 'splitting' && event.assignedRows && event.assignedRows > 0) leaseLost = true;
        }
      })
    ).rejects.toBeInstanceOf(IngestBatchAbortedError);
    expect(await memberships(leaseFamily.fileID)).toEqual(leaseBefore);
  });

  it('rejects new original-batch rows beyond the frozen upper ID and rolls the setup back', async () => {
    const family = newFamily('new_row');
    for (let i = 1; i <= 9; i++) await insertRow(family.fileID, family.batchID, i);
    const before = await memberships(family.fileID);
    const manager = ConnectionManager.getInstance();
    const originalQuery = manager.executeQuery.bind(manager);
    let inserted = false;
    manager.executeQuery = async (sql: string, params?: unknown[], transactionID?: string) => {
      const result = await originalQuery(sql, params, transactionID);
      if (!inserted && String(sql).includes('AS rowID')) {
        inserted = true;
        await originalQuery(
          `INSERT INTO \`${config.database}\`.temporarymeasurements
           (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
           VALUES (?, ?, ?, ?, 'NEWAFTER', '1', ?, ?, 1, 1, 10, 1.3, '2024-03-15')`,
          [
            family.fileID,
            family.batchID,
            testData.plots[0].plotID,
            testData.census[0].censusID,
            testData.species[0].SpeciesCode,
            testData.quadrats[0].QuadratName
          ],
          transactionID
        );
      }
      return result;
    };
    try {
      await expect(runSetupOnly(family.fileID, family.batchID)).rejects.toThrow(/split membership mismatch/);
    } finally {
      manager.executeQuery = originalQuery;
    }
    expect(await memberships(family.fileID)).toEqual(before);
  });

  it('revalidates scope drift after waiting on a lock acquired by a separate session', async () => {
    const family = newFamily('scope_wait');
    for (let i = 1; i <= 5; i++) await insertRow(family.fileID, family.batchID, i);
    const lockName = buildIngestionLockName(config.database, family.fileID, testData.plots[0].plotID, testData.census[0].censusID);
    const lockHolder = await createConnection(config);
    const [lockRows] = await lockHolder.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    expect(lockRows[0].acquired).toBe(1);
    const manager = ConnectionManager.getInstance();
    let lockWaitReached!: () => void;
    const lockWait = new Promise<void>(resolve => {
      lockWaitReached = resolve;
    });
    const pending = ingestBatch(manager, {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
      onSetupProgress: event => {
        if (event.step === 'lock_wait' && event.outcome === 'started') lockWaitReached();
      }
    }).then(
      () => null,
      error => error
    );
    try {
      await lockWait;
      await connection.query('UPDATE temporarymeasurements SET PlotID = ?, CensusID = ? WHERE FileID = ?', [
        testData.plots[0].plotID + 100_000,
        testData.census[0].censusID + 100_000,
        family.fileID
      ]);
    } finally {
      await lockHolder.query('SELECT RELEASE_LOCK(?)', [lockName]);
      await lockHolder.end();
    }
    const error = await pending;
    expect(error?.name).toBe('BatchFamilyScopeError');
    expect(await memberships(family.fileID)).toHaveLength(5);
  });
});
