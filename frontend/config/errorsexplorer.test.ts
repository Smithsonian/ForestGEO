import { describe, expect, it } from 'vitest';

import { INGESTION_ERROR_FIELD_MAP } from './errorsexplorer';

describe('INGESTION_ERROR_FIELD_MAP', () => {
  it('maps UNCLASSIFIED_REJECT to no fields, same as the other fieldless system codes', () => {
    expect(INGESTION_ERROR_FIELD_MAP.UNCLASSIFIED_REJECT).toEqual([]);
    expect(INGESTION_ERROR_FIELD_MAP.INTERRUPTED_UPLOAD).toEqual([]);
  });

  it('routes INVALID_COORDINATE to both local and plot coordinate fields, since a storage-range reject can come from either pair', () => {
    expect(INGESTION_ERROR_FIELD_MAP.INVALID_COORDINATE).toEqual(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY']);
  });
});
