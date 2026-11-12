import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

export interface CensusWindowDays {
  startDate: string | null;
  endDate: string | null;
}

/**
 * Validation definitions only examine IsValidated IS NULL rows, so a row that passed under the
 * old window would stay valid forever. Re-open the linked, active rows the new window excludes.
 * A NULL end date compares as unknown, which leaves an open window without an upper bound.
 */
export async function reopenValidationOutsideCensusWindow(tx: TxExecutor, schema: string, censusID: number, window: CensusWindowDays): Promise<number> {
  const result = await tx.query<{ affectedRows?: number }>(
    safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements
          SET IsValidated = NULL
        WHERE CensusID = ?
          AND IsValidated = TRUE
          AND IsActive = TRUE
          AND StemGUID IS NOT NULL
          AND MeasurementDate IS NOT NULL
          AND (MeasurementDate < ? OR MeasurementDate > ?)`
    ),
    [censusID, window.startDate, window.endDate]
  );
  return result.affectedRows ?? 0;
}
