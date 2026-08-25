import { describe, expect, it } from 'vitest';
import {
  buildReportSummary,
  buildStepPlan,
  evaluateThresholds,
  normalizeArrayResponse,
  parseCliOptions,
  parseDurationMs,
  parseRate,
  parseSiteSpec,
  summarizeSamples
} from './workshop-stress.mjs';

describe('workshop stress helpers', () => {
  it('parses duration and rate values from CLI-friendly strings', () => {
    expect(parseDurationMs('250ms')).toBe(250);
    expect(parseDurationMs('1.5s')).toBe(1500);
    expect(parseDurationMs('2m')).toBe(120000);
    expect(parseRate('2%')).toBe(0.02);
    expect(parseRate('0.05')).toBe(0.05);
    expect(parseRate('5')).toBe(0.05);
  });

  it('parses compact site specs', () => {
    expect(parseSiteSpec('forestgeo_panama:2:9:3')).toEqual({
      schema: 'forestgeo_panama',
      plotID: 2,
      censusID: 9,
      plotCensusNumber: 3
    });
    expect(parseSiteSpec('forestgeo_serc')).toEqual({ schema: 'forestgeo_serc', plotID: undefined, censusID: undefined, plotCensusNumber: undefined });
  });

  it('parses CLI options with repeatable sites and threshold aliases', () => {
    const options = parseCliOptions(
      [
        '--base-url=http://localhost:3001/',
        '--auth=e2e',
        '--site=forestgeo_panama:2:9:3',
        '--sites=forestgeo_serc,forestgeo_harvard',
        '--duration=30s',
        '--max-error-rate=1%',
        '--max-p95=5s',
        '--no-output'
      ],
      {}
    );

    expect(options.baseUrl).toBe('http://localhost:3001');
    expect(options.auth).toBe('e2e');
    expect(options.durationMs).toBe(30000);
    expect(options.maxErrorRate).toBe(0.01);
    expect(options.maxP95Ms).toBe(5000);
    expect(options.output).toBeUndefined();
    expect(options.siteSpecs.map(site => site.schema)).toEqual(['forestgeo_panama', 'forestgeo_serc', 'forestgeo_harvard']);
  });

  it('normalizes route response array shapes', () => {
    expect(normalizeArrayResponse([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(normalizeArrayResponse({ output: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(normalizeArrayResponse({ sites: [{ id: 3 }] })).toEqual([{ id: 3 }]);
    expect(normalizeArrayResponse({})).toEqual([]);
  });

  it('builds a workshop profile with the expected read-heavy routes', () => {
    const steps = buildStepPlan(
      {
        schema: 'forestgeo_panama',
        plotID: 2,
        censusID: 9,
        plotCensusNumber: 3
      },
      { profile: 'workshop', pageSize: 100 }
    );

    expect(steps.map(step => step.operation)).toEqual([
      'fetch-plots',
      'fetch-census',
      'dashboard-metrics',
      'fixeddata-species',
      'fixeddata-viewfulltable',
      'errors-explorer-query'
    ]);
    expect(steps[2].path).toBe('/api/dashboardmetrics/all/forestgeo_panama/2/9');
    expect(steps[5].method).toBe('POST');
  });

  it('summarizes samples and evaluates thresholds', () => {
    const samples = [
      { site: 'forestgeo_a', operation: 'dashboard', status: 200, ok: true, durationMs: 100 },
      { site: 'forestgeo_a', operation: 'dashboard', status: 200, ok: true, durationMs: 200 },
      { site: 'forestgeo_b', operation: 'dashboard', status: 500, ok: false, durationMs: 300, error: 'boom' },
      { site: 'forestgeo_b', operation: 'fixeddata', status: 200, ok: true, durationMs: 400 }
    ];

    const overall = summarizeSamples(samples);
    expect(overall.count).toBe(4);
    expect(overall.successCount).toBe(3);
    expect(overall.errorRate).toBe(0.25);
    expect(overall.p95Ms).toBe(400);

    const summary = buildReportSummary(samples);
    expect(summary.bySite.forestgeo_a.count).toBe(2);
    expect(summary.byOperation.dashboard.count).toBe(3);

    expect(
      evaluateThresholds(
        summary,
        {
          minSites: 2,
          maxErrorRate: 0.1,
          maxP95Ms: 350
        },
        2
      )
    ).toEqual(['Error rate 25.00% exceeded 10.00%.', 'Overall p95 400ms exceeded 350ms.']);
  });

  it('flags the multi-site guardrail when fewer site targets resolved than minSites', () => {
    // The whole point of a multi-site workshop tool is keeping several schemas hot; the previous
    // threshold test passed targetCount === minSites, so this branch was never exercised.
    const samples = [{ site: 'forestgeo_a', operation: 'dashboard', status: 200, ok: true, durationMs: 100 }];
    const summary = buildReportSummary(samples);
    // Only 1 site resolved against a minSites of 3 -> the guard must fire, and alone (error/p95 pass).
    expect(evaluateThresholds(summary, { minSites: 3, maxErrorRate: 0.5, maxP95Ms: 1000 }, 1)).toEqual([
      'Only 1 site target(s) resolved; expected at least 3.'
    ]);
  });

  it('does not flag the multi-site guardrail when targetCount meets minSites', () => {
    const samples = [{ site: 'forestgeo_a', operation: 'dashboard', status: 200, ok: true, durationMs: 100 }];
    const summary = buildReportSummary(samples);
    expect(evaluateThresholds(summary, { minSites: 2, maxErrorRate: 0.5, maxP95Ms: 1000 }, 2)).toEqual([]);
  });
});
