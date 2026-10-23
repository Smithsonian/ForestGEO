import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getConn } from '@/lib/db/primitives';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS, type ErrorExplorerFacetsResponse } from '@/config/errorsexplorer';
import { CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM, TOP_ERROR_TYPE_LIMIT, type CensusOverviewSummary, type ExportSkipReasonCount } from '@/config/censusoverview';
import {
  countExportedRowsWithUnresolvedErrors,
  countExportSkipReasons,
  countPublishBlockers,
  isBlockingPreconditionKind,
  type PublishBlockerCount
} from '@/lib/ctfs-export';
import { parseCensusOverviewSummaryRequest, type CensusOverviewSummaryRequest } from '@/lib/censusoverview/summaryrequest';
import { buildErrorExplorerFacets } from '@/app/api/errors/explorer/_shared';
import ailogger from '@/ailogger';

// mysql2 and the facets builder need the Node.js runtime.
export const runtime = 'nodejs';

const REPEATABLE_READ_STATEMENT = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ';
const CENSUS_NOT_FOUND_MESSAGE = 'Census not found';
const SUMMARY_FAILED_MESSAGE = 'Failed to build the census overview summary';

interface PublishScopeSnapshot {
  blockers: PublishBlockerCount[];
  exportableCount: number;
  totalActiveCount: number;
  skipReasons: ExportSkipReasonCount[];
  exportedWithUnresolvedErrorCount: number;
  errorsScopeActiveMeasurements: number;
}

function routeParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Every publish-scope count plus the errors-scope denominator, read in ONE
 * REPEATABLE READ snapshot on one connection (the publish route's pattern).
 * Returns null when any census in the errors scope is not an active census of
 * the plot. Read-only: the transaction is always rolled back.
 */
async function readPublishScopeSnapshot({ schema, plotID, censusID, errorCensusIDs }: CensusOverviewSummaryRequest): Promise<PublishScopeSnapshot | null> {
  const conn = await getConn();
  let transactionActive = false;
  try {
    await conn.query(REPEATABLE_READ_STATEMENT);
    await conn.beginTransaction();
    transactionActive = true;

    const censusIDPlaceholders = buildInPlaceholders(errorCensusIDs.length);
    const [censusRows] = await conn.query<RowDataPacket[]>(
      safeFormatQuery(schema, `SELECT CensusID FROM ??.census WHERE PlotID = ? AND IsActive = 1 AND CensusID IN (${censusIDPlaceholders})`),
      [plotID, ...errorCensusIDs]
    );
    const activeCensusIDs = new Set(censusRows.map(row => Number(row.CensusID)));
    if (errorCensusIDs.some(id => !activeCensusIDs.has(id))) return null;

    const publishInput = { schema, plotId: plotID, censusId: censusID };
    const { blockers, count, totalActiveCount } = await countPublishBlockers(conn, publishInput, isBlockingPreconditionKind);
    const skipReasons = await countExportSkipReasons(conn, publishInput);
    const exportedWithUnresolvedErrorCount = await countExportedRowsWithUnresolvedErrors(conn, publishInput);
    const [activeRows] = await conn.query<RowDataPacket[]>(
      safeFormatQuery(
        schema,
        `SELECT COUNT(*) AS n
           FROM ??.coremeasurements cm
           JOIN ??.census c ON c.CensusID = cm.CensusID
          WHERE c.PlotID = ? AND cm.IsActive = 1 AND cm.CensusID IN (${censusIDPlaceholders})`
      ),
      [plotID, ...errorCensusIDs]
    );

    return {
      blockers,
      exportableCount: count,
      totalActiveCount,
      skipReasons,
      exportedWithUnresolvedErrorCount,
      errorsScopeActiveMeasurements: Number(activeRows[0].n)
    };
  } finally {
    if (transactionActive) {
      try {
        await conn.rollback();
      } catch (rollbackError: unknown) {
        ailogger.error('Census overview summary rollback failed', toError(rollbackError), { schema, plotID, censusID });
        conn.destroy();
      }
    }
    conn.release();
  }
}

function toCensusOverviewSummary(snapshot: PublishScopeSnapshot, facets: ErrorExplorerFacetsResponse): CensusOverviewSummary {
  return {
    errorOverview: {
      affectedMeasurements: facets.totalMeasurements,
      totalActiveMeasurements: snapshot.errorsScopeActiveMeasurements,
      topErrorTypes: facets.messages.slice(0, TOP_ERROR_TYPE_LIMIT).map(option => ({ message: option.value, count: option.count })),
      remainingErrorTypeCount: Math.max(facets.messages.length - TOP_ERROR_TYPE_LIMIT, 0)
    },
    exportPreview: {
      totalActiveMeasurements: snapshot.totalActiveCount,
      exportableCount: snapshot.exportableCount,
      skippedCount: snapshot.totalActiveCount - snapshot.exportableCount,
      skipReasons: snapshot.skipReasons,
      exportedWithUnresolvedErrorCount: snapshot.exportedWithUnresolvedErrorCount
    },
    blockers: snapshot.blockers
  };
}

async function handler(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const params = await context.params;
  const parsed = parseCensusOverviewSummaryRequest({
    schema: routeParam(params.schema),
    plotID: routeParam(params.plotID),
    censusID: routeParam(params.censusID),
    errorCensusIDs: request.nextUrl.searchParams.get(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM)
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: HTTPResponses.INVALID_REQUEST });
  }
  const summaryRequest = parsed.request;
  const logContext = { ...summaryRequest };

  let snapshot: PublishScopeSnapshot | null;
  try {
    snapshot = await readPublishScopeSnapshot(summaryRequest);
  } catch (error: unknown) {
    ailogger.error('Census overview summary snapshot failed', toError(error), logContext);
    return NextResponse.json({ error: SUMMARY_FAILED_MESSAGE }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
  if (!snapshot) {
    return NextResponse.json({ error: CENSUS_NOT_FOUND_MESSAGE }, { status: HTTPResponses.NOT_FOUND });
  }

  // Runs after the snapshot is rolled back: the facets read measurementssummary
  // through ConnectionManager, exactly as the Errors page does (spec Known risks).
  const connectionManager = ConnectionManager.getInstance();
  try {
    const facets = await buildErrorExplorerFacets(connectionManager, {
      schema: summaryRequest.schema,
      plotID: summaryRequest.plotID,
      censusID: summaryRequest.censusID,
      censusIDs: summaryRequest.errorCensusIDs,
      filters: DEFAULT_ERROR_EXPLORER_FILTERS
    });
    return NextResponse.json(toCensusOverviewSummary(snapshot, facets), { status: HTTPResponses.OK });
  } catch (error: unknown) {
    ailogger.error('Census overview error overview failed', toError(error), logContext);
    return NextResponse.json({ error: SUMMARY_FAILED_MESSAGE }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const GET = withRouteAuthz('censusoverview/summary/[schema]/[plotID]/[censusID]', handler, { schema: fromPath('schema') });
