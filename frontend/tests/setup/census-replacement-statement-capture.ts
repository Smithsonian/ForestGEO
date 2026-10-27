import type ConnectionManager from '@/lib/db/connectionmanager';
import { deleteCensusReplacementChunk } from '@/lib/ingestion/temporary-measurements';

export interface CapturedStatement {
  sql: string;
  params: unknown[];
}

export interface CensusReplacementWindowStatements {
  idSelect: CapturedStatement;
  errorLinkDelete: CapturedStatement;
  deleteAudit: CapturedStatement;
  coreMeasurementDelete: CapturedStatement;
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
const WINDOW_STATEMENT_COUNT = 4;
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
      return captured.length === 1 ? windowIDs.map(id => ({ CoreMeasurementID: id })) : { affectedRows: windowIDs.length };
    }
  } as unknown as ConnectionManager;

  await deleteCensusReplacementChunk(
    recorder,
    scope.schema,
    scope.incomingBatchID,
    scope.plotID,
    scope.censusID,
    scope.afterCoreMeasurementID,
    scope.changedBy,
    CAPTURE_TRANSACTION_ID
  );

  if (captured.length !== WINDOW_STATEMENT_COUNT) {
    throw new Error(
      `Expected ${WINDOW_STATEMENT_COUNT} window statements, captured ${captured.length}: ` +
        captured.map(statement => statement.sql.replace(/\s+/g, ' ').trim().slice(0, DESCRIBED_STATEMENT_LENGTH)).join(' | ')
    );
  }
  const [idSelect, errorLinkDelete, deleteAudit, coreMeasurementDelete] = captured;
  return { idSelect, errorLinkDelete, deleteAudit, coreMeasurementDelete };
}
