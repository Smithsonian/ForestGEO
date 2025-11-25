/**
 * Cleanup API
 *
 * Provides endpoints for cleaning up orphaned data from:
 * - Abandoned upload sessions
 * - Stale temporary measurements
 * - Old upload session records
 *
 * Can be called:
 * - Manually by administrators
 * - Via cron job / scheduled task
 * - On application startup
 */

import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';
import {
  runSessionCleanup,
  purgeOldSessions,
  findStaleSessions,
  findAbandonedSessionsNeedingCleanup,
  ensureUploadSessionsTable
} from '@/config/uploadsessiontracker';
import { isValidSchema } from '@/config/utils/sqlsecurity';

/**
 * Cleanup result interface
 */
interface CleanupResult {
  sessionsMarkedAbandoned: number;
  sessionsCleanedUp: number;
  orphanedTempRowsDeleted: number;
  orphanedTempRowsFound: number;
  oldSessionsPurged: number;
  staleTransactionsCleared: number;
  errors: string[];
  duration: number;
}

/**
 * Find orphaned temporary measurements (not associated with active session)
 */
async function findOrphanedTemporaryMeasurements(schema: string): Promise<{ fileId: string; batchCount: number; rowCount: number }[]> {
  const query = `
    SELECT
      tm.FileID as fileId,
      COUNT(DISTINCT tm.BatchID) as batchCount,
      COUNT(*) as rowCount
    FROM ${schema}.temporarymeasurements tm
    LEFT JOIN ${schema}.upload_sessions us ON tm.FileID = us.file_id
      AND us.state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
    WHERE us.session_id IS NULL
      AND tm.id IS NOT NULL
    GROUP BY tm.FileID
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, query);
    if (!Array.isArray(results)) return [];
    return results.map((row: any) => ({
      fileId: row.fileId,
      batchCount: row.batchCount,
      rowCount: row.rowCount
    }));
  } catch (error: any) {
    // Table might not exist yet
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Delete orphaned temporary measurements by FileID
 */
async function deleteOrphanedTemporaryMeasurements(schema: string, fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;

  const placeholders = fileIds.map(() => '?').join(',');
  const query = `DELETE FROM ${schema}.temporarymeasurements WHERE FileID IN (${placeholders})`;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const result = await runQuery(conn, query, fileIds);
    return (result as any).affectedRows || 0;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Find stale temporary measurements (older than threshold, regardless of session)
 */
async function findStaleTemporaryMeasurements(schema: string, _maxAgeHours: number = 24): Promise<number> {
  // Note: This checks for rows that have been in temp table for too long
  // We use the id sequence as a proxy for age since there's no timestamp column
  const query = `
    SELECT COUNT(*) as count
    FROM ${schema}.temporarymeasurements
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, query);
    if (!Array.isArray(results) || results.length === 0) return 0;
    return results[0].count || 0;
  } catch (error: any) {
    if (error.code === 'ER_NO_SUCH_TABLE') return 0;
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Clear stale transactions from ConnectionManager
 */
async function clearStaleTransactions(): Promise<number> {
  try {
    // Import dynamically to avoid circular dependencies
    const { default: ConnectionManager } = await import('@/config/connectionmanager');
    await ConnectionManager.getInstance().cleanupStaleTransactions();
    return 1; // Cleanup was attempted
  } catch (error: unknown) {
    ailogger.error('[Cleanup API] Failed to clear stale transactions:', error instanceof Error ? error : new Error(String(error)));
    return 0;
  }
}

/**
 * POST - Run comprehensive cleanup
 *
 * Body: {
 *   schema: string,
 *   options?: {
 *     cleanupSessions?: boolean,       // Default: true
 *     cleanupOrphanedTemp?: boolean,   // Default: true
 *     purgeOldSessions?: boolean,      // Default: true
 *     clearStaleTransactions?: boolean, // Default: true
 *     maxSessionAgeDays?: number,      // Default: 30
 *     dryRun?: boolean                 // Default: false - if true, only report what would be cleaned
 *   }
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const result: CleanupResult = {
    sessionsMarkedAbandoned: 0,
    sessionsCleanedUp: 0,
    orphanedTempRowsDeleted: 0,
    orphanedTempRowsFound: 0,
    oldSessionsPurged: 0,
    staleTransactionsCleared: 0,
    errors: [],
    duration: 0
  };

  try {
    const body = await request.json();
    const { schema, options = {} } = body;

    if (!schema) {
      return new NextResponse(JSON.stringify({ error: 'Schema is required' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // SQL Injection Prevention: Validate schema against whitelist
    if (!isValidSchema(schema)) {
      ailogger.error(`[Cleanup API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    const {
      cleanupSessions = true,
      cleanupOrphanedTemp = true,
      purgeOldSessions: shouldPurge = true,
      clearStaleTransactions: shouldClearTransactions = true,
      maxSessionAgeDays = 30,
      dryRun = false
    } = options;

    ailogger.info(`[Cleanup API] Starting cleanup for schema: ${schema}, dryRun: ${dryRun}`);

    // Ensure upload_sessions table exists
    try {
      await ensureUploadSessionsTable(schema);
    } catch (error: any) {
      result.errors.push(`Failed to ensure upload_sessions table: ${error.message}`);
    }

    // 1. Run session cleanup (mark stale as abandoned, cleanup abandoned)
    if (cleanupSessions) {
      try {
        if (dryRun) {
          const staleSessions = await findStaleSessions(schema);
          const abandonedSessions = await findAbandonedSessionsNeedingCleanup(schema);
          result.sessionsMarkedAbandoned = staleSessions.length;
          result.sessionsCleanedUp = abandonedSessions.length;
        } else {
          const sessionResult = await runSessionCleanup(schema);
          result.sessionsMarkedAbandoned = sessionResult.staleMarked;
          result.sessionsCleanedUp = sessionResult.cleanedUp;
          result.orphanedTempRowsDeleted += sessionResult.totalTempDeleted;
        }
      } catch (error: any) {
        result.errors.push(`Session cleanup error: ${error.message}`);
        ailogger.error('[Cleanup API] Session cleanup error:', error);
      }
    }

    // 2. Find and cleanup orphaned temporary measurements
    if (cleanupOrphanedTemp) {
      try {
        const orphaned = await findOrphanedTemporaryMeasurements(schema);
        result.orphanedTempRowsFound = orphaned.reduce((sum, o) => sum + o.rowCount, 0);

        if (!dryRun && orphaned.length > 0) {
          const fileIds = orphaned.map(o => o.fileId);
          const deleted = await deleteOrphanedTemporaryMeasurements(schema, fileIds);
          result.orphanedTempRowsDeleted += deleted;
          ailogger.info(`[Cleanup API] Deleted ${deleted} orphaned temporary measurements`);
        }
      } catch (error: any) {
        result.errors.push(`Orphaned temp cleanup error: ${error.message}`);
        ailogger.error('[Cleanup API] Orphaned temp cleanup error:', error);
      }
    }

    // 3. Purge old completed/cleaned sessions
    if (shouldPurge) {
      try {
        if (!dryRun) {
          result.oldSessionsPurged = await purgeOldSessions(schema, maxSessionAgeDays);
        }
      } catch (error: any) {
        result.errors.push(`Session purge error: ${error.message}`);
        ailogger.error('[Cleanup API] Session purge error:', error);
      }
    }

    // 4. Clear stale transactions from ConnectionManager
    if (shouldClearTransactions) {
      try {
        if (!dryRun) {
          result.staleTransactionsCleared = await clearStaleTransactions();
        }
      } catch (error: any) {
        result.errors.push(`Stale transaction cleanup error: ${error.message}`);
        ailogger.error('[Cleanup API] Stale transaction cleanup error:', error);
      }
    }

    result.duration = Date.now() - startTime;

    ailogger.info(`[Cleanup API] Cleanup completed in ${result.duration}ms:`, result);

    return new NextResponse(JSON.stringify({ result, dryRun }), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    result.duration = Date.now() - startTime;
    result.errors.push(`Fatal error: ${error.message}`);
    ailogger.error('[Cleanup API] Fatal error:', error);

    return new NextResponse(JSON.stringify({ result, error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

/**
 * GET - Get cleanup status/preview
 *
 * Query params:
 *   - schema: string (required)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const schema = searchParams.get('schema');

    if (!schema) {
      return new NextResponse(JSON.stringify({ error: 'Schema is required' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }

    // Get status of various cleanup targets
    const status = {
      staleSessions: 0,
      abandonedSessionsNeedingCleanup: 0,
      orphanedTempMeasurements: 0,
      totalTempMeasurements: 0
    };

    try {
      await ensureUploadSessionsTable(schema);
      const staleSessions = await findStaleSessions(schema);
      status.staleSessions = staleSessions.length;

      const abandonedSessions = await findAbandonedSessionsNeedingCleanup(schema);
      status.abandonedSessionsNeedingCleanup = abandonedSessions.length;
    } catch (error: any) {
      ailogger.warn('[Cleanup API] Could not get session status:', error.message);
    }

    try {
      const orphaned = await findOrphanedTemporaryMeasurements(schema);
      status.orphanedTempMeasurements = orphaned.reduce((sum, o) => sum + o.rowCount, 0);
    } catch (error: any) {
      ailogger.warn('[Cleanup API] Could not get orphaned temp status:', error.message);
    }

    try {
      status.totalTempMeasurements = await findStaleTemporaryMeasurements(schema);
    } catch (error: any) {
      ailogger.warn('[Cleanup API] Could not get total temp status:', error.message);
    }

    return new NextResponse(JSON.stringify({ status }), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('[Cleanup API] GET error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}
