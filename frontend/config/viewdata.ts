import { AttributeStatusOptions } from '@/lib/db/definitions/core';
import type { TSSFilter, VisibleFilter } from '@/config/datagridhelpers';
import type { UserAuthRoles } from '@/config/macros';
import { formatCalendarDate, parseCalendarDay, toCalendarDayString } from '@/config/dateformats';
import { formatErrorTypeLabel, INGESTION_ERROR_FIELD_MAP, MARKED_INVALID_NO_ERROR_LOGGED_LABEL, type ErrorSourceKind } from '@/config/errorsexplorer';
import {
  MEASUREMENT_STATUSES,
  STEM_STATUSES_SEPARATOR,
  UNRESOLVED_ERROR_CODE_PART_SEPARATOR,
  UNRESOLVED_ERROR_CODES_SEPARATOR,
  UNRESOLVED_ERROR_MESSAGES_SEPARATOR,
  type MeasurementStatus
} from '@/config/measurementstatefilters';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const VIEW_DATA_ROW_HEIGHT = 44;
export const VIEW_DATA_ACTIONS_COLUMN_WIDTH = { editor: 92, readOnly: 64 } as const;
export const VIEW_DATA_DEFAULT_COLUMN_WIDTH = 100;

export const VIEW_DATA_FIELDS = {
  actions: 'actions',
  measurementStatus: 'measurementStatus',
  stemState: 'stemState',
  stemStatus: 'stemStatus',
  measurementDate: 'measurementDate',
  attributes: 'attributes',
  speciesCode: 'speciesCode'
} as const;

/** After Validation and Stem state, the measurement upload form's order (config/macros/formdetails.ts). */
export const VIEW_DATA_DATA_FIELD_ORDER = [
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
] as const;

export const VIEW_DATA_COLUMN_ORDER = [
  VIEW_DATA_FIELDS.actions,
  VIEW_DATA_FIELDS.measurementStatus,
  VIEW_DATA_FIELDS.stemState,
  ...VIEW_DATA_DATA_FIELD_ORDER
] as const;

export const VIEW_DATA_COLUMN_WIDTHS: Readonly<Record<string, number>> = {
  measurementStatus: 228,
  stemState: 108,
  treeTag: 88,
  stemTag: 84,
  speciesCode: 92,
  speciesName: 176,
  subspeciesName: 120,
  quadratName: 84,
  stemLocalX: 70,
  stemLocalY: 70,
  stemPlotX: 80,
  stemPlotY: 80,
  measuredDBH: 76,
  measuredHOM: 70,
  measurementDate: 108,
  attributes: 96,
  stemStatus: 132,
  description: 160
};

export const VIEW_DATA_COLUMN_HEADERS: Readonly<Record<string, string>> = {
  measurementStatus: 'Validation',
  stemState: 'Stem state',
  treeTag: 'Tree Tag',
  stemTag: 'Stem Tag',
  speciesCode: 'Species',
  speciesName: 'Species name',
  subspeciesName: 'Subspecies',
  quadratName: 'Quadrat',
  stemLocalX: 'X',
  stemLocalY: 'Y',
  stemPlotX: 'Plot X',
  stemPlotY: 'Plot Y',
  measuredDBH: 'DBH',
  measuredHOM: 'HOM',
  measurementDate: 'Date',
  attributes: 'Codes',
  stemStatus: 'Stem status',
  description: 'Description'
};

export const VIEW_DATA_DEFAULT_HIDDEN_COLUMNS = ['speciesName', 'subspeciesName', 'stemPlotX', 'stemPlotY', 'description'] as const;

/** Operators the View Data columns may offer: the subset of MUI's operators that buildFilterModelStub implements (Task 8's drift test). */
export const VIEW_DATA_FILTER_OPERATOR_VALUES: ReadonlySet<string> = new Set([
  'contains',
  'doesNotContain',
  'equals',
  'doesNotEqual',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'isAnyOf',
  'is',
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<='
]);

export const VIEW_DATA_FILTERABLE_FIELDS = [
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
  'description'
] as const;
export type ViewDataFilterableField = (typeof VIEW_DATA_FILTERABLE_FIELDS)[number];

export const VIEW_DATA_SORTABLE_FIELDS = [VIEW_DATA_FIELDS.measurementStatus, VIEW_DATA_FIELDS.stemState, ...VIEW_DATA_FILTERABLE_FIELDS] as const;
export type ViewDataSortableField = (typeof VIEW_DATA_SORTABLE_FIELDS)[number];

export const VIEW_DATA_DEFAULT_SORT = { field: VIEW_DATA_FIELDS.measurementDate, sort: 'asc' } as const;

export function isViewDataSortableField(field: unknown): field is ViewDataSortableField {
  return typeof field === 'string' && (VIEW_DATA_SORTABLE_FIELDS as readonly string[]).includes(field);
}

export function isViewDataFilterableField(field: unknown): field is ViewDataFilterableField {
  return typeof field === 'string' && (VIEW_DATA_FILTERABLE_FIELDS as readonly string[]).includes(field);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const SINGLE = 1;
const DATE_RANGE_SEPARATOR = ' – ';
const FACTS_SEPARATOR = ' · ';

function pluralRows(count: number, qualifier = ''): string {
  const noun = count === SINGLE ? 'row' : 'rows';
  return `${count.toLocaleString()} ${qualifier ? `${qualifier} ` : ''}${noun}`;
}

export const VIEW_DATA_TEXT = {
  title: 'View Data',
  censusPrefix: 'Census',
  activeMeasurements: (count: number) => `${count.toLocaleString()} active ${count === SINGLE ? 'measurement' : 'measurements'}`,
  measuredPrefix: 'measured',
  readOnly: "Read-only: your role can't edit these rows",
  showLabel: 'Show',
  searchLabel: 'Search',
  searchPlaceholder: 'Tree tag, stem tag, species, quadrat or code',
  searchApplyHint: 'Press Enter to apply',
  clearSearch: 'Clear search',
  withErrorsHint: (count: number) => `View Errors groups these ${count.toLocaleString()} measurements by error type.`,
  openViewErrors: 'Open View Errors →',
  captionEditor: 'Double-click a cell to edit its row',
  captionEditing: (treeTag: string, stemTag: string) => `Editing tree ${treeTag} stem ${stemTag} · Enter moves to the next field · Esc cancels`,
  columnsButton: 'Columns',
  filtersButton: 'Filters',
  densityButton: 'Density',
  hideEmptyColumns: 'Hide empty columns',
  fixFailedUploads: (count: number) => `Fix ${count.toLocaleString()} failed uploads`,
  exportCsv: 'Export CSV',
  moreActions: 'More actions',
  addMeasurements: 'Add measurements',
  validationGroup: 'Validation',
  viewGroup: 'View',
  refreshView: 'Refresh the view',
  refreshViewDescription: 'Rebuild the measurements summary and reload the grid',
  headerReference: 'Header reference',
  headerReferenceDescription: 'Open the grid-to-form header reference',
  manualEntry: 'Manual entry form',
  manualEntryDescription: 'Submit data by filling out a form',
  uploadCsv: 'Upload a CSV',
  uploadCsvDescription: 'Submit data by uploading a CSV file',
  importArcgis: 'Import an ArcGIS workbook',
  importArcgisDescription: 'Import an ArcGIS Field Maps .xlsx workbook',
  validationPending: 'Pending',
  validationPassed: 'Passed',
  ingestionFailedFallback: 'Ingestion failed',
  contradictionIcon: 'In a contradiction with another row',
  moreErrors: (count: number) => `+${count}`,
  moreErrorsInDetails: 'See Details for every error.',
  emptyCensus: 'No measurements in this census yet.',
  emptyFiltered: 'No measurements match these filters.',
  clearFilters: 'Clear filters',
  editRow: 'Edit this row',
  saveRow: 'Save your changes',
  cancelRow: 'Cancel your changes',
  detailsFor: (treeTag: string, stemTag: string) => `Details for tree ${treeTag} stem ${stemTag}`,
  editLockTooltip: "Finish or cancel the row you're editing first",
  offPageRowTooltip: 'Open this row from the grid to edit or delete it',
  actionsHeader: 'Actions',
  detailsHeader: 'Details',
  measurementHeading: 'Measurement',
  deleteMeasurement: 'Delete',
  deleteConfirmTitle: (treeTag: string, stemTag: string, censusNumber: number | string) =>
    `Delete tree ${treeTag} stem ${stemTag} from Census ${censusNumber}?`,
  deleteConfirmBody: (censusNumber: number | string) => `This removes the measurement from Census ${censusNumber}.`,
  deleteConfirm: 'Delete measurement',
  deleteKeep: 'Keep it',
  clearRefreshFailed: 'Validation errors cleared, but the rows shown may be out of date.',
  rowsRefreshFailed: "Couldn't refresh the rows. They may be out of date.",
  refreshingAfterClear: 'Refreshing the rows…',
  refreshBeforeClearing: 'Refresh the rows before changing this row again',
  retryRefresh: 'Retry refresh',
  clearInProgress: 'Wait for Clear validation errors to finish',
  deleteInProgress: 'Finish or cancel the delete first',
  // Same wording as View Errors' census-change notice (View Errors spec r4, Editing → census change).
  editNotSavedCensusChanged: (treeTag: string, stemTag: string) => `Your edit to tree ${treeTag}, stem ${stemTag} was not saved because the census changed.`
} as const;

export const VIEW_DATA_MEASUREMENT_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: 'speciesName', label: 'Species name' },
  { field: 'quadratName', label: 'Quadrat' },
  { field: 'stemLocalX', label: 'X' },
  { field: 'stemLocalY', label: 'Y' },
  { field: 'stemPlotX', label: 'Plot X' },
  { field: 'stemPlotY', label: 'Plot Y' },
  { field: 'measuredDBH', label: 'DBH' },
  { field: 'measuredHOM', label: 'HOM' },
  { field: 'measurementDate', label: 'Date' },
  { field: 'attributes', label: 'Codes' },
  { field: 'stemStatus', label: 'Stem status' },
  { field: 'description', label: 'Description' }
];

export const EMPTY_CELL_DISPLAY = '—';
export const FAULT_FONT_WEIGHT = 600;
export const NUMERIC_FRACTION_DIGITS = 2;
export const VIEW_DATA_NUMERIC_FIELDS: ReadonlySet<string> = new Set(['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY', 'measuredDBH', 'measuredHOM']);

/** A cell's text in the grid and in the details sheet: a dash when blank, two decimals for the measurement number fields. */
export function formatViewDataCellValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY_CELL_DISPLAY;
  if (VIEW_DATA_NUMERIC_FIELDS.has(field)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(NUMERIC_FRACTION_DIGITS) : String(value);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Show control and counts
// ---------------------------------------------------------------------------

export interface ViewDataStateCounts {
  unresolvedLogged: number;
  failedNoLog: number;
  pending: number;
  valid: number;
  overridable: number;
  revalidatable: number;
  firstMeasurementDate: string | null;
  lastMeasurementDate: string | null;
}

export function totalActiveMeasurements(counts: ViewDataStateCounts): number {
  return counts.unresolvedLogged + counts.failedNoLog + counts.pending + counts.valid;
}

export function withErrorsCount(counts: ViewDataStateCounts): number {
  return counts.unresolvedLogged + counts.failedNoLog;
}

export const VIEW_DATA_SHOW_OPTION_VALUES = ['all', 'passed', 'pending', 'withErrors'] as const;
export type ViewDataShowOption = (typeof VIEW_DATA_SHOW_OPTION_VALUES)[number];

export interface ViewDataShowOptionDefinition {
  value: ViewDataShowOption;
  label: string;
  visible: VisibleFilter[];
  count: (counts: ViewDataStateCounts) => number;
}

export const VIEW_DATA_SHOW_OPTIONS: readonly ViewDataShowOptionDefinition[] = [
  { value: 'all', label: 'All', visible: ['errors', 'valid', 'pending'], count: totalActiveMeasurements },
  { value: 'passed', label: 'Passed', visible: ['valid'], count: counts => counts.valid },
  { value: 'pending', label: 'Pending', visible: ['pending'], count: counts => counts.pending },
  { value: 'withErrors', label: 'With errors', visible: ['errors'], count: withErrorsCount }
];

export function getViewDataShowOption(value: ViewDataShowOption): ViewDataShowOptionDefinition {
  return VIEW_DATA_SHOW_OPTIONS.find(option => option.value === value) ?? VIEW_DATA_SHOW_OPTIONS[0];
}

export function resolveInitialShowOption(initialVisibleFilters?: readonly VisibleFilter[]): ViewDataShowOption {
  if (!initialVisibleFilters) return 'all';
  const match = VIEW_DATA_SHOW_OPTIONS.find(
    option => option.visible.length === initialVisibleFilters.length && option.visible.every(bucket => initialVisibleFilters.includes(bucket))
  );
  return match?.value ?? 'all';
}

export function parseViewDataStateCounts(row: Record<string, unknown> | undefined): ViewDataStateCounts {
  const count = (key: string) => Number(row?.[key]) || 0;
  const day = (key: string) => toCalendarDayString(row?.[key] as string | Date | null | undefined);
  return {
    unresolvedLogged: count('CountUnresolvedLogged'),
    failedNoLog: count('CountFailedNoLog'),
    pending: count('CountPending'),
    valid: count('CountValid'),
    overridable: count('CountOverridable'),
    revalidatable: count('CountRevalidatable'),
    firstMeasurementDate: day('FirstMeasurementDate'),
    lastMeasurementDate: day('LastMeasurementDate')
  };
}

export const ALL_TREE_STEM_STATES: readonly TSSFilter[] = ['old tree', 'multi stem', 'new recruit'];

const MONTH_DAY_UTC = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function formatMeasurementDateRange(first: string | null, last: string | null): string | null {
  const firstDay = parseCalendarDay(first);
  const lastDay = parseCalendarDay(last);
  if (!firstDay || !lastDay) return null;
  const firstText =
    firstDay.year === lastDay.year ? MONTH_DAY_UTC.format(new Date(Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day))) : formatCalendarDate(firstDay);
  return `${firstText}${DATE_RANGE_SEPARATOR}${formatCalendarDate(lastDay)}`;
}

export function formatViewDataFactsLine(counts: ViewDataStateCounts, isReadOnly: boolean): string {
  const parts = [VIEW_DATA_TEXT.activeMeasurements(totalActiveMeasurements(counts))];
  const range = formatMeasurementDateRange(counts.firstMeasurementDate, counts.lastMeasurementDate);
  if (range) parts.push(`${VIEW_DATA_TEXT.measuredPrefix} ${range}`);
  if (isReadOnly) parts.push(VIEW_DATA_TEXT.readOnly);
  return parts.join(FACTS_SEPARATOR);
}

export function formatViewDataScopeLine(siteName: string | undefined, plotName: string | undefined, plotCensusNumber: number | undefined): string {
  return [siteName ?? EMPTY_CELL_DISPLAY, plotName ?? EMPTY_CELL_DISPLAY, `${VIEW_DATA_TEXT.censusPrefix} ${plotCensusNumber ?? EMPTY_CELL_DISPLAY}`].join(
    FACTS_SEPARATOR
  );
}

export function canEditMeasurementRows(userStatus: UserAuthRoles | string | null | undefined): boolean {
  return Boolean(userStatus) && userStatus !== 'pending';
}

// ---------------------------------------------------------------------------
// Stem state and stem status
// ---------------------------------------------------------------------------

export const STEM_STATE_LABELS: Readonly<Record<TSSFilter, string>> = {
  'old tree': 'Old tree',
  'multi stem': 'Multi-stem',
  'new recruit': 'New recruit'
};

export const STEM_STATUS_LABELS: Readonly<Record<string, string>> = {
  alive: 'Alive',
  'alive-not measured': 'Alive, not measured',
  dead: 'Dead',
  'stem dead': 'Stem dead',
  'broken below': 'Broken below',
  omitted: 'Omitted',
  missing: 'Missing'
};

const STEM_STATUS_DISPLAY_SEPARATOR = ' · ';

export function formatStemState(value: unknown): string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STEM_STATE_LABELS, value)
    ? STEM_STATE_LABELS[value as TSSFilter]
    : EMPTY_CELL_DISPLAY;
}

export function parseStemStatuses(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  const present = new Set(raw.split(STEM_STATUSES_SEPARATOR).map(status => status.trim()));
  return AttributeStatusOptions.filter(status => present.has(status));
}

export function formatStemStatuses(statuses: readonly string[]): string {
  return statuses.length === 0 ? EMPTY_CELL_DISPLAY : statuses.map(status => STEM_STATUS_LABELS[status] ?? status).join(STEM_STATUS_DISPLAY_SEPARATOR);
}

// ---------------------------------------------------------------------------
// Row summary, Validation cell and faulted cells
// ---------------------------------------------------------------------------

export interface ViewDataRowSummary {
  measurementStatus: MeasurementStatus;
  unresolvedErrorCount: number;
  primaryErrorMessage: string | null;
  primaryErrorSource: ErrorSourceKind | null;
  unresolvedErrorCodes: string[];
  unresolvedErrorMessages: string[];
  hasContradiction: boolean;
  stemStatuses: string[];
}

function isMeasurementStatus(value: unknown): value is MeasurementStatus {
  return typeof value === 'string' && (MEASUREMENT_STATUSES as readonly string[]).includes(value);
}

function splitList(value: unknown, separator: string): string[] {
  return typeof value === 'string' && value !== '' ? value.split(separator).filter(Boolean) : [];
}

/** GenericMapper turns 0, false and '' into undefined (config/datamapper.ts), so every field has a default. */
export function toViewDataRowSummary(row: Record<string, unknown>): ViewDataRowSummary {
  const source = row.primaryErrorSource;
  return {
    measurementStatus: isMeasurementStatus(row.measurementStatus) ? row.measurementStatus : 'pending',
    unresolvedErrorCount: Number(row.unresolvedErrorCount) || 0,
    primaryErrorMessage: typeof row.primaryErrorMessage === 'string' && row.primaryErrorMessage !== '' ? row.primaryErrorMessage : null,
    primaryErrorSource: source === 'validation' || source === 'ingestion' ? source : null,
    unresolvedErrorCodes: splitList(row.unresolvedErrorCodes, UNRESOLVED_ERROR_CODES_SEPARATOR),
    unresolvedErrorMessages: splitList(row.unresolvedErrorMessages, UNRESOLVED_ERROR_MESSAGES_SEPARATOR),
    hasContradiction: row.hasContradiction === true || Number(row.hasContradiction) === SINGLE,
    stemStatuses: parseStemStatuses(row.stemStatuses)
  };
}

export interface ViewDataValidationCellContent {
  status: MeasurementStatus;
  text: string;
  title: string;
  source: ErrorSourceKind | null;
  extraErrorCount: number;
  extraErrorLines: string[];
  hasContradiction: boolean;
}

const ERROR_STATUSES: ReadonlySet<MeasurementStatus> = new Set(['ingestionFailed', 'unresolvedErrors']);

export function describeValidationCell(summary: ViewDataRowSummary): ViewDataValidationCellContent {
  const base = { status: summary.measurementStatus, extraErrorCount: 0, extraErrorLines: [] as string[], hasContradiction: summary.hasContradiction };
  switch (summary.measurementStatus) {
    case 'ingestionFailed':
    case 'unresolvedErrors': {
      // [D2] display labels; the stored text stays in requests and links.
      const text = summary.primaryErrorMessage ? formatErrorTypeLabel(summary.primaryErrorMessage) : VIEW_DATA_TEXT.ingestionFailedFallback;
      const extraErrorCount = Math.max(0, summary.unresolvedErrorCount - SINGLE);
      const extraErrorLines = summary.unresolvedErrorMessages.slice(SINGLE).map(formatErrorTypeLabel);
      if (extraErrorLines.length < extraErrorCount) extraErrorLines.push(VIEW_DATA_TEXT.moreErrorsInDetails);
      const source: ErrorSourceKind | null = summary.measurementStatus === 'ingestionFailed' ? 'ingestion' : summary.primaryErrorSource;
      return { ...base, text, title: text, source, extraErrorCount, extraErrorLines };
    }
    case 'invalidNoLog':
      return { ...base, text: MARKED_INVALID_NO_ERROR_LOGGED_LABEL, title: MARKED_INVALID_NO_ERROR_LOGGED_LABEL, source: null };
    case 'pending':
      return { ...base, text: VIEW_DATA_TEXT.validationPending, title: VIEW_DATA_TEXT.validationPending, source: null };
    case 'passed':
      return { ...base, text: VIEW_DATA_TEXT.validationPassed, title: VIEW_DATA_TEXT.validationPassed, source: null };
  }
}

export interface ValidationFaultSource {
  coreMeasurementID: number;
  validationErrorIDs: number[];
  descriptions: string[];
  criteria: string[];
}

export type ValidationFieldFaultsByMeasurement = ReadonlyMap<number, ReadonlyMap<string, string>>;
/** field → tooltip; null for an ingestion fault (the Validation cell carries its message). */
export type ViewDataFieldFaults = ReadonlyMap<string, string | null>;

const CRITERIA_SEPARATOR = ';';
const FAULT_TOOLTIP_SEPARATOR = '; ';

export function buildValidationFieldFaults(failed: readonly ValidationFaultSource[]): ValidationFieldFaultsByMeasurement {
  const byMeasurement = new Map<number, Map<string, string>>();
  for (const error of failed) {
    if (!error.coreMeasurementID) continue;
    const fields = byMeasurement.get(error.coreMeasurementID) ?? new Map<string, string>();
    (error.validationErrorIDs ?? []).forEach((_id, index) => {
      const label = formatErrorTypeLabel(error.descriptions?.[index] ?? ''); // [D2]
      const criteria = (error.criteria?.[index] ?? '')
        .split(CRITERIA_SEPARATOR)
        .map(field => field.trim())
        .filter(Boolean);
      for (const field of criteria) {
        const existing = fields.get(field);
        fields.set(field, existing && existing !== label ? `${existing}${FAULT_TOOLTIP_SEPARATOR}${label}` : label);
      }
    });
    byMeasurement.set(error.coreMeasurementID, fields);
  }
  return byMeasurement;
}

export function buildRowFieldFaults(summary: ViewDataRowSummary, validationFaults: ReadonlyMap<string, string> | undefined): ViewDataFieldFaults {
  const faults = new Map<string, string | null>();
  if (!ERROR_STATUSES.has(summary.measurementStatus)) return faults;
  for (const [field, tooltip] of validationFaults ?? []) faults.set(field, tooltip);
  for (const entry of summary.unresolvedErrorCodes) {
    const [source, code] = entry.split(UNRESOLVED_ERROR_CODE_PART_SEPARATOR);
    if (source !== 'ingestion') continue;
    for (const field of INGESTION_ERROR_FIELD_MAP[code] ?? []) {
      if (!faults.has(field)) faults.set(field, null);
    }
  }
  return faults;
}

// ---------------------------------------------------------------------------
// Header menus
// ---------------------------------------------------------------------------

export type ViewDataValidationActionID = 'run-validations' | 'override-validations' | 'reset-validations';

export interface ViewDataValidationAction {
  id: ViewDataValidationActionID;
  label: string;
  description: string;
  disabled: boolean;
}

/** Labels, descriptions and disabled rules of the former ValidationActionsMenu (components/client), in sentence case. */
export function describeViewDataValidationActions({
  pending,
  overridable,
  revalidatable
}: {
  pending: number;
  overridable: number;
  revalidatable: number;
}): ViewDataValidationAction[] {
  return [
    {
      id: 'run-validations',
      label: 'Run validations',
      description:
        pending > 0
          ? `Validate ${pluralRows(pending, 'pending')}`
          : revalidatable > 0
            ? `Re-check ${pluralRows(revalidatable, 'failed')}`
            : 'No rows to validate',
      disabled: pending === 0 && revalidatable === 0
    },
    {
      id: 'override-validations',
      label: 'Override validations',
      description: overridable > 0 ? `Force ${pluralRows(overridable, 'eligible failed or not-yet-validated')} to pass` : 'No eligible rows to override',
      disabled: overridable === 0
    },
    {
      id: 'reset-validations',
      label: 'Reset all validation states',
      description: 'Clear all errors and set rows to pending',
      disabled: false
    }
  ];
}
