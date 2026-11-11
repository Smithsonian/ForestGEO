import { snapshotCoreMeasurementsScope, auditCoreMeasurementsScopeDiff } from '@/lib/changelog/ingestion-audit';
import { transactionExecutorFor } from '@/lib/ingestion/bulk-ingestion-call';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';
import ConnectionManager from '@/lib/db/connectionmanager';
import {
  ensureMeasurementErrorDefinition,
  errorCodeForSystemFailure,
  getIngestionErrorMessage,
  INGESTION_ERROR_SOURCE,
  type SystemFailureKind
} from '@/config/measurementerrors';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

export interface FailureTransferAuditContext {
  changedBy: string | null;
  plotID: number;
  censusID: number;
}

export async function moveTemporaryBatchToFailedMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  failureReason: string,
  failureKind: SystemFailureKind,
  transactionID?: string,
  auditContext?: FailureTransferAuditContext
): Promise<number> {
  const managesOwnTransaction = !transactionID;
  let activeTransactionID = transactionID ?? null;

  try {
    if (managesOwnTransaction) {
      activeTransactionID = await connectionManager.beginTransaction();
    }

    const tx = transactionExecutorFor(connectionManager, activeTransactionID!);
    const before = auditContext ? await snapshotCoreMeasurementsScope(tx, schema, fileID, batchID) : undefined;

    const countTempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) AS rowCount FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
    const countRows: any[] = await connectionManager.executeQuery(countTempSQL, [fileID, batchID], activeTransactionID ?? undefined);
    const sourceRowCount = Number(countRows?.[0]?.rowCount ?? 0);

    if (sourceRowCount > 0) {
      const errorCode = errorCodeForSystemFailure(failureKind);
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
           UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawPlotX, RawPlotY, RawCodes, RawComments, SourceRowIndex, IsActive)
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
                tm.PlotX,
                tm.PlotY,
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
         JOIN ??.temporarymeasurements tm
           ON tm.id = cm.SourceRowIndex
          AND tm.FileID = cm.UploadFileID
          AND tm.BatchID = cm.UploadBatchID
         WHERE cm.UploadFileID = ?
           AND cm.UploadBatchID = ?
           AND cm.StemGUID IS NULL`
      );
      await connectionManager.executeQuery(insertErrorLogSQL, [errorID, fileID, batchID], activeTransactionID ?? undefined);
    }

    const deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
    await connectionManager.executeQuery(deleteTempSQL, [fileID, batchID], activeTransactionID ?? undefined);

    if (auditContext && before) {
      const diff = await auditCoreMeasurementsScopeDiff({ tx, schema, fileID, batchID, before, ...auditContext });
      if (diff.insertedCount !== sourceRowCount || diff.updatedCount !== 0 || diff.deletedCount !== 0) {
        throw new ChangelogWriteError(
          ChangelogOperation.INSERT,
          'coremeasurements',
          batchID,
          new Error(
            `Failure transfer moved ${sourceRowCount} rows but audited ${diff.insertedCount} inserts, ${diff.updatedCount} updates and ${diff.deletedCount} deletes`
          )
        );
      }
    }

    if (managesOwnTransaction && activeTransactionID) {
      await connectionManager.commitTransaction(activeTransactionID);
    }
    return sourceRowCount;
  } catch (error) {
    if (managesOwnTransaction && activeTransactionID) {
      try {
        await connectionManager.rollbackTransaction(activeTransactionID);
      } catch (rollbackError) {
        // Keep the actionable transfer error as the thrown error. The rollback
        // failure is secondary, but attach it for structured diagnostics.
        if (error instanceof Error) {
          (error as Error & { rollbackError?: unknown }).rollbackError = rollbackError;
        }
      }
    }
    throw error;
  }
}
