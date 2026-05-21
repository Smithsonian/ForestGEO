import ConnectionManager from '@/config/connectionmanager';
import {
  ContradictionType,
  dedupeNumbers,
  dedupeStrings,
  ErrorDetailRecord,
  ErrorExplorerDetailsResponse,
  ErrorExplorerFacetsResponse,
  ErrorExplorerFilters,
  ErrorExplorerQueryRequest,
  ErrorExplorerQueryResponse,
  ErrorExplorerRow,
  INGESTION_ERROR_FIELD_MAP
} from '@/config/errorsexplorer';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

type ExplorerConnection = ReturnType<typeof ConnectionManager.getInstance>;

interface RawErrorOccurrenceRow {
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
}

interface ContradictionInfo {
  type: ContradictionType;
  groupKey: string;
  relatedMeasurementIDs: number[];
}

interface GroupedErrorRow {
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
            me.ErrorSource,
            me.ErrorCode,
            COALESCE(NULLIF(ve.Description, ''), me.ErrorMessage) AS DisplayMessage,
            COALESCE(NULLIF(ve.Criteria, ''), '') AS ValidationCriteria,
            COALESCE(NULLIF(ve.ProcedureName, ''), '') AS ProcedureName
     FROM ??.measurement_error_log mel
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
     LEFT JOIN ??.sitespecificvalidations ve
       ON me.ErrorSource = 'validation'
      AND me.ErrorCode = CAST(ve.ValidationID AS CHAR)
     WHERE ms.PlotID = ?
       AND ms.CensusID = ?
       AND COALESCE(mel.IsResolved, FALSE) = FALSE
       AND COALESCE(cm.IsActive, TRUE) = TRUE
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
      procedureName: rawRow.ProcedureName ?? null
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

function toDisplayRow(groupedRow: GroupedErrorRow, filters: ErrorExplorerFilters, preferredContradictionType?: ContradictionType): ErrorExplorerRow {
  const matchingErrors = materializeMatchingErrors(groupedRow, filters);
  const visibleErrors = matchingErrors.length > 0 ? matchingErrors : groupedRow.allErrors;
  const visibleContradictions = getVisibleContradictions(groupedRow.contradictions, filters, preferredContradictionType);

  return {
    ...groupedRow.baseRow,
    primaryErrorMessage: visibleErrors[0]?.message ?? groupedRow.baseRow.primaryErrorMessage,
    errorMessages: dedupeStrings(visibleErrors.map(error => error.message)),
    errorSources: dedupeStrings(visibleErrors.map(error => error.source)) as Array<'validation' | 'ingestion'>,
    errorFields: dedupeStrings(visibleErrors.flatMap(error => error.fields)),
    errorCodes: dedupeStrings(visibleErrors.map(error => error.code)),
    errorCount: visibleErrors.length,
    contradictionTypes: visibleContradictions.contradictionTypes,
    contradictionType: visibleContradictions.primaryType,
    contradictionGroupKey: visibleContradictions.primaryType
      ? (groupedRow.contradictions.find(contradiction => contradiction.type === visibleContradictions.primaryType)?.groupKey ?? null)
      : null,
    relatedMeasurementIDs: visibleContradictions.relatedMeasurementIDs
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

function buildSummary(rows: GroupedErrorRow[], filters: ErrorExplorerFilters): ErrorExplorerQueryResponse['summary'] {
  const filteredRows = rows.filter(row => rowMatchesFilters(row, materializeMatchingErrors(row, filters), filters));

  return {
    total: filteredRows.length,
    validation: filteredRows.filter(row => materializeMatchingErrors(row, filters).some(error => error.source === 'validation')).length,
    ingestion: filteredRows.filter(row => materializeMatchingErrors(row, filters).some(error => error.source === 'ingestion')).length,
    contradictions: filteredRows.filter(row => row.baseRow.hasContradiction).length,
    duplicateTagStem: filteredRows.filter(row => row.baseRow.contradictionTypes.includes('duplicate_tag_stem')).length,
    sameBatchConflict: filteredRows.filter(row => row.baseRow.contradictionTypes.includes('same_batch_conflict')).length
  };
}

export async function fetchGroupedErrorRows(connectionManager: ExplorerConnection, schema: string, plotID: number, censusID: number) {
  const [rawRows, contradictionMap] = await Promise.all([
    connectionManager.executeQuery(buildRawErrorsQuery(schema), [plotID, censusID]) as Promise<RawErrorOccurrenceRow[]>,
    buildContradictionMap(connectionManager, schema, plotID, censusID)
  ]);

  return groupErrorRows(rawRows, contradictionMap);
}

export async function queryErrorExplorer(connectionManager: ExplorerConnection, request: ErrorExplorerQueryRequest): Promise<ErrorExplorerQueryResponse> {
  const groupedRows = await fetchGroupedErrorRows(connectionManager, request.schema, request.plotID, request.censusID);
  const filteredRows = buildFilteredRows(groupedRows, request.filters).sort(sortRows);
  const start = request.page * request.pageSize;
  const paginatedRows = filteredRows.slice(start, start + request.pageSize).map(row => toDisplayRow(row, request.filters));

  return {
    rows: paginatedRows,
    totalRows: filteredRows.length,
    summary: buildSummary(filteredRows, request.filters)
  };
}

export async function buildErrorExplorerFacets(
  connectionManager: ExplorerConnection,
  request: Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID' | 'filters'>
): Promise<ErrorExplorerFacetsResponse> {
  const groupedRows = await fetchGroupedErrorRows(connectionManager, request.schema, request.plotID, request.censusID);
  const scopedRows = Array.from(groupedRows.values()).filter(row => {
    if (request.filters.source !== 'all' && !row.allErrors.some(error => error.source === request.filters.source)) {
      return false;
    }
    if (request.filters.contradictionOnly && !row.baseRow.hasContradiction) {
      return false;
    }
    if (request.filters.contradictionTypes.length > 0 && !row.baseRow.contradictionTypes.some(type => request.filters.contradictionTypes.includes(type))) {
      return false;
    }
    return matchesQuickSearch(row.baseRow, row.allErrors, request.filters.quickSearch);
  });

  const messageCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();

  scopedRows.forEach(row => {
    const messageSet = new Set<string>();
    const fieldSet = new Set<string>();
    row.allErrors.forEach(error => {
      messageSet.add(error.message);
      error.fields.forEach(field => fieldSet.add(field));
    });
    messageSet.forEach(message => messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1));
    fieldSet.forEach(field => fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1));
  });

  const sortFacetOptions = (entries: Iterable<[string, number]>) =>
    Array.from(entries)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    messages: sortFacetOptions(messageCounts.entries()),
    fields: sortFacetOptions(fieldCounts.entries()),
    sourceCounts: {
      validation: scopedRows.filter(row => row.allErrors.some(error => error.source === 'validation')).length,
      ingestion: scopedRows.filter(row => row.allErrors.some(error => error.source === 'ingestion')).length
    },
    contradictionCounts: {
      duplicateTagStem: scopedRows.filter(row => row.baseRow.contradictionTypes.includes('duplicate_tag_stem')).length,
      sameBatchConflict: scopedRows.filter(row => row.baseRow.contradictionTypes.includes('same_batch_conflict')).length
    }
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

  const relatedRows = relatedMeasurementIDs
    .map(id => groupedRows.get(id))
    .filter((row): row is GroupedErrorRow => Boolean(row))
    .map(row => ({
      coreMeasurementID: Number(row.baseRow.coreMeasurementID),
      treeTag: row.baseRow.treeTag,
      stemTag: row.baseRow.stemTag,
      speciesCode: row.baseRow.speciesCode,
      quadratName: row.baseRow.quadratName,
      measurementDate: typeof row.baseRow.measurementDate === 'string' ? row.baseRow.measurementDate : normalizeDate(row.baseRow.measurementDate as any),
      measuredDBH: row.baseRow.measuredDBH ?? null,
      measuredHOM: row.baseRow.measuredHOM ?? null,
      stemLocalX: row.baseRow.stemLocalX ?? null,
      stemLocalY: row.baseRow.stemLocalY ?? null,
      description: row.baseRow.description ?? null,
      uploadFileID: row.baseRow.uploadFileID ?? null,
      uploadBatchID: row.baseRow.uploadBatchID ?? null,
      primaryErrorMessage: row.baseRow.primaryErrorMessage,
      errorCount: row.allErrors.length,
      errorMessages: dedupeStrings(row.allErrors.map(error => error.message))
    }));

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
