import { describe, expect, it } from 'vitest';
import { buildMeasurementHasUnresolvedErrorsSql, buildMeasurementVisibleClauseSql, buildMeasurementVisibleConditionSql } from './measurementstatefilters';

describe('measurementstatefilters', () => {
  it('builds the unresolved-error EXISTS clause against measurement_error_log', () => {
    expect(buildMeasurementHasUnresolvedErrorsSql('myschema', 'vft')).toContain('FROM myschema.measurement_error_log mel');
    expect(buildMeasurementHasUnresolvedErrorsSql('myschema', 'vft')).toContain('mel.MeasurementID = vft.CoreMeasurementID');
  });

  it('treats unresolved error-log rows as invalid for visible filters', () => {
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'errors')).toContain('vft.IsValidated = FALSE OR EXISTS');
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'valid')).toContain('vft.IsValidated = TRUE AND NOT EXISTS');
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'pending')).toContain('vft.IsValidated IS NULL AND NOT EXISTS');
  });

  it('builds an OR clause when visible filters are present', () => {
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain(' AND (');
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain('vft.IsValidated = TRUE AND NOT EXISTS');
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain('vft.IsValidated IS NULL AND NOT EXISTS');
  });

  it('returns an always-false clause when no visible filters are selected', () => {
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', [])).toBe(' AND 1 = 0');
  });
});
