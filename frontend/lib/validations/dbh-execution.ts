/** Server-only DBH validation primitives. Kept free of UI/TSX imports for the CLI. */
import ConnectionManager, { type TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { ensureMeasurementErrorDefinition, VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';
import { DBH_CHANGE_VALIDATION_IDS, DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';
import { MANAGER_OVERRIDE_ERROR_CODE } from '@/config/validationoverride';
export type ValidationExecutionParams = { p_CensusID?: number | null; p_PlotID?: number | null };
export type DBHValidationSkipCounts = {
  skippedNoInterval: number;
  skippedNegativeInterval: number;
  skippedImplausibleInterval: number;
  skippedBelowDbhFloor: number;
};
export type CombinedDBHValidationResult = { success: boolean; ranGrowth: boolean; ranShrinkage: boolean; skipCounts?: DBHValidationSkipCounts; error?: string };

type ValidationRuleRow = { ValidationID: number | string; IsEnabled: unknown };
type AffectedRowsResult = { affectedRows?: number };

function isBitFlagSet(value: unknown): boolean {
  return Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);
}

function scopeParams(params: ValidationExecutionParams): Array<number | null> {
  const censusID = params.p_CensusID ?? null;
  const plotID = params.p_PlotID ?? null;
  return [censusID, censusID, plotID, plotID];
}

export function parseDbhValidationSkipCounts(result: unknown): DBHValidationSkipCounts {
  const rows: Record<string, unknown>[] = [];
  const collectRows = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collectRows);
    else if (value && typeof value === 'object') rows.push(value as Record<string, unknown>);
  };
  collectRows(result);
  const countNamed = (key: string) => {
    const row = rows.find(candidate => key in candidate);
    return row && Number.isFinite(Number(row[key])) ? Number(row[key]) : 0;
  };
  return {
    skippedNoInterval: countNamed('SkippedNoInterval'),
    skippedNegativeInterval: countNamed('SkippedNegativeInterval'),
    skippedImplausibleInterval: countNamed('SkippedImplausibleInterval'),
    skippedBelowDbhFloor: countNamed('SkippedBelowDbhFloor')
  };
}

export async function prepareDBHValidationDefinitions(connectionManager: ConnectionManager, schema: string): Promise<void> {
  await ensureMeasurementErrorDefinition(connectionManager, schema, VALIDATION_ERROR_SOURCE, '1', `Validation ${DBH_GROWTH_PROCEDURE}`);
  await ensureMeasurementErrorDefinition(connectionManager, schema, VALIDATION_ERROR_SOURCE, '2', `Validation ${DBH_SHRINKAGE_PROCEDURE}`);
}

/**
 * Sends invalid rows that still carry an open occurrence of this DBH rule back to
 * pending, then resolves every open occurrence on pending rows so the rule can
 * reopen only the ones that still violate.
 */
async function resetStaleDbhOccurrences(tx: TxExecutor, schema: string, validationID: number, params: ValidationExecutionParams): Promise<void> {
  const ruleAndScope = [VALIDATION_ERROR_SOURCE, String(validationID), ...scopeParams(params)];
  await tx.query(
    safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements cm
       JOIN ??.census c ON cm.CensusID = c.CensusID
       JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       SET cm.IsValidated = NULL
       WHERE me.ErrorSource = ? AND me.ErrorCode = ?
         AND mel.IsResolved = FALSE AND cm.IsValidated = FALSE
         AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL
         AND (? IS NULL OR cm.CensusID = ?) AND (? IS NULL OR c.PlotID = ?)`
    ),
    ruleAndScope
  );
  await tx.query(
    safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN ??.coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN ??.census c ON c.CensusID = cm.CensusID
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE me.ErrorSource = ? AND me.ErrorCode = ?
         AND mel.IsResolved = FALSE AND cm.IsValidated IS NULL
         AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL
         AND (? IS NULL OR cm.CensusID = ?) AND (? IS NULL OR c.PlotID = ?)`
    ),
    ruleAndScope
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
  await resetStaleDbhOccurrences(tx, schema, validationID, params);
}

export async function runSharedDBHChangeValidationsInTransaction(input: {
  schema: string;
  tx: TxExecutor;
  params?: ValidationExecutionParams;
  requireActiveStemGUID?: boolean;
}): Promise<Omit<CombinedDBHValidationResult, 'success'>> {
  const { schema, tx, params = {} } = input;
  const rules: ValidationRuleRow[] = await tx.query(
    safeFormatQuery(schema, 'SELECT ValidationID, IsEnabled FROM ??.sitespecificvalidations WHERE ValidationID IN (1,2)')
  );
  const growthEnabled = isBitFlagSet(rules.find(rule => Number(rule.ValidationID) === 1)?.IsEnabled);
  const shrinkageEnabled = isBitFlagSet(rules.find(rule => Number(rule.ValidationID) === 2)?.IsEnabled);
  if (growthEnabled) await resetStaleDbhOccurrences(tx, schema, DBH_CHANGE_VALIDATION_IDS.growth, params);
  if (shrinkageEnabled) await resetStaleDbhOccurrences(tx, schema, DBH_CHANGE_VALIDATION_IDS.shrinkage, params);
  const procedureResult =
    growthEnabled || shrinkageEnabled
      ? await tx.query(safeFormatQuery(schema, 'CALL ??.RunSharedDBHChangeValidations(?, ?, ?, ?)'), [
          params.p_CensusID ?? null,
          params.p_PlotID ?? null,
          growthEnabled ? 1 : 0,
          shrinkageEnabled ? 1 : 0
        ])
      : [];
  return { ranGrowth: growthEnabled, ranShrinkage: shrinkageEnabled, skipCounts: parseDbhValidationSkipCounts(procedureResult) };
}

export async function finalizeValidatedRowsInTransaction(input: {
  schema: string;
  tx: TxExecutor;
  params: ValidationExecutionParams;
  requireActiveStemGUID?: boolean;
}): Promise<number> {
  const { schema, tx, params, requireActiveStemGUID = false } = input;
  // A row being re-validated is judged on its data again, so any earlier manager override no longer applies.
  await tx.query(
    safeFormatQuery(
      schema,
      `DELETE mel FROM ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE me.ErrorSource = ? AND me.ErrorCode = ? AND cm.IsValidated IS NULL
         AND (? IS NULL OR cm.CensusID = ?) AND (? IS NULL OR c.PlotID = ?)`
    ),
    [VALIDATION_ERROR_SOURCE, MANAGER_OVERRIDE_ERROR_CODE, ...scopeParams(params)]
  );
  const activeStemFilter = requireActiveStemGUID ? 'AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL' : '';
  const result: AffectedRowsResult = await tx.query(
    safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       SET cm.IsValidated = CASE WHEN NOT EXISTS (
             SELECT 1 FROM ??.measurement_error_log mel
             JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = cm.CoreMeasurementID AND mel.IsResolved = FALSE AND me.ErrorSource = ?
           ) THEN TRUE ELSE FALSE END
       WHERE cm.IsValidated IS NULL ${activeStemFilter}
         AND (? IS NULL OR cm.CensusID = ?) AND (? IS NULL OR c.PlotID = ?)`
    ),
    [VALIDATION_ERROR_SOURCE, ...scopeParams(params)]
  );
  return Number(result?.affectedRows ?? 0);
}
