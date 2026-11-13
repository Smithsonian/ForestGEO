import { describe, expect, it } from 'vitest';
import {
  buildRowFieldFaults,
  buildValidationFieldFaults,
  canEditMeasurementRows,
  describeValidationCell,
  describeViewDataValidationActions,
  EMPTY_CELL_DISPLAY,
  formatMeasurementDateRange,
  formatStemState,
  formatStemStatuses,
  formatViewDataCellValue,
  formatViewDataFactsLine,
  formatViewDataScopeLine,
  parseStemStatuses,
  parseViewDataStateCounts,
  resolveInitialShowOption,
  toViewDataRowSummary,
  VIEW_DATA_COLUMN_ORDER,
  VIEW_DATA_DEFAULT_HIDDEN_COLUMNS,
  VIEW_DATA_FILTERABLE_FIELDS,
  VIEW_DATA_NUMERIC_FIELDS,
  VIEW_DATA_SHOW_OPTIONS,
  VIEW_DATA_SORTABLE_FIELDS,
  VIEW_DATA_TEXT,
  type ViewDataStateCounts
} from './viewdata';
import { ERROR_TYPE_DISPLAY_LABELS, MARKED_INVALID_NO_ERROR_LOGGED_LABEL } from './errorsexplorer';
import { UNRESOLVED_ERROR_MESSAGES_SEPARATOR } from './measurementstatefilters';

const COUNTS: ViewDataStateCounts = {
  unresolvedLogged: 7,
  failedNoLog: 2,
  pending: 30,
  valid: 61,
  overridable: 9,
  revalidatable: 4,
  firstMeasurementDate: '2024-06-03',
  lastMeasurementDate: '2024-09-14'
};

describe('Show options (spec "Show control → filters")', () => {
  it('maps each option to its visible buckets and census-total count', () => {
    const observed = VIEW_DATA_SHOW_OPTIONS.map(option => ({ value: option.value, label: option.label, visible: option.visible, count: option.count(COUNTS) }));
    console.log('[show options]', JSON.stringify(observed));
    expect(observed).toEqual([
      { value: 'all', label: 'All', visible: ['errors', 'valid', 'pending'], count: 100 },
      { value: 'passed', label: 'Passed', visible: ['valid'], count: 61 },
      { value: 'pending', label: 'Pending', visible: ['pending'], count: 30 },
      { value: 'withErrors', label: 'With errors', visible: ['errors'], count: 9 }
    ]);
  });

  it.each([
    [undefined, 'all'],
    [['errors'], 'withErrors'],
    [['valid'], 'passed'],
    [['pending'], 'pending'],
    [['pending', 'valid', 'errors'], 'all'],
    [['valid', 'pending'], 'all'],
    [[], 'all']
  ])('resolveInitialShowOption(%j) → %s', (initial, expected) => {
    expect(resolveInitialShowOption(initial as never)).toBe(expected);
  });
});

describe('facts line and scope line', () => {
  it.each([
    ['2024-06-03', '2024-09-14', 'Jun 3 – Sep 14, 2024'],
    ['2023-12-30', '2024-01-04', 'Dec 30, 2023 – Jan 4, 2024'],
    ['2024-06-03T00:00:00.000Z', '2024-06-03T00:00:00.000Z', 'Jun 3 – Jun 3, 2024'],
    [null, '2024-06-03', null],
    [null, null, null]
  ])('formatMeasurementDateRange(%j, %j) → %j', (first, last, expected) => {
    expect(formatMeasurementDateRange(first, last)).toBe(expected);
  });

  it('reads "{n} active measurements · measured {range}", without the range when there are no dates, and with the read-only suffix for pending users', () => {
    const observed = {
      editor: formatViewDataFactsLine(COUNTS, false),
      noDates: formatViewDataFactsLine({ ...COUNTS, firstMeasurementDate: null, lastMeasurementDate: null }, false),
      readOnly: formatViewDataFactsLine(COUNTS, true)
    };
    console.log('[facts line]', JSON.stringify(observed));
    expect(observed.editor).toBe('100 active measurements · measured Jun 3 – Sep 14, 2024');
    expect(observed.noDates).toBe('100 active measurements');
    expect(observed.readOnly).toBe(`100 active measurements · measured Jun 3 – Sep 14, 2024 · ${VIEW_DATA_TEXT.readOnly}`);
  });

  it('formats the scope line', () => {
    expect(formatViewDataScopeLine('Luquillo', 'Luquillo Main Plot', 5)).toBe('Luquillo · Luquillo Main Plot · Census 5');
  });

  it('parses the counts row, including the two date columns, treating missing numbers as 0', () => {
    const observed = parseViewDataStateCounts({
      CountUnresolvedLogged: '3',
      CountPending: 2,
      FirstMeasurementDate: '2024-06-03T00:00:00.000Z',
      LastMeasurementDate: null
    });
    console.log('[counts]', JSON.stringify(observed));
    expect(observed).toEqual({
      unresolvedLogged: 3,
      failedNoLog: 0,
      pending: 2,
      valid: 0,
      overridable: 0,
      revalidatable: 0,
      firstMeasurementDate: '2024-06-03',
      lastMeasurementDate: null
    });
  });
});

describe('editors', () => {
  it.each([
    ['global', true],
    ['db admin', true],
    ['lead technician', true],
    ['field crew', true],
    ['pending', false],
    [undefined, false]
  ])('canEditMeasurementRows(%s) → %s', (userStatus, expected) => {
    expect(canEditMeasurementRows(userStatus as never)).toBe(expected);
  });
});

describe('stem state and stem status', () => {
  it('labels the three stem states and shows a dash otherwise', () => {
    expect([
      formatStemState('old tree'),
      formatStemState('multi stem'),
      formatStemState('new recruit'),
      formatStemState(undefined),
      formatStemState('weird')
    ]).toEqual(['Old tree', 'Multi-stem', 'New recruit', '—', '—']);
  });

  it('parses stem statuses into AttributeStatusOptions order and joins their labels with a middle dot', () => {
    const parsed = parseStemStatuses('dead,alive');
    console.log('[stem statuses]', JSON.stringify(parsed));
    expect(parsed).toEqual(['alive', 'dead']);
    expect(formatStemStatuses(parsed)).toBe('Alive · Dead');
    expect(formatStemStatuses(parseStemStatuses('alive-not measured,broken below'))).toBe('Alive, not measured · Broken below');
    expect(formatStemStatuses(parseStemStatuses(undefined))).toBe('—');
    expect(parseStemStatuses('alive,zombie')).toEqual(['alive']);
  });
});

describe('row summary and the Validation cell', () => {
  const STORED = 'Flagged;Different species';
  const STORED_QUADRATS = 'Flagged;Flagged;Different quadrats';
  // [D2] labels come from the shared map (View Errors Task 3), never from a copy.
  const label = (stored: string) => ERROR_TYPE_DISPLAY_LABELS.get(stored) ?? `missing shared label for ${stored}`;

  it('normalises mapper output where numeric 0 and false arrive as undefined', () => {
    const summary = toViewDataRowSummary({ measurementStatus: 'passed' });
    console.log('[row summary] passed', JSON.stringify(summary));
    expect(summary).toEqual({
      measurementStatus: 'passed',
      unresolvedErrorCount: 0,
      primaryErrorMessage: null,
      primaryErrorSource: null,
      unresolvedErrorCodes: [],
      unresolvedErrorMessages: [],
      hasContradiction: false,
      stemStatuses: []
    });
  });

  it('describes an unresolved row with its primary label, source, +n and the other errors as tooltip lines', () => {
    const summary = toViewDataRowSummary({
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCount: 3,
      primaryErrorMessage: STORED,
      primaryErrorSource: 'validation',
      unresolvedErrorCodes: 'validation:7,validation:9,validation:14',
      unresolvedErrorMessages: [STORED, STORED_QUADRATS, 'Invalid attribute code'].join(UNRESOLVED_ERROR_MESSAGES_SEPARATOR),
      hasContradiction: 1
    });
    const cell = describeValidationCell(summary);
    console.log('[validation cell] unresolved', JSON.stringify(cell));
    expect(cell).toEqual({
      status: 'unresolvedErrors',
      text: label(STORED),
      title: label(STORED),
      source: 'validation',
      extraErrorCount: 2,
      extraErrorLines: [label(STORED_QUADRATS), 'Invalid attribute code'],
      hasContradiction: true
    });
  });

  it('adds a "see Details" line when the messages list was truncated', () => {
    const cell = describeValidationCell(
      toViewDataRowSummary({
        measurementStatus: 'unresolvedErrors',
        unresolvedErrorCount: 4,
        primaryErrorMessage: STORED,
        primaryErrorSource: 'validation',
        unresolvedErrorMessages: STORED
      })
    );
    expect(cell.extraErrorLines).toEqual([VIEW_DATA_TEXT.moreErrorsInDetails]);
    expect(cell.extraErrorCount).toBe(3);
  });

  it.each([
    [
      { measurementStatus: 'ingestionFailed', unresolvedErrorCount: 1, primaryErrorMessage: 'Invalid species reference', primaryErrorSource: 'ingestion' },
      'Invalid species reference',
      'ingestion'
    ],
    [{ measurementStatus: 'invalidNoLog' }, MARKED_INVALID_NO_ERROR_LOGGED_LABEL, null],
    [{ measurementStatus: 'pending' }, VIEW_DATA_TEXT.validationPending, null],
    [{ measurementStatus: 'passed' }, VIEW_DATA_TEXT.validationPassed, null]
  ])('describes %j as "%s" with source %s', (row, text, source) => {
    const cell = describeValidationCell(toViewDataRowSummary(row));
    expect([cell.text, cell.source, cell.extraErrorCount]).toEqual([text, source, 0]);
  });
});

describe('faulted cells', () => {
  it('keys validation faults by Criteria field with the full description label (A21)', () => {
    const faults = buildValidationFieldFaults([
      {
        coreMeasurementID: 501,
        validationErrorIDs: [7, 14],
        descriptions: ['Flagged;Different species', 'Invalid attribute code'],
        criteria: ['stemTag;speciesCode', 'attributes']
      }
    ]);
    const observed = Object.fromEntries(faults.get(501) ?? []);
    console.log('[validation faults]', JSON.stringify(observed));
    const speciesLabel = ERROR_TYPE_DISPLAY_LABELS.get('Flagged;Different species');
    expect(speciesLabel).toBeDefined();
    expect(observed).toEqual({ stemTag: speciesLabel, speciesCode: speciesLabel, attributes: 'Invalid attribute code' });
  });

  it('adds ingestion fields for error rows and returns no faults for non-error rows', () => {
    const validation = new Map([['measuredDBH', 'DBH growth']]);
    const errorRow = toViewDataRowSummary({
      measurementStatus: 'unresolvedErrors',
      unresolvedErrorCodes: 'ingestion:COORDINATE_DRIFT,validation:1',
      unresolvedErrorCount: 2
    });
    const observed = Object.fromEntries(buildRowFieldFaults(errorRow, validation));
    console.log('[row faults]', JSON.stringify(observed));
    expect(observed).toEqual({ measuredDBH: 'DBH growth', stemLocalX: null, stemLocalY: null });
    expect(buildRowFieldFaults(toViewDataRowSummary({ measurementStatus: 'passed' }), validation).size).toBe(0);
    expect(buildRowFieldFaults(toViewDataRowSummary({ measurementStatus: 'invalidNoLog' }), validation).size).toBe(0);
  });
});

describe('validation actions (ported from components/client/validationactionsmenu.test.tsx)', () => {
  function action(id: string, counts: { pending: number; overridable: number; revalidatable: number }) {
    const found = describeViewDataValidationActions(counts).find(item => item.id === id);
    if (!found) throw new Error(`no action ${id}`);
    console.log('[validation action]', JSON.stringify({ counts, found }));
    return found;
  }

  it('Run validations is enabled with pending rows and describes the pending count', () => {
    expect(action('run-validations', { pending: 3, overridable: 0, revalidatable: 0 })).toEqual({
      id: 'run-validations',
      label: 'Run validations',
      description: 'Validate 3 pending rows',
      disabled: false
    });
    expect(action('run-validations', { pending: 1, overridable: 0, revalidatable: 0 }).description).toBe('Validate 1 pending row');
  });

  it('Run validations is enabled with revalidatable rows and describes the re-check count, not the overridable count', () => {
    expect(action('run-validations', { pending: 0, overridable: 5, revalidatable: 2 })).toMatchObject({
      description: 'Re-check 2 failed rows',
      disabled: false
    });
  });

  it('Run validations is disabled when the only failures are ingestion failures a rerun cannot fix', () => {
    expect(action('run-validations', { pending: 0, overridable: 4, revalidatable: 0 })).toMatchObject({ description: 'No rows to validate', disabled: true });
  });

  it('Run validations is disabled when there is nothing to validate at all', () => {
    expect(action('run-validations', { pending: 0, overridable: 0, revalidatable: 0 })).toMatchObject({ description: 'No rows to validate', disabled: true });
  });

  it('Override validations is driven by the full overridable count', () => {
    expect(action('override-validations', { pending: 0, overridable: 5, revalidatable: 2 })).toEqual({
      id: 'override-validations',
      label: 'Override validations',
      description: 'Force 5 eligible failed or not-yet-validated rows to pass',
      disabled: false
    });
  });

  it('Override validations is disabled with a clear message when no rows are eligible', () => {
    expect(action('override-validations', { pending: 0, overridable: 0, revalidatable: 0 })).toMatchObject({
      description: 'No eligible rows to override',
      disabled: true
    });
  });

  it('Reset all validation states is always enabled', () => {
    expect(action('reset-validations', { pending: 0, overridable: 0, revalidatable: 0 })).toEqual({
      id: 'reset-validations',
      label: 'Reset all validation states',
      description: 'Clear all errors and set rows to pending',
      disabled: false
    });
  });
});

describe('column whitelists', () => {
  it('orders the columns as the spec table and hides the four newly hidden data columns plus Subspecies (A13)', () => {
    console.log('[columns]', JSON.stringify({ order: VIEW_DATA_COLUMN_ORDER, hidden: VIEW_DATA_DEFAULT_HIDDEN_COLUMNS }));
    expect([...VIEW_DATA_COLUMN_ORDER]).toEqual([
      'actions',
      'measurementStatus',
      'stemState',
      'treeTag',
      'stemTag',
      'speciesCode',
      'speciesName',
      'subspeciesName',
      'quadratName',
      'stemLocalX',
      'stemLocalY',
      'stemPlotX',
      'stemPlotY',
      'measuredDBH',
      'measuredHOM',
      'measurementDate',
      'attributes',
      'stemStatus',
      'description'
    ]);
    expect([...VIEW_DATA_DEFAULT_HIDDEN_COLUMNS]).toEqual(['speciesName', 'subspeciesName', 'stemPlotX', 'stemPlotY', 'description']);
  });

  it('sorts by status and stem state but never by stem status or an ID; filters only real data columns', () => {
    expect(VIEW_DATA_SORTABLE_FIELDS).toContain('measurementStatus');
    expect(VIEW_DATA_SORTABLE_FIELDS).toContain('stemState');
    expect(VIEW_DATA_SORTABLE_FIELDS).not.toContain('stemStatus');
    expect(VIEW_DATA_SORTABLE_FIELDS).not.toContain('coreMeasurementID');
    expect(VIEW_DATA_FILTERABLE_FIELDS).not.toContain('measurementStatus');
    expect(VIEW_DATA_FILTERABLE_FIELDS).not.toContain('stemState');
    expect(VIEW_DATA_FILTERABLE_FIELDS).not.toContain('stemStatus');
  });
});

describe('formatViewDataCellValue (shared by the grid cells and the details sheet)', () => {
  it.each([
    ['a number field rounds to two decimals', 'measuredDBH', 12.3456, '12.35'],
    ['a numeric string is formatted like a number', 'stemLocalX', '1.5', '1.50'],
    ['a non-numeric value in a number field is shown as it came', 'measuredHOM', 'n/a', 'n/a'],
    ['a text field is shown as it came', 'treeTag', '010203', '010203'],
    ['a text field that looks numeric is not reformatted', 'quadratName', '0102', '0102'],
    ['null is a dash', 'measuredDBH', null, EMPTY_CELL_DISPLAY],
    ['undefined is a dash', 'treeTag', undefined, EMPTY_CELL_DISPLAY],
    ['an empty string is a dash', 'speciesCode', '', EMPTY_CELL_DISPLAY],
    ['zero is a value, not a dash', 'measuredDBH', 0, '0.00']
  ])('%s', (_label, field, value, expected) => {
    const formatted = formatViewDataCellValue(field, value);
    console.log('[cell value]', JSON.stringify({ field, value, formatted }));
    expect(formatted).toBe(expected);
  });

  it('formats exactly the six measurement number fields', () => {
    expect([...VIEW_DATA_NUMERIC_FIELDS].sort()).toEqual(['measuredDBH', 'measuredHOM', 'stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY']);
  });
});
