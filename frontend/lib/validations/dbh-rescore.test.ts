import { describe, expect, it } from 'vitest';
import { reconcileDbhRescoreAttempt } from './dbh-rescore';

describe('reconcileDbhRescoreAttempt', () => {
  it('treats a completed marker that appears after the original session ends as committed', async () => {
    let markerReads = 0;
    const result = await reconcileDbhRescoreAttempt({ schema: 'forestgeo_testing', plotID: 1, censusID: 2 }, 'commit-between-reads', {
      originalConnectionID: 77,
      queryFresh: async sql => {
        if (sql.includes('validation_runs')) {
          markerReads += 1;
          return markerReads === 1 ? [] : [{ RunID: 91 }];
        }
        if (sql.includes('PROCESSLIST')) return [{ sessionCount: 0 }];
        return [{ transactionCount: 0 }];
      }
    });

    expect(markerReads).toBe(2);
    expect(result).toEqual({ databaseOutcome: 'committed', runID: 91, errors: [] });
  });
});
