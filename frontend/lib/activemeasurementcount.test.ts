import { describe, expect, it } from 'vitest';
import { ActiveMeasurementCountUnreadableError, buildActiveMeasurementCountQuery, readActiveMeasurementCount } from './activemeasurementcount';

const SCHEMA = 'forestgeo_testing';

describe('buildActiveMeasurementCountQuery', () => {
  it('counts active coremeasurements of the plot over every census in scope', () => {
    const query = buildActiveMeasurementCountQuery(SCHEMA, 3, [7, 8]);
    console.log('[view-errors active count]', JSON.stringify(query));
    expect(query.sql).toContain('FROM `forestgeo_testing`.coremeasurements cm');
    expect(query.sql).toContain('JOIN `forestgeo_testing`.census c ON c.CensusID = cm.CensusID');
    expect(query.sql).toMatch(/WHERE c\.PlotID = \? AND cm\.IsActive = 1 AND cm\.CensusID IN \(\?, \?\)/);
    expect(query.params).toEqual([3, 7, 8]);
  });

  it('refuses an empty census list rather than building IN ()', () => {
    expect(() => buildActiveMeasurementCountQuery(SCHEMA, 3, [])).toThrow();
  });
});

describe('readActiveMeasurementCount', () => {
  it('reads COUNT(*) as a number', () => {
    expect(readActiveMeasurementCount([{ n: 88 }])).toBe(88);
    expect(readActiveMeasurementCount([{ n: '88' }])).toBe(88);
  });

  it.each([[[]], [[{}]], [[{ n: -1 }]], [[{ n: 1.5 }]], [[{ n: 'many' }]], [null]])('throws for %j', rows => {
    expect(() => readActiveMeasurementCount(rows)).toThrow(ActiveMeasurementCountUnreadableError);
  });
});
