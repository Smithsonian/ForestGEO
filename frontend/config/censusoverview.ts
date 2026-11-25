import type { BlockingPreconditionKind, PublishBlockerCount } from '@/lib/ctfs-export/precondition';
import { formatDisplayDate } from '@/config/dateformats';

export const TOP_ERROR_TYPE_LIMIT = 5;
export const CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM = 'errorCensusIDs';
export const CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR = ',';
const CENSUS_OVERVIEW_SUMMARY_API_BASE = '/api/censusoverview/summary';

/** Publish scope in the path (`censusID`), errors scope in the query (`errorCensusIDs`). */
export const CENSUS_OVERVIEW_SUMMARY_ENDPOINT = (schema: string, plotID: number, censusID: number, errorCensusIDs: readonly number[]): string => {
  const query = new URLSearchParams({ [CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM]: errorCensusIDs.join(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR) });
  return `${CENSUS_OVERVIEW_SUMMARY_API_BASE}/${encodeURIComponent(schema)}/${plotID}/${censusID}?${query.toString()}`;
};

/** One reason per clause of the export predicate, plus `other` so every skipped row is accounted for. */
export const EXPORT_SKIP_REASON_KINDS = ['not-validated', 'no-stem-guid', 'inactive-stem-or-tree', 'missing-link', 'other'] as const;
export type ExportSkipReasonKind = (typeof EXPORT_SKIP_REASON_KINDS)[number];

export interface ExportSkipReasonCount {
  kind: ExportSkipReasonKind;
  count: number;
}

export interface ErrorTypeCount {
  message: string;
  count: number;
}

export interface CensusOverviewSummary {
  /** Errors scope: every CensusID the Errors page queries for this plot census. */
  errorOverview: {
    affectedMeasurements: number;
    totalActiveMeasurements: number;
    topErrorTypes: ErrorTypeCount[];
    remainingErrorTypeCount: number;
  };
  /** Publish scope, read in one snapshot with `blockers`. */
  exportPreview: {
    totalActiveMeasurements: number;
    exportableCount: number;
    skippedCount: number;
    /** Counted over skipped rows only; reasons can overlap. */
    skipReasons: ExportSkipReasonCount[];
    exportedWithUnresolvedErrorCount: number;
  };
  /** Publish scope. `count` is null for a census-level kind. */
  blockers: PublishBlockerCount[];
}

export interface BlockerFixHint {
  label: string;
  hint: string;
}

export const BLOCKER_FIX_HINTS: Record<BlockingPreconditionKind, BlockerFixHint> = {
  'unknown-attribute-code': {
    label: 'Unknown attribute code',
    hint: "Add the code on the Attributes page, or correct the measurement's codes"
  },
  'missing-taxonomy-fields': { label: 'Species missing a species code', hint: 'Add a SpeciesCode on the Species page' },
  'string-too-long': {
    label: 'Value too long for the Smithsonian database',
    hint: 'Shorten the tree tag, stem tag, quadrat name, comment or taxonomy text'
  },
  'zero-exportable-rows': { label: 'Nothing to export', hint: 'Resolve errors or validate measurements first' },
  'insufficient-exportable-rows': {
    label: 'Less than half the census is exportable',
    hint: 'Resolve errors or validate measurements until at least half can be exported'
  }
};

export const EXPORT_SKIP_REASON_ROW_LABELS: Record<ExportSkipReasonKind, string> = {
  'not-validated': 'Not validated',
  'no-stem-guid': 'Failed (no stem)',
  'inactive-stem-or-tree': 'Inactive tree or stem',
  'missing-link': 'Missing quadrat, species, genus or family link',
  other: 'Other reason'
};

/** Stem rows labelled by their true unit; each description is the row's tooltip. */
export const TREES_AND_STEMS_ROWS = {
  previouslyMeasuredStems: {
    label: 'Previously measured stems',
    description: 'Stems whose tree tag and stem tag were in the previous census'
  },
  newRecruitStems: { label: 'New-recruit stems', description: "Stems on trees the previous census didn't have" },
  multiStemTrees: { label: 'Multi-stem trees', description: 'Trees with more than one stem' }
} as const;

export const CENSUS_OVERVIEW_TEXT = {
  stemsPerTreeSuffix: 'stems per tree',
  blockerCalloutTitle: 'Publishing will fail until these are fixed',
  noUnresolvedErrors: 'No unresolved errors',
  noMeasurementsYet: 'No measurements in this census yet',
  viewAllErrors: 'View all errors →',
  listSeparator: ' · ',
  validationErrorsTitle: 'Validation Errors',
  errorTypeColumnHeading: 'Error type',
  errorRowsColumnHeading: 'Rows',
  multipleErrorsNote: 'One measurement can carry several errors.',
  publishPreviewTitle: 'If you publish now',
  publishPreviewSubtitle: 'What would reach the Smithsonian database',
  exportedLegend: 'exported',
  skippedLegend: 'skipped',
  skipReasonsHeading: 'Why rows are skipped (a row can have several reasons)',
  censusTotalsLabel: 'Census totals',
  treesTileLabel: 'Trees',
  stemsTileLabel: 'Stems',
  quadratsTileLabel: 'Quadrats with data',
  errorsTileLabel: 'Measurements with errors',
  ofTotalPrefix: 'of',
  multiStemSuffix: 'multi-stem',
  previouslyMeasuredSuffix: 'previously measured',
  newRecruitsSuffix: 'new recruits',
  noPreviousCensus: 'no previous census',
  notYetMeasuredSuffix: 'not yet measured',
  ofActiveMeasurementsSuffix: 'of active measurements',
  noQuadrats: 'No quadrats in this plot',
  moreActionsLabel: 'More census actions',
  rebuildViewFullTableAction: 'Rebuild ViewFullTable',
  deleteCensusAction: 'Delete census…',
  censusTitlePrefix: 'Census',
  scopeSeparator: ' / ',
  retry: 'Retry',
  summaryLoadFailed: 'Failed to load the census summary'
} as const;

const PERCENT_SCALE = 100;
const AFFECTED_PERCENT_FRACTION_DIGITS = 1;
const STEMS_PER_TREE_FRACTION_DIGITS = 1;
const SINGLE_ITEM = 1;
const EMPTY_RATIO_DISPLAY = '0';
const UNAVAILABLE_PERCENT_DISPLAY = '—';
const DATE_RANGE_SEPARATOR = ' – ';
const OPEN_ENDED_DATE_PREFIX = 'From';

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatBlockerRowCount(count: number): string {
  return `${formatCount(count)} ${count === SINGLE_ITEM ? 'row' : 'rows'}`;
}

export function formatExportedWithUnresolvedErrors(count: number): string {
  return count === SINGLE_ITEM
    ? `${formatCount(count)} exported row still has an unresolved error`
    : `${formatCount(count)} exported rows still have an unresolved error`;
}

export function formatStemsPerTree(countTrees: number, countStems: number): string {
  return countTrees > 0 ? (countStems / countTrees).toFixed(STEMS_PER_TREE_FRACTION_DIGITS) : EMPTY_RATIO_DISPLAY;
}

/** null when the share cannot be stated honestly: nothing to divide by, or more affected than exist. */
export function formatPercentOf(part: number, whole: number): string | null {
  if (whole <= 0 || part > whole) return null;
  return `${((part / whole) * PERCENT_SCALE).toFixed(AFFECTED_PERCENT_FRACTION_DIGITS)}%`;
}

export function toBarPercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min((part / whole) * PERCENT_SCALE, PERCENT_SCALE);
}

export function formatAffectedOfActive(affectedMeasurements: number, totalActiveMeasurements: number): string {
  const ofActive = `${CENSUS_OVERVIEW_TEXT.ofTotalPrefix} ${formatCount(totalActiveMeasurements)} measurements`;
  const percent = formatPercentOf(affectedMeasurements, totalActiveMeasurements);
  return percent === null ? ofActive : `${ofActive}${CENSUS_OVERVIEW_TEXT.listSeparator}${percent}`;
}

export function formatShareOfActiveHeading(totalActiveMeasurements: number): string {
  return `Share of ${formatCount(totalActiveMeasurements)} active`;
}

export function formatShareOfActive(count: number, totalActiveMeasurements: number): string {
  return formatPercentOf(count, totalActiveMeasurements) ?? UNAVAILABLE_PERCENT_DISPLAY;
}

export function formatErrorTypesFootnote(remainingErrorTypeCount: number): string {
  if (remainingErrorTypeCount <= 0) return CENSUS_OVERVIEW_TEXT.multipleErrorsNote;
  const noun = remainingErrorTypeCount === SINGLE_ITEM ? 'type' : 'types';
  return `Plus ${formatCount(remainingErrorTypeCount)} more error ${noun}. ${CENSUS_OVERVIEW_TEXT.multipleErrorsNote}`;
}

export function formatExportedOfActive(totalActiveMeasurements: number): string {
  return `${CENSUS_OVERVIEW_TEXT.ofTotalPrefix} ${formatCount(totalActiveMeasurements)} measurements exported`;
}

export function formatCensusDateRange(startDate: Date | string | undefined, endDate: Date | string | undefined): string {
  if (!startDate) return '';
  if (!endDate) return `${OPEN_ENDED_DATE_PREFIX} ${formatDisplayDate(startDate)}`;
  return `${formatDisplayDate(startDate)}${DATE_RANGE_SEPARATOR}${formatDisplayDate(endDate)}`;
}
