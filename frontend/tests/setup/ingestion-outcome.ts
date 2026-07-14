/**
 * Batch-scoped ingestion-outcome reader + asserter.
 *
 * The single mechanism for describing "what did bulkingestionprocess actually do to
 * this one batch" and comparing it against an expectation. Every read is scoped by
 * (fileID, batchID, censusID) so a scenario can never accidentally count another
 * batch's rows.
 *
 * Domain invariants this reads (grounded in db/sql/storedprocedures.sql +
 * db/sql/tablestructures.sql, NOT guessed):
 *   - A SUCCESSFUL measurement is a coremeasurements row with StemGUID IS NOT NULL.
 *   - A SURFACED FAILURE is a coremeasurements row with StemGUID IS NULL carrying Raw*
 *     columns; failures are never silently dropped, they land in coremeasurements and
 *     link to their ingestion error codes via measurement_error_log -> measurement_errors
 *     (ErrorSource = 'ingestion').
 *   - Integrity/alert signals are rows in uploadintegrityalerts.type for the batch.
 *   - uploadmetrics carries the procedure's own counters for the batch:
 *       sourceRecords    = total temporarymeasurements rows in the batch (input size)
 *       processedRecords = rows the procedure INSERTed as successful coremeasurements
 *       failedRecords    = COUNT(DISTINCT SourceRowIndex) that hard-failed (vDataLossCount)
 *       missingRecords   = |reconciliation gap| (0 unless input != success + failed)
 *   - temporarymeasurements is drained on every terminal path, so remainingTemporaryRows
 *     is 0 after a processed batch.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';

/**
 * Ingestion error codes emitted into hard_failure_rows by bulkingestionprocess and
 * seeded in measurement_errors (ErrorSource = 'ingestion'). Named so no scenario
 * hardcodes a bare string.
 */
export const INGESTION_ERROR_CODE = {
  INVALID_SPECIES: 'INVALID_SPECIES',
  INVALID_QUADRAT: 'INVALID_QUADRAT',
  AMBIGUOUS_SPECIES: 'AMBIGUOUS_SPECIES',
  AMBIGUOUS_QUADRAT: 'AMBIGUOUS_QUADRAT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  DUPLICATE_TAG_STEMTAG: 'DUPLICATE_TAG_STEMTAG',
  PUBLISHED_STEMID_CONFLICT: 'PUBLISHED_STEMID_CONFLICT',
  MEASUREMENT_INSERT_SKIPPED: 'MEASUREMENT_INSERT_SKIPPED'
} as const;

/**
 * uploadintegrityalerts.type values emitted by bulkingestionprocess.
 * NOTE: invalid AND ambiguous species/quadrat both surface under the single
 * INVALID_REFERENCE_DATA alert; the distinction lives in the per-row error code.
 */
export const INGESTION_ALERT_TYPE = {
  DUPLICATE_RECORDS: 'DUPLICATE_RECORDS',
  DUPLICATE_TAG_STEMTAG: 'DUPLICATE_TAG_STEMTAG',
  INVALID_REFERENCE_DATA: 'INVALID_REFERENCE_DATA',
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',
  CROSS_CENSUS_VALIDATION_FAILURE: 'CROSS_CENSUS_VALIDATION_FAILURE',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH'
} as const;

export interface IngestionScope {
  fileID: string;
  batchID: string;
  censusID: number;
}

export interface IngestionOutcome {
  /** uploadmetrics.sourceRecords — the input row count the procedure recorded for the batch. */
  sourceRecords: number | null;
  /** coremeasurements with StemGUID IS NOT NULL for this batch. */
  successfulRows: number;
  /** coremeasurements with StemGUID IS NULL for this batch (surfaced failures). */
  failedRows: number;
  /** temporarymeasurements still present for this file+batch (0 after a drained run). */
  remainingTemporaryRows: number;
  /** uploadmetrics.processedRecords. */
  metricProcessedRecords: number | null;
  /** uploadmetrics.failedRecords. */
  metricFailedRecords: number | null;
  /** uploadmetrics.missingRecords. */
  metricMissingRecords: number | null;
  /** Distinct ingestion ErrorCodes linked to this batch's failed rows, sorted. */
  errorCodes: string[];
  /** Distinct uploadintegrityalerts.type values for this batch, sorted. */
  alertTypes: string[];
}

async function scalarCount(connection: Connection, sql: string, params: unknown[]): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Reads the real, batch-scoped outcome of a bulkingestionprocess run. Every query is
 * filtered by fileID/batchID (and censusID where the table carries it) so counts are
 * never global.
 */
export async function readIngestionOutcome(connection: Connection, scope: IngestionScope): Promise<IngestionOutcome> {
  const { fileID, batchID, censusID } = scope;

  const successfulRows = await scalarCount(
    connection,
    `SELECT COUNT(*) AS total FROM coremeasurements
     WHERE UploadFileID = ? AND UploadBatchID = ? AND CensusID = ? AND StemGUID IS NOT NULL`,
    [fileID, batchID, censusID]
  );

  const failedRows = await scalarCount(
    connection,
    `SELECT COUNT(*) AS total FROM coremeasurements
     WHERE UploadFileID = ? AND UploadBatchID = ? AND CensusID = ? AND StemGUID IS NULL`,
    [fileID, batchID, censusID]
  );

  const remainingTemporaryRows = await scalarCount(connection, `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [
    fileID,
    batchID
  ]);

  const [metricRows] = await connection.query<RowDataPacket[]>(
    `SELECT sourceRecords, processedRecords, failedRecords, missingRecords
     FROM uploadmetrics
     WHERE fileID = ? AND batchID = ? AND censusID = ?
     ORDER BY id DESC LIMIT 1`,
    [fileID, batchID, censusID]
  );
  const metric = metricRows[0];

  const [errorRows] = await connection.query<RowDataPacket[]>(
    `SELECT DISTINCT me.ErrorCode AS code
     FROM coremeasurements cm
     JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ? AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND me.ErrorSource = 'ingestion'
     ORDER BY me.ErrorCode`,
    [fileID, batchID, censusID]
  );

  const [alertRows] = await connection.query<RowDataPacket[]>(
    `SELECT DISTINCT type FROM uploadintegrityalerts
     WHERE fileID = ? AND batchID = ?
     ORDER BY type`,
    [fileID, batchID]
  );

  return {
    sourceRecords: metric ? Number(metric.sourceRecords) : null,
    successfulRows,
    failedRows,
    remainingTemporaryRows,
    metricProcessedRecords: metric ? Number(metric.processedRecords) : null,
    metricFailedRecords: metric ? Number(metric.failedRecords) : null,
    metricMissingRecords: metric ? Number(metric.missingRecords) : null,
    errorCodes: errorRows.map(r => String(r.code)),
    alertTypes: alertRows.map(r => String(r.type))
  };
}

const ARRAY_FIELDS: ReadonlyArray<keyof IngestionOutcome> = ['errorCodes', 'alertTypes'];

function normalizeSet(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/**
 * Asserts an actual outcome matches an expectation, field by field, with verbose
 * failure messages that name the field, the expected value, and the actual value,
 * and dump the full actual outcome so a regression is debuggable from the failure
 * text alone. Array fields (errorCodes/alertTypes) are compared as exact sets so an
 * unexpected extra code OR a missing one both fail loudly.
 *
 * Designed to reveal flaws: if bulkingestionprocess stops surfacing a duplicate, or
 * mislabels a code, or miscounts a metric, exactly one named line changes and the
 * test goes red.
 */
export function assertIngestionOutcome(actual: IngestionOutcome, expected: Partial<IngestionOutcome>): void {
  const mismatches: string[] = [];

  for (const key of Object.keys(expected) as Array<keyof IngestionOutcome>) {
    const expectedValue = expected[key];
    if (expectedValue === undefined) continue;

    if (ARRAY_FIELDS.includes(key)) {
      const expectedSet = normalizeSet(expectedValue as string[]);
      const actualSet = normalizeSet(actual[key] as string[]);
      if (JSON.stringify(expectedSet) !== JSON.stringify(actualSet)) {
        mismatches.push(`  - ${key}: expected set [${expectedSet.join(', ')}] but got [${actualSet.join(', ')}]`);
      }
    } else if (actual[key] !== expectedValue) {
      mismatches.push(`  - ${key}: expected ${JSON.stringify(expectedValue)} but got ${JSON.stringify(actual[key])}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `IngestionOutcome assertion failed (${mismatches.length} field(s)):\n` +
        `${mismatches.join('\n')}\n` +
        `Full actual outcome:\n${JSON.stringify(actual, null, 2)}`
    );
  }
}
