import { VisibleFilter } from '@/config/datagridhelpers';

export function buildMeasurementHasUnresolvedErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
          )`;
}

/**
 * Projects measurement-state counts. The first four buckets are mutually exclusive and exhaustive
 * (they sum to the row total):
 * - CountUnresolvedLogged: any row with an unresolved measurement_error_log entry
 * - CountFailedNoLog: IsValidated = FALSE without an unresolved log entry. IsValidated defaults to
 *   FALSE in tablestructures.sql and migration 51 backfilled hard failures whose log link was
 *   dropped, so FALSE-without-logs means "not yet validated (or log link lost)", not "clean".
 * - CountPending: IsValidated IS NULL without an unresolved log entry
 * - CountValid: IsValidated = TRUE without an unresolved log entry
 *
 * CountOverridable is intentionally NOT disjoint from the buckets above: it mirrors the validation
 * override modal's UPDATE predicate (IsValidated = FALSE OR IS NULL) exactly, so it overlaps
 * CountFailedNoLog, CountPending, and the FALSE/NULL portion of CountUnresolvedLogged.
 */
export function buildMeasurementStateCountsSql(schema: string, alias: string): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);

  return `SUM(CASE WHEN ${alias}.IsValidated = FALSE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountFailedNoLog,
          SUM(CASE WHEN ${hasUnresolvedErrors} THEN 1 ELSE 0 END) AS CountUnresolvedLogged,
          SUM(CASE WHEN ${alias}.IsValidated IS NULL AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountPending,
          SUM(CASE WHEN ${alias}.IsValidated = TRUE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountValid,
          SUM(CASE WHEN ${alias}.IsValidated = FALSE OR ${alias}.IsValidated IS NULL THEN 1 ELSE 0 END) AS CountOverridable`;
}

export function buildMeasurementVisibleConditionSql(schema: string, alias: string, visibleFilter: VisibleFilter): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);

  switch (visibleFilter) {
    case 'valid':
      return `(${alias}.IsValidated = TRUE AND NOT ${hasUnresolvedErrors})`;
    case 'errors':
      return `(${alias}.IsValidated = FALSE OR ${hasUnresolvedErrors})`;
    case 'pending':
      return `(${alias}.IsValidated IS NULL AND NOT ${hasUnresolvedErrors})`;
  }
}

export function buildMeasurementVisibleClauseSql(schema: string, alias: string, visibleFilters: VisibleFilter[] | undefined): string {
  if (!visibleFilters) {
    return '';
  }

  const visibleConditions = visibleFilters.map(visibleFilter => buildMeasurementVisibleConditionSql(schema, alias, visibleFilter));

  return visibleConditions.length > 0 ? ` AND (${visibleConditions.join(' OR ')})` : ' AND 1 = 0';
}
