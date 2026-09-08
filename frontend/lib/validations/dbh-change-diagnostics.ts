/**
 * Read-only explanation of the DBH comparison facts for one measurement.
 * The stored procedure owns all thresholds and eligibility calculations; this
 * module only exposes the facts it leaves in its connection-local temp table.
 */
import ConnectionManager from '@/lib/db/connectionmanager';
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

export interface ExplainDbhChangePairsInput {
  schema: string;
  coreMeasurementID: number;
  censusID?: number | null;
  plotID?: number | null;
}

export interface DbhPresentProcessingState {
  coreMeasurementID: number;
  censusID: number;
  plotID: number;
  isValidated: boolean | null;
  /** Existing unresolved DBH occurrences are state, not a recomputed verdict. */
  hasUnresolvedGrowthError: boolean;
  hasUnresolvedShrinkageError: boolean;
}

export interface DbhChangePairFact {
  presentCoreMeasurementID: number;
  priorCoreMeasurementID: number;
  presentCensusID: number;
  priorCensusID: number;
  presentIsValidated: boolean | null;
  presentDBH: number | null;
  priorDBH: number | null;
  presentHOM: number | null;
  priorHOM: number | null;
  presentMeasurementDate: string | null;
  priorMeasurementDate: string | null;
  unitToMm: number | null;
  intervalDays: number | null;
  intervalYears: number | null;
  statusExempt: boolean;
  dbhsMeetFloor: boolean;
  homEligible: boolean;
  intervalSkipReason: 'missing-date' | 'zero-interval' | 'negative-interval' | null;
  isEligible: boolean;
  growthViolates: boolean;
  shrinkageViolates: boolean;
}

export type DbhChangeDiagnostic =
  | { outcome: 'measurement-not-found'; present: null; pairs: [] }
  | { outcome: 'measurement-out-of-scope'; present: DbhPresentProcessingState; pairs: [] }
  | { outcome: 'no-eligible-prior-comparison'; present: DbhPresentProcessingState; pairs: [] }
  | { outcome: 'pairs-found'; present: DbhPresentProcessingState; pairs: DbhChangePairFact[] };

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Number(value) === 1;
}

function asBoolean(value: unknown): boolean {
  return asNullableBoolean(value) === true;
}

function mapPair(row: Record<string, unknown>): DbhChangePairFact {
  return {
    presentCoreMeasurementID: Number(row.PresentCoreMeasurementID),
    priorCoreMeasurementID: Number(row.PriorCoreMeasurementID),
    presentCensusID: Number(row.PresentCensusID),
    priorCensusID: Number(row.PriorCensusID),
    presentIsValidated: asNullableBoolean(row.PresentIsValidated),
    presentDBH: asNullableNumber(row.PresentDBH),
    priorDBH: asNullableNumber(row.PriorDBH),
    presentHOM: asNullableNumber(row.PresentHOM),
    priorHOM: asNullableNumber(row.PriorHOM),
    presentMeasurementDate: row.PresentMeasurementDate == null ? null : String(row.PresentMeasurementDate),
    priorMeasurementDate: row.PriorMeasurementDate == null ? null : String(row.PriorMeasurementDate),
    unitToMm: asNullableNumber(row.UnitToMm),
    intervalDays: asNullableNumber(row.IntervalDays),
    intervalYears: asNullableNumber(row.IntervalYears),
    statusExempt: asBoolean(row.StatusExempt),
    dbhsMeetFloor: asBoolean(row.DbhsMeetFloor),
    homEligible: asBoolean(row.HomEligible),
    intervalSkipReason: row.IntervalSkipReason == null ? null : (String(row.IntervalSkipReason) as DbhChangePairFact['intervalSkipReason']),
    isEligible: asBoolean(row.IsEligible),
    growthViolates: asBoolean(row.GrowthViolates),
    shrinkageViolates: asBoolean(row.ShrinkageViolates)
  };
}

async function dropPairs(tx: TxExecutor): Promise<void> {
  await tx.query('DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs');
}

/**
 * Uses one transaction connection because BuildDBHChangePairs creates a
 * session temp table. No persistent table is written and the temp table is
 * dropped on both the success and failure paths before the connection returns
 * to the pool.
 */
export async function explainDbhChangePairs(input: ExplainDbhChangePairsInput): Promise<DbhChangeDiagnostic> {
  const connectionManager = ConnectionManager.getInstance();
  return connectionManager.withTransaction(async tx => {
    const presentSql = safeFormatQuery(
      input.schema,
      `SELECT cm.CoreMeasurementID, cm.CensusID, c.PlotID, cm.IsValidated,
              EXISTS (
                SELECT 1
                FROM ??.measurement_error_log mel
                JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
                WHERE mel.MeasurementID = cm.CoreMeasurementID
                  AND mel.IsResolved = FALSE
                  AND me.ErrorSource = 'validation'
                  AND me.ErrorCode = '1'
              ) AS HasUnresolvedGrowthError,
              EXISTS (
                SELECT 1
                FROM ??.measurement_error_log mel
                JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
                WHERE mel.MeasurementID = cm.CoreMeasurementID
                  AND mel.IsResolved = FALSE
                  AND me.ErrorSource = 'validation'
                  AND me.ErrorCode = '2'
              ) AS HasUnresolvedShrinkageError
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE cm.CoreMeasurementID = ?
       LIMIT 1`
    );
    const presentRows: Array<Record<string, unknown>> = await tx.query(presentSql, [input.coreMeasurementID]);
    if (presentRows.length === 0) return { outcome: 'measurement-not-found', present: null, pairs: [] };

    const presentRow = presentRows[0];
    const present: DbhPresentProcessingState = {
      coreMeasurementID: Number(presentRow.CoreMeasurementID),
      censusID: Number(presentRow.CensusID),
      plotID: Number(presentRow.PlotID),
      isValidated: asNullableBoolean(presentRow.IsValidated),
      hasUnresolvedGrowthError: asBoolean(presentRow.HasUnresolvedGrowthError),
      hasUnresolvedShrinkageError: asBoolean(presentRow.HasUnresolvedShrinkageError)
    };
    if ((input.censusID != null && present.censusID !== input.censusID) || (input.plotID != null && present.plotID !== input.plotID)) {
      return { outcome: 'measurement-out-of-scope', present, pairs: [] };
    }

    let primaryError: unknown;
    try {
      const buildSql = safeFormatQuery(input.schema, 'CALL ??.BuildDBHChangePairs(?, ?, ?)');
      await tx.query(buildSql, [input.censusID ?? null, input.plotID ?? null, input.coreMeasurementID]);
      const pairRows: Array<Record<string, unknown>> = await tx.query(
        'SELECT * FROM dbh_change_pairs WHERE PresentCoreMeasurementID = ? ORDER BY PriorCoreMeasurementID DESC',
        [input.coreMeasurementID]
      );
      const pairs = pairRows.map(mapPair);
      return pairs.length === 0 ? { outcome: 'no-eligible-prior-comparison', present, pairs: [] } : { outcome: 'pairs-found', present, pairs };
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await dropPairs(tx);
      } catch (cleanupError) {
        if (primaryError) throw new AggregateError([primaryError, cleanupError], 'DBH diagnostics failed and temporary-table cleanup also failed');
        throw cleanupError;
      }
    }
  });
}
