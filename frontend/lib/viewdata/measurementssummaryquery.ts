import type { GridFilterItem } from '@mui/x-data-grid';
import {
  buildFilterModelStub,
  buildSearchStub,
  resolveFilterLogicOperatorSql,
  SUPPORTED_FILTER_OPERATORS,
  UnsupportedFilterLogicOperatorError
} from '@/components/processors/processormacros';
import type { ExtendedGridFilterModel, TSSFilter } from '@/config/datagridhelpers';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';
import {
  buildMeasurementRowSummaryProjectionSql,
  buildMeasurementVisibleClauseSql,
  buildStemStatusFilterClauseSql,
  MEASUREMENT_STATUS_RANK_COLUMN,
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
export const PAGINATED_QUERY_LIMIT_CLAUSE = ' LIMIT ?, ?;';

export const VIEW_DATA_REQUEST_ERRORS = {
  unsupportedSortField: 'Unsupported sort field',
  unsupportedFilterField: 'Unsupported filter field',
  unsupportedFilterOperator: 'Unsupported filter operator',
  unsupportedLogicOperator: 'Unsupported filter logic operator',
  unsupportedStemStatus: 'Unsupported stem status'
} as const;

export class ViewDataRequestError extends Error {
  constructor(message: (typeof VIEW_DATA_REQUEST_ERRORS)[keyof typeof VIEW_DATA_REQUEST_ERRORS]) {
    super(message);
    this.name = 'ViewDataRequestError';
  }
}

/** ExtendedGridFilterModel plus the Stem status list Task 11 adds to it; `unknown` until parseViewDataStemStatusFilter has checked it. */
export type ViewDataFilterModel = ExtendedGridFilterModel & { stemStatus?: unknown };

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

/** Validates everything a measurementssummary request carries before any SQL runs. */
export function validateViewDataRequest(filterModel: ViewDataFilterModel, sortModel: unknown): void {
  assertViewDataFilterItemsSupported(filterModel.items);
  assertViewDataLogicOperatorSupported(filterModel.logicOperator);
  parseViewDataSortModel(sortModel);
  parseViewDataStemStatusFilter(filterModel.stemStatus);
}

/** Rows without a tree-stem state (failed rows) would fail JSON_CONTAINS, so no clause when every state is selected. */
export function buildTreeStemStateClauseSql(tss: readonly TSSFilter[] | undefined): string {
  const selected = (tss ?? []).filter(state => (ALL_TREE_STEM_STATES as readonly string[]).includes(state));
  if (selected.length === 0 || selected.length === ALL_TREE_STEM_STATES.length) return '';
  return ` AND (${selected.map(state => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${state}'), '$.treestemstate') = 1`).join(' OR ')})`;
}

export interface MeasurementsSummaryPageQueryInput {
  schema: string;
  columns: string[];
  filterModel: ViewDataFilterModel;
  sortModel: unknown;
  plotID: number | undefined;
  plotCensusNumber: number | undefined;
  page: number;
  pageSize: number;
}

export interface MeasurementsSummaryPageQueries {
  /** `??` still unformatted and no LIMIT; the route appends PAGINATED_QUERY_LIMIT_CLAUSE and calls safeFormatQuery. */
  paginatedQuery: string;
  countQuery: string;
  exportQuery: string;
  queryParams: Array<number | undefined>;
  countParams: Array<number | undefined>;
}

/**
 * The measurementssummary branch of fixeddatafilter. The caller must have checked `schema` with isValidSchema:
 * the state predicates in config/measurementstatefilters.ts interpolate it.
 */
export function buildMeasurementsSummaryPageQueries(input: MeasurementsSummaryPageQueryInput): MeasurementsSummaryPageQueries {
  const { schema, columns, filterModel, plotID, plotCensusNumber, page, pageSize } = input;
  validateViewDataRequest(filterModel, input.sortModel);
  const orderBy = buildViewDataOrderByClause(parseViewDataSortModel(input.sortModel));
  const stemStatuses = parseViewDataStemStatusFilter(filterModel.stemStatus);

  const searchStub = filterModel.quickFilterValues?.length ? buildSearchStub(columns, filterModel.quickFilterValues, MEASUREMENTS_SUMMARY_ALIAS) : '';
  const filterStub = filterModel.items?.length ? buildFilterModelStub(filterModel, MEASUREMENTS_SUMMARY_ALIAS) : '';
  const searchAndFilter = [searchStub, filterStub]
    .filter(Boolean)
    .map(clause => ` AND (${clause})`)
    .join('\n              ');

  const sharedFrom = `
            FROM ??.measurementssummary ${MEASUREMENTS_SUMMARY_ALIAS}
              JOIN ??.census c ON ${MEASUREMENTS_SUMMARY_ALIAS}.PlotID = c.PlotID AND ${MEASUREMENTS_SUMMARY_ALIAS}.CensusID = c.CensusID`;
  const sharedWhere = `
            WHERE ${MEASUREMENTS_SUMMARY_ALIAS}.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ?
              ${buildMeasurementVisibleClauseSql(schema, MEASUREMENTS_SUMMARY_ALIAS, filterModel.visible)}
              ${buildTreeStemStateClauseSql(filterModel.tss)}
              ${buildStemStatusFilterClauseSql(schema, MEASUREMENTS_SUMMARY_ALIAS, stemStatuses)}
              ${searchAndFilter}`;

  return {
    paginatedQuery: `SELECT ${MEASUREMENTS_SUMMARY_ALIAS}.*, ${buildMeasurementRowSummaryProjectionSql(schema, MEASUREMENTS_SUMMARY_ALIAS)} ${sharedFrom} ${sharedWhere}
            ${orderBy}`,
    countQuery: `SELECT COUNT(*) as totalRows ${sharedFrom} ${sharedWhere}`,
    exportQuery: `SELECT ${MEASUREMENTS_SUMMARY_ALIAS}.* ${sharedFrom} ${sharedWhere}
            ORDER BY ${MEASUREMENTS_SUMMARY_ALIAS}.MeasurementDate ASC`,
    queryParams: [plotID, plotID, plotCensusNumber, page * pageSize, pageSize],
    countParams: [plotID, plotID, plotCensusNumber]
  };
}

/** GenericMapper turns a numeric 0 into undefined, so the rank becomes the status string before mapping (A4). */
export function attachMeasurementStatus(row: Record<string, unknown>): void {
  row.MeasurementStatus = measurementStatusFromRank(row[MEASUREMENT_STATUS_RANK_COLUMN]);
  delete row[MEASUREMENT_STATUS_RANK_COLUMN];
  row.HasContradiction = Number(row.HasContradiction) === 1;
}
