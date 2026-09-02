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

  // The point of classifying these shapes at all is that the explorer can
  // highlight the offending cell. A code with no entry here is no more useful
  // to a researcher than the UNCLASSIFIED_REJECT it replaced.
  it('points every parser-reject code at the cell the researcher has to fix', () => {
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_DBH).toEqual(['measuredDBH']);
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_HOM).toEqual(['measuredHOM']);
    expect(INGESTION_ERROR_FIELD_MAP.NON_NUMERIC_COORDINATE).toEqual(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY']);
    expect(INGESTION_ERROR_FIELD_MAP.INVALID_DATE).toEqual(['measurementDate']);
    expect(INGESTION_ERROR_FIELD_MAP.MALFORMED_ROW).toEqual(['treeTag', 'stemTag']);
  });

  it('keeps the retired MISSING_FIELD_COORDINATES entry so pre-split rows still highlight their coordinates', () => {
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_COORDINATES).toEqual(['stemLocalX', 'stemLocalY']);
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_LOCALX).toEqual(['stemLocalX']);
    expect(INGESTION_ERROR_FIELD_MAP.MISSING_FIELD_LOCALY).toEqual(['stemLocalY']);
  });
});
