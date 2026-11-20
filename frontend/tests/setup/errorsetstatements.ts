import {
  buildCatalogStatement,
  buildDuplicateMemberGroupsStatement,
  buildHistogramWithFlagsStatement,
  buildHistogramWithoutFlagsStatement,
  buildIDRawRowsStatement,
  buildPageStatement,
  buildRelatedRowsOutsideErrorSetStatement,
  buildSameBatchMemberGroupsStatement,
  buildScopeRawRowsStatement,
  buildTotalsStatement,
  chunkCensusIDs,
  chunkMeasurementIDs,
  readStatementLabel,
  type BuiltStatement,
  type ErrorSetScope,
  type ErrorTypeKeyFilter,
  type FlagCombinations,
  type PageWindow
} from '@/app/api/errors/explorer/errorsetsql';

export const STATEMENT_PLOT_ID = 3;
const STATEMENT_PAGE_SIZE = 25;
const STATEMENT_PAGE_OFFSET = 50;

export const KEY_FILTER: ErrorTypeKeyFilter = { allKeysMatch: false, matchingKeys: [1, 7] };
export const ALL_FLAGS: FlagCombinations = { none: true, sameBatchOnly: true, duplicateOnly: true, both: true };
export const WINDOW: PageWindow = { limit: STATEMENT_PAGE_SIZE, offset: STATEMENT_PAGE_OFFSET };

export interface ErrorSetStatementVariant {
  readonly plotID: number;
  readonly keyFilter: ErrorTypeKeyFilter;
  readonly flags: FlagCombinations;
  readonly window: PageWindow;
}

export const DEFAULT_STATEMENT_VARIANT: ErrorSetStatementVariant = { plotID: STATEMENT_PLOT_ID, keyFilter: KEY_FILTER, flags: ALL_FLAGS, window: WINDOW };

export const UNLABELLED_STATEMENT = 'unlabelled';
/** Dev's shared active-measurement count (plan D-C): both arms send it, and it is allowed beside the ten explorer shapes. */
export const ACTIVE_COUNT_STATEMENT = 'active-count';
const ACTIVE_COUNT_TEXT =
  /SELECT COUNT\(\*\) AS n\s+FROM\s+\S+\.coremeasurements cm\s+JOIN\s+\S+\.census c ON c\.CensusID = cm\.CensusID\s+WHERE c\.PlotID = \? AND cm\.IsActive = 1/;
export const ORACLE_OUTSIDE_ROWS_STATEMENT = 'outside-rows';
const ORACLE_OUTSIDE_ROWS_SHAPE = new RegExp(
  [
    '^SELECT ms\\.CoreMeasurementID AS RelatedCoreMeasurementID, ms\\.TreeTag, ms\\.StemTag, ms\\.SpeciesCode, ms\\.QuadratName, ms\\.MeasurementDate,',
    'ms\\.MeasuredDBH, ms\\.MeasuredHOM, ms\\.StemLocalX, ms\\.StemLocalY, ms\\.Description AS MeasurementDescription, cm\\.UploadFileID, cm\\.UploadBatchID',
    'FROM \\S+\\.coremeasurements cm JOIN \\S+\\.measurementssummary ms ON ms\\.CoreMeasurementID = cm\\.CoreMeasurementID',
    'WHERE ms\\.PlotID = \\? AND ms\\.CensusID = \\? AND COALESCE\\(cm\\.IsActive, TRUE\\) = TRUE AND cm\\.CoreMeasurementID IN \\(\\?(, \\?)*\\)$'
  ].join(' ')
);
const ORACLE_RAW_ROWS = /measurement_error_log\s+mel/i;
const ORACLE_DUPLICATE_GROUPS = /GROUP_CONCAT\s*\(DISTINCT\s+ms\./i;
const ORACLE_SAME_BATCH_GROUPS = /GROUP_CONCAT\s*\(DISTINCT\s+cm\./i;

export function legacyStatementClass(sql: string): string {
  if (ORACLE_OUTSIDE_ROWS_SHAPE.test(sql.replace(/\s+/g, ' ').trim())) return ORACLE_OUTSIDE_ROWS_STATEMENT;
  if (ORACLE_RAW_ROWS.test(sql)) return 'raw-rows';
  if (ORACLE_DUPLICATE_GROUPS.test(sql)) return 'duplicate-groups';
  if (ORACLE_SAME_BATCH_GROUPS.test(sql)) return 'same-batch-groups';
  if (ACTIVE_COUNT_TEXT.test(sql)) return ACTIVE_COUNT_STATEMENT;
  return UNLABELLED_STATEMENT;
}

export function classifyStatement(sql: string): string {
  return readStatementLabel(sql) ?? legacyStatementClass(sql);
}

export function lastPageNumber(totalRows: number, pageSize: number): number {
  return Math.max(0, Math.ceil(totalRows / pageSize) - 1);
}

/** The page one past the last: its page statement returns no rows, so the totals statement answers. */
export function pastTheEndPageNumber(totalRows: number, pageSize: number): number {
  return lastPageNumber(totalRows, pageSize) + 1;
}

export function describeCensusScope(censusIDs: readonly number[]): { censuses: number; censusChunks: number } {
  return { censuses: censusIDs.length, censusChunks: chunkCensusIDs(censusIDs).length };
}

/** Every builder's output for every census chunk and every measurement-ID chunk (the ten statement shapes per chunk). */
export function everyErrorSetStatement(
  schema: string,
  censusIDs: number[],
  measurementIDs: number[],
  variant: ErrorSetStatementVariant = DEFAULT_STATEMENT_VARIANT
): BuiltStatement[] {
  return chunkCensusIDs(censusIDs).flatMap(censusChunk => {
    const scope: ErrorSetScope = { schema, plotID: variant.plotID, censusIDs: censusChunk };
    return [
      buildCatalogStatement(schema),
      buildPageStatement(scope, variant.keyFilter, variant.flags, variant.window),
      buildTotalsStatement(scope, variant.keyFilter, variant.flags),
      buildHistogramWithFlagsStatement(scope),
      buildHistogramWithoutFlagsStatement(scope),
      buildScopeRawRowsStatement(scope),
      ...chunkMeasurementIDs(measurementIDs).flatMap(idChunk => [
        buildIDRawRowsStatement(scope, idChunk),
        buildRelatedRowsOutsideErrorSetStatement(scope, idChunk),
        buildDuplicateMemberGroupsStatement(scope, idChunk),
        buildSameBatchMemberGroupsStatement(scope, idChunk)
      ])
    ];
  });
}
