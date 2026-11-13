import { ERROR_SOURCE, FALLBACK_ERROR_CODE, FALLBACK_ERROR_MESSAGE } from '@/config/errorsexplorer';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';

export const CENSUS_LIST_SIZE = 8;
export const ID_LIST_SIZE = 128;
export const NO_LOG_ERROR_TYPE_KEY = 0;
export const NO_LOG_ERROR_SOURCE = ERROR_SOURCE.ingestion;
export const NO_LOG_ERROR_CODE = FALLBACK_ERROR_CODE;
export const NO_LOG_ERROR_MESSAGE = FALLBACK_ERROR_MESSAGE;
export const LIST_SEPARATOR = ',';

export const SQL_TRUE = 1;
export const SQL_FALSE = 0;

export const ERROR_EXPLORER_STATEMENT_LABELS = {
  catalog: '/* errors-explorer:catalog */',
  page: '/* errors-explorer:page */',
  totals: '/* errors-explorer:totals */',
  histogramWithFlags: '/* errors-explorer:histogram-with-flags */',
  histogramWithoutFlags: '/* errors-explorer:histogram-without-flags */',
  scopeRawRows: '/* errors-explorer:scope-raw-rows */',
  idRawRows: '/* errors-explorer:id-raw-rows */',
  duplicateMemberGroups: '/* errors-explorer:duplicate-member-groups */',
  sameBatchMemberGroups: '/* errors-explorer:same-batch-member-groups */'
} as const;

const STATEMENT_LABEL_PATTERN = /^\/\* errors-explorer:[a-z-]+ \*\//;

export function readStatementLabel(sql: string): string | null {
  return STATEMENT_LABEL_PATTERN.exec(sql)?.[0] ?? null;
}

export interface BuiltStatement {
  sql: string;
  params: unknown[];
}

export interface ErrorSetScope {
  readonly schema: string;
  readonly plotID: number;
  /** 1 to CENSUS_LIST_SIZE physical census IDs. */
  readonly censusIDs: readonly number[];
}

export interface ErrorTypeKeyFilter {
  readonly allKeysMatch: boolean;
  readonly matchingKeys: readonly number[];
  readonly matchingValidationKeys: readonly number[];
  readonly matchingIngestionKeys: readonly number[];
}

export interface FlagCombinations {
  readonly none: boolean;
  readonly sameBatchOnly: boolean;
  readonly duplicateOnly: boolean;
  readonly both: boolean;
}

export interface PageWindow {
  readonly limit: number;
  readonly offset: number;
}

type SqlCount = number | string;
type SqlFlag = number | string;

export interface ErrorTypeCatalogRow {
  ErrorID: number;
  ErrorSource: 'validation' | 'ingestion';
  ErrorCode: string;
  DisplayMessage: string;
  ValidationCriteria: string;
  ProcedureName: string;
}

export interface SelectedRowSortKeys {
  CoreMeasurementID: number;
  HasContradiction: SqlFlag;
  OccurrenceCount: SqlCount;
  MeasurementDate: Date | string | null;
}

export interface ErrorSetTotalsRow {
  TotalRows: SqlCount;
}

export interface SelectedPageRow extends SelectedRowSortKeys, ErrorSetTotalsRow {
  CensusID: number;
}

export interface ErrorSignatureRow {
  ErrorTypeKeys: string;
  SignatureComplete: SqlFlag;
  HasDuplicate: SqlFlag;
  HasSameBatch: SqlFlag;
  IsFailedRow: SqlFlag;
  MeasurementCount: SqlCount;
}

interface MemberListColumns {
  RequestedMeasurementID: number;
  CensusID: number;
  TreeTag: string | null;
  MeasurementIDs: string | null;
  MemberCount: SqlCount;
  MemberListComplete: SqlFlag;
}

export interface DuplicateMemberGroupRow extends MemberListColumns {
  StemTag: string | null;
}

export interface SameBatchMemberGroupRow extends MemberListColumns {
  UploadFileID: string | null;
  UploadBatchID: string | null;
}

export interface ContradictionFlagColumns {
  HasDuplicate: SqlFlag;
  HasSameBatch: SqlFlag;
}

export class ErrorSetListSizeError extends Error {
  constructor(
    readonly listName: string,
    readonly size: number,
    readonly slotSize: number
  ) {
    super(`A ${listName} list of ${size} values does not fit a statement slot of 1 to ${slotSize}; chunk it first`);
    this.name = 'ErrorSetListSizeError';
  }
}

export class InvalidPageWindowError extends Error {
  constructor(readonly window: PageWindow) {
    super(`LIMIT ${window.limit} OFFSET ${window.offset} is not a pair of non-negative safe integers`);
    this.name = 'InvalidPageWindowError';
  }
}

const CENSUS_SLOT = buildInPlaceholders(CENSUS_LIST_SIZE);
const ID_SLOT = buildInPlaceholders(ID_LIST_SIZE);
const EMPTY_FRAGMENT: BuiltStatement = { sql: '', params: [] };

function joinFragments(parts: ReadonlyArray<BuiltStatement | string>): BuiltStatement {
  let sql = '';
  const params: unknown[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      sql += part;
    } else {
      sql += part.sql;
      params.push(...part.params);
    }
  }
  return { sql, params };
}

function bound(value: unknown): BuiltStatement {
  return { sql: '?', params: [value] };
}

function padToSlot(values: readonly number[], slotSize: number, listName: string): Array<number | null> {
  if (values.length === 0 || values.length > slotSize) throw new ErrorSetListSizeError(listName, values.length, slotSize);
  return [...values, ...Array<null>(slotSize - values.length).fill(null)];
}

function censusList(scope: ErrorSetScope): BuiltStatement {
  return { sql: CENSUS_SLOT, params: padToSlot(scope.censusIDs, CENSUS_LIST_SIZE, 'census') };
}

function measurementIDList(measurementIDs: readonly number[]): BuiltStatement {
  return { sql: ID_SLOT, params: padToSlot(measurementIDs, ID_LIST_SIZE, 'measurement ID') };
}

function finalize(schema: string, label: string, body: BuiltStatement): BuiltStatement {
  return { sql: safeFormatQuery(schema, `${label}\n${body.sql}`), params: body.params };
}

function sqlFlag(value: boolean): number {
  return value ? SQL_TRUE : SQL_FALSE;
}

function joinKeys(keys: readonly number[]): string {
  return keys.join(LIST_SEPARATOR);
}

export function chunkList<T>(values: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += chunkSize) chunks.push(values.slice(start, start + chunkSize));
  return chunks;
}

export function chunkCensusIDs(censusIDs: readonly number[]): number[][] {
  return chunkList(censusIDs, CENSUS_LIST_SIZE);
}

export function chunkMeasurementIDs(measurementIDs: readonly number[]): number[][] {
  return chunkList(measurementIDs, ID_LIST_SIZE);
}

// ---- the shared error-occurrence source (spec §2, form F2) ----

/** Unformatted (`??` still in place). Exported for the M1 membership probe in tests/benchmarks/lib/membershipprobe.ts only. */
export function errorOccurrenceSource(scope: ErrorSetScope, measurementIDs: readonly number[] | null): BuiltStatement {
  const idFilter = () => (measurementIDs ? joinFragments(['\n     AND cm.CoreMeasurementID IN (', measurementIDList(measurementIDs), ')']) : EMPTY_FRAGMENT);
  return joinFragments([
    `SELECT mel.MeasurementID AS CoreMeasurementID, mel.ErrorID, mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM
    FROM ??.measurement_error_log mel
    JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
    JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
   WHERE (mel.IsResolved = FALSE OR mel.IsResolved IS NULL)
     AND ms.PlotID = `,
    bound(scope.plotID),
    ' AND ms.CensusID IN (',
    censusList(scope),
    ') AND COALESCE(cm.IsActive, TRUE) = TRUE',
    idFilter(),
    `
  UNION ALL
  SELECT ms.CoreMeasurementID, NULL, NULL, NULL, NULL
    FROM ??.measurementssummary ms
    JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = ms.CoreMeasurementID
   WHERE ms.PlotID = `,
    bound(scope.plotID),
    ' AND ms.CensusID IN (',
    censusList(scope),
    ') AND COALESCE(cm.IsActive, TRUE) = TRUE AND ms.IsValidated = FALSE',
    idFilter(),
    `
     AND NOT EXISTS (SELECT 1 FROM ??.measurement_error_log unresolved
                      WHERE unresolved.MeasurementID = cm.CoreMeasurementID
                        AND (unresolved.IsResolved = FALSE OR unresolved.IsResolved IS NULL))`
  ]);
}

// ---- display columns shared by the catalog and the raw rows (spec §3) ----

const ERROR_DISPLAY_COLUMNS = `COALESCE(me.ErrorSource, ?) AS ErrorSource,
       COALESCE(me.ErrorCode, ?) AS ErrorCode,
       COALESCE(NULLIF(ve.Description, ''), me.ErrorMessage, ?) AS DisplayMessage,
       COALESCE(NULLIF(ve.Criteria, ''), '') AS ValidationCriteria,
       COALESCE(NULLIF(ve.ProcedureName, ''), '') AS ProcedureName`;
const ERROR_DISPLAY_PARAMS = [NO_LOG_ERROR_SOURCE, NO_LOG_ERROR_CODE, NO_LOG_ERROR_MESSAGE];
const VALIDATION_JOIN = `LEFT JOIN ??.sitespecificvalidations ve
    ON me.ErrorSource = 'validation' AND me.ErrorCode = CAST(ve.ValidationID AS CHAR)`;

const RAW_ROW_COLUMNS = `ms.CoreMeasurementID, ms.PlotID, ms.CensusID, ms.QuadratID, ms.TreeID, ms.StemGUID,
       cm.StemGUID AS CoreStemGUID, ms.SpeciesID, ms.TreeTag, ms.StemTag, ms.SpeciesName, ms.SubspeciesName,
       ms.SpeciesCode, ms.QuadratName, ms.StemLocalX, ms.StemLocalY, ms.StemPlotX, ms.StemPlotY, ms.MeasurementDate,
       ms.MeasuredDBH, ms.MeasuredHOM, ms.IsValidated, ms.Description AS MeasurementDescription, ms.Attributes,
       cm.RawCodes, ms.UserDefinedFields, cm.UploadFileID, cm.UploadBatchID,
       eo.PriorCensusID, eo.PriorDBH, eo.PriorHOM,
       ${ERROR_DISPLAY_COLUMNS}`;
const RAW_ROW_JOINS = `JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = eo.CoreMeasurementID
  JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = eo.CoreMeasurementID
  LEFT JOIN ??.measurement_errors me ON me.ErrorID = eo.ErrorID
  ${VALIDATION_JOIN}`;
const RAW_ROW_ORDER = 'ORDER BY ms.CoreMeasurementID ASC, me.ErrorSource ASC, me.ErrorCode ASC';

// ---- error_measurement variants (spec §5 step 2, §6) ----

const ERROR_TYPE_KEY = `COALESCE(eo.ErrorID, ${NO_LOG_ERROR_TYPE_KEY})`;

const ID_MEASUREMENT_CTE = `error_measurement AS (
  SELECT eo.CoreMeasurementID FROM error_occurrence eo GROUP BY eo.CoreMeasurementID)`;

function matchCountMeasurementCte(keyFilter: ErrorTypeKeyFilter): BuiltStatement {
  return {
    sql: `error_measurement AS (
  SELECT eo.CoreMeasurementID,
         COUNT(*) AS OccurrenceCount,
         SUM(FIND_IN_SET(${ERROR_TYPE_KEY}, ?) > 0) AS MatchingCount,
         SUM(FIND_IN_SET(${ERROR_TYPE_KEY}, ?) > 0) AS MatchingValidationCount,
         SUM(FIND_IN_SET(${ERROR_TYPE_KEY}, ?) > 0) AS MatchingIngestionCount
    FROM error_occurrence eo
   GROUP BY eo.CoreMeasurementID)`,
    params: [joinKeys(keyFilter.matchingKeys), joinKeys(keyFilter.matchingValidationKeys), joinKeys(keyFilter.matchingIngestionKeys)]
  };
}

const SIGNATURE_MEASUREMENT_CTE = `error_measurement AS (
  SELECT signature.CoreMeasurementID, signature.ErrorTypeKeys,
         (CHAR_LENGTH(signature.ErrorTypeKeys) = signature.ErrorTypeKeysFullLength) AS SignatureComplete
    FROM (SELECT eo.CoreMeasurementID,
                 GROUP_CONCAT(${ERROR_TYPE_KEY} ORDER BY ${ERROR_TYPE_KEY} SEPARATOR '${LIST_SEPARATOR}') AS ErrorTypeKeys,
                 SUM(CHAR_LENGTH(${ERROR_TYPE_KEY})) + COUNT(*) - 1 AS ErrorTypeKeysFullLength
            FROM error_occurrence eo
           GROUP BY eo.CoreMeasurementID) signature)`;

const ERROR_KEY_CTE = `error_key AS (
  SELECT em.*, ms.CensusID, ms.TreeTag, ms.StemTag, ms.MeasurementDate, cm.UploadFileID, cm.UploadBatchID, (cm.StemGUID IS NULL) AS IsFailedRow
    FROM error_measurement em
    JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = em.CoreMeasurementID
    JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = em.CoreMeasurementID)`;

// ---- contradiction-group definitions (spec §4) ----

type GroupForm = 'flags' | 'member-list';

function memberListColumns(memberID: string): string {
  return `,
         GROUP_CONCAT(DISTINCT ${memberID} ORDER BY ${memberID} SEPARATOR '${LIST_SEPARATOR}') AS MeasurementIDs,
         COUNT(DISTINCT ${memberID}) AS MemberCount,
         SUM(CHAR_LENGTH(${memberID})) + COUNT(DISTINCT ${memberID}) - 1 AS MemberListFullLength`;
}

function duplicateGroupDefinition(scope: ErrorSetScope, keySource: BuiltStatement, form: GroupForm): BuiltStatement {
  return joinFragments([
    `SELECT ms.CensusID, ms.TreeTag, ms.StemTag${form === 'member-list' ? memberListColumns('ms.CoreMeasurementID') : ''}
    FROM ??.measurementssummary ms
   WHERE ms.PlotID = `,
    bound(scope.plotID),
    ' AND ms.CensusID IN (',
    censusList(scope),
    `)
     AND COALESCE(ms.TreeTag, '') <> '' AND COALESCE(ms.StemTag, '') <> ''
     AND (ms.CensusID, ms.TreeTag, ms.StemTag) IN (`,
    keySource,
    `)
   GROUP BY ms.CensusID, ms.TreeTag, ms.StemTag
  HAVING COUNT(DISTINCT ms.CoreMeasurementID) > 1`
  ]);
}

function sameBatchGroupDefinition(scope: ErrorSetScope, keySource: BuiltStatement, form: GroupForm): BuiltStatement {
  return joinFragments([
    `SELECT ms.CensusID, cm.UploadFileID, cm.UploadBatchID, ms.TreeTag${form === 'member-list' ? memberListColumns('cm.CoreMeasurementID') : ''}
    FROM ??.coremeasurements cm
    JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID
   WHERE ms.PlotID = `,
    bound(scope.plotID),
    ' AND ms.CensusID IN (',
    censusList(scope),
    `)
     AND COALESCE(ms.TreeTag, '') <> '' AND cm.UploadFileID IS NOT NULL AND cm.UploadBatchID IS NOT NULL
     AND COALESCE(cm.IsActive, TRUE) = TRUE
     AND (ms.CensusID, cm.UploadFileID, cm.UploadBatchID, ms.TreeTag) IN (`,
    keySource,
    `)
   GROUP BY ms.CensusID, cm.UploadFileID, cm.UploadBatchID, ms.TreeTag
  HAVING COUNT(DISTINCT COALESCE(ms.SpeciesCode, '')) > 1 AND COUNT(DISTINCT cm.CoreMeasurementID) > 1`
  ]);
}

const ERROR_KEY_DUPLICATE_KEYS: BuiltStatement = { sql: 'SELECT ek.CensusID, ek.TreeTag, ek.StemTag FROM error_key ek', params: [] };
const ERROR_KEY_SAME_BATCH_KEYS: BuiltStatement = { sql: 'SELECT ek.CensusID, ek.UploadFileID, ek.UploadBatchID, ek.TreeTag FROM error_key ek', params: [] };

function requestedDuplicateKeys(measurementIDs: readonly number[]): BuiltStatement {
  return joinFragments([
    'SELECT keyed.CensusID, keyed.TreeTag, keyed.StemTag FROM ??.measurementssummary keyed WHERE keyed.CoreMeasurementID IN (',
    measurementIDList(measurementIDs),
    ')'
  ]);
}

function requestedSameBatchKeys(measurementIDs: readonly number[]): BuiltStatement {
  return joinFragments([
    `SELECT keyed_ms.CensusID, keyed_cm.UploadFileID, keyed_cm.UploadBatchID, keyed_ms.TreeTag
       FROM ??.measurementssummary keyed_ms
       JOIN ??.coremeasurements keyed_cm ON keyed_cm.CoreMeasurementID = keyed_ms.CoreMeasurementID
      WHERE keyed_ms.CoreMeasurementID IN (`,
    measurementIDList(measurementIDs),
    ')'
  ]);
}

const FLAGGED_CTE = `flagged AS (
  SELECT ek.*, (dg.CensusID IS NOT NULL) AS HasDuplicate, (sg.CensusID IS NOT NULL) AS HasSameBatch
    FROM error_key ek
    LEFT JOIN duplicate_group dg
      ON dg.CensusID = ek.CensusID AND dg.TreeTag = ek.TreeTag AND dg.StemTag = ek.StemTag
    LEFT JOIN same_batch_group sg
      ON sg.CensusID = ek.CensusID AND sg.UploadFileID = ek.UploadFileID AND sg.UploadBatchID = ek.UploadBatchID AND sg.TreeTag = ek.TreeTag)`;

function errorSetCtes(scope: ErrorSetScope, measurementCte: BuiltStatement | string, withFlags: boolean): BuiltStatement {
  return joinFragments([
    'WITH error_occurrence AS (\n  ',
    errorOccurrenceSource(scope, null),
    '),\n',
    measurementCte,
    withFlags
      ? joinFragments([
          ',\n',
          ERROR_KEY_CTE,
          ',\nduplicate_group AS (\n  ',
          duplicateGroupDefinition(scope, ERROR_KEY_DUPLICATE_KEYS, 'flags'),
          '),\nsame_batch_group AS (\n  ',
          sameBatchGroupDefinition(scope, ERROR_KEY_SAME_BATCH_KEYS, 'flags'),
          '),\n',
          FLAGGED_CTE
        ])
      : EMPTY_FRAGMENT
  ]);
}

function matchingCte(keyFilter: ErrorTypeKeyFilter, flags: FlagCombinations): BuiltStatement {
  return {
    sql: `,
matching AS (
  SELECT f.*, (f.HasDuplicate = 1 OR f.HasSameBatch = 1) AS HasContradiction
    FROM flagged f
   WHERE (? = 1 OR f.MatchingCount > 0)
     AND ((f.HasDuplicate = 0 AND f.HasSameBatch = 0 AND ? = 1)
       OR (f.HasDuplicate = 0 AND f.HasSameBatch = 1 AND ? = 1)
       OR (f.HasDuplicate = 1 AND f.HasSameBatch = 0 AND ? = 1)
       OR (f.HasDuplicate = 1 AND f.HasSameBatch = 1 AND ? = 1)))`,
    params: [sqlFlag(keyFilter.allKeysMatch), sqlFlag(flags.none), sqlFlag(flags.sameBatchOnly), sqlFlag(flags.duplicateOnly), sqlFlag(flags.both)]
  };
}

/** The SQL twin of compareSelectedRows; keep them in step (spec §5 "Order and ties"). */
export const SELECTED_ROW_ORDER = 'm.HasContradiction DESC, m.OccurrenceCount DESC, m.MeasurementDate ASC, m.CoreMeasurementID ASC';

function assertPageWindow(window: PageWindow): void {
  if (!Number.isSafeInteger(window.limit) || !Number.isSafeInteger(window.offset) || window.limit < 0 || window.offset < 0) {
    throw new InvalidPageWindowError(window);
  }
}

// ---- the nine statements ----

export function buildCatalogStatement(schema: string): BuiltStatement {
  return finalize(schema, ERROR_EXPLORER_STATEMENT_LABELS.catalog, {
    sql: `SELECT me.ErrorID, ${ERROR_DISPLAY_COLUMNS}
  FROM ??.measurement_errors me
  ${VALIDATION_JOIN}
 ORDER BY me.ErrorID`,
    params: [...ERROR_DISPLAY_PARAMS]
  });
}

export function buildPageStatement(scope: ErrorSetScope, keyFilter: ErrorTypeKeyFilter, flags: FlagCombinations, window: PageWindow): BuiltStatement {
  assertPageWindow(window);
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.page,
    joinFragments([
      errorSetCtes(scope, matchCountMeasurementCte(keyFilter), true),
      matchingCte(keyFilter, flags),
      `
SELECT m.CoreMeasurementID, m.CensusID, m.HasContradiction, m.OccurrenceCount, m.MeasurementDate,
       COUNT(*) OVER () AS TotalRows
  FROM matching m
 ORDER BY ${SELECTED_ROW_ORDER}
 LIMIT ? OFFSET ?`,
      { sql: '', params: [String(window.limit), String(window.offset)] }
    ])
  );
}

export function buildTotalsStatement(scope: ErrorSetScope, keyFilter: ErrorTypeKeyFilter, flags: FlagCombinations): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.totals,
    joinFragments([
      errorSetCtes(scope, matchCountMeasurementCte(keyFilter), true),
      matchingCte(keyFilter, flags),
      '\nSELECT COUNT(*) AS TotalRows\n  FROM matching m'
    ])
  );
}

export function buildHistogramWithFlagsStatement(scope: ErrorSetScope): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags,
    joinFragments([
      errorSetCtes(scope, SIGNATURE_MEASUREMENT_CTE, true),
      `
SELECT f.ErrorTypeKeys, f.SignatureComplete, f.HasDuplicate, f.HasSameBatch, f.IsFailedRow, COUNT(*) AS MeasurementCount
  FROM flagged f
 GROUP BY f.ErrorTypeKeys, f.SignatureComplete, f.HasDuplicate, f.HasSameBatch, f.IsFailedRow
 ORDER BY f.ErrorTypeKeys, f.SignatureComplete, f.HasDuplicate, f.HasSameBatch, f.IsFailedRow`
    ])
  );
}

export function buildHistogramWithoutFlagsStatement(scope: ErrorSetScope): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags,
    joinFragments([
      errorSetCtes(scope, SIGNATURE_MEASUREMENT_CTE, false),
      `
SELECT em.ErrorTypeKeys, em.SignatureComplete, ${SQL_FALSE} AS HasDuplicate, ${SQL_FALSE} AS HasSameBatch, ${SQL_FALSE} AS IsFailedRow, COUNT(*) AS MeasurementCount
  FROM error_measurement em
 GROUP BY em.ErrorTypeKeys, em.SignatureComplete
 ORDER BY em.ErrorTypeKeys, em.SignatureComplete`
    ])
  );
}

export function buildScopeRawRowsStatement(scope: ErrorSetScope): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.scopeRawRows,
    joinFragments([
      errorSetCtes(scope, ID_MEASUREMENT_CTE, true),
      {
        sql: `\nSELECT ${RAW_ROW_COLUMNS},\n       f.HasDuplicate, f.HasSameBatch\n  FROM error_occurrence eo\n  JOIN flagged f ON f.CoreMeasurementID = eo.CoreMeasurementID\n  ${RAW_ROW_JOINS}\n ${RAW_ROW_ORDER}`,
        params: [...ERROR_DISPLAY_PARAMS]
      }
    ])
  );
}

export function buildIDRawRowsStatement(scope: ErrorSetScope, measurementIDs: readonly number[]): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.idRawRows,
    joinFragments([
      'WITH error_occurrence AS (\n  ',
      errorOccurrenceSource(scope, measurementIDs),
      ')',
      { sql: `\nSELECT ${RAW_ROW_COLUMNS}\n  FROM error_occurrence eo\n  ${RAW_ROW_JOINS}\n ${RAW_ROW_ORDER}`, params: [...ERROR_DISPLAY_PARAMS] }
    ])
  );
}

export function buildDuplicateMemberGroupsStatement(scope: ErrorSetScope, measurementIDs: readonly number[]): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.duplicateMemberGroups,
    joinFragments([
      `SELECT requested.CoreMeasurementID AS RequestedMeasurementID, grp.CensusID, grp.TreeTag, grp.StemTag,
       grp.MeasurementIDs, grp.MemberCount, (CHAR_LENGTH(grp.MeasurementIDs) = grp.MemberListFullLength) AS MemberListComplete
  FROM ??.measurementssummary requested
  JOIN (`,
      duplicateGroupDefinition(scope, requestedDuplicateKeys(measurementIDs), 'member-list'),
      `) grp
    ON grp.CensusID = requested.CensusID AND grp.TreeTag = requested.TreeTag AND grp.StemTag = requested.StemTag
 WHERE requested.CoreMeasurementID IN (`,
      measurementIDList(measurementIDs),
      ') AND requested.PlotID = ',
      bound(scope.plotID),
      '\n ORDER BY requested.CoreMeasurementID'
    ])
  );
}

export function buildSameBatchMemberGroupsStatement(scope: ErrorSetScope, measurementIDs: readonly number[]): BuiltStatement {
  return finalize(
    scope.schema,
    ERROR_EXPLORER_STATEMENT_LABELS.sameBatchMemberGroups,
    joinFragments([
      `SELECT requested_ms.CoreMeasurementID AS RequestedMeasurementID, grp.CensusID, grp.UploadFileID, grp.UploadBatchID, grp.TreeTag,
       grp.MeasurementIDs, grp.MemberCount, (CHAR_LENGTH(grp.MeasurementIDs) = grp.MemberListFullLength) AS MemberListComplete
  FROM ??.measurementssummary requested_ms
  JOIN ??.coremeasurements requested_cm ON requested_cm.CoreMeasurementID = requested_ms.CoreMeasurementID
  JOIN (`,
      sameBatchGroupDefinition(scope, requestedSameBatchKeys(measurementIDs), 'member-list'),
      `) grp
    ON grp.CensusID = requested_ms.CensusID AND grp.UploadFileID = requested_cm.UploadFileID
   AND grp.UploadBatchID = requested_cm.UploadBatchID AND grp.TreeTag = requested_ms.TreeTag
 WHERE requested_ms.CoreMeasurementID IN (`,
      measurementIDList(measurementIDs),
      ') AND requested_ms.PlotID = ',
      bound(scope.plotID),
      ' AND COALESCE(requested_cm.IsActive, TRUE) = TRUE\n ORDER BY requested_ms.CoreMeasurementID'
    ])
  );
}

// ---- census-chunk merge (spec §10 "Chunks") ----

function sortableDate(value: Date | string | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

export function compareSelectedRows(a: SelectedRowSortKeys, b: SelectedRowSortKeys): number {
  const contradictionDelta = Number(b.HasContradiction) - Number(a.HasContradiction);
  if (contradictionDelta !== 0) return contradictionDelta;
  const occurrenceDelta = Number(b.OccurrenceCount) - Number(a.OccurrenceCount);
  if (occurrenceDelta !== 0) return occurrenceDelta;
  const aDate = sortableDate(a.MeasurementDate);
  const bDate = sortableDate(b.MeasurementDate);
  if (aDate !== bDate) {
    if (aDate === null) return -1;
    if (bDate === null) return 1;
    return aDate - bDate;
  }
  return Number(a.CoreMeasurementID) - Number(b.CoreMeasurementID);
}
