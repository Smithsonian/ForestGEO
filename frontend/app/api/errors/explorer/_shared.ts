import ConnectionManager from '@/lib/db/connectionmanager';
import {
  computeDbhChangePercent,
  ContradictionType,
  dedupeNumbers,
  DBH_CHANGE_VALIDATION_CODES,
  dedupeStrings,
  ERROR_SOURCE,
  ErrorComparisonContext,
  ErrorDetailRecord,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  ErrorFacetOption,
  ErrorCensusTotals,
  ErrorTypeFacet,
  ErrorTypeIdentity,
  RelatedContradictionRow,
  buildErrorTypeKey,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  INGESTION_ERROR_FIELD_MAP,
  toFiniteNumberOrNull
} from '@/config/errorsexplorer';
import { type ColumnValueRow, compareRowsBySortItem, matchesColumnFilter } from '@/lib/errorsexplorer/columnquery';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildActiveMeasurementCountQuery, readActiveMeasurementCount } from '@/lib/activemeasurementcount';

type ExplorerConnection = ReturnType<typeof ConnectionManager.getInstance>;

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
  groupKey: string;
  relatedMeasurementIDs: number[];
}

export interface GroupedErrorRow {
  baseRow: ErrorExplorerRow;
  allErrors: ErrorDetailRecord[];
  contradictions: ContradictionInfo[];
}

const VALIDATION_ERROR_FIELD_FALLBACK_MAP: Record<string, string[]> = {
  '5': ['treeTag', 'stemTag'],
  '21': ['treeTag', 'speciesCode']
};

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

function splitValidationCriteria(criteria?: string | null): string[] {
  if (!criteria) return [];
  return dedupeStrings(criteria.split(';').map(part => part.trim()));
}

function getOccurrenceFields(source: 'validation' | 'ingestion', errorCode: string, validationCriteria?: string | null): string[] {
  if (source === 'validation') {
    const criteriaFields = splitValidationCriteria(validationCriteria);
    return criteriaFields.length > 0 ? criteriaFields : (VALIDATION_ERROR_FIELD_FALLBACK_MAP[errorCode] ?? []);
  }
  return INGESTION_ERROR_FIELD_MAP[errorCode] ?? [];
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

function parseMeasurementIDs(value: string | null | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => Number(item))
    .filter(id => Number.isFinite(id));
}

function addContradiction(contradictionMap: Map<number, ContradictionInfo[]>, measurementID: number, contradiction: ContradictionInfo) {
  const existing = contradictionMap.get(measurementID) ?? [];
  if (existing.some(item => item.groupKey === contradiction.groupKey)) {
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

function buildRawErrorsQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT ms.CoreMeasurementID,
            ms.PlotID,
            ms.CensusID,
            ms.QuadratID,
            ms.TreeID,
            ms.StemGUID,
            cm.StemGUID AS CoreStemGUID,
            ms.SpeciesID,
            ms.TreeTag,
            ms.StemTag,
            ms.SpeciesName,
            ms.SubspeciesName,
            ms.SpeciesCode,
            ms.QuadratName,
            ms.StemLocalX,
            ms.StemLocalY,
            ms.StemPlotX,
            ms.StemPlotY,
            ms.MeasurementDate,
            ms.MeasuredDBH,
            ms.MeasuredHOM,
            ms.IsValidated,
            ms.Description AS MeasurementDescription,
            ms.Attributes,
            cm.RawCodes,
            ms.UserDefinedFields,
            cm.UploadFileID,
            cm.UploadBatchID,
            mel.PriorCensusID,
            mel.PriorDBH,
            mel.PriorHOM,
            COALESCE(me.ErrorSource, '${ERROR_SOURCE.ingestion}') AS ErrorSource,
            COALESCE(me.ErrorCode, '${FALLBACK_ERROR_CODE}') AS ErrorCode,
            COALESCE(
              NULLIF(ve.Description, ''),
              me.ErrorMessage,
              '${FALLBACK_ERROR_MESSAGE}'
            ) AS DisplayMessage,
            COALESCE(NULLIF(ve.Criteria, ''), '') AS ValidationCriteria,
            COALESCE(NULLIF(ve.ProcedureName, ''), '') AS ProcedureName
     FROM ??.coremeasurements cm
     JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
     LEFT JOIN ??.measurement_error_log mel
       ON mel.MeasurementID = cm.CoreMeasurementID
      AND COALESCE(mel.IsResolved, FALSE) = FALSE
     LEFT JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     LEFT JOIN ??.sitespecificvalidations ve
       ON me.ErrorSource = 'validation'
      AND me.ErrorCode = CAST(ve.ValidationID AS CHAR)
     WHERE ms.PlotID = ?
       AND ms.CensusID = ?
       AND COALESCE(cm.IsActive, TRUE) = TRUE
       AND (mel.MeasurementID IS NOT NULL OR ms.IsValidated = FALSE)
     ORDER BY ms.CoreMeasurementID ASC, me.ErrorSource ASC, me.ErrorCode ASC`
  );
}

function buildDuplicateGroupsQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT ms.TreeTag,
            ms.StemTag,
            GROUP_CONCAT(DISTINCT ms.CoreMeasurementID ORDER BY ms.CoreMeasurementID SEPARATOR ',') AS MeasurementIDs
     FROM ??.measurementssummary ms
     WHERE ms.PlotID = ?
       AND ms.CensusID = ?
       AND COALESCE(ms.TreeTag, '') <> ''
       AND COALESCE(ms.StemTag, '') <> ''
     GROUP BY ms.TreeTag, ms.StemTag
     HAVING COUNT(DISTINCT ms.CoreMeasurementID) > 1`
  );
}

function buildSameBatchConflictGroupsQuery(schema: string): string {
  return safeFormatQuery(
    schema,
    `SELECT cm.UploadFileID,
            cm.UploadBatchID,
            ms.TreeTag,
            GROUP_CONCAT(DISTINCT cm.CoreMeasurementID ORDER BY cm.CoreMeasurementID SEPARATOR ',') AS MeasurementIDs
     FROM ??.coremeasurements cm
     JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
     WHERE ms.PlotID = ?
       AND ms.CensusID = ?
       AND COALESCE(ms.TreeTag, '') <> ''
       AND cm.UploadFileID IS NOT NULL
       AND cm.UploadBatchID IS NOT NULL
       AND COALESCE(cm.IsActive, TRUE) = TRUE
     GROUP BY cm.UploadFileID, cm.UploadBatchID, ms.TreeTag
     HAVING COUNT(DISTINCT COALESCE(ms.SpeciesCode, '')) > 1
        AND COUNT(DISTINCT cm.CoreMeasurementID) > 1`
  );
}

async function buildContradictionMap(connectionManager: ExplorerConnection, schema: string, plotID: number, censusID: number) {
  const contradictionMap = new Map<number, ContradictionInfo[]>();

  const duplicateGroups = (await connectionManager.executeQuery(buildDuplicateGroupsQuery(schema), [plotID, censusID])) as Array<{
    TreeTag?: string | null;
    StemTag?: string | null;
    MeasurementIDs?: string | null;
  }>;

  duplicateGroups.forEach(group => {
    const measurementIDs = parseMeasurementIDs(group.MeasurementIDs);
    measurementIDs.forEach(measurementID => {
      addContradiction(contradictionMap, measurementID, {
        type: 'duplicate_tag_stem',
        groupKey: `duplicate:${censusID}:${group.TreeTag ?? ''}:${group.StemTag ?? ''}`,
        relatedMeasurementIDs: measurementIDs.filter(id => id !== measurementID)
      });
    });
  });

  const sameBatchGroups = (await connectionManager.executeQuery(buildSameBatchConflictGroupsQuery(schema), [plotID, censusID])) as Array<{
    UploadFileID?: string | null;
    UploadBatchID?: string | null;
    TreeTag?: string | null;
    MeasurementIDs?: string | null;
  }>;

  sameBatchGroups.forEach(group => {
    const measurementIDs = parseMeasurementIDs(group.MeasurementIDs);
    measurementIDs.forEach(measurementID => {
      addContradiction(contradictionMap, measurementID, {
        type: 'same_batch_conflict',
        groupKey: `same-batch:${censusID}:${group.UploadFileID ?? ''}:${group.UploadBatchID ?? ''}:${group.TreeTag ?? ''}`,
        relatedMeasurementIDs: measurementIDs.filter(id => id !== measurementID)
      });
    });
  });

  return contradictionMap;
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
  return row.allErrors.filter(error => {
    if (filters.source !== 'all' && error.source !== filters.source) {
      return false;
    }
    if (filters.exactMessages.length > 0 && !filters.exactMessages.includes(error.message)) {
      return false;
    }
    if (filters.affectedFields.length > 0 && !error.fields.some(field => filters.affectedFields.includes(field))) {
      return false;
    }
    return true;
  });
}

function rowMatchesFilters(row: GroupedErrorRow, matchingErrors: ErrorDetailRecord[], filters: ErrorExplorerFilters): boolean {
  if (matchingErrors.length === 0) {
    return false;
  }
  if (filters.contradictionOnly && !row.baseRow.hasContradiction) {
    return false;
  }
  if (filters.contradictionTypes.length > 0 && !row.baseRow.contradictionTypes.some(type => filters.contradictionTypes.includes(type))) {
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

interface GroupedErrorRowsOptions {
  /** Contradictions annotate rows that are already in the error set; they never add or remove one. */
  withContradictions: boolean;
}

const GROUPED_ERROR_ROWS_WITH_CONTRADICTIONS: GroupedErrorRowsOptions = { withContradictions: true };

export async function fetchGroupedErrorRows(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  censusIDs: number | number[],
  { withContradictions }: GroupedErrorRowsOptions = GROUPED_ERROR_ROWS_WITH_CONTRADICTIONS
) {
  const uniqueCensusIDs = Array.from(new Set((Array.isArray(censusIDs) ? censusIDs : [censusIDs]).filter(censusID => censusID > 0)));
  const groupedByCensus = await Promise.all(
    uniqueCensusIDs.map(async censusID => {
      const [rawRows, contradictionMap] = await Promise.all([
        connectionManager.executeQuery(buildRawErrorsQuery(schema), [plotID, censusID]) as Promise<RawErrorOccurrenceRow[]>,
        withContradictions ? buildContradictionMap(connectionManager, schema, plotID, censusID) : new Map<number, ContradictionInfo[]>()
      ]);
      return groupErrorRows(rawRows, contradictionMap);
    })
  );

  return groupedByCensus.reduce((combined, groupedRows) => {
    groupedRows.forEach((row, measurementID) => combined.set(measurementID, row));
    return combined;
  }, new Map<number, GroupedErrorRow>());
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

function countMeasurementsPerMessage(rows: GroupedErrorRow[]): Map<string, number> {
  const messageCounts = new Map<string, number>();
  rows.forEach(row => {
    new Set(row.allErrors.map(error => error.message)).forEach(message => messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1));
  });
  return messageCounts;
}

function sortFacetOptions(entries: Iterable<[string, number]>): ErrorFacetOption[] {
  return Array.from(entries)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface ErrorMessageCounts {
  /** Distinct measurements carrying at least one unresolved error or an invalid flag. */
  totalMeasurements: number;
  messages: ErrorFacetOption[];
}

/**
 * The message list and measurement total buildErrorExplorerFacets returns under the
 * default filters, without the duplicate-tag and same-batch queries: contradictions
 * never change which rows are in the error set or what their messages are.
 */
export async function buildErrorMessageCounts(
  connectionManager: ExplorerConnection,
  request: { schema: string; plotID: number; censusIDs: number[] }
): Promise<ErrorMessageCounts> {
  const groupedRows = await fetchGroupedErrorRows(connectionManager, request.schema, request.plotID, request.censusIDs, { withContradictions: false });
  const rows = Array.from(groupedRows.values());
  return { totalMeasurements: rows.length, messages: sortFacetOptions(countMeasurementsPerMessage(rows).entries()) };
}

interface ErrorTypeAccumulator {
  facet: ErrorTypeFacet;
  measurementIDs: Set<number>;
  fields: Set<string>;
}

function compareErrorTypeFacets(a: ErrorTypeFacet, b: ErrorTypeFacet): number {
  return b.count - a.count || a.message.localeCompare(b.message) || a.source.localeCompare(b.source) || a.code.localeCompare(b.code);
}

/** Uses the query's own predicate, so each count equals that identity's query totalRows with no column filter. */
function buildErrorTypeFacets(rows: GroupedErrorRow[], filters: ErrorExplorerFilters): ErrorTypeFacet[] {
  const byIdentity = new Map<string, ErrorTypeAccumulator>();
  rows.forEach(row => {
    const matchingErrors = materializeMatchingErrors(row, filters);
    if (!rowMatchesFilters(row, matchingErrors, filters)) return;
    matchingErrors.forEach(error => {
      const key = buildErrorTypeKey(error);
      const entry = byIdentity.get(key) ?? {
        facet: { source: error.source, code: error.code, message: error.message, fields: [], count: 0, hasContradiction: false },
        measurementIDs: new Set<number>(),
        fields: new Set<string>()
      };
      entry.measurementIDs.add(Number(row.baseRow.coreMeasurementID));
      error.fields.forEach(field => entry.fields.add(field));
      if (row.baseRow.hasContradiction) entry.facet.hasContradiction = true;
      byIdentity.set(key, entry);
    });
  });
  return Array.from(byIdentity.values())
    .map(entry => ({ ...entry.facet, fields: Array.from(entry.fields), count: entry.measurementIDs.size }))
    .sort(compareErrorTypeFacets);
}

function buildCensusTotals(rows: GroupedErrorRow[], activeMeasurements: number): ErrorCensusTotals {
  const hasSource = (row: GroupedErrorRow, source: 'validation' | 'ingestion') => row.allErrors.some(error => error.source === source);
  return {
    affectedMeasurements: rows.length,
    activeMeasurements,
    errorTypeCount: new Set(rows.flatMap(row => row.allErrors.map(buildErrorTypeKey))).size,
    validation: rows.filter(row => hasSource(row, 'validation')).length,
    ingestion: rows.filter(row => hasSource(row, 'ingestion')).length,
    failedMeasurements: rows.filter(row => row.baseRow.isFailedRow).length,
    contradictions: rows.filter(row => row.baseRow.hasContradiction).length,
    duplicateTagStem: rows.filter(row => row.baseRow.contradictionTypes.includes('duplicate_tag_stem')).length,
    sameBatchConflict: rows.filter(row => row.baseRow.contradictionTypes.includes('same_batch_conflict')).length
  };
}

export async function buildErrorExplorerFacets(
  connectionManager: ExplorerConnection,
  request: Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID' | 'censusIDs' | 'filters'>
): Promise<ErrorExplorerFacetsResponse> {
  const censusIDs = request.censusIDs?.length ? request.censusIDs : [request.censusID];
  const activeCountQuery = buildActiveMeasurementCountQuery(request.schema, request.plotID, censusIDs);
  const [groupedRows, activeRows] = await Promise.all([
    fetchGroupedErrorRows(connectionManager, request.schema, request.plotID, censusIDs),
    connectionManager.executeQuery(activeCountQuery.sql, activeCountQuery.params)
  ]);
  const allRows = Array.from(groupedRows.values());

  return {
    errorTypes: buildErrorTypeFacets(allRows, request.filters),
    censusTotals: buildCensusTotals(allRows, readActiveMeasurementCount(activeRows))
  };
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
