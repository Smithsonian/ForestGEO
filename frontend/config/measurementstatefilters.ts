import { VisibleFilter } from '@/config/datagridhelpers';

export function buildMeasurementHasUnresolvedErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
          )`;
}

export function buildMeasurementHasUnresolvedValidationErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
              AND me.ErrorSource = 'validation'
          )`;
}

/**
 * Unresolved ingestion-source error log entries. Written as an EXISTS over a DISTINCT derived table
 * (not a plain correlated subquery) on purpose: the override DELETE targets measurement_error_log, and
 * MySQL rejects a subquery over its own DELETE target (error 1093). DISTINCT stops the optimizer from
 * merging the derived table back into the outer query, so the same fragment is safe in SELECT, UPDATE
 * and DELETE statements.
 */
export function buildMeasurementHasUnresolvedIngestionErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM (
              SELECT DISTINCT ilog.MeasurementID
              FROM ${schema}.measurement_error_log ilog
              JOIN ${schema}.measurement_errors ierr ON ierr.ErrorID = ilog.ErrorID
              WHERE COALESCE(ilog.IsResolved, FALSE) = FALSE
                AND ierr.ErrorSource = 'ingestion'
            ) ing
            WHERE ing.MeasurementID = ${alias}.CoreMeasurementID
          )`;
}

/**
 * THE override-eligibility predicate, shared by CountOverridable, the override modal's pre-count, its
 * validation-log DELETE and its IsValidated UPDATE so they can never disagree. A row is eligible when
 * it is a resolved, linked measurement (real StemGUID), has not already passed (IsValidated FALSE or
 * NULL) and carries no unresolved ingestion-source error. Ingestion failures (StemGUID NULL, or an
 * unresolved ingestion log even when a StemGUID is present) are never overridable.
 */
export function buildMeasurementOverrideEligibleSql(schema: string, alias: string): string {
  return `(${alias}.IsValidated = FALSE OR ${alias}.IsValidated IS NULL)
        AND ${alias}.StemGUID IS NOT NULL
        AND NOT (${buildMeasurementHasUnresolvedIngestionErrorsSql(schema, alias)})`;
}

export interface ValidationOverrideStatement {
  query: string;
  params: Array<number>;
}

export interface ValidationOverrideStatements {
  count: ValidationOverrideStatement;
  clearValidationLogs: ValidationOverrideStatement;
  markValidated: ValidationOverrideStatement;
}

/**
 * Builds the override modal's three statements from the single eligibility predicate. Every
 * statement carries the same plot/census scope (bound as ? params, in the order plotID,
 * plotCensusNumber, plotID) and the same eligibility fragment. The DELETE only ever touches
 * validation-source logs, never ingestion logs.
 */
export function buildValidationOverrideStatements(schema: string, plotID: number, plotCensusNumber: number): ValidationOverrideStatements {
  const eligible = buildMeasurementOverrideEligibleSql(schema, 'cm');
  const scope = `c.CensusID IN (SELECT CensusID FROM ${schema}.census WHERE PlotID = ? AND PlotCensusNumber = ?)
        AND c.PlotID = ?`;
  const params = [plotID, plotCensusNumber, plotID];
  return {
    count: {
      query: `SELECT COUNT(*) AS EligibleCount
      FROM ${schema}.coremeasurements AS cm
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      WHERE ${scope}
        AND ${eligible}`,
      params
    },
    clearValidationLogs: {
      query: `DELETE mel
      FROM ${schema}.measurement_error_log AS mel
      JOIN ${schema}.measurement_errors AS me ON me.ErrorID = mel.ErrorID
      JOIN ${schema}.coremeasurements AS cm ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      WHERE ${scope}
        AND me.ErrorSource = 'validation'
        AND ${eligible}`,
      params
    },
    markValidated: {
      query: `UPDATE ${schema}.coremeasurements AS cm
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      SET cm.IsValidated = TRUE
      WHERE ${scope}
        AND ${eligible}`,
      params
    }
  };
}

export type MeasurementRowStatus = 'ingestion-unresolved' | 'pending' | 'valid' | 'failed' | 'unknown';

/**
 * Status-column precedence for a grid row (the caller handles per-row validation-error detail
 * first). A row with StemGUID NULL is an unresolved ingestion failure and must never read as passed
 * or pending, even if a past override left IsValidated = 1 on it.
 */
export function getMeasurementRowStatus(row: { stemGUID?: number | null; isValidated?: boolean | number | null }): MeasurementRowStatus {
  if (row.stemGUID === null) return 'ingestion-unresolved';
  if (row.isValidated === null) return 'pending';
  if (row.isValidated === undefined) return 'unknown';
  return row.isValidated ? 'valid' : 'failed';
}

/**
 * Projects measurement-state counts. The first four buckets are mutually exclusive and exhaustive
 * (they sum to the row total):
 * - CountUnresolvedLogged: any row with StemGUID NULL (an unresolved ingestion failure, whatever its
 *   IsValidated flag or log state) or with an unresolved measurement_error_log entry
 * - CountFailedNoLog: real stem, IsValidated = FALSE, no unresolved log entry. IsValidated defaults to
 *   FALSE in tablestructures.sql and migration 51 backfilled hard failures whose log link was
 *   dropped, so FALSE-without-logs means "not yet validated (or log link lost)", not "clean".
 * - CountPending: real stem, IsValidated IS NULL, no unresolved log entry
 * - CountValid: real stem, IsValidated = TRUE, no unresolved log entry
 *
 * CountOverridable is intentionally NOT disjoint from the buckets above: it uses the shared
 * buildMeasurementOverrideEligibleSql predicate (also used by the override modal's DELETE/UPDATE),
 * so it overlaps CountFailedNoLog, CountPending, and the FALSE/NULL portion of CountUnresolvedLogged,
 * but excludes ingestion failures (StemGUID NULL or an unresolved ingestion-source log).
 *
 * CountRevalidatable mirrors prepareValidationRun's reset predicate exactly (IsValidated = FALSE,
 * a real stem, and an unresolved validation-source error): the rows a validation rerun will reset
 * to pending and re-examine. Ingestion failures (StemGUID NULL, 'ingestion'-source errors) are
 * excluded — no rerun can clear those, so they must not make the run action look actionable.
 */
export function buildMeasurementStateCountsSql(schema: string, alias: string): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);
  const hasUnresolvedValidationErrors = buildMeasurementHasUnresolvedValidationErrorsSql(schema, alias);
  const overrideEligible = buildMeasurementOverrideEligibleSql(schema, alias);

  return `SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = FALSE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountFailedNoLog,
          SUM(CASE WHEN ${alias}.StemGUID IS NULL OR ${hasUnresolvedErrors} THEN 1 ELSE 0 END) AS CountUnresolvedLogged,
          SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated IS NULL AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountPending,
          SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = TRUE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountValid,
          SUM(CASE WHEN ${overrideEligible} THEN 1 ELSE 0 END) AS CountOverridable,
          SUM(CASE WHEN ${alias}.IsValidated = FALSE AND ${alias}.StemGUID IS NOT NULL AND (${hasUnresolvedValidationErrors}) THEN 1 ELSE 0 END) AS CountRevalidatable`;
}

export function buildMeasurementVisibleConditionSql(schema: string, alias: string, visibleFilter: VisibleFilter): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);

  switch (visibleFilter) {
    case 'valid':
      return `(${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = TRUE AND NOT ${hasUnresolvedErrors})`;
    case 'errors':
      return `(${alias}.StemGUID IS NULL OR ${alias}.IsValidated = FALSE OR ${hasUnresolvedErrors})`;
    case 'pending':
      return `(${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated IS NULL AND NOT ${hasUnresolvedErrors})`;
  }
}

export function buildMeasurementVisibleClauseSql(schema: string, alias: string, visibleFilters: VisibleFilter[] | undefined): string {
  if (!visibleFilters) {
    return '';
  }

  const visibleConditions = visibleFilters.map(visibleFilter => buildMeasurementVisibleConditionSql(schema, alias, visibleFilter));

  return visibleConditions.length > 0 ? ` AND (${visibleConditions.join(' OR ')})` : ' AND 1 = 0';
}
