import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ErrorExplorerQueryRequest } from '@/config/errorsexplorer';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { buildErrorExportRows, fetchGroupedErrorRows } from '../_shared';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import ailogger from '@/ailogger';
import { z } from 'zod';

export const runtime = 'nodejs';

type ErrorExplorerExportRequest = Pick<ErrorExplorerQueryRequest, 'schema' | 'plotID' | 'censusID' | 'censusIDs' | 'filters'>;

const MAX_EXPORT_CENSUS_IDS = 25;
const boundedStrings = z.array(z.string().max(1_000)).max(100);
const exportRequestSchema = z
  .object({
    schema: z.string().refine(isValidSchema, 'Invalid schema'),
    plotID: z.coerce.number().int().positive(),
    censusID: z.coerce.number().int().positive(),
    censusIDs: z.array(z.coerce.number().int().positive()).max(MAX_EXPORT_CENSUS_IDS).optional().default([]),
    filters: z
      .object({
        source: z.enum(['all', 'validation', 'ingestion']).optional().default(DEFAULT_ERROR_EXPLORER_FILTERS.source),
        exactMessages: boundedStrings.optional().default([]),
        affectedFields: boundedStrings.optional().default([]),
        contradictionOnly: z.boolean().optional().default(false),
        contradictionTypes: z
          .array(z.enum(['duplicate_tag_stem', 'same_batch_conflict']))
          .max(2)
          .optional()
          .default([]),
        quickSearch: z.string().max(500).optional().default(''),
        presetId: z.string().max(100).optional()
      })
      .optional()
      .default(DEFAULT_ERROR_EXPLORER_FILTERS)
  })
  .strict();

function parseRequest(body: z.infer<typeof exportRequestSchema>): ErrorExplorerExportRequest {
  return {
    schema: body.schema ?? '',
    plotID: Number(body.plotID ?? 0),
    censusID: Number(body.censusID ?? 0),
    censusIDs: Array.from(new Set((body.censusIDs ?? []).map(Number).filter(censusID => Number.isInteger(censusID) && censusID > 0))),
    filters: {
      ...DEFAULT_ERROR_EXPLORER_FILTERS,
      ...body.filters,
      exactMessages: body.filters?.exactMessages ?? [],
      affectedFields: body.filters?.affectedFields ?? [],
      contradictionTypes: body.filters?.contradictionTypes ?? []
    }
  };
}

async function handler(request: NextRequest, _context: RouteContext) {
  const connectionManager = ConnectionManager.getInstance();
  const startedAt = Date.now();

  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid export request', code: 'INVALID_EXPORT_REQUEST' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    const parsed = exportRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      ailogger.warn('Rejected invalid errors explorer export request', {
        issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code }))
      });
      return NextResponse.json({ error: 'Invalid export request', code: 'INVALID_EXPORT_REQUEST' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    const body = parseRequest(parsed.data);

    const groupedRows = await fetchGroupedErrorRows(connectionManager, body.schema, body.plotID, body.censusIDs?.length ? body.censusIDs : body.censusID);
    const exportRows = buildErrorExportRows(groupedRows, body.filters);
    // Excel and other spreadsheet applications execute cells beginning with
    // formula sigils. Every exported text field can ultimately be upload/user
    // controlled, so force Papa Parse's formula escaping for all rows.
    const csv = Papa.unparse(exportRows, { escapeFormulae: true });
    const date = new Date().toISOString().slice(0, 10);
    const filename = `errors-${body.schema}-plot${body.plotID}-census${body.censusID}-${date}.csv`;
    const censusCount = body.censusIDs?.length || 1;
    ailogger.event('ErrorExplorerCsvExported', {
      schema: body.schema,
      plotID: body.plotID,
      censusCount,
      rowCount: exportRows.length,
      durationMs: Date.now() - startedAt,
      outputBytes: Buffer.byteLength(csv, 'utf8')
    });

    return new NextResponse(csv, {
      status: HTTPResponses.OK,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error exporting errors explorer CSV:', errorObj);
    return NextResponse.json({ error: 'Unable to export errors', code: 'ERROR_EXPORT_FAILED' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    try {
      await connectionManager.closeConnection();
    } catch (cleanupError: unknown) {
      const errorObj = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
      ailogger.error('Failed to close the errors explorer export database connection:', errorObj);
    }
  }
}

export const POST = withRouteAuthz('errors/explorer/export', handler, { schema: fromBody('schema') });
