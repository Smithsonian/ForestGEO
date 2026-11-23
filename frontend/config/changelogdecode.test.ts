import { describe, expect, it } from 'vitest';
import {
  decodeChangelogRow,
  LEGACY_ROW_KEY_COLUMNS,
  splitEditOperationRecordID,
  type ChangelogRecord,
  type DecodableChangelogRow
} from '@/config/changelogdecode';
import { BULK_REVISION_SUMMARY_KIND, EDIT_OPERATION_RECORD_ID_MARKER } from '@/lib/changelog/edit-operation-projection';

const LEGACY_TABLE_COUNT = 14;

function row(overrides: Partial<DecodableChangelogRow>): DecodableChangelogRow {
  return { tableName: 'trees', recordID: '1', oldRowState: null, newRowState: null, ...overrides };
}

function decodedRecords(input: DecodableChangelogRow): ChangelogRecord[] {
  const decoded = decodeChangelogRow(input);
  expect(decoded.undecodable, `expected a decodable row, got undecodable for ${JSON.stringify(input)}`).toBe(false);
  return decoded.records;
}

describe('decodeChangelogRow: object states (every current writer)', () => {
  const snapshot = { CoreMeasurementID: 77, StemGUID: 5, UploadFileID: 'census1.csv', UploadBatchID: 'batch-a__sub001', MeasuredDBH: 12.5 };
  const objectStateWriters: Array<{ writer: string; input: DecodableChangelogRow; expected: ChangelogRecord }> = [
    {
      writer: 'W1 recordMutation INSERT',
      input: row({ tableName: 'quadrats', recordID: '12', newRowState: { QuadratID: 12, QuadratName: 'Q12' } }),
      expected: { primaryKey: '12', oldState: null, newState: { QuadratID: 12, QuadratName: 'Q12' } }
    },
    {
      writer: 'W1 recordMutation DELETE with a composite RecordID',
      input: row({ tableName: 'measurement_error_log', recordID: '77-3', oldRowState: { MeasurementID: 77, ErrorID: 3 } }),
      expected: { primaryKey: '77-3', oldState: { MeasurementID: 77, ErrorID: 3 }, newState: null }
    },
    {
      writer: 'W1 upsert UPDATE that captured no prior row',
      input: row({ tableName: 'species', recordID: '9', newRowState: { SpeciesID: 9, SpeciesCode: 'abcdsp' } }),
      expected: { primaryKey: '9', oldState: null, newState: { SpeciesID: 9, SpeciesCode: 'abcdsp' } }
    },
    {
      writer: 'W2 recordClearInChangelog partial state',
      input: row({
        tableName: 'coremeasurements',
        recordID: '77',
        oldRowState: { IsValidated: 0, ValidationErrors: [{ code: '14' }] },
        newRowState: { IsValidated: null }
      }),
      expected: { primaryKey: '77', oldState: { IsValidated: 0, ValidationErrors: [{ code: '14' }] }, newState: { IsValidated: null } }
    },
    {
      writer: 'W3 edit-operation projection',
      input: row({
        tableName: 'trees',
        recordID: `41${EDIT_OPERATION_RECORD_ID_MARKER}7`,
        oldRowState: { TreeID: 41, SpeciesID: 1 },
        newRowState: { TreeID: 41, SpeciesID: 2 }
      }),
      expected: { primaryKey: '41', oldState: { TreeID: 41, SpeciesID: 1 }, newState: { TreeID: 41, SpeciesID: 2 } }
    },
    {
      writer: 'W3 bulk revision summary',
      input: row({
        tableName: 'bulk-revision-apply',
        recordID: `planhash${EDIT_OPERATION_RECORD_ID_MARKER}8`,
        newRowState: { updatedCount: 4, summaryKind: BULK_REVISION_SUMMARY_KIND }
      }),
      expected: { primaryKey: 'planhash', oldState: null, newState: { updatedCount: 4, summaryKind: BULK_REVISION_SUMMARY_KIND } }
    },
    {
      writer: 'W4-W7 ingestion snapshot',
      input: row({ tableName: 'coremeasurements', recordID: '77', newRowState: snapshot }),
      expected: { primaryKey: '77', oldState: null, newState: snapshot }
    },
    {
      writer: 'W8 reference file_upload',
      input: row({ tableName: 'file_upload', recordID: 'species.csv', newRowState: { fileName: 'species.csv', rowCount: 3 } }),
      expected: { primaryKey: 'species.csv', oldState: null, newState: { fileName: 'species.csv', rowCount: 3 } }
    },
    {
      writer: 'W9 measurement file_upload keyed by attempt',
      input: row({ tableName: 'file_upload', recordID: 'census1.csv::session-1', newRowState: { fileName: 'census1.csv', batchCount: 2 } }),
      expected: { primaryKey: 'census1.csv::session-1', oldState: null, newState: { fileName: 'census1.csv', batchCount: 2 } }
    },
    {
      writer: 'W10 quadrat overlap acknowledgment',
      input: row({ tableName: 'quadrat_overlap_acknowledgment', recordID: 'a'.repeat(40), newRowState: { fileName: 'quadrats.csv', summaries: [{}] } }),
      expected: { primaryKey: 'a'.repeat(40), oldState: null, newState: { fileName: 'quadrats.csv', summaries: [{}] } }
    }
  ];

  it.each(objectStateWriters)('$writer gives exactly one record', ({ writer, input, expected }) => {
    const records = decodedRecords(input);
    expect(records, `${writer}: one object state is one record`).toEqual([expected]);
  });

  it('reads a state stored as JSON text the same as a parsed object', () => {
    const records = decodedRecords(row({ recordID: '5', oldRowState: '{"TreeID":5,"TreeTag":"A"}', newRowState: '{"TreeID":5,"TreeTag":"B"}' }));
    expect(records).toEqual([{ primaryKey: '5', oldState: { TreeID: 5, TreeTag: 'A' }, newState: { TreeID: 5, TreeTag: 'B' } }]);
  });

  it('keys an attribute by its stored Code even though the image also holds IsActive (D14)', () => {
    const records = decodedRecords(
      row({ tableName: 'attributes', recordID: 'DS', oldRowState: { Code: 'DS', IsActive: 1 }, newRowState: { Code: 'DS', IsActive: 0 } })
    );
    expect(records[0].primaryKey, 'object states never consult LEGACY_ROW_KEY_COLUMNS').toBe('DS');
  });

  it('gives no record when neither side holds an image', () => {
    expect(decodeChangelogRow(row({}))).toEqual({ records: [], undecodable: false });
  });
});

describe('decodeChangelogRow: legacy array states', () => {
  it('lists the fourteen interceptor tables with their schema primary keys', () => {
    expect(Object.keys(LEGACY_ROW_KEY_COLUMNS)).toHaveLength(LEGACY_TABLE_COUNT);
    expect(LEGACY_ROW_KEY_COLUMNS.attributes).toEqual(['Code', 'IsActive']);
    expect(LEGACY_ROW_KEY_COLUMNS.measurement_error_log).toEqual(['MeasurementID', 'ErrorID']);
    expect(LEGACY_ROW_KEY_COLUMNS.stems).toEqual(['StemGUID']);
  });

  it('reads an INSERT with an empty old array as one record with no old state', () => {
    const records = decodedRecords(row({ recordID: '8', oldRowState: [], newRowState: [{ TreeID: 8, TreeTag: 'T8' }] }));
    expect(records).toEqual([{ primaryKey: '8', oldState: null, newState: { TreeID: 8, TreeTag: 'T8' } }]);
  });

  it('reads a DELETE with an empty new array as one record with no new state', () => {
    const records = decodedRecords(row({ recordID: '8', oldRowState: [{ TreeID: 8, TreeTag: 'T8' }], newRowState: [] }));
    expect(records).toEqual([{ primaryKey: '8', oldState: { TreeID: 8, TreeTag: 'T8' }, newState: null }]);
  });

  it('pairs one image on each side when the key matches, comparing a number with a string', () => {
    const records = decodedRecords(row({ recordID: '8', oldRowState: [{ TreeID: 8, SpeciesID: 1 }], newRowState: [{ TreeID: '8', SpeciesID: 2 }] }));
    expect(records, 'TreeID 8 and "8" are the same row').toEqual([
      { primaryKey: '8', oldState: { TreeID: 8, SpeciesID: 1 }, newState: { TreeID: '8', SpeciesID: 2 } }
    ]);
  });

  it('splits one image on each side into two one-sided records when the keys differ', () => {
    const records = decodedRecords(row({ recordID: '8', oldRowState: [{ TreeID: 8, SpeciesID: 1 }], newRowState: [{ TreeID: 9, SpeciesID: 2 }] }));
    expect(records, 'the two reads returned different rows, so neither is the other’s after-image').toEqual([
      { primaryKey: '8', oldState: { TreeID: 8, SpeciesID: 1 }, newState: null },
      { primaryKey: '9', oldState: null, newState: { TreeID: 9, SpeciesID: 2 } }
    ]);
  });

  it('pairs a multi-row UPDATE by key regardless of stored order, before-images first', () => {
    const records = decodedRecords(
      row({
        recordID: '1|2|3',
        oldRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 },
          { TreeID: 3, SpeciesID: 10 }
        ],
        newRowState: [
          { TreeID: 3, SpeciesID: 30 },
          { TreeID: 1, SpeciesID: 11 },
          { TreeID: 4, SpeciesID: 40 }
        ]
      })
    );
    expect(records).toEqual([
      { primaryKey: '1', oldState: { TreeID: 1, SpeciesID: 10 }, newState: { TreeID: 1, SpeciesID: 11 } },
      { primaryKey: '2', oldState: { TreeID: 2, SpeciesID: 10 }, newState: null },
      { primaryKey: '3', oldState: { TreeID: 3, SpeciesID: 10 }, newState: { TreeID: 3, SpeciesID: 30 } },
      { primaryKey: '4', oldState: null, newState: { TreeID: 4, SpeciesID: 40 } }
    ]);
  });

  it('pairs composite-key tables by the full key only', () => {
    const errorLog = decodedRecords(
      row({
        tableName: 'measurement_error_log',
        recordID: '77',
        oldRowState: [
          { MeasurementID: 77, ErrorID: 3, IsResolved: 0 },
          { MeasurementID: 77, ErrorID: 4, IsResolved: 0 }
        ],
        newRowState: [{ MeasurementID: 77, ErrorID: 4, IsResolved: 1 }]
      })
    );
    expect(errorLog, 'the interceptor keyed this table by MeasurementID alone; the row key is (MeasurementID, ErrorID)').toEqual([
      { primaryKey: '77-3', oldState: { MeasurementID: 77, ErrorID: 3, IsResolved: 0 }, newState: null },
      { primaryKey: '77-4', oldState: { MeasurementID: 77, ErrorID: 4, IsResolved: 0 }, newState: { MeasurementID: 77, ErrorID: 4, IsResolved: 1 } }
    ]);

    const attributes = decodedRecords(
      row({
        tableName: 'attributes',
        recordID: 'DS',
        oldRowState: [{ Code: 'DS', IsActive: 1, Description: 'dead' }],
        newRowState: [{ Code: 'DS', IsActive: 0, Description: 'dead' }]
      })
    );
    expect(attributes, 'attributes is keyed (Code, IsActive): a flipped IsActive is a different row').toEqual([
      { primaryKey: 'DS-1', oldState: { Code: 'DS', IsActive: 1, Description: 'dead' }, newState: null },
      { primaryKey: 'DS-0', oldState: null, newState: { Code: 'DS', IsActive: 0, Description: 'dead' } }
    ]);
  });

  it('never pairs an image that lacks its key column, and keeps the stored RecordID for it', () => {
    const records = decodedRecords(row({ recordID: '8|9', oldRowState: [{ SpeciesID: 1 }], newRowState: [{ SpeciesID: 2 }] }));
    expect(records).toEqual([
      { primaryKey: '8|9', oldState: { SpeciesID: 1 }, newState: null },
      { primaryKey: '8|9', oldState: null, newState: { SpeciesID: 2 } }
    ]);
  });

  it('never pairs images of a table the interceptor did not handle', () => {
    const records = decodedRecords(row({ tableName: 'plots', recordID: '1', oldRowState: [{ PlotID: 1 }], newRowState: [{ PlotID: 1 }] }));
    expect(records.map(record => [record.oldState === null, record.newState === null])).toEqual([
      [false, true],
      [true, false]
    ]);
  });

  it.each(['constructor', 'toString', '__proto__'])('never pairs images through the inherited property %s used as a table name', inheritedName => {
    const records = decodedRecords(row({ tableName: inheritedName, recordID: '8', oldRowState: [{ TreeID: 8 }], newRowState: [{ TreeID: 8 }] }));
    expect(records, 'an inherited Object.prototype member is not a table the interceptor handled').toEqual([
      { primaryKey: '8', oldState: { TreeID: 8 }, newState: null },
      { primaryKey: '8', oldState: null, newState: { TreeID: 8 } }
    ]);
  });

  it('gives no record for empty arrays on both sides', () => {
    expect(decodeChangelogRow(row({ tableName: 'attributes', recordID: '0', oldRowState: '[]', newRowState: '[]' }))).toEqual({
      records: [],
      undecodable: false
    });
  });
});

describe('decodeChangelogRow: undecodable states', () => {
  it.each([
    { label: 'invalid JSON text', state: '{not json' },
    { label: 'a scalar number', state: 5 },
    { label: 'a JSON string scalar', state: '"just text"' },
    { label: 'an array holding a scalar', state: [{ TreeID: 1 }, 7] },
    { label: 'an array holding a nested array', state: [[{ TreeID: 1 }]] }
  ])('marks $label as undecodable', ({ label, state }) => {
    expect(decodeChangelogRow(row({ newRowState: state })), `new side: ${label}`).toEqual({ records: [], undecodable: true });
    expect(decodeChangelogRow(row({ oldRowState: state, newRowState: { TreeID: 1 } })), `old side: ${label}`).toEqual({ records: [], undecodable: true });
  });
});

describe('splitEditOperationRecordID', () => {
  it('separates the key from the edit operation id', () => {
    expect(splitEditOperationRecordID(`41${EDIT_OPERATION_RECORD_ID_MARKER}7`)).toEqual({ primaryKey: '41', editOperationID: '7' });
  });

  it('returns a RecordID without the marker whole', () => {
    expect(splitEditOperationRecordID('census1.csv::session-1')).toEqual({ primaryKey: 'census1.csv::session-1', editOperationID: null });
  });

  it('does not strip a marker that is not followed by a numeric id', () => {
    const recordID = `41${EDIT_OPERATION_RECORD_ID_MARKER}draft`;
    expect(splitEditOperationRecordID(recordID)).toEqual({ primaryKey: recordID, editOperationID: null });
  });
});
