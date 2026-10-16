import { describe, expect, it, vi } from 'vitest';
import { recordSetupDiagnostic } from './repository';

describe('recordSetupDiagnostic safe optional fields', () => {
  it('persists lifecycle counters while omitting invalid values', async () => {
    const query = vi.fn().mockResolvedValue([{}, undefined]);
    const pool = { query } as never;
    const details = {
      attemptID: 'attempt',
      fileID: 'file.csv',
      batchID: 'batch',
      schema: 'forestgeo_test',
      plotID: 1,
      censusID: 2,
      step: 'splitting',
      outcome: 'completed',
      assignedRows: 12,
      completedBatches: -1,
      rowCount: -2,
      detail: 'bounded'
    };
    await recordSetupDiagnostic(pool, 1, details);

    const persistedDetails = JSON.parse(query.mock.calls[0][1][3] as string) as Record<string, unknown>;
    expect(persistedDetails).toMatchObject({ assignedRows: 12, detail: 'bounded' });
    expect(persistedDetails).not.toHaveProperty('completedBatches');
    expect(persistedDetails).not.toHaveProperty('rowCount');
  });
});
