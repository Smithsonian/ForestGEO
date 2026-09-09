/** Server-only DBH validation primitives. Kept free of UI/TSX imports for the CLI. */
import ConnectionManager, { type TxExecutor } from '@/lib/db/connectionmanager';
import { ensureMeasurementErrorDefinition, VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';
import { DBH_CHANGE_VALIDATION_IDS, DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';
export type ValidationExecutionParams = { p_CensusID?: number | null; p_PlotID?: number | null };
export type DBHValidationSkipCounts = {
  skippedNoInterval: number;
  skippedMissingDate: number;
  skippedZeroInterval: number;
  skippedNegativeInterval: number;
  skippedBelowDbhFloor: number;
};
export type CombinedDBHValidationResult = { success: boolean; ranGrowth: boolean; ranShrinkage: boolean; skipCounts?: DBHValidationSkipCounts; error?: string };

const bool = (v: unknown) => (Buffer.isBuffer(v) ? v[0] === 1 : Boolean(v));
export function parseDbhValidationSkipCounts(result: unknown): DBHValidationSkipCounts {
  const rows: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') rows.push(value as Record<string, unknown>);
  };
  visit(result);
  const n = (key: string) => {
    const row = rows.find(candidate => key in candidate);
    return row && Number.isFinite(Number(row[key])) ? Number(row[key]) : 0;
  };
  return {
    skippedNoInterval: n('SkippedNoInterval'),
    skippedMissingDate: n('SkippedMissingDate'),
    skippedZeroInterval: n('SkippedZeroInterval'),
    skippedNegativeInterval: n('SkippedNegativeInterval'),
    skippedBelowDbhFloor: n('SkippedBelowDbhFloor')
  };
}
export async function prepareDBHValidationDefinitions(connectionManager: ConnectionManager, schema: string): Promise<void> {
  await ensureMeasurementErrorDefinition(connectionManager, schema, VALIDATION_ERROR_SOURCE, '1', `Validation ${DBH_GROWTH_PROCEDURE}`);
  await ensureMeasurementErrorDefinition(connectionManager, schema, VALIDATION_ERROR_SOURCE, '2', `Validation ${DBH_SHRINKAGE_PROCEDURE}`);
}
async function scrub(tx: TxExecutor, schema: string, id: number, params: ValidationExecutionParams) {
  const census = params.p_CensusID ?? null,
    plot = params.p_PlotID ?? null,
    scope = [VALIDATION_ERROR_SOURCE, String(id), census, census, plot, plot];
  await tx.query(
    `UPDATE ${schema}.coremeasurements cm JOIN ${schema}.census c ON cm.CensusID=c.CensusID JOIN ${schema}.measurement_error_log mel ON mel.MeasurementID=cm.CoreMeasurementID JOIN ${schema}.measurement_errors me ON me.ErrorID=mel.ErrorID SET cm.IsValidated=NULL WHERE me.ErrorSource=? AND me.ErrorCode=? AND (cm.IsValidated=FALSE OR (mel.IsResolved=TRUE AND cm.IsValidated=TRUE)) AND cm.IsActive=TRUE AND cm.StemGUID IS NOT NULL AND (? IS NULL OR cm.CensusID=?) AND (? IS NULL OR c.PlotID=?)`,
    scope
  );
  await tx.query(
    `UPDATE ${schema}.measurement_error_log mel JOIN ${schema}.measurement_errors me ON me.ErrorID=mel.ErrorID JOIN ${schema}.coremeasurements cm ON mel.MeasurementID=cm.CoreMeasurementID JOIN ${schema}.census c ON c.CensusID=cm.CensusID SET mel.IsResolved=TRUE, mel.ResolvedAt=NOW() WHERE me.ErrorSource=? AND me.ErrorCode=? AND mel.IsResolved=FALSE AND cm.IsValidated IS NULL AND cm.IsActive=TRUE AND cm.StemGUID IS NOT NULL AND (? IS NULL OR cm.CensusID=?) AND (? IS NULL OR c.PlotID=?)`,
    scope
  );
}
/**
 * Prepares one DBH validation for a normal validation run. This is deliberately
 * limited to error carriers for the requested DBH validation; it never resets
 * otherwise-valid rows just because they are in scope.
 */
export async function prepareDBHValidationRunInTransaction(input: {
  schema: string;
  tx: TxExecutor;
  validationID: number;
  params: ValidationExecutionParams;
  requireActiveStemGUID?: boolean;
}): Promise<void> {
  const { schema, tx, validationID, params } = input;
  if (validationID !== DBH_CHANGE_VALIDATION_IDS.growth && validationID !== DBH_CHANGE_VALIDATION_IDS.shrinkage) {
    throw new Error(`Unsupported DBH validation ID: ${validationID}`);
  }
  await scrub(tx, schema, validationID, params);
}
export async function runSharedDBHChangeValidationsInTransaction(input: {
  schema: string;
  tx: TxExecutor;
  params?: ValidationExecutionParams;
  requireActiveStemGUID?: boolean;
}): Promise<Omit<CombinedDBHValidationResult, 'success'>> {
  const { schema, tx, params = {} } = input;
  const rows: any[] = await tx.query(`SELECT ValidationID, ProcedureName, IsEnabled FROM ${schema}.sitespecificvalidations WHERE ValidationID IN (1,2)`);
  const growth = bool(rows.find(r => Number(r.ValidationID) === 1)?.IsEnabled),
    shrinkage = bool(rows.find(r => Number(r.ValidationID) === 2)?.IsEnabled);
  if (growth) await scrub(tx, schema, DBH_CHANGE_VALIDATION_IDS.growth, params);
  if (shrinkage) await scrub(tx, schema, DBH_CHANGE_VALIDATION_IDS.shrinkage, params);
  const result =
    growth || shrinkage
      ? await tx.query(`CALL ${schema}.RunSharedDBHChangeValidations(?, ?, ?, ?)`, [
          params.p_CensusID ?? null,
          params.p_PlotID ?? null,
          growth ? 1 : 0,
          shrinkage ? 1 : 0
        ])
      : [];
  return { ranGrowth: growth, ranShrinkage: shrinkage, skipCounts: parseDbhValidationSkipCounts(result) };
}
export async function finalizeValidatedRowsInTransaction(input: {
  schema: string;
  tx: TxExecutor;
  params: ValidationExecutionParams;
  requireActiveStemGUID?: boolean;
}): Promise<number> {
  const { schema, tx, params, requireActiveStemGUID = false } = input,
    census = params.p_CensusID ?? null,
    plot = params.p_PlotID ?? null;
  const result: any = await tx.query(
    `UPDATE ${schema}.coremeasurements cm JOIN ${schema}.census c ON c.CensusID=cm.CensusID SET cm.IsValidated=CASE WHEN NOT EXISTS (SELECT 1 FROM ${schema}.measurement_error_log mel JOIN ${schema}.measurement_errors me ON me.ErrorID=mel.ErrorID WHERE mel.MeasurementID=cm.CoreMeasurementID AND mel.IsResolved=FALSE AND me.ErrorSource='validation') THEN TRUE ELSE FALSE END WHERE cm.IsValidated IS NULL ${requireActiveStemGUID ? 'AND cm.IsActive=TRUE AND cm.StemGUID IS NOT NULL' : ''} AND (? IS NULL OR cm.CensusID=?) AND (? IS NULL OR c.PlotID=?)`,
    [census, census, plot, plot]
  );
  return Number(result?.affectedRows ?? 0);
}
