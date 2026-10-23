import { isValidSchema } from '@/lib/db/sqlsecurity';
import { CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM, CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR } from '@/config/censusoverview';

// The publish route's strict match (Number.parseInt + String round-trip), restricted to positive values.
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export const CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS = {
  invalidSchema: 'Invalid schema name',
  invalidPlotOrCensusID: 'plotID and censusID must be positive integers',
  missingErrorCensusIDs: `Missing required query param: ${CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM}`,
  malformedErrorCensusIDs: `${CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM} must be a comma-separated list of positive integers`,
  errorCensusIDsOmitPathCensus: `${CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM} must include the censusID in the path`
} as const;

export interface RawCensusOverviewSummaryRequest {
  schema: string | undefined;
  plotID: string | undefined;
  censusID: string | undefined;
  errorCensusIDs: string | null;
}

export interface CensusOverviewSummaryRequest {
  schema: string;
  plotID: number;
  /** Publish scope: the census a publish would carry. */
  censusID: number;
  /** Errors scope: every census the Errors page queries; always includes censusID. */
  errorCensusIDs: number[];
}

export type CensusOverviewSummaryRequestParseResult = { ok: true; request: CensusOverviewSummaryRequest } | { ok: false; error: string };

export function parseStrictPositiveInteger(raw: string | undefined): number | null {
  if (raw === undefined || !POSITIVE_INTEGER_PATTERN.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseErrorCensusIDs(raw: string): number[] | null {
  const censusIDs: number[] = [];
  for (const member of raw.split(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_SEPARATOR)) {
    const censusID = parseStrictPositiveInteger(member);
    if (censusID === null) return null;
    if (!censusIDs.includes(censusID)) censusIDs.push(censusID);
  }
  return censusIDs;
}

/** Validates every route input before any SQL runs. */
export function parseCensusOverviewSummaryRequest(raw: RawCensusOverviewSummaryRequest): CensusOverviewSummaryRequestParseResult {
  if (!isValidSchema(raw.schema)) return { ok: false, error: CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidSchema };

  const plotID = parseStrictPositiveInteger(raw.plotID);
  const censusID = parseStrictPositiveInteger(raw.censusID);
  if (plotID === null || censusID === null) return { ok: false, error: CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID };

  if (raw.errorCensusIDs === null || raw.errorCensusIDs === '') return { ok: false, error: CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.missingErrorCensusIDs };
  const errorCensusIDs = parseErrorCensusIDs(raw.errorCensusIDs);
  if (errorCensusIDs === null) return { ok: false, error: CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.malformedErrorCensusIDs };
  if (!errorCensusIDs.includes(censusID)) return { ok: false, error: CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.errorCensusIDsOmitPathCensus };

  return { ok: true, request: { schema: raw.schema, plotID, censusID, errorCensusIDs } };
}
