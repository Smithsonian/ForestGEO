import { NextRequest, NextResponse } from 'next/server';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import { buildChangeExportFilename, serializeChangeExportCsv } from '@/config/changelogexport';
import { CHANGE_EXPORT_ERROR_CODES } from '@/config/recentchangesexplorer';
import { parseExplorerRequest, readExplorerRequestJson } from '@/lib/errorsexplorer/explorerrequest';
import { changeExportRequestSchema, INVALID_CHANGE_EXPORT_REQUEST_RESPONSE } from '@/lib/changes/explorerrequest';
import { ChangeExportReadError, ExportTooLargeError, readChangeExportSnapshot, type ChangeExportLimits } from '@/lib/changes/exportsnapshot';
import type { RouteContext } from '@/lib/route-authz';

const EXPORT_SUCCEEDED_EVENT = 'RecentChangesCsvExported';
const EXPORT_FAILED_LOG_MESSAGE = 'Change log export failed';
const EXPORT_TOO_LARGE_LOG_MESSAGE = 'Change log export passed its row limit';
/** A failure outside the reader: serializing, building the response, or telemetry. */
const HANDLER_STAGE = 'handler';
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
/** The CSV names the people who made each change; no cache may keep a copy. */
const NO_STORE_CACHE_CONTROL = 'no-store';

const EXPORT_TOO_LARGE_RESPONSE = { error: 'The export is larger than the row limit', code: CHANGE_EXPORT_ERROR_CODES.tooLarge } as const;
const CHANGE_EXPORT_FAILED_RESPONSE = { error: 'Unable to export the change log', code: CHANGE_EXPORT_ERROR_CODES.failed } as const;

/**
 * Builds the export handler around a row ceiling and page size. The route passes the production
 * limits; tests pass small ones instead of mocking them. Parses, reads, serializes; holds no SQL.
 */
export function createChangeExportHandler(limits: ChangeExportLimits) {
  return async function handleChangeExport(request: NextRequest, _context: RouteContext): Promise<Response> {
    const startedAt = Date.now();

    const json = await readExplorerRequestJson(request);
    if (!json.ok) {
      return NextResponse.json(INVALID_CHANGE_EXPORT_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
    }
    const parsed = parseExplorerRequest(changeExportRequestSchema, json.body);
    if (!parsed.ok) {
      ailogger.warn('Rejected invalid change log export request', { issues: parsed.issues });
      return NextResponse.json(INVALID_CHANGE_EXPORT_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
    }
    const { schema, plotID, filters } = parsed.data;

    try {
      const snapshot = await readChangeExportSnapshot({ schema, plotID, filters }, limits);
      const csv = serializeChangeExportCsv(snapshot.rows);
      const filename = buildChangeExportFilename(schema, plotID, new Date());

      ailogger.event(EXPORT_SUCCEEDED_EVENT, {
        schema,
        plotID,
        changeCount: snapshot.detailChangeCount + snapshot.rollupMemberCount,
        suppressedChangeCount: snapshot.suppressedChangeCount,
        rowCount: snapshot.rows.length,
        durationMs: Date.now() - startedAt,
        outputBytes: Buffer.byteLength(csv, 'utf8')
      });

      return new NextResponse(csv, {
        status: HTTPResponses.OK,
        headers: { 'Content-Type': CSV_CONTENT_TYPE, 'Cache-Control': NO_STORE_CACHE_CONTROL, 'Content-Disposition': `attachment; filename="${filename}"` }
      });
    } catch (error: unknown) {
      if (error instanceof ExportTooLargeError) {
        // Where and which ceiling only: the filters can quote what the researcher searched for.
        ailogger.warn(EXPORT_TOO_LARGE_LOG_MESSAGE, { schema, plotID, maxRows: error.maxRows });
        return NextResponse.json(EXPORT_TOO_LARGE_RESPONSE, { status: HTTPResponses.PAYLOAD_TOO_LARGE });
      }
      const readFailure = error instanceof ChangeExportReadError ? error : null;
      const underlyingFailure: unknown = readFailure ? readFailure.cause : error;
      // The full error goes to the log, as on the list route; the response below stays fixed.
      ailogger.error(EXPORT_FAILED_LOG_MESSAGE, underlyingFailure instanceof Error ? underlyingFailure : new Error(String(underlyingFailure)), {
        schema,
        plotID,
        stage: readFailure?.stage ?? HANDLER_STAGE,
        driverCode: readFailure?.driverCode
      });
      return NextResponse.json(CHANGE_EXPORT_FAILED_RESPONSE, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }
  };
}
