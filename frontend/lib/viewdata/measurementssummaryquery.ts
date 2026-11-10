import type { GridFilterItem } from '@mui/x-data-grid';
import { format } from 'mysql2/promise';
import {
  buildFilterModelStub,
  buildSearchStub,
  resolveFilterLogicOperatorSql,
  SUPPORTED_FILTER_OPERATORS,
  UnsupportedFilterLogicOperatorError
} from '@/components/processors/processormacros';
import type { ExtendedGridFilterModel, TSSFilter, VisibleFilter } from '@/config/datagridhelpers';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import {
  buildMeasurementRowSummaryProjectionSql,
  buildMeasurementStatusRankSql,
  buildMeasurementVisibleClauseSql,
  buildStemStatusFilterClauseSql,
  MEASUREMENT_STATUS_RANK_COLUMN,
  MEASUREMENT_STATUS_VISIBLE_BUCKET,
  measurementStatusFromRank
} from '@/config/measurementstatefilters';
import {
  ALL_TREE_STEM_STATES,
  isViewDataFilterableField,
  isViewDataSortableField,
  VIEW_DATA_DEFAULT_SORT,
  type ViewDataSortableField
} from '@/config/viewdata';

export const MEASUREMENTS_SUMMARY_ALIAS = 'vft';
export const MEASUREMENTS_SUMMARY_PAGE_ALIAS = 'page_rows';
const OFFSET_LIMIT_CLAUSE = ' LIMIT ?, ?';
export const PAGINATED_QUERY_LIMIT_CLAUSE = `${OFFSET_LIMIT_CLAUSE};`;

export const VIEW_DATA_REQUEST_ERRORS = {
  unsupportedSortField: 'Unsupported sort field',
  unsupportedFilterField: 'Unsupported filter field',
  unsupportedFilterOperator: 'Unsupported filter operator',
  unsupportedLogicOperator: 'Unsupported filter logic operator',
  unsupportedStemStatus: 'Unsupported stem status',
  unsupportedVisibleFilter: 'Unsupported visibility filter',
  unsupportedStemStateFilter: 'Unsupported stem state filter',
  unsupportedQuickFilter: 'Unsupported quick filter'
} as const;

export class ViewDataRequestError extends Error {
  constructor(message: (typeof VIEW_DATA_REQUEST_ERRORS)[keyof typeof VIEW_DATA_REQUEST_ERRORS]) {
    super(message);
    this.name = 'ViewDataRequestError';
  }
}

type SortKind = 'text' | 'number' | 'date' | 'rank';

const STEM_STATE_EXPRESSION = `JSON_UNQUOTE(JSON_EXTRACT(${MEASUREMENTS_SUMMARY_ALIAS}.UserDefinedFields, '$.treestemstate'))`;

const SORT_COLUMNS: Readonly<Record<ViewDataSortableField, { expression: string; kind: SortKind }>> = {
  measurementStatus: { expression: MEASUREMENT_STATUS_RANK_COLUMN, kind: 'rank' },
  stemState: { expression: STEM_STATE_EXPRESSION, kind: 'text' },
  treeTag: { expression: 'vft.TreeTag', kind: 'text' },
  stemTag: { expression: 'vft.StemTag', kind: 'text' },
  speciesCode: { expression: 'vft.SpeciesCode', kind: 'text' },
  speciesName: { expression: 'vft.SpeciesName', kind: 'text' },
  subspeciesName: { expression: 'vft.SubspeciesName', kind: 'text' },
  quadratName: { expression: 'vft.QuadratName', kind: 'text' },
  stemLocalX: { expression: 'vft.StemLocalX', kind: 'number' },
  stemLocalY: { expression: 'vft.StemLocalY', kind: 'number' },
  stemPlotX: { expression: 'vft.StemPlotX', kind: 'number' },
  stemPlotY: { expression: 'vft.StemPlotY', kind: 'number' },
  measuredDBH: { expression: 'vft.MeasuredDBH', kind: 'number' },
  measuredHOM: { expression: 'vft.MeasuredHOM', kind: 'number' },
  measurementDate: { expression: 'vft.MeasurementDate', kind: 'date' },
  attributes: { expression: 'vft.Attributes', kind: 'text' },
  description: { expression: 'vft.Description', kind: 'text' }
};

const SORT_DIRECTIONS = ['asc', 'desc'] as const;
type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ViewDataSortItem {
  field: ViewDataSortableField;
  sort: SortDirection;
}

export function parseViewDataSortModel(sortModel: unknown): ViewDataSortItem {
  if (sortModel === undefined || sortModel === null) return { ...VIEW_DATA_DEFAULT_SORT };
  if (!Array.isArray(sortModel)) throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedSortField);
  if (sortModel.length === 0) return { ...VIEW_DATA_DEFAULT_SORT };
  const [first] = sortModel as Array<{ field?: unknown; sort?: unknown }>;
  if (!isViewDataSortableField(first?.field) || !(SORT_DIRECTIONS as readonly unknown[]).includes(first?.sort)) {
    throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedSortField);
  }
  return { field: first.field, sort: first.sort as SortDirection };
}

/** Blanks last in both directions; the ID tie-breaker keeps paging stable. */
export function buildViewDataOrderByClause(item: ViewDataSortItem): string {
  const { expression, kind } = SORT_COLUMNS[item.field];
  const direction = item.sort.toUpperCase();
  const tieBreaker = `${MEASUREMENTS_SUMMARY_ALIAS}.CoreMeasurementID ASC`;
  if (kind === 'rank') return `ORDER BY ${expression} ${direction}, ${tieBreaker}`;
  const blankFirstKey = kind === 'text' ? `(NULLIF(${expression}, '') IS NULL)` : `(${expression} IS NULL)`;
  return `ORDER BY ${blankFirstKey}, ${expression} ${direction}, ${tieBreaker}`;
}

export function assertViewDataFilterItemsSupported(items: unknown): void {
  if (items === undefined || items === null) return;
  if (!Array.isArray(items)) throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedFilterField);
  for (const item of items as GridFilterItem[]) {
    if (!isViewDataFilterableField(item?.field)) throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedFilterField);
    if (typeof item.operator !== 'string' || !SUPPORTED_FILTER_OPERATORS.has(item.operator)) {
      throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedFilterOperator);
    }
  }
}

function assertViewDataLogicOperatorSupported(logicOperator: unknown): void {
  try {
    resolveFilterLogicOperatorSql(logicOperator);
  } catch (error) {
    if (error instanceof UnsupportedFilterLogicOperatorError) throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedLogicOperator);
    throw error;
  }
}

export function parseViewDataStemStatusFilter(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(status => typeof status !== 'string' || !AttributeStatusOptions.includes(status))) {
    throw new ViewDataRequestError(VIEW_DATA_REQUEST_ERRORS.unsupportedStemStatus);
  }
  return Array.from(new Set(value as string[]));
}

const KNOWN_VISIBLE_FILTERS: ReadonlySet<unknown> = new Set<VisibleFilter>(Object.values(MEASUREMENT_STATUS_VISIBLE_BUCKET));
const KNOWN_TREE_STEM_STATES: ReadonlySet<unknown> = new Set<TSSFilter>(ALL_TREE_STEM_STATES);

function assertAbsentOrArrayOf(
  value: unknown,
  isAllowedEntry: (entry: unknown) => boolean,
  message: (typeof VIEW_DATA_REQUEST_ERRORS)[keyof typeof VIEW_DATA_REQUEST_ERRORS]
) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || !value.every(isAllowedEntry)) throw new ViewDataRequestError(message);
}

export interface ParsedViewDataRequest {
  sort: ViewDataSortItem;
  stemStatuses: string[];
}

/** Validates everything a measurementssummary request carries before any SQL runs and returns the parts that need parsing. */
export function validateViewDataRequest(filterModel: ExtendedGridFilterModel, sortModel: unknown): ParsedViewDataRequest {
  assertViewDataFilterItemsSupported(filterModel.items);
  assertViewDataLogicOperatorSupported(filterModel.logicOperator);
  assertAbsentOrArrayOf(filterModel.visible, entry => KNOWN_VISIBLE_FILTERS.has(entry), VIEW_DATA_REQUEST_ERRORS.unsupportedVisibleFilter);
  assertAbsentOrArrayOf(filterModel.tss, entry => KNOWN_TREE_STEM_STATES.has(entry), VIEW_DATA_REQUEST_ERRORS.unsupportedStemStateFilter);
  assertAbsentOrArrayOf(filterModel.quickFilterValues, entry => typeof entry === 'string', VIEW_DATA_REQUEST_ERRORS.unsupportedQuickFilter);
  return { sort: parseViewDataSortModel(sortModel), stemStatuses: parseViewDataStemStatusFilter(filterModel.stemStatus) };
}

/** Rows without a tree-stem state (failed rows) would fail JSON_CONTAINS, so no clause when every state is selected. */
export function buildTreeStemStateClauseSql(tss: readonly TSSFilter[] | undefined): string {
  const selected = Array.from(new Set((tss ?? []).filter(state => KNOWN_TREE_STEM_STATES.has(state))));
  if (selected.length === 0 || selected.length === ALL_TREE_STEM_STATES.length) return '';
  return ` AND (${selected.map(state => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${state}'), '$.treestemstate') = 1`).join(' OR ')})`;
}

/** Every bucket selected keeps every row, so the three correlated EXISTS it would emit only cost time. */
function omitVisibleFilterWhenEveryBucketSelected(visible: VisibleFilter[] | undefined): VisibleFilter[] | undefined {
  if (!visible) return undefined;
  const selected = new Set<unknown>(visible);
  return Array.from(KNOWN_VISIBLE_FILTERS).every(bucket => selected.has(bucket)) ? undefined : visible;
}

export interface MeasurementsSummaryPageQueryInput {
  schema: string;
  columns: string[];
  filterModel: ExtendedGridFilterModel;
  sortModel: unknown;
  plotID: number | undefined;
  plotCensusNumber: number | undefined;
  page: number;
  pageSize: number;
}

/** Ready to execute: schema identifiers escaped and every number bound. */
export interface MeasurementsSummaryPageQueries {
  paginatedQuery: string;
  countQuery: string;
  /** The page's own LIMIT is bound too; ordered by date and without the row projection, for the CSV export. */
  exportQuery: string;
}

function formatSkeleton(schema: string, skeleton: string, values: Array<number | undefined>): string {
  return format(safeFormatQuery(schema, skeleton), values);
}

/**
 * The measurementssummary branch of fixeddatafilter. The caller must have checked `schema` with isValidSchema:
 * the state predicates in config/measurementstatefilters.ts interpolate it.
 *
 * The search and filter clauses embed already-escaped request values, so they are spliced in AFTER the skeleton
 * around them is formatted: run through mysql2 format or safeFormatQuery, a literal `?` or `??` in a value
 * would be consumed as a placeholder.
 */
export function buildMeasurementsSummaryPageQueries(input: MeasurementsSummaryPageQueryInput): MeasurementsSummaryPageQueries {
  const { schema, columns, filterModel, plotID, plotCensusNumber, page, pageSize } = input;
  const { sort, stemStatuses } = validateViewDataRequest(filterModel, input.sortModel);
  const orderBy = buildViewDataOrderByClause(sort);

  const searchStub = filterModel.quickFilterValues?.length ? buildSearchStub(columns, filterModel.quickFilterValues, MEASUREMENTS_SUMMARY_ALIAS) : '';
  const filterStub = filterModel.items?.length ? buildFilterModelStub(filterModel, MEASUREMENTS_SUMMARY_ALIAS) : '';
  const searchAndFilter = [searchStub, filterStub]
    .filter(Boolean)
    .map(clause => ` AND (${clause})`)
    .join('\n              ');

  const scopeValues = [plotID, plotID, plotCensusNumber];
  const pageValues = [page * pageSize, pageSize];
  const stateFilteredScope = `
            FROM ??.measurementssummary ${MEASUREMENTS_SUMMARY_ALIAS}
              JOIN ??.census c ON ${MEASUREMENTS_SUMMARY_ALIAS}.PlotID = c.PlotID AND ${MEASUREMENTS_SUMMARY_ALIAS}.CensusID = c.CensusID
            WHERE ${MEASUREMENTS_SUMMARY_ALIAS}.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ?
              ${buildMeasurementVisibleClauseSql(schema, MEASUREMENTS_SUMMARY_ALIAS, omitVisibleFilterWhenEveryBucketSelected(filterModel.visible))}
              ${buildTreeStemStateClauseSql(filterModel.tss)}
              ${buildStemStatusFilterClauseSql(schema, MEASUREMENTS_SUMMARY_ALIAS, stemStatuses)}
              `;

  const pageIdentitySelectList = [
    `${MEASUREMENTS_SUMMARY_ALIAS}.CoreMeasurementID`,
    ...(sort.field === 'measurementStatus' ? [`${buildMeasurementStatusRankSql(schema, MEASUREMENTS_SUMMARY_ALIAS)} AS ${MEASUREMENT_STATUS_RANK_COLUMN}`] : [])
  ].join(', ');

  const assemble = (selectList: string, tail: string, tailValues: number[]) =>
    formatSkeleton(schema, `SELECT ${selectList} ${stateFilteredScope}`, scopeValues) +
    searchAndFilter +
    (tail ? formatSkeleton(schema, tail, tailValues) : '');

  const pageRowsQuery = assemble(pageIdentitySelectList, `\n            ${orderBy}${OFFSET_LIMIT_CLAUSE}`, pageValues);
  const paginatedQuery =
    formatSkeleton(
      schema,
      `SELECT ${MEASUREMENTS_SUMMARY_ALIAS}.*, ${buildMeasurementRowSummaryProjectionSql(schema, MEASUREMENTS_SUMMARY_ALIAS)}
          FROM (`,
      []
    ) +
    pageRowsQuery +
    formatSkeleton(
      schema,
      `) ${MEASUREMENTS_SUMMARY_PAGE_ALIAS}
          JOIN ??.measurementssummary ${MEASUREMENTS_SUMMARY_ALIAS}
            ON ${MEASUREMENTS_SUMMARY_ALIAS}.CoreMeasurementID = ${MEASUREMENTS_SUMMARY_PAGE_ALIAS}.CoreMeasurementID
          ${orderBy};`,
      []
    );

  return {
    paginatedQuery,
    countQuery: assemble('COUNT(*) as totalRows', '', []),
    exportQuery: assemble(
      `${MEASUREMENTS_SUMMARY_ALIAS}.*`,
      `\n            ORDER BY ${MEASUREMENTS_SUMMARY_ALIAS}.MeasurementDate ASC${PAGINATED_QUERY_LIMIT_CLAUSE}`,
      pageValues
    )
  };
}

/** GenericMapper turns a numeric 0 into undefined, so the rank becomes the status string before mapping (A4). */
export function attachMeasurementStatus(row: Record<string, unknown>): void {
  row.MeasurementStatus = measurementStatusFromRank(row[MEASUREMENT_STATUS_RANK_COLUMN]);
  delete row[MEASUREMENT_STATUS_RANK_COLUMN];
  row.HasContradiction = Number(row.HasContradiction) === 1;
}
