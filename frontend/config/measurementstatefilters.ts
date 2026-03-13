import { VisibleFilter } from '@/config/datagridhelpers';

export function buildMeasurementHasUnresolvedErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
          )`;
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
