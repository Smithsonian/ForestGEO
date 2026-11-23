import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  buildUploadRollupDraft,
  collectForeignKeyReferences,
  compareExportDrafts,
  describeChange,
  expandChange,
  EXPORT_COLUMNS,
  FILTERED_COUNT_SUFFIX,
  NO_FILE_RECORDED_KEY,
  serializeChangeExportCsv,
  SUMMARY_COLUMN_MARKER,
  toExportCells,
  type ChangeExportDraft,
  type DescribeChangeContext,
  type ExportCell,
  type ExportSourceChange,
  type ForeignKeyLabelMap,
  type UploadRollupGroup
} from '@/config/changelogexport';
import { BULK_REVISION_SUMMARY_KIND, EDIT_OPERATION_RECORD_ID_MARKER } from '@/lib/changelog/edit-operation-projection';

const EXPORT_COLUMN_COUNT = 13;
const CHANGE_TIME = '2026-11-20 14:05:09';
const CHANGE_DATE = '2026-11-20';
const CHANGED_BY = 'researcher@forestgeo.test';
const PLOT_ID = 4;
const CENSUS_ID = 9;
const NO_LABELS: ForeignKeyLabelMap = { SpeciesID: new Map(), QuadratID: new Map() };
const UNFILTERED: DescribeChangeContext = { labels: NO_LABELS, countsAreFiltered: false };

const COLUMN_INDEX = Object.fromEntries(EXPORT_COLUMNS.map((column, index) => [column, index])) as Record<(typeof EXPORT_COLUMNS)[number], number>;

function change(overrides: Partial<ExportSourceChange>): ExportSourceChange {
  return {
    changeID: 100,
    tableName: 'trees',
    recordID: '41',
    operation: 'UPDATE',
    oldRowState: null,
    newRowState: null,
    changeTime: CHANGE_TIME,
    changedBy: CHANGED_BY,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    ...overrides
  };
}

function rollupGroup(overrides: Partial<UploadRollupGroup>): UploadRollupGroup {
  return {
    logID: 500,
    changeTime: CHANGE_TIME,
    changedTable: 'coremeasurements',
    operation: 'INSERT',
    changedBy: CHANGED_BY,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    fileID: 'census1.csv',
    baseBatchID: 'batch-a',
    memberCount: 250,
    ...overrides
  };
}

function cellsOf(drafts: ChangeExportDraft[], context: DescribeChangeContext = UNFILTERED): ExportCell[][] {
  return drafts.map(draft => toExportCells(draft, context));
}

/** [ChangedColumn, Action, Old, New] per row: the part of a row that the expansion rules decide. */
function fieldRows(drafts: ChangeExportDraft[]): ExportCell[][] {
  return cellsOf(drafts).map(cells => [cells[COLUMN_INDEX.ChangedColumn], cells[COLUMN_INDEX.Action], cells[COLUMN_INDEX.Old], cells[COLUMN_INDEX.New]]);
}

function descriptions(drafts: ChangeExportDraft[], context: DescribeChangeContext = UNFILTERED): string[] {
  return drafts.map(draft => describeChange(draft.descriptor, context));
}

function parseCsv(csv: string): string[][] {
  const parsed = Papa.parse<string[]>(csv, { header: false });
  expect(parsed.errors, `CSV must parse cleanly: ${JSON.stringify(parsed.errors)}`).toEqual([]);
  return parsed.data;
}

describe('expandChange: rule precedence (spec §6.2)', () => {
  it('rule 1: a bulk-revision summary is one * row even though its OldRowState is NULL like a rule-6 record', () => {
    const drafts = expandChange(
      change({
        tableName: 'bulk-revision-apply',
        recordID: `planhash${EDIT_OPERATION_RECORD_ID_MARKER}8`,
        newRowState: { updatedCount: 4, skippedCount: 1, insertedCount: 2, deletedDuplicateCount: 0, summaryKind: BULK_REVISION_SUMMARY_KIND }
      })
    );
    expect(cellsOf(drafts)).toEqual([
      [
        100,
        CHANGED_BY,
        'bulk-revision-apply',
        'planhash',
        SUMMARY_COLUMN_MARKER,
        CHANGE_DATE,
        CHANGE_TIME,
        'Applied a bulk revision: 4 updated, 1 skipped, 2 inserted, 0 duplicate(s) removed (edit #8)',
        'U',
        '',
        '',
        PLOT_ID,
        CENSUS_ID
      ]
    ]);
  });

  it('rule 1: a bulk revision lists only the counts its stored summary holds', () => {
    const drafts = expandChange(
      change({
        tableName: 'bulk-revision-apply',
        recordID: `planhash${EDIT_OPERATION_RECORD_ID_MARKER}8`,
        newRowState: { updatedCount: 4, failedRowCount: 3, summaryKind: BULK_REVISION_SUMMARY_KIND }
      })
    );
    expect(descriptions(drafts)).toEqual(['Applied a bulk revision: 4 updated, 3 failed (edit #8)']);
  });

  it('rule 2: both file_upload shapes and an old plain-RecordID row are one * row each, never field rows', () => {
    const reference = expandChange(
      change({
        tableName: 'file_upload',
        recordID: 'species.csv',
        operation: 'INSERT',
        newRowState: {
          fileName: 'species.csv',
          formType: 'species',
          uploadMode: 'revisions',
          rowCount: 30,
          insertedCount: 20,
          updatedCount: 8,
          skippedCount: 2
        }
      })
    );
    const measurement = expandChange(
      change({
        tableName: 'file_upload',
        recordID: 'census1.csv::session-1',
        operation: 'INSERT',
        newRowState: {
          fileName: 'census1.csv',
          uploadSessionID: 'session-1',
          formType: 'measurements',
          sourceFormat: 'csv',
          uploadMode: 'clean_reupload',
          chunksByIdentity: { a: { rowCount: 100, droppedCount: 3 } },
          rowCount: 100,
          droppedCount: 3,
          batchCount: 1
        }
      })
    );
    const oldPlainRow = expandChange(change({ tableName: 'file_upload', recordID: 'legacy.csv', operation: 'INSERT', newRowState: { name: 'legacy.csv' } }));

    expect(fieldRows(reference), 'reference shape').toEqual([[SUMMARY_COLUMN_MARKER, 'I', '', '']]);
    expect(reference[0].primaryKey).toBe('species.csv');
    expect(descriptions(reference)).toEqual(['Uploaded species.csv (species, revisions): 30 rows; 20 inserted, 8 updated, 2 skipped']);

    expect(measurement[0].primaryKey, 'the stored RecordID keeps attempts apart and is never split').toBe('census1.csv::session-1');
    expect(descriptions(measurement)).toEqual(['Uploaded census1.csv (measurements, csv): 100 rows staged, 3 dropped, in 1 chunk(s)']);

    expect(descriptions(oldPlainRow), 'no fileName and no counts: the RecordID names the file and no count is invented').toEqual(['Uploaded legacy.csv']);
  });

  it('rule 2: a count missing from a file_upload state is left out, never written as 0', () => {
    const drafts = expandChange(
      change({
        tableName: 'file_upload',
        recordID: 'species.csv',
        operation: 'INSERT',
        newRowState: { fileName: 'species.csv', formType: 'species', rowCount: 30, updatedCount: 8 }
      })
    );
    expect(descriptions(drafts)).toEqual(['Uploaded species.csv (species): 30 rows; 8 updated']);
  });

  it('rule 2: a quadrat overlap acknowledgment is one * row counting its layouts', () => {
    const drafts = expandChange(
      change({
        tableName: 'quadrat_overlap_acknowledgment',
        recordID: 'f'.repeat(40),
        operation: 'INSERT',
        newRowState: { statement: 'I acknowledge', acknowledgedBy: CHANGED_BY, fileName: 'quadrats.csv', uploadMode: 'revisions', summaries: [{}, {}] }
      })
    );
    expect(fieldRows(drafts)).toEqual([[SUMMARY_COLUMN_MARKER, 'I', '', '']]);
    expect(drafts[0].primaryKey).toBe('f'.repeat(40));
    expect(descriptions(drafts)).toEqual(['Acknowledged overlapping quadrats in upload quadrats.csv (2 layout(s))']);
  });

  it.each([
    { label: 'an undecodable state', newRowState: 5 as unknown },
    { label: 'no image on either side', newRowState: null as unknown },
    { label: 'empty arrays on both sides', newRowState: [] as unknown }
  ])('rule 3: $label is one * row keyed by the stored RecordID', ({ newRowState }) => {
    const drafts = expandChange(
      change({ tableName: 'attributes', recordID: '0', operation: 'INSERT', oldRowState: newRowState === null ? null : [], newRowState })
    );
    expect(fieldRows(drafts)).toEqual([[SUMMARY_COLUMN_MARKER, 'I', '', '']]);
    expect(drafts[0].primaryKey).toBe('0');
    expect(descriptions(drafts)).toEqual(['INSERT on attributes 0 was recorded; row images are unavailable']);
  });

  it('rule 4: an INSERT lists one row per recorded field alphabetically with Old blank', () => {
    const drafts = expandChange(
      change({
        tableName: 'quadrats',
        recordID: '12',
        operation: 'INSERT',
        newRowState: { QuadratName: 'Q12', Area: 400, QuadratID: 12, StartX: null, CreatedAt: 'x' }
      })
    );
    expect(fieldRows(drafts), 'null StartX and excluded CreatedAt get no row').toEqual([
      ['Area', 'I', '', 400],
      ['QuadratID', 'I', '', 12],
      ['QuadratName', 'I', '', 'Q12']
    ]);
    expect(new Set(descriptions(drafts)), 'every field row of one record shares one Description').toEqual(new Set(['Added quadrats 12']));
  });

  it('rule 5: a DELETE lists one row per recorded field with New blank', () => {
    const drafts = expandChange(change({ tableName: 'quadrats', recordID: '12', operation: 'DELETE', oldRowState: { QuadratName: 'Q12', QuadratID: 12 } }));
    expect(fieldRows(drafts)).toEqual([
      ['QuadratID', 'D', 12, ''],
      ['QuadratName', 'D', 'Q12', '']
    ]);
    expect(new Set(descriptions(drafts))).toEqual(new Set(['Deleted quadrats 12']));
  });

  it('rule 6: a W1 upsert UPDATE that stored no prior row lists the new values with Old blank and says so', () => {
    const drafts = expandChange(change({ tableName: 'species', recordID: '9', newRowState: { SpeciesID: 9, SpeciesCode: 'abcdsp' } }));
    expect(fieldRows(drafts)).toEqual([
      ['SpeciesCode', 'U', '', 'abcdsp'],
      ['SpeciesID', 'U', '', 9]
    ]);
    expect(new Set(descriptions(drafts))).toEqual(new Set(['Updated species 9; prior values were not recorded']));
  });

  it('rule 8: a W1 upsert UPDATE that stored both images is a field diff with Old filled', () => {
    const drafts = expandChange(
      change({
        tableName: 'species',
        recordID: '9',
        oldRowState: { SpeciesID: 9, SpeciesCode: 'abcdsp', IDLevel: 'species' },
        newRowState: { SpeciesID: 9, SpeciesCode: 'abcdef', IDLevel: 'species' }
      })
    );
    expect(fieldRows(drafts)).toEqual([['SpeciesCode', 'U', 'abcdsp', 'abcdef']]);
    expect(descriptions(drafts)).toEqual(['Changed SpeciesCode on species 9']);
  });

  it('rule 7: a legacy before-image with no after-image is a U row with New blank, never a D', () => {
    const drafts = expandChange(change({ recordID: '8', oldRowState: [{ TreeID: 8, SpeciesID: 1 }], newRowState: [] }));
    expect(fieldRows(drafts)).toEqual([
      ['SpeciesID', 'U', 1, ''],
      ['TreeID', 'U', 8, '']
    ]);
    expect(new Set(descriptions(drafts))).toEqual(new Set(['Updated trees 8; new values were not recorded (legacy log entry)']));
  });

  it('expands every record of a legacy multi-row change in record order', () => {
    const drafts = expandChange(
      change({
        recordID: '1|2',
        oldRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 }
        ],
        newRowState: [
          { TreeID: 2, SpeciesID: 30 },
          { TreeID: 1, SpeciesID: 20 }
        ]
      })
    );
    expect(cellsOf(drafts).map(cells => [cells[COLUMN_INDEX.LogID], cells[COLUMN_INDEX.PrimaryKey], cells[COLUMN_INDEX.Old], cells[COLUMN_INDEX.New]])).toEqual(
      [
        [100, '1', 10, 20],
        [100, '2', 10, 30]
      ]
    );
  });
});

describe('expandChange: records that yield no field row', () => {
  it('D11: a paired UPDATE whose only differences are excluded fields is suppressed', () => {
    const drafts = expandChange(change({ oldRowState: { TreeID: 41, UpdatedAt: '2026-01-01' }, newRowState: { TreeID: 41, UpdatedAt: '2026-02-02' } }));
    expect(drafts, 'no CSV row; the reader counts this change as suppressed').toEqual([]);
  });

  it('D11: only the record that differs is emitted when another record of the same change does not', () => {
    const drafts = expandChange(
      change({
        recordID: '1|2',
        oldRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 }
        ],
        newRowState: [
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 11 }
        ]
      })
    );
    expect(fieldRows(drafts)).toEqual([['SpeciesID', 'U', 10, 11]]);
    expect(drafts[0].primaryKey).toBe('2');
  });

  it.each([
    {
      label: 'an INSERT image',
      operation: 'INSERT' as const,
      oldRowState: null,
      newRowState: { id: 3, Note: null },
      expected: 'Added trees 41; no field values were recorded',
      action: 'I'
    },
    {
      label: 'a DELETE image',
      operation: 'DELETE' as const,
      oldRowState: { CreatedAt: 'x', Note: null },
      newRowState: null,
      expected: 'Deleted trees 41; no field values were recorded',
      action: 'D'
    },
    {
      label: 'a one-sided UPDATE',
      operation: 'UPDATE' as const,
      oldRowState: null,
      newRowState: { UpdatedAt: 'x' },
      expected: 'Updated trees 41; no field values were recorded',
      action: 'U'
    }
  ])('$label holding only null or excluded fields is one * row with its real verb', ({ operation, oldRowState, newRowState, expected, action }) => {
    const drafts = expandChange(change({ operation, oldRowState, newRowState }));
    expect(fieldRows(drafts)).toEqual([[SUMMARY_COLUMN_MARKER, action, '', '']]);
    expect(descriptions(drafts), 'the text must never contradict Action').toEqual([expected]);
  });
});

describe('expandChange: PlotID and CensusID are ordinary fields (D8)', () => {
  it('emits a row for a real PlotID change and a real CensusID change', () => {
    const drafts = expandChange(
      change({
        tableName: 'quadrats',
        recordID: '12',
        oldRowState: { QuadratID: 12, PlotID: 1, CensusID: 5 },
        newRowState: { QuadratID: 12, PlotID: 2, CensusID: 6 }
      })
    );
    expect(fieldRows(drafts)).toEqual([
      ['CensusID', 'U', 5, 6],
      ['PlotID', 'U', 1, 2]
    ]);
  });

  it('emits neither when a writer-shaped UPDATE left them unchanged', () => {
    const snapshotBefore = { CoreMeasurementID: 77, CensusID: 5, MeasuredDBH: 12.5, UploadBatchID: 'b' };
    const drafts = expandChange(
      change({ tableName: 'coremeasurements', recordID: '77', oldRowState: snapshotBefore, newRowState: { ...snapshotBefore, MeasuredDBH: 13 } })
    );
    expect(fieldRows(drafts)).toEqual([['MeasuredDBH', 'U', 12.5, 13]]);
  });

  it('lists PlotID and CensusID among the fields of an INSERT', () => {
    const drafts = expandChange(change({ tableName: 'quadrats', recordID: '12', operation: 'INSERT', newRowState: { QuadratID: 12, PlotID: 1, CensusID: 5 } }));
    expect(fieldRows(drafts).map(([column]) => column)).toEqual(['CensusID', 'PlotID', 'QuadratID']);
  });
});

describe('upload rollup rows (spec §6.3)', () => {
  it.each([
    { operation: 'INSERT' as const, action: 'I', expected: 'Upload census1.csv: added 250 measurement rows (batch batch-a)' },
    { operation: 'UPDATE' as const, action: 'U', expected: 'Upload census1.csv: updated 250 measurement rows (batch batch-a)' },
    {
      operation: 'DELETE' as const,
      action: 'D',
      expected: 'Upload pipeline removed 250 measurements originally loaded from census1.csv (original batch batch-a)'
    }
  ])('$operation is one * row keyed by the file', ({ operation, action, expected }) => {
    const draft = buildUploadRollupDraft(rollupGroup({ operation }));
    expect(toExportCells(draft, UNFILTERED)).toEqual([
      500,
      CHANGED_BY,
      'coremeasurements',
      'census1.csv',
      SUMMARY_COLUMN_MARKER,
      CHANGE_DATE,
      CHANGE_TIME,
      expected,
      action,
      '',
      '',
      PLOT_ID,
      CENSUS_ID
    ]);
  });

  it('puts rows with no usable file id in the no-file bucket', () => {
    const draft = buildUploadRollupDraft(rollupGroup({ operation: 'DELETE', fileID: null, baseBatchID: null, memberCount: 4 }));
    expect(draft.primaryKey).toBe(NO_FILE_RECORDED_KEY);
    expect(describeChange(draft.descriptor, UNFILTERED)).toBe(
      'Upload pipeline removed 4 measurements originally loaded from no file recorded (no batch recorded)'
    );
  });

  it('marks the count as partial when a quick search or a date bound narrows the export', () => {
    const draft = buildUploadRollupDraft(rollupGroup({}));
    const filtered = describeChange(draft.descriptor, { labels: NO_LABELS, countsAreFiltered: true });
    expect(filtered).toBe(`Upload census1.csv: added 250 measurement rows (batch batch-a)${FILTERED_COUNT_SUFFIX}`);
    expect(describeChange(draft.descriptor, UNFILTERED).endsWith(FILTERED_COUNT_SUFFIX)).toBe(false);
  });
});

describe('describeChange: labels and edit operations (spec §6.4)', () => {
  const labels: ForeignKeyLabelMap = {
    SpeciesID: new Map([
      [1, 'abcdsp'],
      [2, 'abcdef']
    ]),
    QuadratID: new Map([[7, 'Q0707']])
  };

  it('appends the current species codes for both IDs and the edit operation', () => {
    const drafts = expandChange(
      change({ recordID: `41${EDIT_OPERATION_RECORD_ID_MARKER}7`, oldRowState: { TreeID: 41, SpeciesID: 1 }, newRowState: { TreeID: 41, SpeciesID: 2 } })
    );
    expect(descriptions(drafts, { labels, countsAreFiltered: false })).toEqual(['Changed SpeciesID on trees 41 (abcdsp → abcdef) (edit #7)']);
    expect(fieldRows(drafts), 'Old and New stay the raw stored IDs').toEqual([['SpeciesID', 'U', 1, 2]]);
  });

  it('keeps the raw ID where no current row exists and says none for a missing value', () => {
    const drafts = expandChange(
      change({ tableName: 'stems', recordID: '300', oldRowState: { StemGUID: 300, QuadratID: null }, newRowState: { StemGUID: 300, QuadratID: 99 } })
    );
    expect(descriptions(drafts, { labels, countsAreFiltered: false })).toEqual(['Changed QuadratID on stems 300 (none → 99)']);
  });

  it('reports the distinct positive-integer IDs that field updates reference, and nothing else', () => {
    const drafts = [
      ...expandChange(change({ oldRowState: { TreeID: 41, SpeciesID: 1 }, newRowState: { TreeID: 41, SpeciesID: '2' } })),
      ...expandChange(change({ changeID: 101, oldRowState: { TreeID: 42, SpeciesID: 2 }, newRowState: { TreeID: 42, SpeciesID: 'x; DROP' } })),
      ...expandChange(
        change({
          changeID: 102,
          tableName: 'stems',
          recordID: '300',
          oldRowState: { StemGUID: 300, QuadratID: 7 },
          newRowState: { StemGUID: 300, QuadratID: -3 }
        })
      ),
      ...expandChange(change({ changeID: 103, tableName: 'trees', recordID: '50', operation: 'INSERT', newRowState: { TreeID: 50, SpeciesID: 77 } }))
    ];
    expect(collectForeignKeyReferences(drafts), 'an INSERT row is not a field update; non-integers are never looked up').toEqual({
      SpeciesID: [1, 2],
      QuadratID: [7]
    });
  });
  it.each(['constructor', 'toString', 'hasOwnProperty'])('treats a changed field named %s as an ordinary field, not a labelled foreign key', column => {
    const drafts = expandChange(
      change({ tableName: 'stems', recordID: '300', oldRowState: { StemGUID: 300, [column]: 4 }, newRowState: { StemGUID: 300, [column]: 5 } })
    );
    expect(collectForeignKeyReferences(drafts), 'an inherited Object property is not a labelled column').toEqual({ SpeciesID: [], QuadratID: [] });
    expect(descriptions(drafts, { labels, countsAreFiltered: false })).toEqual([`Changed ${column} on stems 300`]);
  });
});

describe('value formatting and serialization (spec §5)', () => {
  function csvFor(newRowState: Record<string, unknown>): string[][] {
    const drafts = expandChange(change({ tableName: 'coremeasurements', recordID: '77', operation: 'INSERT', newRowState }));
    return parseCsv(serializeChangeExportCsv(cellsOf(drafts)));
  }

  it('writes the thirteen-column header first', () => {
    expect(EXPORT_COLUMNS).toHaveLength(EXPORT_COLUMN_COUNT);
    expect(csvFor({ MeasuredDBH: 1 })[0]).toEqual([...EXPORT_COLUMNS]);
  });

  it('writes a negative number plainly and escapes a string that starts with a minus sign', () => {
    const raw = serializeChangeExportCsv(
      cellsOf(expandChange(change({ tableName: 'coremeasurements', recordID: '77', operation: 'INSERT', newRowState: { RawX: -12.5, RawY: '-12.5' } })))
    );
    const rows = parseCsv(raw);
    const newCells = Object.fromEntries(rows.slice(1).map(cells => [cells[COLUMN_INDEX.ChangedColumn], cells[COLUMN_INDEX.New]]));
    expect(newCells, `raw CSV:\n${raw}`).toEqual({ RawX: '-12.5', RawY: "'-12.5" });
  });

  it('round-trips nested object and array values through the CSV as JSON', () => {
    const userDefinedFields = { note: 'a,b "quoted"', nested: { depth: [1, 2] } };
    const rows = csvFor({ UserDefinedFields: userDefinedFields, RawCodes: ['A', 'B'] });
    const newCells = Object.fromEntries(rows.slice(1).map(cells => [cells[COLUMN_INDEX.ChangedColumn], cells[COLUMN_INDEX.New]]));
    expect(JSON.parse(newCells.UserDefinedFields)).toEqual(userDefinedFields);
    expect(JSON.parse(newCells.RawCodes)).toEqual(['A', 'B']);
  });

  it('writes booleans and blank scope cells', () => {
    const drafts = expandChange(
      change({
        tableName: 'attributes',
        recordID: 'DS',
        operation: 'INSERT',
        changedBy: null,
        plotID: null,
        censusID: null,
        changeTime: null,
        newRowState: { IsActive: true }
      })
    );
    const [, row] = parseCsv(serializeChangeExportCsv(cellsOf(drafts)));
    expect(row).toEqual(['100', '', 'attributes', 'DS', 'IsActive', '', '', 'Added attributes DS', 'I', '', 'true', '', '']);
  });

  it('escapes a formula cell, including one whose formula is followed by a line break', () => {
    const rows = csvFor({ Description: '=cmd|" /C calc"!A0', RawComments: '=1+1\nx' });
    const newCells = Object.fromEntries(rows.slice(1).map(cells => [cells[COLUMN_INDEX.ChangedColumn], cells[COLUMN_INDEX.New]]));
    expect(newCells.Description).toBe(`'=cmd|" /C calc"!A0`);
    expect(newCells.RawComments, 'Papa’s built-in pattern leaves this multi-line cell unescaped').toBe("'=1+1\nx");
    expect(Papa.unparse([['=1+1\nx']], { escapeFormulae: true }), 'the built-in pattern this export replaces').toBe('"=1+1\nx"');
  });

  it('serializes an empty export as the header alone with no trailing newline', () => {
    const csv = serializeChangeExportCsv([]);
    expect(csv).toBe(EXPORT_COLUMNS.join(','));
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.data, 'zero data rows').toEqual([]);
    expect(parsed.errors, 'zero parse errors').toEqual([]);
  });
});

describe('compareExportDrafts (spec §5)', () => {
  function draftAt(logID: number, changeTime: string | null, changedColumn = SUMMARY_COLUMN_MARKER): ChangeExportDraft {
    return { ...buildUploadRollupDraft(rollupGroup({ logID, changeTime })), changedColumn };
  }

  it('orders a blank time first, then by time, then by LogID', () => {
    const drafts = [
      draftAt(9, '2026-11-20 10:00:00'),
      draftAt(3, '2026-11-21 08:00:00'),
      draftAt(7, null),
      draftAt(4, '2026-11-20 10:00:00'),
      draftAt(2, null)
    ];
    expect(drafts.sort(compareExportDrafts).map(draft => [draft.changeTime, draft.logID])).toEqual([
      [null, 2],
      [null, 7],
      ['2026-11-20 10:00:00', 4],
      ['2026-11-20 10:00:00', 9],
      ['2026-11-21 08:00:00', 3]
    ]);
  });

  it('keeps the rows of one change in their expansion order', () => {
    const drafts = [draftAt(5, CHANGE_TIME, 'TreeTag'), draftAt(5, CHANGE_TIME, 'SpeciesID'), draftAt(1, CHANGE_TIME, 'Zeta'), draftAt(5, CHANGE_TIME, 'Area')];
    expect(drafts.sort(compareExportDrafts).map(draft => draft.changedColumn)).toEqual(['Zeta', 'TreeTag', 'SpeciesID', 'Area']);
  });
});
