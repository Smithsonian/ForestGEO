/**
 * Aggregated Dashboard Metrics API Endpoint
 *
 * This endpoint combines all dashboard metric queries into a single API call,
 * executing them in parallel for optimal performance.
 *
 * Performance Improvement:
 * - Before: 7 sequential API calls (~1200ms)
 * - After: 1 aggregated API call with parallel queries (~300ms)
 * - Result: 3-4x faster dashboard load
 */

import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { auth } from '@/auth';
import { assertSchemaAccess } from '@/lib/authz';
import ailogger from '@/ailogger';

// Force Node.js runtime for database compatibility
export const runtime = 'nodejs';

// A "multi-stem tree" is a tree carrying more than one distinct measured stem in the
// CURRENT census. Requires a measured_stems CTE (TreeTag, StemTag) in scope. Shared by
// the first-census and comparison branches so both always agree on the definition.
const MULTI_STEM_TREES_SUBQUERY = `(SELECT COUNT(*) FROM (
               SELECT TreeTag FROM measured_stems GROUP BY TreeTag HAVING COUNT(DISTINCT StemTag) > 1
             ) multi)`;

function parsePositiveIntegerParam(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

interface DashboardMetrics {
  progressTachometer: {
    TotalQuadrats: number;
    PopulatedQuadrats: number;
    PopulatedPercent: number;
    UnpopulatedQuadrats: string;
  };
  activeUsers: {
    CountActiveUsers: number;
  };
  countTrees: {
    CountTrees: number;
  };
  countStems: {
    CountStems: number;
  };
  stemTypes: {
    // Null (not zero) when there is no previous census to compare against —
    // "old stems" is undefined in that case, whereas zero would falsely claim
    // every stem is brand new relative to a prior census that does not exist.
    CountOldStems: number | null;
    CountMultiStems: number;
    CountNewRecruits: number;
    isFirstCensus: boolean;
  };
}

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const params = await props.params;
  const { schema, plotID: plotIDParam, censusID: censusIDParam } = params;

  // Validate and parse parameters
  if (!schema || !plotIDParam || !censusIDParam) {
    return NextResponse.json({ error: 'Missing required parameters: schema, plotID, and censusID' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Validate schema against whitelist to prevent SQL injection
  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    ailogger.error(`Invalid schema in aggregated dashboard metrics: ${schema}`, error);
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.INVALID_REQUEST });
  }

  // Authorize: ensure the authenticated user has access to this schema
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
  }
  const denied = assertSchemaAccess(session, schema);
  if (denied) return denied;

  const plotID = parsePositiveIntegerParam(plotIDParam);
  const censusID = parsePositiveIntegerParam(censusIDParam);

  if (!plotID || !censusID) {
    return NextResponse.json({ error: 'Invalid plot ID or census ID parameters' }, { status: HTTPResponses.BAD_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    const previousCensusPromise = connectionManager.executeQuery(
      `SELECT MAX(c.CensusID) as PrevCensusID FROM ${schema}.census c WHERE c.PlotID = ? AND c.CensusID < ?`,
      [plotID, censusID]
    );

    // Start independent dashboard reads immediately. These cards are
    // informational and can tolerate eventual consistency.
    const progressTachoPromise = connectionManager.executeQuery(
      `
          WITH measured_quads AS (
            SELECT DISTINCT s.QuadratID
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            JOIN ${schema}.quadrats q2 ON s.QuadratID = q2.QuadratID
            WHERE cm.CensusID = ? AND q2.PlotID = ?
          )
          SELECT
            COUNT(*) AS total_quadrats,
            COUNT(mq.QuadratID) AS populated_quadrats,
            ROUND(COUNT(mq.QuadratID) / NULLIF(COUNT(*),0) * 100, 2) AS populated_pct,
            GROUP_CONCAT(
              CASE WHEN mq.QuadratID IS NULL THEN q.QuadratName END
              ORDER BY q.QuadratName SEPARATOR ';'
            ) AS unpopulated_quadrats
          FROM ${schema}.quadrats q
          LEFT JOIN measured_quads mq ON mq.QuadratID = q.QuadratID
          WHERE q.PlotID = ?
          GROUP BY q.PlotID;
        `,
      [censusID, plotID, plotID]
    );

    const activeUsersPromise = connectionManager.executeQuery(
      `
          SELECT COUNT(p.PersonnelID) as PersonnelCount
          FROM ${schema}.personnel p
          JOIN ${schema}.censusactivepersonnel cap ON p.PersonnelID = cap.PersonnelID
          JOIN ${schema}.census c ON c.CensusID = cap.CensusID
          WHERE c.CensusID = ? AND c.PlotID = ?
        `,
      [censusID, plotID]
    );

    const countTreesPromise = connectionManager.executeQuery(
      `
          SELECT COUNT(t.TreeID) AS CountTrees
          FROM ${schema}.trees t
          JOIN ${schema}.census c ON t.CensusID = c.CensusID
          WHERE t.CensusID = ? AND c.PlotID = ?
        `,
      [censusID, plotID]
    );

    const countStemsPromise = connectionManager.executeQuery(
      `
          SELECT COUNT(st.StemGUID) AS CountStems
          FROM ${schema}.stems st
          JOIN ${schema}.census c ON st.CensusID = c.CensusID
          WHERE st.CensusID = ? AND c.PlotID = ?
        `,
      [censusID, plotID]
    );

    const independentMetricPromises = [progressTachoPromise, activeUsersPromise, countTreesPromise, countStemsPromise] as const;
    const prevCensusResult = await previousCensusPromise.catch(async error => {
      await Promise.allSettled(independentMetricPromises);
      throw error;
    });
    const previousCensusID = prevCensusResult[0]?.PrevCensusID;

    // 5. Stem Types Query - Handle first census (no previous) as a dedicated path.
    // Multi-stem trees are a property of the CURRENT census alone, so we compute
    // them for real here rather than hardcoding zero (which contradicted a
    // stems-per-tree ratio above 1). Only "old stems" is genuinely undefined on a
    // first census and is surfaced as null downstream.
    const isFirstCensus = !previousCensusID;
    let stemTypesPromise: Promise<any[]>;
    if (isFirstCensus) {
      stemTypesPromise = connectionManager.executeQuery(
        `
          WITH measured_stems AS (
            SELECT DISTINCT s.StemGUID, t.TreeTag, s.StemTag
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            JOIN ${schema}.trees t ON s.TreeID = t.TreeID
            WHERE cm.CensusID = ? AND s.CensusID = ?
          )
          SELECT
            ${MULTI_STEM_TREES_SUBQUERY} AS CountMultiStems,
            (SELECT COUNT(DISTINCT CONCAT(TreeTag, '|', StemTag)) FROM measured_stems) AS CountNewRecruits
        `,
        [censusID, censusID]
      );
    } else {
      // Subsequent census: use optimized comparison query with explicit census ID
      stemTypesPromise = connectionManager.executeQuery(
        `
          WITH measured_stems AS (
            SELECT DISTINCT s.StemGUID, t.TreeTag, s.StemTag
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            JOIN ${schema}.trees t ON s.TreeID = t.TreeID
            WHERE cm.CensusID = ? AND s.CensusID = ?
          ),
          previous_stems AS (
            SELECT t_prev.TreeTag, s_prev.StemTag
            FROM ${schema}.trees t_prev
            JOIN ${schema}.stems s_prev ON s_prev.TreeID = t_prev.TreeID
            WHERE t_prev.CensusID = ? AND s_prev.CensusID = ?
              AND t_prev.IsActive = 1 AND s_prev.IsActive = 1
          ),
          previous_trees AS (
            SELECT DISTINCT t_prev.TreeTag
            FROM ${schema}.trees t_prev
            WHERE t_prev.CensusID = ? AND t_prev.IsActive = 1
          )
          SELECT
            COALESCE(SUM(CASE WHEN ps.TreeTag IS NOT NULL THEN 1 ELSE 0 END), 0) as CountOldStems,
            ${MULTI_STEM_TREES_SUBQUERY} as CountMultiStems,
            COALESCE(SUM(CASE WHEN ps.TreeTag IS NULL AND pt.TreeTag IS NULL THEN 1 ELSE 0 END), 0) as CountNewRecruits
          FROM measured_stems ms
          LEFT JOIN previous_stems ps ON ms.TreeTag = ps.TreeTag AND ms.StemTag = ps.StemTag
          LEFT JOIN previous_trees pt ON ms.TreeTag = pt.TreeTag
        `,
        [censusID, censusID, previousCensusID, previousCensusID, previousCensusID]
      );
    }

    const [progressTachoResults, activeUsersResults, countTreesResults, countStemsResults, stemTypesResults] = await Promise.all([
      ...independentMetricPromises,
      stemTypesPromise
    ]);

    // Format response with all metrics
    const metrics: DashboardMetrics = {
      progressTachometer: {
        TotalQuadrats: progressTachoResults[0]?.total_quadrats || 0,
        PopulatedQuadrats: progressTachoResults[0]?.populated_quadrats || 0,
        PopulatedPercent: progressTachoResults[0]?.populated_pct || 0,
        UnpopulatedQuadrats: progressTachoResults[0]?.unpopulated_quadrats || ''
      },
      activeUsers: {
        CountActiveUsers: activeUsersResults[0]?.PersonnelCount || 0
      },
      countTrees: {
        CountTrees: countTreesResults[0]?.CountTrees || 0
      },
      countStems: {
        CountStems: countStemsResults[0]?.CountStems || 0
      },
      stemTypes: {
        CountOldStems: isFirstCensus ? null : (stemTypesResults[0]?.CountOldStems ?? 0),
        CountMultiStems: stemTypesResults[0]?.CountMultiStems ?? 0,
        CountNewRecruits: stemTypesResults[0]?.CountNewRecruits ?? 0,
        isFirstCensus
      }
    };

    ailogger.info(`Aggregated dashboard metrics loaded for schema: ${schema}, plot: ${plotID}, census: ${censusID}`);

    return NextResponse.json(metrics, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Aggregated dashboard metrics error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve aggregated dashboard metrics',
        details: error.message
      },
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
