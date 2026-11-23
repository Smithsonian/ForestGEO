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
        return NextResponse.json(EXPORT_TOO_LARGE_RESPONSE, { status: HTTPResponses.PAYLOAD_TOO_LARGE });
      }
      const stage = error instanceof ChangeExportReadError ? error.stage : HANDLER_STAGE;
      const driverCode = error instanceof ChangeExportReadError ? error.driverCode : undefined;
      // `name`, not `constructor.name`: a server build may minify class names, and each error class sets its own name.
      const errorName = error instanceof Error ? error.name : typeof error;
      // Stage, driver code and the error's class name only: filter values, cell values, SQL text and error messages can all quote row data.
      ailogger.error(EXPORT_FAILED_LOG_MESSAGE, new Error(`${EXPORT_FAILED_LOG_MESSAGE} at stage ${stage}`), { schema, plotID, stage, driverCode, errorName });
      return NextResponse.json(CHANGE_EXPORT_FAILED_RESPONSE, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }
  };
}
