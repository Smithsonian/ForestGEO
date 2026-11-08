import { VisibleFilter } from '@/config/datagridhelpers';
import { AttributeStatusOptions } from '@/lib/db/definitions/core';

export function buildMeasurementHasUnresolvedErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
          )`;
}

export function buildMeasurementHasUnresolvedValidationErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM ${schema}.measurement_error_log mel
            JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
            WHERE mel.MeasurementID = ${alias}.CoreMeasurementID
              AND COALESCE(mel.IsResolved, FALSE) = FALSE
              AND me.ErrorSource = 'validation'
          )`;
}

/**
 * Unresolved ingestion-source error log entries. Written as an EXISTS over a DISTINCT derived table
 * (not a plain correlated subquery) on purpose: the override DELETE targets measurement_error_log, and
 * MySQL rejects a subquery over its own DELETE target (error 1093). DISTINCT stops the optimizer from
 * merging the derived table back into the outer query, so the same fragment is safe in SELECT, UPDATE
 * and DELETE statements.
 */
export function buildMeasurementHasUnresolvedIngestionErrorsSql(schema: string, alias: string): string {
  return `EXISTS (
            SELECT 1
            FROM (
              SELECT DISTINCT ilog.MeasurementID
              FROM ${schema}.measurement_error_log ilog
              JOIN ${schema}.measurement_errors ierr ON ierr.ErrorID = ilog.ErrorID
              WHERE COALESCE(ilog.IsResolved, FALSE) = FALSE
                AND ierr.ErrorSource = 'ingestion'
            ) ing
            WHERE ing.MeasurementID = ${alias}.CoreMeasurementID
          )`;
}

/**
 * THE override-eligibility predicate, shared by CountOverridable, the override modal's pre-count, its
 * validation-log DELETE and its IsValidated UPDATE so they can never disagree. A row is eligible when
 * it is a resolved, linked measurement (real StemGUID), has not already passed (IsValidated FALSE or
 * NULL) and carries no unresolved ingestion-source error. Ingestion failures (StemGUID NULL, or an
 * unresolved ingestion log even when a StemGUID is present) are never overridable.
 */
export function buildMeasurementOverrideEligibleSql(schema: string, alias: string): string {
  return `(${alias}.IsValidated = FALSE OR ${alias}.IsValidated IS NULL)
        AND ${alias}.StemGUID IS NOT NULL
        AND NOT (${buildMeasurementHasUnresolvedIngestionErrorsSql(schema, alias)})`;
}

export interface ValidationOverrideStatement {
  query: string;
  params: Array<number>;
}

export interface ValidationOverrideStatements {
  count: ValidationOverrideStatement;
  clearValidationLogs: ValidationOverrideStatement;
  markValidated: ValidationOverrideStatement;
}

/**
 * Builds the override modal's three statements from the single eligibility predicate. Every
 * statement carries the same plot/census scope (bound as ? params, in the order plotID,
 * plotCensusNumber, plotID) and the same eligibility fragment. The DELETE only ever touches
 * validation-source logs, never ingestion logs.
 */
export function buildValidationOverrideStatements(schema: string, plotID: number, plotCensusNumber: number): ValidationOverrideStatements {
  const eligible = buildMeasurementOverrideEligibleSql(schema, 'cm');
  const scope = `c.CensusID IN (SELECT CensusID FROM ${schema}.census WHERE PlotID = ? AND PlotCensusNumber = ?)
        AND c.PlotID = ?`;
  const params = [plotID, plotCensusNumber, plotID];
  return {
    count: {
      query: `SELECT COUNT(*) AS EligibleCount
      FROM ${schema}.coremeasurements AS cm
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      WHERE ${scope}
        AND ${eligible}`,
      params
    },
    clearValidationLogs: {
      query: `DELETE mel
      FROM ${schema}.measurement_error_log AS mel
      JOIN ${schema}.measurement_errors AS me ON me.ErrorID = mel.ErrorID
      JOIN ${schema}.coremeasurements AS cm ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      WHERE ${scope}
        AND me.ErrorSource = 'validation'
        AND ${eligible}`,
      params
    },
    markValidated: {
      query: `UPDATE ${schema}.coremeasurements AS cm
      JOIN ${schema}.census AS c ON c.CensusID = cm.CensusID
      SET cm.IsValidated = TRUE
      WHERE ${scope}
        AND ${eligible}`,
      params
    }
  };
}

export type MeasurementRowStatus = 'ingestion-unresolved' | 'pending' | 'valid' | 'failed' | 'unknown';

/**
 * Status-column precedence for a grid row (the caller handles per-row validation-error detail
 * first). A row with StemGUID NULL is an unresolved ingestion failure and must never read as passed
 * or pending, even if a past override left IsValidated = 1 on it.
 */
export function getMeasurementRowStatus(row: { stemGUID?: number | null; isValidated?: boolean | number | null }): MeasurementRowStatus {
  if (row.stemGUID === null) return 'ingestion-unresolved';
  if (row.isValidated === null) return 'pending';
  if (row.isValidated === undefined) return 'unknown';
  return row.isValidated ? 'valid' : 'failed';
}

/**
 * Projects measurement-state counts. The first four buckets are mutually exclusive and exhaustive
 * (they sum to the row total):
 * - CountUnresolvedLogged: any row with StemGUID NULL (an unresolved ingestion failure, whatever its
 *   IsValidated flag or log state) or with an unresolved measurement_error_log entry
 * - CountFailedNoLog: real stem, IsValidated = FALSE, no unresolved log entry. IsValidated defaults to
 *   FALSE in tablestructures.sql and migration 51 backfilled hard failures whose log link was
 *   dropped, so FALSE-without-logs means "not yet validated (or log link lost)", not "clean".
 * - CountPending: real stem, IsValidated IS NULL, no unresolved log entry
 * - CountValid: real stem, IsValidated = TRUE, no unresolved log entry
 *
 * CountOverridable is intentionally NOT disjoint from the buckets above: it uses the shared
 * buildMeasurementOverrideEligibleSql predicate (also used by the override modal's DELETE/UPDATE),
 * so it overlaps CountFailedNoLog, CountPending, and the FALSE/NULL portion of CountUnresolvedLogged,
 * but excludes ingestion failures (StemGUID NULL or an unresolved ingestion-source log).
 *
 * CountRevalidatable mirrors prepareValidationRun's reset predicate exactly (IsValidated = FALSE,
 * a real stem, and an unresolved validation-source error): the rows a validation rerun will reset
 * to pending and re-examine. Ingestion failures (StemGUID NULL, 'ingestion'-source errors) are
 * excluded — no rerun can clear those, so they must not make the run action look actionable.
 */
export function buildMeasurementStateCountsSql(schema: string, alias: string): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);
  const hasUnresolvedValidationErrors = buildMeasurementHasUnresolvedValidationErrorsSql(schema, alias);
  const overrideEligible = buildMeasurementOverrideEligibleSql(schema, alias);

  return `SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = FALSE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountFailedNoLog,
          SUM(CASE WHEN ${alias}.StemGUID IS NULL OR ${hasUnresolvedErrors} THEN 1 ELSE 0 END) AS CountUnresolvedLogged,
          SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated IS NULL AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountPending,
          SUM(CASE WHEN ${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = TRUE AND NOT (${hasUnresolvedErrors}) THEN 1 ELSE 0 END) AS CountValid,
          SUM(CASE WHEN ${overrideEligible} THEN 1 ELSE 0 END) AS CountOverridable,
          SUM(CASE WHEN ${alias}.IsValidated = FALSE AND ${alias}.StemGUID IS NOT NULL AND (${hasUnresolvedValidationErrors}) THEN 1 ELSE 0 END) AS CountRevalidatable`;
}

export function buildMeasurementVisibleConditionSql(schema: string, alias: string, visibleFilter: VisibleFilter): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);

  switch (visibleFilter) {
    case 'valid':
      return `(${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated = TRUE AND NOT ${hasUnresolvedErrors})`;
    case 'errors':
      return `(${alias}.StemGUID IS NULL OR ${alias}.IsValidated = FALSE OR ${hasUnresolvedErrors})`;
    case 'pending':
      return `(${alias}.StemGUID IS NOT NULL AND ${alias}.IsValidated IS NULL AND NOT ${hasUnresolvedErrors})`;
  }
}

export function buildMeasurementVisibleClauseSql(schema: string, alias: string, visibleFilters: VisibleFilter[] | undefined): string {
  if (!visibleFilters) {
    return '';
  }

  const visibleConditions = visibleFilters.map(visibleFilter => buildMeasurementVisibleConditionSql(schema, alias, visibleFilter));

  return visibleConditions.length > 0 ? ` AND (${visibleConditions.join(' OR ')})` : ' AND 1 = 0';
}

export const MEASUREMENT_STATUSES = ['ingestionFailed', 'unresolvedErrors', 'invalidNoLog', 'pending', 'passed'] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

export const MEASUREMENT_STATUS_RANK: Readonly<Record<MeasurementStatus, number>> = {
  ingestionFailed: 0,
  unresolvedErrors: 1,
  invalidNoLog: 2,
  pending: 3,
  passed: 4
};

/** Each status lands in exactly one of buildMeasurementVisibleConditionSql's buckets. */
export const MEASUREMENT_STATUS_VISIBLE_BUCKET: Readonly<Record<MeasurementStatus, VisibleFilter>> = {
  ingestionFailed: 'errors',
  unresolvedErrors: 'errors',
  invalidNoLog: 'errors',
  pending: 'pending',
  passed: 'valid'
};

export const MEASUREMENT_STATUS_RANK_COLUMN = 'MeasurementStatusRank';
export const UNRESOLVED_ERROR_CODES_SEPARATOR = ',';
export const UNRESOLVED_ERROR_CODE_PART_SEPARATOR = ':';
/** ASCII unit separator: never part of a stored error message. */
export const UNRESOLVED_ERROR_MESSAGES_SEPARATOR = '\u001f';
export const STEM_STATUSES_SEPARATOR = ',';

export class UnknownAttributeStatusError extends Error {
  constructor(readonly status: string) {
    super(`Unknown attribute status: ${status}`);
    this.name = 'UnknownAttributeStatusError';
  }
}

const ATTRIBUTE_STATUS_LITERAL_PATTERN = /^[a-z][a-z -]*$/;

function toAttributeStatusLiteral(status: string): string {
  if (!AttributeStatusOptions.includes(status) || !ATTRIBUTE_STATUS_LITERAL_PATTERN.test(status)) {
    throw new UnknownAttributeStatusError(status);
  }
  return `'${status}'`;
}

export function measurementStatusFromRank(rank: unknown): MeasurementStatus | null {
  if (rank === null || rank === undefined || rank === '') return null;
  const numeric = Number(rank);
  return Number.isInteger(numeric) && numeric >= 0 && numeric < MEASUREMENT_STATUSES.length ? MEASUREMENT_STATUSES[numeric] : null;
}

/** Same predicates as buildMeasurementStateCountsSql, so a row's rank always agrees with the Show counts. */
export function buildMeasurementStatusRankSql(schema: string, alias: string): string {
  const hasUnresolvedErrors = buildMeasurementHasUnresolvedErrorsSql(schema, alias);
  return `CASE
            WHEN ${alias}.StemGUID IS NULL THEN ${MEASUREMENT_STATUS_RANK.ingestionFailed}
            WHEN ${hasUnresolvedErrors} THEN ${MEASUREMENT_STATUS_RANK.unresolvedErrors}
            WHEN ${alias}.IsValidated = FALSE THEN ${MEASUREMENT_STATUS_RANK.invalidNoLog}
            WHEN ${alias}.IsValidated IS NULL THEN ${MEASUREMENT_STATUS_RANK.pending}
            ELSE ${MEASUREMENT_STATUS_RANK.passed}
          END`;
}

/** attributes' key is (Code, IsActive): prefer the active row so each code yields one status (A6). */
function buildEffectiveAttributeJoinSql(schema: string, cmAttributeAlias: string, attributeAlias: string): string {
  return `JOIN ${schema}.attributes ${attributeAlias}
              ON ${attributeAlias}.Code = ${cmAttributeAlias}.Code
             AND ${attributeAlias}.IsActive = (SELECT MAX(effective_attr.IsActive) FROM ${schema}.attributes effective_attr WHERE effective_attr.Code = ${cmAttributeAlias}.Code)`;
}

function buildUnresolvedErrorsFromSql(schema: string, alias: string, logAlias: string, errorAlias: string, validationAlias?: string): string {
  const validationJoin = validationAlias
    ? `LEFT JOIN ${schema}.sitespecificvalidations ${validationAlias}
                ON ${errorAlias}.ErrorSource = 'validation' AND ${errorAlias}.ErrorCode = CAST(${validationAlias}.ValidationID AS CHAR)`
    : '';
  return `FROM ${schema}.measurement_error_log ${logAlias}
              JOIN ${schema}.measurement_errors ${errorAlias} ON ${errorAlias}.ErrorID = ${logAlias}.ErrorID
              ${validationJoin}
             WHERE ${logAlias}.MeasurementID = ${alias}.CoreMeasurementID
               AND COALESCE(${logAlias}.IsResolved, FALSE) = FALSE`;
}

function errorOrder(errorAlias: string): string {
  return `ORDER BY ${errorAlias}.ErrorSource ASC, ${errorAlias}.ErrorCode ASC`;
}

function displayMessage(errorAlias: string, validationAlias: string): string {
  return `COALESCE(NULLIF(${validationAlias}.Description, ''), ${errorAlias}.ErrorMessage)`;
}

/**
 * Per-row columns the View Data grid reads (measurementssummary branch only). Message text and error order
 * match buildRawErrorsQuery and its ORDER BY in app/api/errors/explorer/_shared.ts; the contradiction checks
 * mirror buildDuplicateGroupsQuery and buildSameBatchConflictGroupsQuery there.
 */
export function buildMeasurementRowSummaryProjectionSql(schema: string, alias: string): string {
  const statusOrder = AttributeStatusOptions.map(toAttributeStatusLiteral).join(', ');
  const duplicateTagStem = `EXISTS (
            SELECT 1 FROM ${schema}.measurementssummary rs_dup
             WHERE rs_dup.PlotID = ${alias}.PlotID AND rs_dup.CensusID = ${alias}.CensusID
               AND rs_dup.CoreMeasurementID <> ${alias}.CoreMeasurementID
               AND rs_dup.TreeTag = ${alias}.TreeTag AND rs_dup.StemTag = ${alias}.StemTag
               AND COALESCE(${alias}.TreeTag, '') <> '' AND COALESCE(${alias}.StemTag, '') <> '')`;
  const sameBatchSpecies = `EXISTS (
            SELECT 1 FROM ${schema}.coremeasurements rs_self
              JOIN ${schema}.coremeasurements rs_other
                ON rs_other.UploadFileID = rs_self.UploadFileID AND rs_other.UploadBatchID = rs_self.UploadBatchID
               AND rs_other.CoreMeasurementID <> rs_self.CoreMeasurementID AND COALESCE(rs_other.IsActive, TRUE) = TRUE
              JOIN ${schema}.measurementssummary rs_other_ms
                ON rs_other_ms.CoreMeasurementID = rs_other.CoreMeasurementID
               AND rs_other_ms.PlotID = ${alias}.PlotID AND rs_other_ms.CensusID = ${alias}.CensusID
             WHERE rs_self.CoreMeasurementID = ${alias}.CoreMeasurementID
               AND rs_self.UploadFileID IS NOT NULL AND rs_self.UploadBatchID IS NOT NULL AND COALESCE(rs_self.IsActive, TRUE) = TRUE
               AND COALESCE(${alias}.TreeTag, '') <> '' AND rs_other_ms.TreeTag = ${alias}.TreeTag
               AND COALESCE(rs_other_ms.SpeciesCode, '') <> COALESCE(${alias}.SpeciesCode, ''))`;

  return `${buildMeasurementStatusRankSql(schema, alias)} AS ${MEASUREMENT_STATUS_RANK_COLUMN},
          (SELECT COUNT(*) ${buildUnresolvedErrorsFromSql(schema, alias, 'rs_cmel', 'rs_cme')}) AS UnresolvedErrorCount,
          (SELECT ${displayMessage('rs_pme', 'rs_pve')} ${buildUnresolvedErrorsFromSql(schema, alias, 'rs_pmel', 'rs_pme', 'rs_pve')}
             ${errorOrder('rs_pme')} LIMIT 1) AS PrimaryErrorMessage,
          (SELECT rs_sme.ErrorSource ${buildUnresolvedErrorsFromSql(schema, alias, 'rs_smel', 'rs_sme')}
             ${errorOrder('rs_sme')} LIMIT 1) AS PrimaryErrorSource,
          (SELECT GROUP_CONCAT(CONCAT(rs_kme.ErrorSource, '${UNRESOLVED_ERROR_CODE_PART_SEPARATOR}', rs_kme.ErrorCode) ${errorOrder('rs_kme')} SEPARATOR '${UNRESOLVED_ERROR_CODES_SEPARATOR}')
             ${buildUnresolvedErrorsFromSql(schema, alias, 'rs_kmel', 'rs_kme')}) AS UnresolvedErrorCodes,
          (SELECT GROUP_CONCAT(${displayMessage('rs_mme', 'rs_mve')} ${errorOrder('rs_mme')} SEPARATOR '${UNRESOLVED_ERROR_MESSAGES_SEPARATOR}')
             ${buildUnresolvedErrorsFromSql(schema, alias, 'rs_mmel', 'rs_mme', 'rs_mve')}) AS UnresolvedErrorMessages,
          (CASE WHEN ${duplicateTagStem} OR ${sameBatchSpecies} THEN 1 ELSE 0 END) AS HasContradiction,
          (SELECT GROUP_CONCAT(DISTINCT rs_attr.Status ORDER BY FIELD(rs_attr.Status, ${statusOrder}) SEPARATOR '${STEM_STATUSES_SEPARATOR}')
             FROM ${schema}.cmattributes rs_ca
             ${buildEffectiveAttributeJoinSql(schema, 'rs_ca', 'rs_attr')}
            WHERE rs_ca.CoreMeasurementID = ${alias}.CoreMeasurementID AND rs_attr.Status IS NOT NULL) AS StemStatuses`;
}

/** " AND EXISTS (...)" matching rows where any effective code carries one of the statuses; '' when none. */
export function buildStemStatusFilterClauseSql(schema: string, alias: string, statuses: readonly string[]): string {
  if (statuses.length === 0) return '';
  const literals = statuses.map(toAttributeStatusLiteral).join(', ');
  return ` AND EXISTS (
            SELECT 1 FROM ${schema}.cmattributes sf_ca
            ${buildEffectiveAttributeJoinSql(schema, 'sf_ca', 'sf_attr')}
            WHERE sf_ca.CoreMeasurementID = ${alias}.CoreMeasurementID AND sf_attr.Status IN (${literals}))`;
}
