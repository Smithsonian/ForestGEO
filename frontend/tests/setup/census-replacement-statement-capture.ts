import type ConnectionManager from '@/lib/db/connectionmanager';
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { deleteCensusReplacementChunk, lockAuditAndDeleteCoreMeasurementWindow, type CoreMeasurementDeleteScope } from '@/lib/ingestion/temporary-measurements';
import { recordDeletedCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';
import type { CensusReplacementSummaryIdentity } from '@/lib/changelog/deletion-summary';

export interface CapturedStatement {
  sql: string;
  params: unknown[];
}

export interface CensusReplacementWindowStatements {
  idSelect: CapturedStatement;
  errorLinkDelete: CapturedStatement;
  coreMeasurementDelete: CapturedStatement;
  summaryRead: CapturedStatement;
  summaryWrite: CapturedStatement;
}

export interface CensusReplacementWindowScope {
  schema: string;
  incomingBatchID: string;
  plotID: number;
  censusID: number;
  afterCoreMeasurementID: number;
  changedBy: string | null;
}

const CAPTURE_TRANSACTION_ID = 'statement-capture';
const CAPTURE_FILE_NAME = 'statement-capture.csv';
const WINDOW_STATEMENT_COUNT = 5;
const DESCRIBED_STATEMENT_LENGTH = 80;

/**
 * The exact statements one production measurement window issues for `windowIDs`,
 * captured without a database, so a test can EXPLAIN what production really runs.
 */
export async function captureCensusReplacementWindowStatements(
  scope: CensusReplacementWindowScope,
  windowIDs: number[]
): Promise<CensusReplacementWindowStatements> {
  const captured: CapturedStatement[] = [];
  const recorder = {
    executeQuery: async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      if (captured.length === 1) return windowIDs.map(id => ({ CoreMeasurementID: id }));
      if (/^\s*SELECT\b[\s\S]*\.unifiedchangelog\b/.test(sql)) return [];
      return { affectedRows: windowIDs.length };
    }
  } as unknown as ConnectionManager;
  const summary: CensusReplacementSummaryIdentity = {
    recordID: `${CAPTURE_FILE_NAME}::${scope.incomingBatchID}`,
    fileName: CAPTURE_FILE_NAME,
    batchID: scope.incomingBatchID,
    changedBy: scope.changedBy
  };

  await deleteCensusReplacementChunk(
    recorder,
    scope.schema,
    scope.incomingBatchID,
    scope.plotID,
    scope.censusID,
    scope.afterCoreMeasurementID,
    summary,
    CAPTURE_TRANSACTION_ID
  );

  if (captured.length !== WINDOW_STATEMENT_COUNT) {
    throw new Error(
      `Expected ${WINDOW_STATEMENT_COUNT} window statements, captured ${captured.length}: ` +
        captured.map(statement => statement.sql.replace(/\s+/g, ' ').trim().slice(0, DESCRIBED_STATEMENT_LENGTH)).join(' | ')
    );
  }
  const [idSelect, errorLinkDelete, coreMeasurementDelete, summaryRead, summaryWrite] = captured;
  return { idSelect, errorLinkDelete, coreMeasurementDelete, summaryRead, summaryWrite };
}

/**
 * The per-row DELETE audit INSERT the failed-row cleanups issue for `ids` (recordDeletedCoreMeasurementsAudit),
 * captured without a database. Called directly, not through a window, so a test can size `ids` past the window limit.
 */
export async function captureDeleteAuditStatement(schema: string, ids: number[], plotID: number, censusID: number): Promise<CapturedStatement> {
  const captured: CapturedStatement[] = [];
  const recorder: Pick<TxExecutor, 'query'> = {
    query: async <T>(sql: string, params: unknown[] = []): Promise<T> => {
      captured.push({ sql, params });
      return { affectedRows: ids.length } as T;
    }
  };
  await recordDeletedCoreMeasurementsAudit({ tx: recorder, schema, coreMeasurementIDs: ids, changedBy: null, plotID, censusID });
  return captured[0];
}

/** The exact lock statement production issues for one window of `scope`, captured without a database. */
export async function captureCoreMeasurementWindowLockStatement(
  schema: string,
  scope: CoreMeasurementDeleteScope,
  windowIDs: number[],
  plotID: number,
  censusID: number
): Promise<CapturedStatement> {
  const captured: CapturedStatement[] = [];
  const recorder = {
    executeQuery: async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      return captured.length === 1 ? windowIDs.map(id => ({ CoreMeasurementID: id })) : { affectedRows: windowIDs.length };
    }
  } as unknown as ConnectionManager;
  await lockAuditAndDeleteCoreMeasurementWindow(recorder, schema, scope, windowIDs, null, plotID, censusID, CAPTURE_TRANSACTION_ID);
  return captured[0];
}
