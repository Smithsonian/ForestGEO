// GET /api/uploads/replacement-preview — read-only "how many rows would a Clean
// Re-Upload replace" preview (issue #504). Mirrors cleanupPreviousFileUploads'
// (lib/ingestion/temporary-measurements.ts) coremeasurements DELETE scope exactly —
// CensusID alone, no IsActive/IsValidated/PlotID filter — so the count shown before a
// user confirms a Clean Re-Upload matches what that DELETE would actually remove.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import { requireSession } from '@/lib/auth-helpers';
import ConnectionManager from '@/lib/db/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { parseOptionalPositiveInteger } from '@/lib/background-jobs/route-helpers';
import { fromQuery, withRouteAuthz } from '@/lib/route-authz';

export const runtime = 'nodejs';

interface ExistingRowCountRow {
  existingRowCount: unknown;
}

/** Generic operational message for the client — no internal detail (schema, SQL, row shape) leaks. */
const EXISTING_ROW_COUNT_ERROR_MESSAGE = 'Unable to determine the existing row count for this plot/census.';

/** The preview count must always be read fresh — a Clean Re-Upload confirmation decision is made from it. */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/** Matches a non-empty run of decimal digits only — excludes '', whitespace, and signed/fractional strings. */
const DECIMAL_DIGITS_ONLY = /^\d+$/;

/**
 * Normalizes the COUNT(*) result to a safe nonnegative integer, or null for anything
 * that is not one (missing row, null, NaN, negative, fractional, unsafe, or not a
 * number/digit-string to begin with). Defaulting any of those to 0 would let a
 * malformed/missing count authorize a Clean Re-Upload as "zero existing rows" when the
 * true count is unknown. Only `number` or a `/^\d+$/` digit string is accepted before
 * coercion, so values JS's `Number()` would otherwise coerce into a plausible-looking
 * count (e.g. `Number(false) === 0`, `Number(['0']) === 0`) are rejected up front.
 */
function toSafeExistingRowCount(rawCount: unknown): number | null {
  const isAcceptedType = typeof rawCount === 'number' || (typeof rawCount === 'string' && DECIMAL_DIGITS_ONLY.test(rawCount));
  if (!isAcceptedType) return null;
  const normalized = Number(rawCount);
  if (!Number.isSafeInteger(normalized) || normalized < 0) return null;
  return normalized;
}

async function getHandler(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const schema = searchParams.get('schema');
  if (!schema || !isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Both are required (unlike uploadjobs' GET, where plotID/censusID narrow an
  // existing listing) — there is no scope to preview without them, so a
  // missing or non-positive-integer value is a 400, not an "all scopes" query.
  const rawPlotID = searchParams.get('plotID');
  const rawCensusID = searchParams.get('censusID');
  const plotID = parseOptionalPositiveInteger(rawPlotID);
  const censusID = parseOptionalPositiveInteger(rawCensusID);
  if (plotID === undefined || censusID === undefined) {
    return NextResponse.json({ error: 'plotID and censusID must be positive integers' }, { status: HTTPResponses.BAD_REQUEST });
  }

  const cm = ConnectionManager.getInstance();
  try {
    await assertCanEditMeasurementScope(cm, session!, { schema, plotID, censusID });

    // Matches cleanupPreviousFileUploads' DELETE scope exactly (see header) --
    // counting only validated/visible rows would under-report what gets deleted.
    const countSQL = safeFormatQuery(schema, `SELECT COUNT(*) AS existingRowCount FROM ??.coremeasurements WHERE CensusID = ?`);
    const rows = await cm.executeQuery(countSQL, [censusID]);
    const firstRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
    // Narrow before accessing the property so a malformed driver result (e.g. a null
    // row) flows into the controlled error path below instead of throwing.
    const rawExistingRowCount = typeof firstRow === 'object' && firstRow !== null ? (firstRow as ExistingRowCountRow).existingRowCount : undefined;
    const existingRowCount = toSafeExistingRowCount(rawExistingRowCount);

    if (existingRowCount === null) {
      // Fail closed: a missing/null/NaN/negative/fractional/unsafe count must
      // never be reported as 0 — that would authorize an unchecked Clean
      // Re-Upload census replacement as "nothing to replace".
      ailogger.error(
        `[replacement-preview] Invalid existingRowCount for schema=${schema} plotID=${plotID} censusID=${censusID}: ` +
          `received ${JSON.stringify(rawExistingRowCount)} (rows: ${JSON.stringify(rows)})`
      );
      return NextResponse.json({ error: EXISTING_ROW_COUNT_ERROR_MESSAGE }, { status: HTTPResponses.INTERNAL_SERVER_ERROR, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ existingRowCount }, { status: HTTPResponses.OK, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }
    ailogger.error('[replacement-preview] Failed to resolve existing row count', error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    await cm.closeConnection();
  }
}

export const GET = withRouteAuthz('uploads/replacement-preview', getHandler, { schema: fromQuery('schema') });
