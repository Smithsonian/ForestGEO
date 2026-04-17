import { describe, expect, it, vi } from 'vitest';

import { backfillLegacyUploadTrackingColumns } from './local-db-setup';

describe('backfillLegacyUploadTrackingColumns', () => {
  it('returns the backfill summary from the executed queries', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 4 }])
      .mockResolvedValueOnce([[{ count: 1 }]])
      .mockResolvedValueOnce([[{ count: 2 }]]);

    const result = await backfillLegacyUploadTrackingColumns({ query } as any);

    expect(result).toEqual({
      backfilledRows: 4,
      remainingRowsWithMetadataGaps: 1,
      conflictingRows: 2
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[0][0])).toContain('UPDATE coremeasurements');
    expect(String(query.mock.calls[1][0])).toContain('UploadFileID IS NULL OR UploadBatchID IS NULL');
    expect(String(query.mock.calls[2][0])).toContain('UploadFileID <>');
  });
});
