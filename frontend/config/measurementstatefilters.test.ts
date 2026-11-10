import { describe, expect, it } from 'vitest';
import {
  buildMeasurementOverrideEligibleSql,
  buildValidationOverrideStatements,
  getMeasurementRowStatus,
  buildMeasurementHasUnresolvedErrorsSql,
  buildMeasurementStateCountsSql,
  buildMeasurementVisibleClauseSql,
  buildMeasurementVisibleConditionSql,
  buildMeasurementRowSummaryProjectionSql,
  buildMeasurementStatusRankSql,
  buildStemStatusFilterClauseSql,
  MEASUREMENT_STATUS_RANK,
  MEASUREMENT_STATUS_RANK_COLUMN,
  MEASUREMENT_STATUS_VISIBLE_BUCKET,
  MEASUREMENT_STATUSES,
  measurementStatusFromRank,
  UnknownAttributeStatusError,
  UNRESOLVED_ERROR_MESSAGES_SEPARATOR
} from './measurementstatefilters';

describe('measurementstatefilters', () => {
  it('builds the unresolved-error EXISTS clause against measurement_error_log', () => {
    expect(buildMeasurementHasUnresolvedErrorsSql('myschema', 'vft')).toContain('FROM myschema.measurement_error_log mel');
    expect(buildMeasurementHasUnresolvedErrorsSql('myschema', 'vft')).toContain('mel.MeasurementID = vft.CoreMeasurementID');
  });

  it('treats unresolved error-log rows as invalid for visible filters', () => {
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'errors')).toContain('vft.StemGUID IS NULL OR vft.IsValidated = FALSE OR EXISTS');
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'valid')).toContain('vft.StemGUID IS NOT NULL AND vft.IsValidated = TRUE AND NOT EXISTS');
    expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'pending')).toContain('vft.StemGUID IS NOT NULL AND vft.IsValidated IS NULL AND NOT EXISTS');
  });

  it('builds an OR clause when visible filters are present', () => {
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain(' AND (');
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain(
      'vft.StemGUID IS NOT NULL AND vft.IsValidated = TRUE AND NOT EXISTS'
    );
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', ['valid', 'pending'])).toContain(
      'vft.StemGUID IS NOT NULL AND vft.IsValidated IS NULL AND NOT EXISTS'
    );
  });

  describe('override eligibility', () => {
    it('requires a real StemGUID, FALSE/NULL IsValidated, and no unresolved ingestion-source log', () => {
      const sql = buildMeasurementOverrideEligibleSql('myschema', 'cm');
      expect(sql).toContain('(cm.IsValidated = FALSE OR cm.IsValidated IS NULL)');
      expect(sql).toContain('cm.StemGUID IS NOT NULL');
      expect(sql).toContain('NOT (EXISTS');
      expect(sql).toContain("ierr.ErrorSource = 'ingestion'");
      expect(sql).toContain('COALESCE(ilog.IsResolved, FALSE) = FALSE');
      expect(sql).toContain('ing.MeasurementID = cm.CoreMeasurementID');
      // DISTINCT derived table keeps the fragment legal inside a DELETE on measurement_error_log (MySQL 1093).
      expect(sql).toContain('SELECT DISTINCT ilog.MeasurementID');
    });

    it('uses the identical eligibility fragment in the count, clear, and update statements', () => {
      const eligible = buildMeasurementOverrideEligibleSql('myschema', 'cm');
      const statements = buildValidationOverrideStatements('myschema', 7, 3);
      expect(statements.count.query).toContain(eligible);
      expect(statements.clearValidationLogs.query).toContain(eligible);
      expect(statements.markValidated.query).toContain(eligible);
    });

    it('binds the plot/census scope as params on every statement, so another census never matches', () => {
      const statements = buildValidationOverrideStatements('myschema', 7, 3);
      for (const statement of [statements.count, statements.clearValidationLogs, statements.markValidated]) {
        expect(statement.params).toEqual([7, 3, 7]);
        expect(statement.query).toContain('PlotID = ? AND PlotCensusNumber = ?');
        expect(statement.query).toContain('c.PlotID = ?');
        expect(statement.query).not.toContain('7');
      }
    });

    it('only deletes validation-source logs and never clears ingestion logs', () => {
      const { query } = buildValidationOverrideStatements('myschema', 7, 3).clearValidationLogs;
      expect(query).toContain("me.ErrorSource = 'validation'");
      expect(query).not.toContain("ErrorSource = 'ingestion' AND me");
      expect(query.startsWith('DELETE mel')).toBe(true);
    });
  });

  describe('getMeasurementRowStatus', () => {
    it('shows StemGUID NULL rows as unresolved ingestion failures even when IsValidated is stale-true', () => {
      expect(getMeasurementRowStatus({ stemGUID: null, isValidated: true })).toBe('ingestion-unresolved');
      expect(getMeasurementRowStatus({ stemGUID: null, isValidated: null })).toBe('ingestion-unresolved');
    });

    it('classifies linked rows by IsValidated', () => {
      expect(getMeasurementRowStatus({ stemGUID: 5, isValidated: true })).toBe('valid');
      expect(getMeasurementRowStatus({ stemGUID: 5, isValidated: false })).toBe('failed');
      expect(getMeasurementRowStatus({ stemGUID: 5, isValidated: null })).toBe('pending');
    });
  });

  it('returns an always-false clause when no visible filters are selected', () => {
    expect(buildMeasurementVisibleClauseSql('myschema', 'vft', [])).toBe(' AND 1 = 0');
  });

  describe('missing-stem rows (StemGUID NULL) are always unresolved', () => {
    it('counts them as unresolved and excludes them from failed-no-log, pending and valid buckets', () => {
      const countsSql = buildMeasurementStateCountsSql('myschema', 'vft');
      expect(countsSql).toContain('WHEN vft.StemGUID IS NULL OR EXISTS');
      for (const alias of ['CountFailedNoLog', 'CountPending', 'CountValid']) {
        const projection = countsSql.split(/,(?=\s*SUM\()/).find(candidate => candidate.includes(`AS ${alias}`))!;
        expect(projection).toContain('vft.StemGUID IS NOT NULL AND');
      }
    });

    it('includes them in the errors filter and excludes them from the valid and pending filters', () => {
      expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'errors')).toMatch(/^\(vft\.StemGUID IS NULL OR /);
      expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'valid')).toMatch(/^\(vft\.StemGUID IS NOT NULL AND /);
      expect(buildMeasurementVisibleConditionSql('myschema', 'vft', 'pending')).toMatch(/^\(vft\.StemGUID IS NOT NULL AND /);
    });
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

    it('projects the six measurement-state count aliases', () => {
      expect(countsSql).toContain('AS CountFailedNoLog');
      expect(countsSql).toContain('AS CountUnresolvedLogged');
      expect(countsSql).toContain('AS CountPending');
      expect(countsSql).toContain('AS CountValid');
      expect(countsSql).toContain('AS CountOverridable');
      expect(countsSql).toContain('AS CountRevalidatable');
    });

    it('counts failed-no-log as IsValidated = FALSE rows WITHOUT an unresolved log entry (disjoint from CountUnresolvedLogged)', () => {
      expect(statePredicate('CountFailedNoLog')).toContain('vft.StemGUID IS NOT NULL AND vft.IsValidated = FALSE AND NOT (EXISTS');
    });

    it('counts unresolved logged errors via the measurement_error_log EXISTS clause', () => {
      const unresolvedLoggedPredicate = statePredicate('CountUnresolvedLogged');
      expect(unresolvedLoggedPredicate).toContain('EXISTS');
      expect(unresolvedLoggedPredicate).toContain('FROM myschema.measurement_error_log mel');
      expect(unresolvedLoggedPredicate).toContain('COALESCE(mel.IsResolved, FALSE) = FALSE');
    });

    it('counts pending as not-yet-validated rows without unresolved logged errors', () => {
      expect(statePredicate('CountPending')).toContain('vft.StemGUID IS NOT NULL AND vft.IsValidated IS NULL AND NOT (EXISTS');
    });

    it('counts valid as validated rows without unresolved logged errors', () => {
      expect(statePredicate('CountValid')).toContain('vft.StemGUID IS NOT NULL AND vft.IsValidated = TRUE AND NOT (EXISTS');
    });

    it('keeps every non-unresolved bucket disjoint from the unresolved-log bucket via AND NOT (EXISTS', () => {
      expect(statePredicate('CountFailedNoLog')).toContain('AND NOT (EXISTS');
      expect(statePredicate('CountPending')).toContain('AND NOT (EXISTS');
      expect(statePredicate('CountValid')).toContain('AND NOT (EXISTS');
    });

    it('counts overridable rows with exactly the shared override-eligibility predicate', () => {
      expect(statePredicate('CountOverridable')).toBe(buildMeasurementOverrideEligibleSql('myschema', 'vft'));
    });

    it('counts revalidatable rows with exactly the prepareValidationRun reset predicate: failed, real stem, unresolved validation-source error', () => {
      const revalidatablePredicate = statePredicate('CountRevalidatable');
      expect(revalidatablePredicate).toContain('vft.IsValidated = FALSE AND vft.StemGUID IS NOT NULL AND (EXISTS');
      expect(revalidatablePredicate).toContain('JOIN myschema.measurement_errors me ON me.ErrorID = mel.ErrorID');
      expect(revalidatablePredicate).toContain("me.ErrorSource = 'validation'");
      expect(revalidatablePredicate).toContain('COALESCE(mel.IsResolved, FALSE) = FALSE');
    });
  });
});

const SCHEMA = 'myschema';
const ALIAS = 'vft';
const STATUS_ORDER_IN_SPEC = ['ingestionFailed', 'unresolvedErrors', 'invalidNoLog', 'pending', 'passed'];

describe('measurement status rank (View Data Validation column)', () => {
  it('lists the five statuses in the spec order with ranks 0-4', () => {
    console.log('[status rank]', JSON.stringify(MEASUREMENT_STATUS_RANK));
    expect([...MEASUREMENT_STATUSES]).toEqual(STATUS_ORDER_IN_SPEC);
    expect(STATUS_ORDER_IN_SPEC.map(status => MEASUREMENT_STATUS_RANK[status as keyof typeof MEASUREMENT_STATUS_RANK])).toEqual([0, 1, 2, 3, 4]);
  });

  it('builds a CASE whose WHEN branches test, in order, StemGUID NULL, an unresolved log entry, FALSE and NULL, with passed as ELSE', () => {
    const sql = buildMeasurementStatusRankSql(SCHEMA, ALIAS);
    console.log('[status rank] sql', sql);
    const positions = [
      sql.indexOf(`WHEN ${ALIAS}.StemGUID IS NULL THEN 0`),
      sql.indexOf(`WHEN ${buildMeasurementHasUnresolvedErrorsSql(SCHEMA, ALIAS)} THEN 1`),
      sql.indexOf(`WHEN ${ALIAS}.IsValidated = FALSE THEN 2`),
      sql.indexOf(`WHEN ${ALIAS}.IsValidated IS NULL THEN 3`),
      sql.indexOf('ELSE 4')
    ];
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('maps every status to exactly one Show bucket, matching the counts buckets', () => {
    console.log('[status buckets]', JSON.stringify(MEASUREMENT_STATUS_VISIBLE_BUCKET));
    expect(MEASUREMENT_STATUS_VISIBLE_BUCKET).toEqual({
      ingestionFailed: 'errors',
      unresolvedErrors: 'errors',
      invalidNoLog: 'errors',
      pending: 'pending',
      passed: 'valid'
    });
  });

  it.each([
    [0, 'ingestionFailed'],
    [4, 'passed'],
    ['2', 'invalidNoLog'],
    [null, null],
    [undefined, null],
    ['', null],
    [5, null],
    [-1, null],
    ['x', null],
    [1.5, null]
  ])('measurementStatusFromRank(%j) → %j', (rank, expected) => {
    expect(measurementStatusFromRank(rank)).toBe(expected);
  });
});

describe('row summary projection', () => {
  const sql = buildMeasurementRowSummaryProjectionSql(SCHEMA, ALIAS);

  it('selects every projected column under its documented alias and binds no placeholder', () => {
    const aliases = [
      MEASUREMENT_STATUS_RANK_COLUMN,
      'UnresolvedErrorCount',
      'PrimaryErrorMessage',
      'PrimaryErrorSource',
      'UnresolvedErrorCodes',
      'UnresolvedErrorMessages',
      'HasContradiction',
      'StemStatuses'
    ];
    const observed = Object.fromEntries(aliases.map(alias => [alias, sql.includes(`AS ${alias}`)]));
    console.log('[projection] aliases', JSON.stringify(observed), 'placeholders', (sql.match(/\?/g) ?? []).length);
    expect(Object.values(observed).every(Boolean)).toBe(true);
    expect(sql).not.toContain('?');
  });

  it('orders the primary error, codes and messages by ErrorSource then ErrorCode, as View Errors does', () => {
    const orderClauses = sql.match(/ORDER BY \w+\.ErrorSource ASC, \w+\.ErrorCode ASC/g) ?? [];
    console.log('[projection] order clauses', orderClauses.length);
    expect(orderClauses.length).toBe(4);
    expect(sql).toMatch(/COALESCE\(NULLIF\(\w+\.Description, ''\), \w+\.ErrorMessage\)/);
    expect(sql).toContain(`SEPARATOR '${UNRESOLVED_ERROR_MESSAGES_SEPARATOR}'`);
  });

  it('orders stem statuses by AttributeStatusOptions and prefers the active attribute row', () => {
    expect(sql).toContain("FIELD(rs_attr.Status, 'alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing')");
    expect(sql).toContain('IsActive = (SELECT MAX(effective_attr.IsActive)');
  });

  it('flags contradictions with the two View Errors rules scoped to the row plot and census', () => {
    expect(sql).toContain(`rs_dup.PlotID = ${ALIAS}.PlotID AND rs_dup.CensusID = ${ALIAS}.CensusID`);
    expect(sql).toContain(`COALESCE(rs_other_ms.SpeciesCode, '') <> COALESCE(${ALIAS}.SpeciesCode, '')`);
    expect(sql).toContain('rs_self.UploadFileID IS NOT NULL AND rs_self.UploadBatchID IS NOT NULL');
  });
});

describe('buildStemStatusFilterClauseSql', () => {
  it('adds no clause when no status is selected', () => {
    expect(buildStemStatusFilterClauseSql(SCHEMA, ALIAS, [])).toBe('');
  });

  it('matches rows where any effective code carries the status', () => {
    const clause = buildStemStatusFilterClauseSql(SCHEMA, ALIAS, ['dead']);
    console.log('[stem status clause]', clause);
    expect(clause).toMatch(/^ AND EXISTS \(/);
    expect(clause).toContain(`sf_ca.CoreMeasurementID = ${ALIAS}.CoreMeasurementID`);
    expect(clause).toContain("sf_attr.Status IN ('dead')");
  });

  it('resolves the status codes once, not through a per-row join to attributes', () => {
    const clause = buildStemStatusFilterClauseSql(SCHEMA, ALIAS, ['dead']);
    expect(clause).toContain('sf_ca.Code IN (');
    expect(clause).not.toMatch(/\bJOIN\b/);
  });

  it('keeps the active-row-wins rule on the code list', () => {
    const clause = buildStemStatusFilterClauseSql(SCHEMA, ALIAS, ['dead']);
    expect(clause).toContain(
      `sf_attr.IsActive = (SELECT MAX(effective_attr.IsActive) FROM ${SCHEMA}.attributes effective_attr WHERE effective_attr.Code = sf_attr.Code)`
    );
  });

  it('lists every requested status in the IN list', () => {
    expect(buildStemStatusFilterClauseSql(SCHEMA, ALIAS, ['dead', 'alive'])).toContain("sf_attr.Status IN ('dead', 'alive')");
  });

  it('rejects a value outside AttributeStatusOptions', () => {
    expect(() => buildStemStatusFilterClauseSql(SCHEMA, ALIAS, ["dead') OR 1=1 --"])).toThrow(UnknownAttributeStatusError);
  });
});
