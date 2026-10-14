import { describe, expect, it, vi } from 'vitest';
import { planDbhSweep, runDbhSweep, type DbhSweepDependencies } from './dbh-rescore-sweep';

const scope = (plotID: number, censusID: number, plotCensusNumber: number) => ({ schema: 'forestgeo_testing', plotID, censusID, plotCensusNumber });
const completed = (censusID: number) => ({ outcome: 'completed' as const, databaseOutcome: 'committed' as const, attemptID: String(censusID), errors: [] });

function deps(overrides: Partial<DbhSweepDependencies> = {}): DbhSweepDependencies {
  return {
    discoverScopes: vi.fn(),
    verifySchema: vi.fn().mockResolvedValue({ revision: 'r', digests: {} }),
    advisoryPreflight: vi.fn().mockResolvedValue({}),
    rescore: vi.fn(async value => completed(value.censusID)),
    writeArtifact: vi.fn(),
    now: () => '2026-09-07T00:00:00.000Z',
    ...overrides
  };
}

describe('planDbhSweep', () => {
  it('sorts each plot and reports later scopes for a single census request', () => {
    const plan = planDbhSweep([scope(1, 12, 2), scope(1, 11, 1), scope(1, 13, 3)], { plotID: 1, censusID: 12 });
    expect(plan.scopes.map(row => row.censusID)).toEqual([12]);
    expect(plan.followOn.map(row => row.censusID)).toEqual([13]);
  });

  it('rejects duplicate or invalid census sequence numbers', () => {
    expect(() => planDbhSweep([scope(1, 1, 1), scope(1, 2, 1)])).toThrow(/duplicate/);
    expect(() => planDbhSweep([{ ...scope(1, 1, 0) }])).toThrow(/invalid/);
  });
});

describe('runDbhSweep', () => {
  it('verifies every target before the first apply and defers later scopes in one plot while another proceeds', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), scope(1, 12, 2), scope(2, 21, 1)]);
    const run = vi.fn(async value =>
      value.censusID === 11
        ? { ...completed(value.censusID), outcome: 'deferred-pending' as const, databaseOutcome: 'not-started' as const }
        : completed(value.censusID)
    );
    const dependency = deps({ rescore: run });
    const result = await runDbhSweep(plan, dependency, true);
    expect(dependency.verifySchema).toHaveBeenCalledBefore(run);
    expect(run.mock.calls.map(([value]) => value.censusID)).toEqual([11, 21]);
    expect(result.deferred.map(row => row.censusID)).toEqual([11, 12]);
    expect(result.earliestUnfinished.get('forestgeo_testing:1')?.censusID).toBe(11);
  });

  it('halts every plot for unknown commit outcomes', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), scope(2, 21, 1)]);
    const dependency = deps({ rescore: vi.fn().mockResolvedValue({ ...completed(11), outcome: 'failed', databaseOutcome: 'unknown' }) });
    const result = await runDbhSweep(plan, dependency, true);
    expect(result.halted).toBe(true);
    expect(dependency.rescore).toHaveBeenCalledTimes(1);
  });

  it('continues another plot after an ordinary rolled-back result', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), scope(1, 12, 2), scope(2, 21, 1)]);
    const run = vi.fn(async value =>
      value.censusID === 11 ? { ...completed(value.censusID), outcome: 'failed' as const, databaseOutcome: 'rolled-back' as const } : completed(value.censusID)
    );
    const result = await runDbhSweep(plan, deps({ rescore: run }), true);
    expect(result.halted).toBe(false);
    expect(run.mock.calls.map(([value]) => value.censusID)).toEqual([11, 21]);
    expect(result.earliestUnfinished.get('forestgeo_testing:1')?.censusID).toBe(11);
  });

  it('halts every plot with an unknown outcome when a runner throws unexpectedly', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), scope(1, 12, 2), scope(2, 21, 1)]);
    const run = vi.fn(async value => {
      if (value.censusID === 11) throw new Error('unexpected runner loss');
      return completed(value.censusID);
    });
    const result = await runDbhSweep(plan, deps({ rescore: run }), true);
    expect(result.halted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([expect.objectContaining({ outcome: 'failed', databaseOutcome: 'unknown', errors: ['unexpected runner loss'] })]);
    expect(result.earliestUnfinished.get('forestgeo_testing:1')?.censusID).toBe(11);
    expect(result.earliestUnfinished.get('forestgeo_testing:2')?.censusID).toBe(21);
  });

  it('preserves a committed result and stops at the earliest unfinished scopes when its outcome artifact fails', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), scope(1, 12, 2), scope(2, 21, 1)]);
    const writeArtifact = vi.fn(async event => {
      if (event.event === 'scope-outcome') throw new Error('artifact volume unavailable');
    });
    const result = await runDbhSweep(plan, deps({ writeArtifact }), true);
    expect(result.halted).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ outcome: 'artifact-failed', databaseOutcome: 'committed', errors: ['artifact volume unavailable'] })
    ]);
    expect(result.deferred.map(row => row.censusID)).toEqual([11, 12, 21]);
    expect(result.earliestUnfinished.get('forestgeo_testing:1')?.censusID).toBe(11);
    expect(result.earliestUnfinished.get('forestgeo_testing:2')?.censusID).toBe(21);
  });

  it('does not run a scope when a later schema fails verification', async () => {
    const plan = planDbhSweep([scope(1, 11, 1), { ...scope(2, 21, 1), schema: 'forestgeo_other' }], {}, ['forestgeo_testing', 'forestgeo_other']);
    const verify = vi.fn(async schema => {
      if (schema === 'forestgeo_other') throw new Error('mismatched SQL');
      return { revision: 'r', digests: {} };
    });
    const dependency = deps({ verifySchema: verify });
    await expect(runDbhSweep(plan, dependency, true)).rejects.toThrow(/mismatched SQL/);
    expect(dependency.rescore).not.toHaveBeenCalled();
  });
});
