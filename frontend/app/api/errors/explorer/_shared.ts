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
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  ErrorTypeIdentity,
  RelatedContradictionRow,
  toFiniteNumberOrNull
} from '@/config/errorsexplorer';
import { type ColumnValueRow, compareRowsBySortItem, matchesColumnFilter } from '@/lib/errorsexplorer/columnquery';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildActiveMeasurementCountQuery, readActiveMeasurementCount } from '@/lib/activemeasurementcount';
import {
  buildCatalogStatement,
  buildHistogramWithFlagsStatement,
  buildHistogramWithoutFlagsStatement,
  buildScopeRawRowsStatement,
  chunkCensusIDs,
  SQL_TRUE,
  type BuiltStatement,
  type ContradictionFlagColumns,
  type ErrorSetScope,
  type ErrorSignatureRow,
  type ErrorTypeCatalogRow
} from './errorsetsql';
import {
  buildErrorTypeCatalog,
  computeCensusTotals,
  computeErrorMessageCounts,
  computeErrorTypeFacets,
  contradictionFiltersAllow,
  errorMatchesFilters,
  findMissingErrorTypeKeys,
  getOccurrenceFields,
  hasErrorTypeOrderTie,
  hasIncompleteSignature,
  hasLocaleCompareTie,
  mergeSignatureRows,
  toWeightedErrorRows,
  type ErrorMessageCounts,
  type ErrorTypeCatalog,
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

/**
 * Spec Data → Query, steps 1-7: rebuild, page filters, identity (decided on the page-matching
 * errors, so search and Show behave exactly as the facets do), pair every row with the projection
 * its cells show, column filter, sort, slice. totalRows counts after the column filter.
 */
export async function queryErrorExplorer(connectionManager: ExplorerConnection, request: ErrorExplorerQueryRequest): Promise<ErrorExplorerQueryResponse> {
  const groupedRows = await fetchGroupedErrorRows(
    connectionManager,
    request.schema,
    request.plotID,
    request.censusIDs?.length ? request.censusIDs : request.censusID
  );
  const pageMatchingRows = buildFilteredRows(groupedRows, request.filters);
  const identity = request.errorType;
  const identityRows = identity
    ? pageMatchingRows.filter(row => materializeMatchingErrors(row, request.filters).some(error => matchesErrorTypeIdentity(error, identity)))
    : pageMatchingRows;
  const pairs: QueryRowPair[] = identityRows.map(grouped => ({ grouped, display: toDisplayRow(grouped, request.filters, undefined, identity) }));
  const columnFilter = request.columnFilters?.[0];
  const filteredPairs = columnFilter ? pairs.filter(pair => matchesColumnFilter(toColumnValueRow(pair.display), columnFilter)) : pairs;
  const sortItem = request.sortModel?.[0];
  filteredPairs.sort((a, b) =>
    sortItem ? compareRowsBySortItem(toColumnValueRow(a.display), toColumnValueRow(b.display), sortItem) : sortRows(a.grouped, b.grouped)
  );
  const start = request.page * request.pageSize;

  return {
    rows: filteredPairs.slice(start, start + request.pageSize).map(pair => pair.display),
    totalRows: filteredPairs.length
  };
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

async function loadErrorTypeCatalog(connectionManager: ExplorerConnection, schema: string): Promise<ErrorTypeCatalog> {
  return buildErrorTypeCatalog(await runStatement<ErrorTypeCatalogRow>(connectionManager, buildCatalogStatement(schema)));
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

function buildRelatedRowsOutsideErrorSetQuery(schema: string, relatedCount: number): string {
  return safeFormatQuery(
    schema,
    `SELECT ms.CoreMeasurementID AS RelatedCoreMeasurementID,
            ms.TreeTag,
            ms.StemTag,
            ms.SpeciesCode,
            ms.QuadratName,
            ms.MeasurementDate,
            ms.MeasuredDBH,
            ms.MeasuredHOM,
            ms.StemLocalX,
            ms.StemLocalY,
            ms.Description AS MeasurementDescription,
            cm.UploadFileID,
            cm.UploadBatchID
     FROM ??.coremeasurements cm
     JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
     WHERE ms.PlotID = ?
       AND ms.CensusID = ?
       AND COALESCE(cm.IsActive, TRUE) = TRUE
       AND cm.CoreMeasurementID IN (${buildInPlaceholders(relatedCount)})`
  );
}

interface RelatedRowOutsideErrorSet {
  RelatedCoreMeasurementID: number;
  TreeTag?: string | null;
  StemTag?: string | null;
  SpeciesCode?: string | null;
  QuadratName?: string | null;
  MeasurementDate?: string | Date | null;
  MeasuredDBH?: number | string | null;
  MeasuredHOM?: number | string | null;
  StemLocalX?: number | string | null;
  StemLocalY?: number | string | null;
  MeasurementDescription?: string | null;
  UploadFileID?: string | null;
  UploadBatchID?: string | null;
}

function toRelatedRowOutsideErrorSet(row: RelatedRowOutsideErrorSet): RelatedContradictionRow {
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

export async function buildErrorExplorerDetails(
  connectionManager: ExplorerConnection,
  request: Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID'>,
  measurementID: number,
  activeContradictionType?: ContradictionType
): Promise<ErrorExplorerDetailsResponse> {
  const groupedRows = await fetchGroupedErrorRows(connectionManager, request.schema, request.plotID, request.censusID);
  const selected = groupedRows.get(measurementID);

  if (!selected) {
    return {
      row: null,
      allErrors: [],
      relatedRows: []
    };
  }

  const relatedMeasurementIDs =
    activeContradictionType && selected.baseRow.contradictionTypes.includes(activeContradictionType)
      ? dedupeNumbers(
          selected.contradictions
            .filter(contradiction => contradiction.type === activeContradictionType)
            .flatMap(contradiction => contradiction.relatedMeasurementIDs)
        )
      : dedupeNumbers(selected.contradictions.flatMap(contradiction => contradiction.relatedMeasurementIDs));

  const outsideIDs = relatedMeasurementIDs.filter(id => !groupedRows.has(id));
  const outsideRows =
    outsideIDs.length > 0
      ? ((await connectionManager.executeQuery(buildRelatedRowsOutsideErrorSetQuery(request.schema, outsideIDs.length), [
          request.plotID,
          request.censusID,
          ...outsideIDs
        ])) as RelatedRowOutsideErrorSet[])
      : [];
  const outsideByID = new Map(outsideRows.map(row => [Number(row.RelatedCoreMeasurementID), toRelatedRowOutsideErrorSet(row)]));

  const relatedRows = relatedMeasurementIDs.flatMap((id): RelatedContradictionRow[] => {
    const grouped = groupedRows.get(id);
    if (!grouped) {
      const outside = outsideByID.get(id);
      return outside ? [outside] : [];
    }
    return [
      {
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
      }
    ];
  });

  return {
    row: toDisplayRow(
      selected,
      {
        source: 'all',
        exactMessages: [],
        affectedFields: [],
        contradictionOnly: false,
        contradictionTypes: [],
        quickSearch: ''
      },
      activeContradictionType
    ),
    allErrors: selected.allErrors,
    relatedRows
  };
}

export { groupErrorRows as groupErrorRowsForTest, toDisplayRow as toDisplayRowForTest };
