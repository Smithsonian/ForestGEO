import { describe, expect, it } from 'vitest';
import {
  buildMeasurementHasUnresolvedErrorsSql,
  buildMeasurementStateCountsSql,
  buildMeasurementVisibleClauseSql,
  buildMeasurementVisibleConditionSql
} from './measurementstatefilters';

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

  describe('buildMeasurementStateCountsSql', () => {
    const countsSql = buildMeasurementStateCountsSql('myschema', 'vft');

    // Extracts one projection's CASE predicate by its alias, independent of SELECT-list order:
    // each projection has the shape `SUM(CASE WHEN <predicate> THEN 1 ELSE 0 END) AS CountX`.
    // Splitting on the `,` that precedes each SUM( keeps predicates with internal commas
    // (e.g. COALESCE(mel.IsResolved, FALSE)) intact.
    function statePredicate(alias: string): string {
      const projection = countsSql.split(/,(?=\s*SUM\()/).find(candidate => candidate.includes(`AS ${alias}`));
      expect(projection, `no projection found for alias ${alias}`).toBeDefined();

      const predicateMatch = projection!.match(/SUM\(CASE WHEN ([\s\S]*?) THEN 1 ELSE 0 END\) AS /);
      expect(predicateMatch, `projection for ${alias} does not match SUM(CASE WHEN ... THEN 1 ELSE 0 END) AS`).not.toBeNull();
      return predicateMatch![1];
    }

    it('projects the five measurement-state count aliases', () => {
      expect(countsSql).toContain('AS CountFailedNoLog');
      expect(countsSql).toContain('AS CountUnresolvedLogged');
      expect(countsSql).toContain('AS CountPending');
      expect(countsSql).toContain('AS CountValid');
      expect(countsSql).toContain('AS CountOverridable');
    });

    it('counts failed-no-log as IsValidated = FALSE rows WITHOUT an unresolved log entry (disjoint from CountUnresolvedLogged)', () => {
      expect(statePredicate('CountFailedNoLog')).toContain('vft.IsValidated = FALSE AND NOT (EXISTS');
    });

    it('counts unresolved logged errors via the measurement_error_log EXISTS clause', () => {
      const unresolvedLoggedPredicate = statePredicate('CountUnresolvedLogged');
      expect(unresolvedLoggedPredicate).toContain('EXISTS');
      expect(unresolvedLoggedPredicate).toContain('FROM myschema.measurement_error_log mel');
      expect(unresolvedLoggedPredicate).toContain('COALESCE(mel.IsResolved, FALSE) = FALSE');
    });

    it('counts pending as not-yet-validated rows without unresolved logged errors', () => {
      expect(statePredicate('CountPending')).toContain('vft.IsValidated IS NULL AND NOT (EXISTS');
    });

    it('counts valid as validated rows without unresolved logged errors', () => {
      expect(statePredicate('CountValid')).toContain('vft.IsValidated = TRUE AND NOT (EXISTS');
    });

    it('keeps every non-unresolved bucket disjoint from the unresolved-log bucket via AND NOT (EXISTS', () => {
      expect(statePredicate('CountFailedNoLog')).toContain('AND NOT (EXISTS');
      expect(statePredicate('CountPending')).toContain('AND NOT (EXISTS');
      expect(statePredicate('CountValid')).toContain('AND NOT (EXISTS');
    });

    it('counts overridable rows with exactly the override modal predicate (FALSE OR NULL), intentionally overlapping the disjoint buckets', () => {
      const overridablePredicate = statePredicate('CountOverridable');
      expect(overridablePredicate).toBe('vft.IsValidated = FALSE OR vft.IsValidated IS NULL');
      expect(overridablePredicate).not.toContain('EXISTS');
    });
  });
});
