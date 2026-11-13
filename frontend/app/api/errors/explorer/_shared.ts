import type ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import {
  computeDbhChangePercent,
  ContradictionType,
  dedupeNumbers,
  DBH_CHANGE_VALIDATION_CODES,
  dedupeStrings,
  ErrorComparisonContext,
  ErrorDetailRecord,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerColumnFilter,
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  ErrorTypeIdentity,
  RelatedContradictionRow,
  toFiniteNumberOrNull
} from '@/config/errorsexplorer';
import { type ColumnValueRow, compareRowsBySortItem, matchesColumnFilter } from '@/lib/errorsexplorer/columnquery';
import { buildActiveMeasurementCountQuery, readActiveMeasurementCount } from '@/lib/activemeasurementcount';
import {
  buildCatalogStatement,
  buildDuplicateMemberGroupsStatement,
  buildHistogramWithFlagsStatement,
  buildHistogramWithoutFlagsStatement,
  buildIDRawRowsStatement,
  buildRelatedRowsOutsideErrorSetStatement,
  buildPageStatement,
  buildSameBatchMemberGroupsStatement,
  buildScopeRawRowsStatement,
  buildTotalsStatement,
  chunkCensusIDs,
  chunkMeasurementIDs,
  compareSelectedRows,
  SQL_TRUE,
  type BuiltStatement,
  type ContradictionFlagColumns,
  type DuplicateMemberGroupRow,
  type ErrorSetScope,
  type ErrorSetTotalsRow,
  type ErrorSignatureRow,
  type ErrorTypeCatalogRow,
  type ErrorTypeKeyFilter,
  type FlagCombinations,
  type RelatedRowOutsideErrorSetRow,
  type SameBatchMemberGroupRow,
  type SelectedPageRow
} from './errorsetsql';
import {
  allowedFlagCombinations,
  anyFlagCombinationAllowed,
  buildErrorTypeCatalog,
  buildRelatedMeasurementIDs,
  computeCensusTotals,
  computeErrorKeySets,
  computeErrorMessageCounts,
  computeErrorTypeFacets,
  contradictionFiltersAllow,
  errorMatchesFilters,
  findMissingErrorTypeKeys,
  getOccurrenceFields,
  hasErrorTypeOrderTie,
  hasIncompleteSignature,
  hasLocaleCompareTie,
  isImpossibleKeyFilter,
  mergeSignatureRows,
  toSliceBounds,
  toWeightedErrorRows,
  type ErrorMessageCounts,
  type ErrorTypeCatalog,
  type SliceBounds,
  type WeightedErrorRow
} from './errorsetcounts';

export type { ErrorMessageCounts } from './errorsetcounts';

type ExplorerConnection = Pick<ReturnType<typeof ConnectionManager.getInstance>, 'executeQuery'>;
type FacetsRequest = Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID' | 'censusIDs' | 'filters'>;
type SignatureRequestKind = 'facets' | 'message-counts';

const ERROR_SIGNATURE_WARNING_THRESHOLD = 10_000;
export const SIGNATURE_FALLBACK_WARNING = 'Errors explorer: a cut error-type signature sent this request to the Node path';
export const SIGNATURE_THRESHOLD_WARNING = 'Errors explorer: the signature histogram returned more rows than the warning threshold';
export const LOCALE_TIE_FALLBACK_WARNING = 'Errors explorer: facet values that localeCompare ties sent this request to the Node path';

export interface RawErrorOccurrenceRow {
  CoreMeasurementID: number;
  PlotID: number;
  CensusID: number;
  QuadratID?: number | null;
  TreeID?: number | null;
  StemGUID?: number | null;
  // Authoritative coremeasurements.StemGUID. Distinct from ms.StemGUID (which
  // can be stale): null means the row failed ingestion and lives in the
  // failedmeasurements edit surface.
  CoreStemGUID: number | null;
  SpeciesID?: number | null;
  TreeTag?: string | null;
  StemTag?: string | null;
  SpeciesName?: string | null;
  SubspeciesName?: string | null;
  SpeciesCode?: string | null;
  QuadratName?: string | null;
  StemLocalX?: number | null;
  StemLocalY?: number | null;
  StemPlotX?: number | null;
  StemPlotY?: number | null;
  MeasurementDate?: string | Date | null;
  MeasuredDBH?: number | null;
  MeasuredHOM?: number | null;
  IsValidated?: boolean | null;
  MeasurementDescription?: string | null;
  Attributes?: string | null;
  RawCodes?: string | null;
  UserDefinedFields?: string | null;
  UploadFileID?: string | null;
  UploadBatchID?: string | null;
  ErrorSource: 'validation' | 'ingestion';
  ErrorCode: string;
  DisplayMessage: string;
  ValidationCriteria?: string | null;
  ProcedureName?: string | null;
  // DECIMAL(12,6)/INT snapshot columns off measurement_error_log — mysql2 may
  // return the DECIMAL columns as strings, so callers must coerce with Number().
  PriorCensusID?: number | null;
  PriorDBH?: number | string | null;
  PriorHOM?: number | string | null;
}

interface ContradictionInfo {
  type: ContradictionType;
  groupKey: string | null;
  relatedMeasurementIDs: number[];
}

export interface GroupedErrorRow {
  baseRow: ErrorExplorerRow;
  allErrors: ErrorDetailRecord[];
  contradictions: ContradictionInfo[];
}

function normalizeDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }
  return null;
}

function buildComparison(rawRow: RawErrorOccurrenceRow): ErrorComparisonContext | null {
  if (rawRow.ErrorSource !== 'validation' || !DBH_CHANGE_VALIDATION_CODES.has(String(rawRow.ErrorCode))) return null;
  const priorHOM = rawRow.PriorHOM ?? null;
  const currentHOM = rawRow.MeasuredHOM ?? null;
  return {
    priorCensusID: rawRow.PriorCensusID != null ? Number(rawRow.PriorCensusID) : null,
    priorDBH: rawRow.PriorDBH != null ? Number(rawRow.PriorDBH) : null,
    priorHOM: priorHOM != null ? Number(priorHOM) : null,
    homChanged: priorHOM != null && currentHOM != null && Number(priorHOM) !== Number(currentHOM)
  };
}

function addContradiction(contradictionMap: Map<number, ContradictionInfo[]>, measurementID: number, contradiction: ContradictionInfo) {
  const existing = contradictionMap.get(measurementID) ?? [];
  if (existing.some(item => item.type === contradiction.type)) {
    return;
  }
  contradictionMap.set(measurementID, [...existing, contradiction]);
}

function pickPrimaryContradictionType(
  contradictionTypes: ContradictionType[],
  filters: Pick<ErrorExplorerFilters, 'contradictionTypes'>,
  preferredType?: ContradictionType
): ContradictionType | null {
  if (preferredType && contradictionTypes.includes(preferredType)) {
    return preferredType;
  }

  const filteredType = filters.contradictionTypes.find(type => contradictionTypes.includes(type));
  return filteredType ?? contradictionTypes[0] ?? null;
}

function getVisibleContradictions(
  contradictions: ContradictionInfo[],
  filters: Pick<ErrorExplorerFilters, 'contradictionTypes'>,
  preferredType?: ContradictionType
) {
  const contradictionTypes = dedupeStrings(contradictions.map(contradiction => contradiction.type)) as ContradictionType[];
  const primaryType = pickPrimaryContradictionType(contradictionTypes, filters, preferredType);

  return {
    contradictionTypes,
    primaryType,
    relatedMeasurementIDs: primaryType
      ? dedupeNumbers(contradictions.filter(contradiction => contradiction.type === primaryType).flatMap(contradiction => contradiction.relatedMeasurementIDs))
      : []
  };
}

function groupErrorRows(rawRows: RawErrorOccurrenceRow[], contradictionMap: Map<number, ContradictionInfo[]>): Map<number, GroupedErrorRow> {
  const grouped = new Map<number, GroupedErrorRow>();

  rawRows.forEach(rawRow => {
    const measurementID = Number(rawRow.CoreMeasurementID);
    const contradictions = contradictionMap.get(measurementID) ?? [];
    const visibleContradictions = getVisibleContradictions(contradictions, { contradictionTypes: [] });
    const detailRecord: ErrorDetailRecord = {
      source: rawRow.ErrorSource,
      code: String(rawRow.ErrorCode),
      message: rawRow.DisplayMessage,
      fields: getOccurrenceFields(rawRow.ErrorSource, String(rawRow.ErrorCode), rawRow.ValidationCriteria),
      procedureName: rawRow.ProcedureName ?? null,
      comparison: buildComparison(rawRow)
    };

    const existing = grouped.get(measurementID);
    if (!existing) {
      const baseRow: ErrorExplorerRow = {
        id: measurementID,
        coreMeasurementID: measurementID,
        plotID: Number(rawRow.PlotID),
        censusID: Number(rawRow.CensusID),
        quadratID: rawRow.QuadratID ?? undefined,
        treeID: rawRow.TreeID ?? undefined,
        stemGUID: rawRow.StemGUID ?? undefined,
        speciesID: rawRow.SpeciesID ?? undefined,
        treeTag: rawRow.TreeTag ?? undefined,
        stemTag: rawRow.StemTag ?? undefined,
        speciesName: rawRow.SpeciesName ?? undefined,
        subspeciesName: rawRow.SubspeciesName ?? undefined,
        speciesCode: rawRow.SpeciesCode ?? undefined,
        quadratName: rawRow.QuadratName ?? undefined,
        stemLocalX: rawRow.StemLocalX ?? undefined,
        stemLocalY: rawRow.StemLocalY ?? undefined,
        stemPlotX: rawRow.StemPlotX ?? undefined,
        stemPlotY: rawRow.StemPlotY ?? undefined,
        measurementDate: normalizeDate(rawRow.MeasurementDate),
        measuredDBH: rawRow.MeasuredDBH ?? undefined,
        measuredHOM: rawRow.MeasuredHOM ?? undefined,
        isValidated: rawRow.IsValidated ?? undefined,
        description: rawRow.MeasurementDescription ?? undefined,
        attributes: rawRow.Attributes ?? undefined,
        rawCodes: rawRow.RawCodes ?? undefined,
        userDefinedFields: rawRow.UserDefinedFields ?? undefined,
        primaryErrorMessage: rawRow.DisplayMessage,
        errorMessages: [rawRow.DisplayMessage],
        errorSources: [rawRow.ErrorSource],
        errorFields: detailRecord.fields,
        errorCodes: [String(rawRow.ErrorCode)],
        errorCount: 1,
        totalErrorCount: 1,
        dbhChangePercent: null,
        hasContradiction: contradictions.length > 0,
        contradictionTypes: visibleContradictions.contradictionTypes,
        contradictionType: visibleContradictions.primaryType,
        contradictionGroupKey: visibleContradictions.primaryType
          ? (contradictions.find(contradiction => contradiction.type === visibleContradictions.primaryType)?.groupKey ?? null)
          : null,
        relatedMeasurementIDs: visibleContradictions.relatedMeasurementIDs,
        uploadFileID: rawRow.UploadFileID ?? null,
        uploadBatchID: rawRow.UploadBatchID ?? null,
        isFailedRow: rawRow.CoreStemGUID === null
      };
      grouped.set(measurementID, {
        baseRow,
        allErrors: [detailRecord],
        contradictions
      });
      return;
    }

    existing.allErrors.push(detailRecord);
    existing.baseRow.errorMessages = dedupeStrings([...existing.baseRow.errorMessages, rawRow.DisplayMessage]);
    existing.baseRow.errorSources = dedupeStrings([...existing.baseRow.errorSources, rawRow.ErrorSource]) as Array<'validation' | 'ingestion'>;
    existing.baseRow.errorFields = dedupeStrings([...existing.baseRow.errorFields, ...detailRecord.fields]);
    existing.baseRow.errorCodes = dedupeStrings([...existing.baseRow.errorCodes, String(rawRow.ErrorCode)]);
    existing.baseRow.errorCount = existing.baseRow.errorMessages.length;
    existing.baseRow.totalErrorCount = existing.allErrors.length;
  });

  return grouped;
}

function matchesQuickSearch(row: ErrorExplorerRow, errors: ErrorDetailRecord[], quickSearch: string): boolean {
  const normalized = quickSearch.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    row.treeTag,
    row.stemTag,
    row.speciesCode,
    row.quadratName,
    row.rawCodes,
    row.attributes,
    row.primaryErrorMessage,
    ...row.errorMessages,
    ...errors.flatMap(error => [error.message, ...error.fields])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function materializeMatchingErrors(row: GroupedErrorRow, filters: ErrorExplorerFilters): ErrorDetailRecord[] {
  return row.allErrors.filter(error => errorMatchesFilters(error, filters));
}

function rowMatchesFilters(row: GroupedErrorRow, matchingErrors: ErrorDetailRecord[], filters: ErrorExplorerFilters): boolean {
  if (matchingErrors.length === 0) {
    return false;
  }
  if (!contradictionFiltersAllow(filters, row.baseRow.hasContradiction, row.baseRow.contradictionTypes)) {
    return false;
  }
  return matchesQuickSearch(row.baseRow, matchingErrors, filters.quickSearch);
}

function buildFilteredRows(groupedRows: Map<number, GroupedErrorRow>, filters: ErrorExplorerFilters): GroupedErrorRow[] {
  return Array.from(groupedRows.values()).filter(groupedRow => rowMatchesFilters(groupedRow, materializeMatchingErrors(groupedRow, filters), filters));
}

function matchesErrorTypeIdentity(error: ErrorDetailRecord, identity: ErrorTypeIdentity): boolean {
  return error.source === identity.source && error.code === identity.code && error.message === identity.message;
}

function toDisplayRow(
  groupedRow: GroupedErrorRow,
  filters: ErrorExplorerFilters,
  preferredContradictionType?: ContradictionType,
  errorType?: ErrorTypeIdentity
): ErrorExplorerRow {
  const pageMatchingErrors = materializeMatchingErrors(groupedRow, filters);
  const matchingErrors = errorType ? pageMatchingErrors.filter(error => matchesErrorTypeIdentity(error, errorType)) : pageMatchingErrors;
  const visibleErrors = matchingErrors.length > 0 ? matchingErrors : groupedRow.allErrors;
  const visibleContradictions = getVisibleContradictions(groupedRow.contradictions, filters, preferredContradictionType);

  const comparisonSource = [...visibleErrors]
    .filter(error => error.comparison !== null && error.source === 'validation')
    .sort((a, b) => Number(a.code) - Number(b.code))[0];
  const priorDBH = comparisonSource?.comparison?.priorDBH ?? null;

  return {
    ...groupedRow.baseRow,
    primaryErrorMessage: visibleErrors[0]?.message ?? groupedRow.baseRow.primaryErrorMessage,
    errorMessages: dedupeStrings(visibleErrors.map(error => error.message)),
    errorSources: dedupeStrings(visibleErrors.map(error => error.source)) as Array<'validation' | 'ingestion'>,
    errorFields: dedupeStrings(visibleErrors.flatMap(error => error.fields)),
    errorCodes: dedupeStrings(visibleErrors.map(error => error.code)),
    errorCount: visibleErrors.length,
    totalErrorCount: groupedRow.allErrors.length,
    contradictionTypes: visibleContradictions.contradictionTypes,
    contradictionType: visibleContradictions.primaryType,
    contradictionGroupKey: visibleContradictions.primaryType
      ? (groupedRow.contradictions.find(contradiction => contradiction.type === visibleContradictions.primaryType)?.groupKey ?? null)
      : null,
    relatedMeasurementIDs: visibleContradictions.relatedMeasurementIDs,
    priorCensusID: comparisonSource?.comparison?.priorCensusID ?? null,
    priorDBH,
    priorHOM: comparisonSource?.comparison?.priorHOM ?? null,
    homChanged: comparisonSource?.comparison?.homChanged ?? false,
    dbhChangePercent: computeDbhChangePercent(priorDBH, groupedRow.baseRow.measuredDBH)
  };
}

function sortRows(a: GroupedErrorRow, b: GroupedErrorRow): number {
  const contradictionDelta = Number(b.baseRow.hasContradiction) - Number(a.baseRow.hasContradiction);
  if (contradictionDelta !== 0) return contradictionDelta;

  const errorCountDelta = b.allErrors.length - a.allErrors.length;
  if (errorCountDelta !== 0) return errorCountDelta;

  const dateDelta = (a.baseRow.measurementDate ?? '').localeCompare(b.baseRow.measurementDate ?? '');
  if (dateDelta !== 0) return dateDelta;

  const aID = a.baseRow.coreMeasurementID ?? Number.MAX_SAFE_INTEGER;
  const bID = b.baseRow.coreMeasurementID ?? Number.MAX_SAFE_INTEGER;
  return aID - bID;
}

/** push(...rows) throws RangeError once rows outgrow the engine's argument limit; a statement can answer with hundreds of thousands. */
function appendRows<Row>(target: Row[], rows: readonly Row[]): void {
  for (const row of rows) target.push(row);
}

async function runStatement<Row>(connectionManager: ExplorerConnection, statement: BuiltStatement): Promise<Row[]> {
  return (await connectionManager.executeQuery(statement.sql, statement.params)) as Row[];
}

function uniquePositiveCensusIDs(censusIDs: number | number[]): number[] {
  return Array.from(new Set((Array.isArray(censusIDs) ? censusIDs : [censusIDs]).filter(censusID => censusID > 0)));
}

function requestCensusIDs(request: { censusID: number; censusIDs?: number[] }): number[] {
  return uniquePositiveCensusIDs(request.censusIDs?.length ? request.censusIDs : request.censusID);
}

function censusChunkScopes(schema: string, plotID: number, censusIDs: number[]): ErrorSetScope[] {
  return chunkCensusIDs(censusIDs).map(chunk => ({ schema, plotID, censusIDs: chunk }));
}

type FlaggedRawErrorOccurrenceRow = RawErrorOccurrenceRow & ContradictionFlagColumns;

function typeOnlyContradictions(rawRows: FlaggedRawErrorOccurrenceRow[]): Map<number, ContradictionInfo[]> {
  const contradictionMap = new Map<number, ContradictionInfo[]>();
  rawRows.forEach(rawRow => {
    const measurementID = Number(rawRow.CoreMeasurementID);
    if (Number(rawRow.HasDuplicate) === SQL_TRUE)
      addContradiction(contradictionMap, measurementID, { type: 'duplicate_tag_stem', groupKey: null, relatedMeasurementIDs: [] });
    if (Number(rawRow.HasSameBatch) === SQL_TRUE)
      addContradiction(contradictionMap, measurementID, { type: 'same_batch_conflict', groupKey: null, relatedMeasurementIDs: [] });
  });
  return contradictionMap;
}

async function fetchFlaggedScopeRawRows(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  censusIDs: number[]
): Promise<FlaggedRawErrorOccurrenceRow[]> {
  const rawRows: FlaggedRawErrorOccurrenceRow[] = [];
  for (const scope of censusChunkScopes(schema, plotID, censusIDs)) {
    appendRows(rawRows, await runStatement<FlaggedRawErrorOccurrenceRow>(connectionManager, buildScopeRawRowsStatement(scope)));
  }
  return rawRows;
}

export async function fetchGroupedErrorRows(connectionManager: ExplorerConnection, schema: string, plotID: number, censusIDs: number | number[]) {
  const rawRows = await fetchFlaggedScopeRawRows(connectionManager, schema, plotID, uniquePositiveCensusIDs(censusIDs));
  return groupErrorRows(rawRows, typeOnlyContradictions(rawRows));
}

function toColumnValueRow(row: ErrorExplorerRow): ColumnValueRow {
  return { ...row, coreMeasurementID: Number(row.coreMeasurementID) };
}

interface QueryRowPair {
  grouped: GroupedErrorRow;
  display: ErrorExplorerRow;
}

interface RequestedRow {
  measurementID: number;
  censusID: number;
}

type RowSelection = Pick<ErrorExplorerQueryRequest, 'filters' | 'errorType'> & { columnFilter?: ErrorExplorerColumnFilter };

const DETAILS_DISPLAY_FILTERS: ErrorExplorerFilters = {
  source: 'all',
  exactMessages: [],
  affectedFields: [],
  contradictionOnly: false,
  contradictionTypes: [],
  quickSearch: ''
};

function contradictionsFromMemberGroups(
  duplicateGroups: DuplicateMemberGroupRow[],
  sameBatchGroups: SameBatchMemberGroupRow[]
): Map<number, ContradictionInfo[]> {
  const contradictionMap = new Map<number, ContradictionInfo[]>();
  duplicateGroups.forEach(group => {
    const requestedID = Number(group.RequestedMeasurementID);
    addContradiction(contradictionMap, requestedID, {
      type: 'duplicate_tag_stem',
      groupKey: `duplicate:${group.CensusID}:${group.TreeTag ?? ''}:${group.StemTag ?? ''}`,
      relatedMeasurementIDs: buildRelatedMeasurementIDs(group.MeasurementIDs, Number(group.MemberListComplete) === SQL_TRUE, requestedID)
    });
  });
  sameBatchGroups.forEach(group => {
    const requestedID = Number(group.RequestedMeasurementID);
    addContradiction(contradictionMap, requestedID, {
      type: 'same_batch_conflict',
      groupKey: `same-batch:${group.CensusID}:${group.UploadFileID ?? ''}:${group.UploadBatchID ?? ''}:${group.TreeTag ?? ''}`,
      relatedMeasurementIDs: buildRelatedMeasurementIDs(group.MeasurementIDs, Number(group.MemberListComplete) === SQL_TRUE, requestedID)
    });
  });
  return contradictionMap;
}

async function fetchMemberGroupContradictions(
  connectionManager: ExplorerConnection,
  scope: ErrorSetScope,
  measurementIDs: number[]
): Promise<Map<number, ContradictionInfo[]>> {
  const [duplicateGroups, sameBatchGroups] = await Promise.all([
    runStatement<DuplicateMemberGroupRow>(connectionManager, buildDuplicateMemberGroupsStatement(scope, measurementIDs)),
    runStatement<SameBatchMemberGroupRow>(connectionManager, buildSameBatchMemberGroupsStatement(scope, measurementIDs))
  ]);
  return contradictionsFromMemberGroups(duplicateGroups, sameBatchGroups);
}

/** Display data for requested rows only: raw rows (already read, or from SQL) and their member groups, per census chunk, one wave each. */
async function hydrateRequestedRows(
  connectionManager: ExplorerConnection,
  scopes: ErrorSetScope[],
  requested: RequestedRow[],
  knownRawRows: Map<number, RawErrorOccurrenceRow[]> | null
): Promise<Map<number, GroupedErrorRow>> {
  const rawRows: RawErrorOccurrenceRow[] = [];
  const contradictionMap = new Map<number, ContradictionInfo[]>();
  for (const scope of scopes) {
    const scopeIDs = requested.filter(row => scope.censusIDs.includes(row.censusID)).map(row => row.measurementID);
    for (const idChunk of chunkMeasurementIDs(scopeIDs)) {
      const [chunkRawRows, chunkContradictions] = await Promise.all([
        knownRawRows
          ? Promise.resolve(idChunk.flatMap(id => knownRawRows.get(id) ?? []))
          : runStatement<RawErrorOccurrenceRow>(connectionManager, buildIDRawRowsStatement(scope, idChunk)),
        fetchMemberGroupContradictions(connectionManager, scope, idChunk)
      ]);
      appendRows(rawRows, chunkRawRows);
      chunkContradictions.forEach((contradictions, measurementID) => contradictionMap.set(measurementID, contradictions));
    }
  }
  return groupErrorRows(rawRows, contradictionMap);
}

function rowKeepsIdentity(row: GroupedErrorRow, filters: ErrorExplorerFilters, errorType: ErrorTypeIdentity | undefined): boolean {
  return !errorType || materializeMatchingErrors(row, filters).some(error => matchesErrorTypeIdentity(error, errorType));
}

/** Selection order kept; rows that no longer match the request on the data they display are dropped (spec §5). */
function recheckedDisplayRows(selectedIDs: number[], hydrated: Map<number, GroupedErrorRow>, selection: RowSelection): ErrorExplorerRow[] {
  const { filters, errorType, columnFilter } = selection;
  return selectedIDs
    .map(measurementID => hydrated.get(measurementID))
    .filter((row): row is GroupedErrorRow => row !== undefined)
    .filter(row => rowMatchesFilters(row, materializeMatchingErrors(row, filters), filters) && rowKeepsIdentity(row, filters, errorType))
    .map(row => toDisplayRow(row, filters, undefined, errorType))
    .filter(display => !columnFilter || matchesColumnFilter(toColumnValueRow(display), columnFilter));
}

function rawRowsOfMeasurements(rawRows: RawErrorOccurrenceRow[], measurementIDs: ReadonlySet<number>): Map<number, RawErrorOccurrenceRow[]> {
  const byMeasurement = new Map<number, RawErrorOccurrenceRow[]>();
  for (const rawRow of rawRows) {
    const measurementID = Number(rawRow.CoreMeasurementID);
    if (!measurementIDs.has(measurementID)) continue;
    const measurementRows = byMeasurement.get(measurementID);
    if (measurementRows) measurementRows.push(rawRow);
    else byMeasurement.set(measurementID, [rawRow]);
  }
  return byMeasurement;
}

/**
 * Spec Data → Query, steps 1-7 over the flagged scope raw rows: page filters, identity (decided on the page-matching errors, so
 * search and Show behave exactly as the facets do), pair every row with the projection its cells show, column filter, sort, slice.
 * totalRows counts after the column filter. The page's rows are then hydrated with their member groups and re-checked.
 */
async function queryOnNodePath(
  connectionManager: ExplorerConnection,
  request: ErrorExplorerQueryRequest,
  censusIDs: number[]
): Promise<ErrorExplorerQueryResponse> {
  const rawRows = await fetchFlaggedScopeRawRows(connectionManager, request.schema, request.plotID, censusIDs);
  const groupedRows = groupErrorRows(rawRows, typeOnlyContradictions(rawRows));
  const identity = request.errorType;
  const identityRows = buildFilteredRows(groupedRows, request.filters).filter(row => rowKeepsIdentity(row, request.filters, identity));
  const pairs: QueryRowPair[] = identityRows.map(grouped => ({ grouped, display: toDisplayRow(grouped, request.filters, undefined, identity) }));
  const columnFilter = request.columnFilters?.[0];
  const filteredPairs = columnFilter ? pairs.filter(pair => matchesColumnFilter(toColumnValueRow(pair.display), columnFilter)) : pairs;
  const sortItem = request.sortModel?.[0];
  filteredPairs.sort((a, b) =>
    sortItem ? compareRowsBySortItem(toColumnValueRow(a.display), toColumnValueRow(b.display), sortItem) : sortRows(a.grouped, b.grouped)
  );
  const start = request.page * request.pageSize;
  const pageRows = filteredPairs.slice(start, start + request.pageSize).map(pair => pair.grouped);
  const pageMeasurementIDs = pageRows.map(row => Number(row.baseRow.coreMeasurementID));
  const hydrated = await hydrateRequestedRows(
    connectionManager,
    censusChunkScopes(request.schema, request.plotID, censusIDs),
    pageRows.map(row => ({ measurementID: Number(row.baseRow.coreMeasurementID), censusID: Number(row.baseRow.censusID) })),
    rawRowsOfMeasurements(rawRows, new Set(pageMeasurementIDs))
  );

  return {
    rows: recheckedDisplayRows(pageMeasurementIDs, hydrated, { filters: request.filters, errorType: identity, columnFilter }),
    totalRows: filteredPairs.length
  };
}

async function loadErrorTypeCatalog(connectionManager: ExplorerConnection, schema: string): Promise<ErrorTypeCatalog> {
  return buildErrorTypeCatalog(await runStatement<ErrorTypeCatalogRow>(connectionManager, buildCatalogStatement(schema)));
}

interface PageSelection {
  rows: SelectedPageRow[];
  totalRows: number;
}

function emptyQueryResponse(): ErrorExplorerQueryResponse {
  return { rows: [], totalRows: 0 };
}

async function fetchTotalRows(
  connectionManager: ExplorerConnection,
  scope: ErrorSetScope,
  keyFilter: ErrorTypeKeyFilter,
  flags: FlagCombinations
): Promise<number> {
  const [totals] = await runStatement<ErrorSetTotalsRow>(connectionManager, buildTotalsStatement(scope, keyFilter, flags));
  return Number(totals.TotalRows ?? 0);
}

async function selectSingleChunkPage(
  connectionManager: ExplorerConnection,
  scope: ErrorSetScope,
  keyFilter: ErrorTypeKeyFilter,
  flags: FlagCombinations,
  bounds: SliceBounds
): Promise<PageSelection> {
  if (bounds.limit === 0) return { rows: [], totalRows: await fetchTotalRows(connectionManager, scope, keyFilter, flags) };
  const rows = await runStatement<SelectedPageRow>(connectionManager, buildPageStatement(scope, keyFilter, flags, bounds));
  if (rows.length === 0) return { rows, totalRows: await fetchTotalRows(connectionManager, scope, keyFilter, flags) };
  return { rows, totalRows: Number(rows[0].TotalRows) };
}

/** More than CENSUS_LIST_SIZE censuses: each chunk's first offset + limit rows, merged in SQL order (spec §10). */
async function selectMultiChunkPage(
  connectionManager: ExplorerConnection,
  scopes: ErrorSetScope[],
  keyFilter: ErrorTypeKeyFilter,
  flags: FlagCombinations,
  bounds: SliceBounds
): Promise<PageSelection> {
  const prefixWindow: SliceBounds = { limit: bounds.offset + bounds.limit, offset: 0 };
  const candidates: SelectedPageRow[] = [];
  let totalRows = 0;
  for (const scope of scopes) {
    if (bounds.limit === 0) {
      totalRows += await fetchTotalRows(connectionManager, scope, keyFilter, flags);
      continue;
    }
    const rows = await runStatement<SelectedPageRow>(connectionManager, buildPageStatement(scope, keyFilter, flags, prefixWindow));
    if (rows.length > 0) {
      appendRows(candidates, rows);
      totalRows += Number(rows[0].TotalRows);
    }
  }
  return { rows: candidates.sort(compareSelectedRows).slice(bounds.offset, bounds.offset + bounds.limit), totalRows };
}

async function queryOnSqlPath(
  connectionManager: ExplorerConnection,
  request: ErrorExplorerQueryRequest,
  censusIDs: number[]
): Promise<ErrorExplorerQueryResponse> {
  const flags = allowedFlagCombinations(request.filters);
  if (censusIDs.length === 0 || !anyFlagCombinationAllowed(flags)) return emptyQueryResponse();
  const keyFilter = computeErrorKeySets(await loadErrorTypeCatalog(connectionManager, request.schema), request.filters, request.errorType);
  if (isImpossibleKeyFilter(keyFilter)) return emptyQueryResponse();
  const scopes = censusChunkScopes(request.schema, request.plotID, censusIDs);
  const bounds = toSliceBounds(request.page, request.pageSize);
  const selection =
    scopes.length === 1
      ? await selectSingleChunkPage(connectionManager, scopes[0], keyFilter, flags, bounds)
      : await selectMultiChunkPage(connectionManager, scopes, keyFilter, flags, bounds);
  const selectedIDs = selection.rows.map(row => Number(row.CoreMeasurementID));
  const hydrated = await hydrateRequestedRows(
    connectionManager,
    scopes,
    selection.rows.map(row => ({ measurementID: Number(row.CoreMeasurementID), censusID: Number(row.CensusID) })),
    null
  );
  return {
    rows: recheckedDisplayRows(selectedIDs, hydrated, { filters: request.filters, errorType: request.errorType }),
    totalRows: selection.totalRows
  };
}

/** Search, sort and column filters read the whole error set in Node; the page statement cannot order or filter on those (spec D-A). */
function mustRunOnNodePath(request: ErrorExplorerQueryRequest): boolean {
  return request.filters.quickSearch.trim().length > 0 || (request.sortModel?.length ?? 0) > 0 || (request.columnFilters?.length ?? 0) > 0;
}

export async function queryErrorExplorer(connectionManager: ExplorerConnection, request: ErrorExplorerQueryRequest): Promise<ErrorExplorerQueryResponse> {
  const censusIDs = requestCensusIDs(request);
  return mustRunOnNodePath(request) ? queryOnNodePath(connectionManager, request, censusIDs) : queryOnSqlPath(connectionManager, request, censusIDs);
}

export interface ErrorExportRow {
  CoreMeasurementID: number;
  TreeTag: string;
  StemTag: string;
  SpeciesCode: string;
  QuadratName: string;
  MeasurementDate: string;
  MeasuredDBH: number | '';
  MeasuredHOM: number | '';
  ErrorSource: string;
  ErrorCode: string;
  ErrorMessage: string;
  PriorCensusID: number | '';
  PriorDBH: number | '';
  PriorHOM: number | '';
  HOMChanged: 'true' | 'false' | '';
}

// A blank HOMChanged means "the two HOM values were never comparable", never
// "compared and unchanged". comparison.homChanged is a two-state display flag —
// false there only means "show no HOM-changed warning" — so the export cannot
// print it verbatim without asserting a comparison that may not have happened:
// legacy Validation 1/2 rows predate the prior-census snapshot entirely, and
// either census may simply carry no HOM.
function formatHOMChangedForExport(comparison: ErrorComparisonContext | null, currentHOM: number | null | undefined): ErrorExportRow['HOMChanged'] {
  if (comparison?.priorHOM == null || currentHOM == null) return '';
  return comparison.homChanged ? 'true' : 'false';
}

// One row per error occurrence (not per measurement) — a measurement with three
// unresolved errors produces three CSV rows, each carrying its own comparison
// context. Sort mirrors queryErrorExplorer's unfiltered grid order so the
// export reads the same top-to-bottom as the grid the user was looking at.
export function buildErrorExportRows(
  groupedRows: Map<number, GroupedErrorRow>,
  filters: ErrorExplorerFilters,
  errorType?: ErrorTypeIdentity
): ErrorExportRow[] {
  return buildFilteredRows(groupedRows, filters)
    .sort(sortRows)
    .flatMap(row =>
      materializeMatchingErrors(row, filters)
        .filter(error => !errorType || matchesErrorTypeIdentity(error, errorType))
        .map(
          (error): ErrorExportRow => ({
            CoreMeasurementID: Number(row.baseRow.coreMeasurementID),
            TreeTag: row.baseRow.treeTag ?? '',
            StemTag: row.baseRow.stemTag ?? '',
            SpeciesCode: row.baseRow.speciesCode ?? '',
            QuadratName: row.baseRow.quadratName ?? '',
            MeasurementDate: row.baseRow.measurementDate ?? '',
            MeasuredDBH: row.baseRow.measuredDBH ?? '',
            MeasuredHOM: row.baseRow.measuredHOM ?? '',
            ErrorSource: error.source,
            ErrorCode: error.code,
            ErrorMessage: error.message,
            PriorCensusID: error.comparison?.priorCensusID ?? '',
            PriorDBH: error.comparison?.priorDBH ?? '',
            PriorHOM: error.comparison?.priorHOM ?? '',
            HOMChanged: formatHOMChangedForExport(error.comparison, row.baseRow.measuredHOM)
          })
        )
    );
}

async function fetchSignatureRows(connectionManager: ExplorerConnection, scopes: ErrorSetScope[], withFlags: boolean): Promise<ErrorSignatureRow[]> {
  const chunks: ErrorSignatureRow[][] = [];
  for (const scope of scopes) {
    chunks.push(
      await runStatement<ErrorSignatureRow>(connectionManager, withFlags ? buildHistogramWithFlagsStatement(scope) : buildHistogramWithoutFlagsStatement(scope))
    );
  }
  return mergeSignatureRows(chunks);
}

async function resolveWeightedRows(
  connectionManager: ExplorerConnection,
  schema: string,
  catalog: ErrorTypeCatalog,
  rows: ErrorSignatureRow[]
): Promise<WeightedErrorRow[]> {
  if (findMissingErrorTypeKeys(rows, catalog).length === 0) return toWeightedErrorRows(rows, catalog);
  return toWeightedErrorRows(rows, await loadErrorTypeCatalog(connectionManager, schema));
}

/** Catalog and histogram in parallel; null means the request must take the Node path (a cut signature). */
async function readWeightedHistogram(
  connectionManager: ExplorerConnection,
  scope: { schema: string; plotID: number; censusIDs: number[] },
  withFlags: boolean,
  requestKind: SignatureRequestKind
): Promise<WeightedErrorRow[] | null> {
  const [catalog, rows] = await Promise.all([
    loadErrorTypeCatalog(connectionManager, scope.schema),
    fetchSignatureRows(connectionManager, censusChunkScopes(scope.schema, scope.plotID, scope.censusIDs), withFlags)
  ]);
  if (rows.length > ERROR_SIGNATURE_WARNING_THRESHOLD) {
    ailogger.warn(SIGNATURE_THRESHOLD_WARNING, { requestKind, schema: scope.schema, signatureRows: rows.length, threshold: ERROR_SIGNATURE_WARNING_THRESHOLD });
  }
  if (hasIncompleteSignature(rows)) {
    ailogger.warn(SIGNATURE_FALLBACK_WARNING, { requestKind, schema: scope.schema, plotID: scope.plotID, censusIDs: scope.censusIDs });
    return null;
  }
  return resolveWeightedRows(connectionManager, scope.schema, catalog, rows);
}

function weightOnePerGroupedRow(rows: GroupedErrorRow[]): WeightedErrorRow[] {
  return rows.map(row => ({
    errors: row.allErrors,
    contradictionTypes: row.baseRow.contradictionTypes,
    hasContradiction: row.baseRow.hasContradiction,
    isFailedRow: row.baseRow.isFailedRow,
    measurementCount: 1
  }));
}

/** Today's encounter order: censuses in request order, measurements by ID within each census (the oracle's merged map). */
async function groupedRowsInLegacyOrder(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  censusIDs: number[]
): Promise<GroupedErrorRow[]> {
  const groupedRows = Array.from((await fetchGroupedErrorRows(connectionManager, schema, plotID, censusIDs)).values());
  const censusRank = new Map(censusIDs.map((censusID, index) => [censusID, index]));
  return groupedRows.sort(
    (a, b) =>
      (censusRank.get(Number(a.baseRow.censusID)) ?? 0) - (censusRank.get(Number(b.baseRow.censusID)) ?? 0) ||
      Number(a.baseRow.coreMeasurementID) - Number(b.baseRow.coreMeasurementID)
  );
}

async function buildMessageCountsOnNodePath(
  connectionManager: ExplorerConnection,
  request: { schema: string; plotID: number },
  censusIDs: number[]
): Promise<ErrorMessageCounts> {
  return computeErrorMessageCounts(weightOnePerGroupedRow(await groupedRowsInLegacyOrder(connectionManager, request.schema, request.plotID, censusIDs)));
}

/**
 * The message list and measurement total the View Errors query reports under the default filters, read from the
 * signature histogram without the duplicate-tag and same-batch work: contradictions never change which rows are in
 * the error set or what their messages are. When a signature is cut or two messages tie under localeCompare it falls back to
 * the scope raw-rows statement, whose SQL also evaluates the duplicate-tag and same-batch groups; that is the price of the fallback.
 */
export async function buildErrorMessageCounts(
  connectionManager: ExplorerConnection,
  request: { schema: string; plotID: number; censusIDs: number[] }
): Promise<ErrorMessageCounts> {
  const censusIDs = uniquePositiveCensusIDs(request.censusIDs);
  if (censusIDs.length === 0) return computeErrorMessageCounts([]);
  const weighted = await readWeightedHistogram(connectionManager, { schema: request.schema, plotID: request.plotID, censusIDs }, false, 'message-counts');
  if (!weighted) return buildMessageCountsOnNodePath(connectionManager, request, censusIDs);
  const counts = computeErrorMessageCounts(weighted);
  if (!hasLocaleCompareTie(counts.messages)) return counts;
  ailogger.warn(LOCALE_TIE_FALLBACK_WARNING, { requestKind: 'message-counts', schema: request.schema });
  return buildMessageCountsOnNodePath(connectionManager, request, censusIDs);
}

async function fetchActiveMeasurements(connectionManager: ExplorerConnection, schema: string, plotID: number, censusIDs: number[]): Promise<number> {
  if (censusIDs.length === 0) return 0;
  const activeCountQuery = buildActiveMeasurementCountQuery(schema, plotID, censusIDs);
  return readActiveMeasurementCount(await connectionManager.executeQuery(activeCountQuery.sql, activeCountQuery.params));
}

/**
 * The error types count the rows that pass the search over their filter-matching errors; the census totals describe the whole
 * error set, so they come from the rows before any search.
 */
async function buildFacetsOnNodePath(
  connectionManager: ExplorerConnection,
  request: FacetsRequest,
  censusIDs: number[],
  knownActiveMeasurements?: number
): Promise<ErrorExplorerFacetsResponse> {
  const [groupedRows, activeMeasurements] = await Promise.all([
    groupedRowsInLegacyOrder(connectionManager, request.schema, request.plotID, censusIDs),
    knownActiveMeasurements ?? fetchActiveMeasurements(connectionManager, request.schema, request.plotID, censusIDs)
  ]);
  const searchedRows = groupedRows.filter(row => matchesQuickSearch(row.baseRow, materializeMatchingErrors(row, request.filters), request.filters.quickSearch));
  return {
    errorTypes: computeErrorTypeFacets(weightOnePerGroupedRow(searchedRows), request.filters),
    censusTotals: computeCensusTotals(weightOnePerGroupedRow(groupedRows), activeMeasurements)
  };
}

export async function buildErrorExplorerFacets(connectionManager: ExplorerConnection, request: FacetsRequest): Promise<ErrorExplorerFacetsResponse> {
  const censusIDs = requestCensusIDs(request);
  if (request.filters.quickSearch.trim()) return buildFacetsOnNodePath(connectionManager, request, censusIDs);
  const [weighted, activeMeasurements] = await Promise.all([
    censusIDs.length === 0 ? [] : readWeightedHistogram(connectionManager, { schema: request.schema, plotID: request.plotID, censusIDs }, true, 'facets'),
    fetchActiveMeasurements(connectionManager, request.schema, request.plotID, censusIDs)
  ]);
  if (!weighted) return buildFacetsOnNodePath(connectionManager, request, censusIDs, activeMeasurements);
  const facets: ErrorExplorerFacetsResponse = {
    errorTypes: computeErrorTypeFacets(weighted, request.filters),
    censusTotals: computeCensusTotals(weighted, activeMeasurements)
  };
  if (!hasErrorTypeOrderTie(facets.errorTypes)) return facets;
  ailogger.warn(LOCALE_TIE_FALLBACK_WARNING, { requestKind: 'facets', schema: request.schema });
  return buildFacetsOnNodePath(connectionManager, request, censusIDs, activeMeasurements);
}

function toRelatedRowOutsideErrorSet(row: RelatedRowOutsideErrorSetRow): RelatedContradictionRow {
  return {
    coreMeasurementID: Number(row.RelatedCoreMeasurementID),
    treeTag: row.TreeTag ?? undefined,
    stemTag: row.StemTag ?? undefined,
    speciesCode: row.SpeciesCode ?? undefined,
    quadratName: row.QuadratName ?? undefined,
    measurementDate: normalizeDate(row.MeasurementDate),
    measuredDBH: toFiniteNumberOrNull(row.MeasuredDBH),
    measuredHOM: toFiniteNumberOrNull(row.MeasuredHOM),
    stemLocalX: toFiniteNumberOrNull(row.StemLocalX),
    stemLocalY: toFiniteNumberOrNull(row.StemLocalY),
    description: row.MeasurementDescription ?? null,
    uploadFileID: row.UploadFileID ?? null,
    uploadBatchID: row.UploadBatchID ?? null,
    errorCount: 0,
    errorMessages: [],
    inErrorSet: false
  };
}

function toRelatedRowInErrorSet(grouped: GroupedErrorRow): RelatedContradictionRow {
  return {
    coreMeasurementID: Number(grouped.baseRow.coreMeasurementID),
    treeTag: grouped.baseRow.treeTag,
    stemTag: grouped.baseRow.stemTag,
    speciesCode: grouped.baseRow.speciesCode,
    quadratName: grouped.baseRow.quadratName,
    measurementDate: typeof grouped.baseRow.measurementDate === 'string' ? grouped.baseRow.measurementDate : normalizeDate(grouped.baseRow.measurementDate),
    measuredDBH: grouped.baseRow.measuredDBH ?? null,
    measuredHOM: grouped.baseRow.measuredHOM ?? null,
    stemLocalX: grouped.baseRow.stemLocalX ?? null,
    stemLocalY: grouped.baseRow.stemLocalY ?? null,
    description: grouped.baseRow.description ?? null,
    uploadFileID: grouped.baseRow.uploadFileID ?? null,
    uploadBatchID: grouped.baseRow.uploadBatchID ?? null,
    primaryErrorMessage: grouped.baseRow.primaryErrorMessage,
    errorCount: grouped.allErrors.length,
    errorMessages: dedupeStrings(grouped.allErrors.map(error => error.message)),
    inErrorSet: true
  };
}

function emptyDetailsResponse(): ErrorExplorerDetailsResponse {
  return { row: null, allErrors: [], relatedRows: [] };
}

async function fetchRelatedRowsInErrorSet(
  connectionManager: ExplorerConnection,
  scope: ErrorSetScope,
  relatedMeasurementIDs: number[]
): Promise<Map<number, GroupedErrorRow>> {
  const relatedRawRows: RawErrorOccurrenceRow[] = [];
  for (const idChunk of chunkMeasurementIDs(relatedMeasurementIDs)) {
    appendRows(relatedRawRows, await runStatement<RawErrorOccurrenceRow>(connectionManager, buildIDRawRowsStatement(scope, idChunk)));
  }
  return groupErrorRows(relatedRawRows, new Map());
}

async function fetchRelatedRowsOutsideErrorSet(
  connectionManager: ExplorerConnection,
  scope: ErrorSetScope,
  outsideMeasurementIDs: number[]
): Promise<Map<number, RelatedContradictionRow>> {
  const outsideRows: RelatedRowOutsideErrorSetRow[] = [];
  for (const idChunk of chunkMeasurementIDs(outsideMeasurementIDs)) {
    appendRows(outsideRows, await runStatement<RelatedRowOutsideErrorSetRow>(connectionManager, buildRelatedRowsOutsideErrorSetStatement(scope, idChunk)));
  }
  return new Map(outsideRows.map(row => [Number(row.RelatedCoreMeasurementID), toRelatedRowOutsideErrorSet(row)]));
}

export async function buildErrorExplorerDetails(
  connectionManager: ExplorerConnection,
  request: Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID'>,
  measurementID: number,
  activeContradictionType?: ContradictionType
): Promise<ErrorExplorerDetailsResponse> {
  if (!Number.isSafeInteger(measurementID) || measurementID <= 0 || !(request.censusID > 0)) return emptyDetailsResponse();
  const scope: ErrorSetScope = { schema: request.schema, plotID: request.plotID, censusIDs: [request.censusID] };
  const [selectedRawRows, selectedContradictions] = await Promise.all([
    runStatement<RawErrorOccurrenceRow>(connectionManager, buildIDRawRowsStatement(scope, [measurementID])),
    fetchMemberGroupContradictions(connectionManager, scope, [measurementID])
  ]);
  const selected = groupErrorRows(selectedRawRows, selectedContradictions).get(measurementID);
  if (!selected) return emptyDetailsResponse();

  const relatedMeasurementIDs =
    activeContradictionType && selected.baseRow.contradictionTypes.includes(activeContradictionType)
      ? dedupeNumbers(
          selected.contradictions
            .filter(contradiction => contradiction.type === activeContradictionType)
            .flatMap(contradiction => contradiction.relatedMeasurementIDs)
        )
      : dedupeNumbers(selected.contradictions.flatMap(contradiction => contradiction.relatedMeasurementIDs));

  const relatedInErrorSet = await fetchRelatedRowsInErrorSet(connectionManager, scope, relatedMeasurementIDs);
  const outsideMeasurementIDs = relatedMeasurementIDs.filter(id => !relatedInErrorSet.has(id));
  const relatedOutsideErrorSet = await fetchRelatedRowsOutsideErrorSet(connectionManager, scope, outsideMeasurementIDs);
  const relatedRows = relatedMeasurementIDs.flatMap((id): RelatedContradictionRow[] => {
    const grouped = relatedInErrorSet.get(id);
    if (grouped) return [toRelatedRowInErrorSet(grouped)];
    const outside = relatedOutsideErrorSet.get(id);
    return outside ? [outside] : [];
  });

  return {
    row: toDisplayRow(selected, DETAILS_DISPLAY_FILTERS, activeContradictionType),
    allErrors: selected.allErrors,
    relatedRows
  };
}

export { groupErrorRows as groupErrorRowsForTest, toDisplayRow as toDisplayRowForTest };
