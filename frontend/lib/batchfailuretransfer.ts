import ConnectionManager from '@/config/connectionmanager';
import { ensureMeasurementErrorDefinition, getIngestionErrorMessage, inferIngestionErrorCode, INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

/**
 * Moves all remaining sub-batches (BatchID LIKE 'prefix%') for a given file
 * to unresolved coremeasurements. Used when the client calls setupbulkfailure
 * with the original batchID but rows have been split into sub-batch IDs.
 */
export async function moveTemporarySubBatchesToFailedMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  subBatchPrefix: string,
  failureReason: string,
  transactionID?: string
): Promise<number> {
  const findSubBatchesSQL = safeFormatQuery(
    schema,
    'SELECT DISTINCT BatchID FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID LIKE ?'
  );
  // Reuse the caller's transaction when provided so multi-batch cleanup can stay atomic.
  const subBatchRows: any[] = await connectionManager.executeQuery(findSubBatchesSQL, [fileID, `${subBatchPrefix}%`], transactionID);

  let totalMoved = 0;
  for (const row of subBatchRows) {
    const moved = await moveTemporaryBatchToFailedMeasurements(connectionManager, schema, fileID, row.BatchID, failureReason, transactionID);
    totalMoved += moved;
  }
  return totalMoved;
}

export async function moveTemporaryBatchToFailedMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  failureReason: string,
  transactionID?: string
): Promise<number> {
  const managesOwnTransaction = !transactionID;
  let activeTransactionID = transactionID ?? null;

  try {
    if (managesOwnTransaction) {
      activeTransactionID = await connectionManager.beginTransaction();
    }

    const countTempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) AS rowCount FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
    const countRows: any[] = await connectionManager.executeQuery(countTempSQL, [fileID, batchID], activeTransactionID ?? undefined);
    const sourceRowCount = Number(countRows?.[0]?.rowCount ?? 0);

    if (sourceRowCount > 0) {
      const errorCode = inferIngestionErrorCode(failureReason);
      const errorID = await ensureMeasurementErrorDefinition(
        connectionManager,
        schema,
        INGESTION_ERROR_SOURCE,
        errorCode,
        getIngestionErrorMessage(errorCode, failureReason),
        activeTransactionID ?? undefined
      );

      const insertCoreSQL = safeFormatQuery(
        schema,
        `INSERT INTO ??.coremeasurements
          (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
           UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, SourceRowIndex, IsActive)
         SELECT tm.CensusID,
                NULL,
                FALSE,
                tm.MeasurementDate,
                tm.DBH,
                tm.HOM,
                LEFT(?, 255),
                ?,
                ?,
                tm.TreeTag,
                tm.StemTag,
                tm.SpeciesCode,
                tm.QuadratName,
                tm.LocalX,
                tm.LocalY,
                tm.Codes,
                tm.Comments,
                tm.id,
                1
         FROM ??.temporarymeasurements tm
         WHERE tm.FileID = ? AND tm.BatchID = ?`
      );
      await connectionManager.executeQuery(insertCoreSQL, [failureReason, fileID, batchID, fileID, batchID], activeTransactionID ?? undefined);

      const insertErrorLogSQL = safeFormatQuery(
        schema,
        `INSERT IGNORE INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt, ResolvedAt)
         SELECT cm.CoreMeasurementID, ?, FALSE, NOW(), NULL
         FROM ??.coremeasurements cm
         WHERE cm.UploadFileID = ?
           AND cm.UploadBatchID = ?
           AND cm.StemGUID IS NULL`
      );
      await connectionManager.executeQuery(insertErrorLogSQL, [errorID, fileID, batchID], activeTransactionID ?? undefined);
    }

    const deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
    await connectionManager.executeQuery(deleteTempSQL, [fileID, batchID], activeTransactionID ?? undefined);

    if (managesOwnTransaction && activeTransactionID) {
      await connectionManager.commitTransaction(activeTransactionID);
    }
    return sourceRowCount;
  } catch (error) {
    if (managesOwnTransaction && activeTransactionID) {
      await connectionManager.rollbackTransaction(activeTransactionID);
    }
    throw error;
  }
}
