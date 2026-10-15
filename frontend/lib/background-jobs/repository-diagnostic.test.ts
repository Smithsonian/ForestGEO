import { describe, expect, it, vi } from 'vitest';
import { recordSetupDiagnostic } from './repository';

describe('recordSetupDiagnostic safe optional fields', () => {
  it('persists lifecycle counters while omitting invalid values', async () => {
    const query = vi.fn().mockResolvedValue([{}, undefined]);
    const pool = { query } as never;
    const details = Object.assign(
      {
        attemptID: 'attempt',
        fileID: 'file.csv',
        batchID: 'batch',
        schema: 'forestgeo_test',
        plotID: 1,
        censusID: 2,
        step: 'splitting',
        outcome: 'completed',
        assignedRows: 12,
        operation: 'assign_interval',
        completedBatches: -1,
        rowCount: -2,
        detail: 'bounded'
      },
      {
        // Exercise malformed runtime values at the persistence boundary.
        operation: 'leak detail'
      }
    );
    await recordSetupDiagnostic(pool, 1, details as Parameters<typeof recordSetupDiagnostic>[2]);

    const persistedDetails = JSON.parse(query.mock.calls[0][1][3] as string) as Record<string, unknown>;
    expect(persistedDetails).toMatchObject({ assignedRows: 12, detail: 'bounded' });
    expect(persistedDetails).not.toHaveProperty('completedBatches');
    expect(persistedDetails).not.toHaveProperty('rowCount');
    expect(persistedDetails).not.toHaveProperty('operation');
  });
});
