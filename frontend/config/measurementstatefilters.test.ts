import { describe, expect, it } from 'vitest';
import { buildMeasurementHasUnresolvedErrorsSql, buildMeasurementVisibleConditionSql } from './measurementstatefilters';

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
});
