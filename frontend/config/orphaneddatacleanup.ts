/**
 * Orphaned Data Cleanup Utilities
 *
 * This module provides utilities for detecting and cleaning up orphaned data
 * that can accumulate when uploads are interrupted or connections are lost.
 *
 * The main scenarios this handles:
 * 1. Data in temporarymeasurements without corresponding active session
 * 2. Stale data that has been in temporarymeasurements for too long
 * 3. Failed sessions that were never properly cleaned up
 */

import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';

export interface OrphanedDataStats {
  temporaryMeasurementsCount: number;
  orphanedFileIds: string[];
  staleRecordCount: number;
  failedMeasurementsCount: number;
}

export interface CleanupResult {
  temporaryRowsDeleted: number;
  filesProcessed: string[];
  errors: string[];
}

/**
 * Get statistics about potentially orphaned data
 */
export async function getOrphanedDataStats(schema: string, plotId?: number, censusId?: number): Promise<OrphanedDataStats> {
  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();

    // Count total temporary measurements
    let tempCountQuery = `SELECT COUNT(*) as count FROM ${schema}.temporarymeasurements`;
    const tempCountParams: any[] = [];
    if (plotId && censusId) {
      tempCountQuery += ` WHERE PlotID = ? AND CensusID = ?`;
      tempCountParams.push(plotId, censusId);
    }
    const tempResults = await runQuery(conn, tempCountQuery, tempCountParams);
    const tempCount = Array.isArray(tempResults) && tempResults.length > 0 ? tempResults[0].count : 0;

    // Get distinct FileIDs in temporary measurements
    let fileIdQuery = `SELECT DISTINCT FileID FROM ${schema}.temporarymeasurements`;
    if (plotId && censusId) {
      fileIdQuery += ` WHERE PlotID = ? AND CensusID = ?`;
    }
    const fileIdResults = await runQuery(conn, fileIdQuery, tempCountParams);
    const orphanedFileIds = Array.isArray(fileIdResults) ? fileIdResults.map((r: any) => r.FileID).filter(Boolean) : [];

    // Count failed measurements
    let failedCountQuery = `SELECT COUNT(*) as count FROM ${schema}.failedmeasurements`;
    if (plotId && censusId) {
      failedCountQuery += ` WHERE PlotID = ? AND CensusID = ?`;
    }
    const failedResults = await runQuery(conn, failedCountQuery, tempCountParams);
    const failedCount = Array.isArray(failedResults) && failedResults.length > 0 ? failedResults[0].count : 0;

    return {
      temporaryMeasurementsCount: tempCount,
      orphanedFileIds,
      staleRecordCount: tempCount, // All temp records are potentially stale
      failedMeasurementsCount: failedCount
    };
  } catch (error: any) {
    ailogger.error('[OrphanedDataCleanup] Failed to get stats:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Clean up orphaned temporary measurements for a specific file
 */
export async function cleanupOrphanedTemporaryByFileId(schema: string, fileId: string): Promise<number> {
  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();

    const deleteQuery = `DELETE FROM ${schema}.temporarymeasurements WHERE FileID = ?`;
    const result = await runQuery(conn, deleteQuery, [fileId]);

    const deletedCount = (result as any).affectedRows || 0;
    ailogger.info(`[OrphanedDataCleanup] Deleted ${deletedCount} orphaned rows for FileID: ${fileId}`);

    return deletedCount;
  } catch (error: any) {
    ailogger.error(`[OrphanedDataCleanup] Failed to cleanup FileID ${fileId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Clean up all orphaned temporary measurements for a plot/census
 */
export async function cleanupAllOrphanedTemporary(schema: string, plotId: number, censusId: number): Promise<CleanupResult> {
  const result: CleanupResult = {
    temporaryRowsDeleted: 0,
    filesProcessed: [],
    errors: []
  };

  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();

    // Start transaction
    await runQuery(conn, 'START TRANSACTION');

    // Get FileIDs first
    const fileIdQuery = `SELECT DISTINCT FileID FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`;
    const fileIdResults = await runQuery(conn, fileIdQuery, [plotId, censusId]);
    result.filesProcessed = Array.isArray(fileIdResults) ? fileIdResults.map((r: any) => r.FileID).filter(Boolean) : [];

    // Delete all temporary measurements
    const deleteQuery = `DELETE FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`;
    const deleteResult = await runQuery(conn, deleteQuery, [plotId, censusId]);
    result.temporaryRowsDeleted = (deleteResult as any).affectedRows || 0;

    await runQuery(conn, 'COMMIT');

    ailogger.info(`[OrphanedDataCleanup] Cleaned up ${result.temporaryRowsDeleted} orphaned rows for plot ${plotId}, census ${censusId}`);

    return result;
  } catch (error: any) {
    if (conn) {
      await runQuery(conn, 'ROLLBACK').catch(() => {});
    }
    result.errors.push(error.message);
    ailogger.error('[OrphanedDataCleanup] Cleanup failed:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Check if there is orphaned data that needs cleanup before a new upload
 *
 * Call this before starting a new upload to warn the user or auto-cleanup
 */
export async function checkForOrphanedDataBeforeUpload(
  schema: string,
  plotId: number,
  censusId: number
): Promise<{
  hasOrphanedData: boolean;
  count: number;
  fileIds: string[];
  recommendation: 'none' | 'cleanup' | 'warn';
}> {
  const stats = await getOrphanedDataStats(schema, plotId, censusId);

  if (stats.temporaryMeasurementsCount === 0) {
    return {
      hasOrphanedData: false,
      count: 0,
      fileIds: [],
      recommendation: 'none'
    };
  }

  // If there's orphaned data, recommend cleanup
  return {
    hasOrphanedData: true,
    count: stats.temporaryMeasurementsCount,
    fileIds: stats.orphanedFileIds,
    recommendation: stats.temporaryMeasurementsCount > 1000 ? 'warn' : 'cleanup'
  };
}

/**
 * Auto-cleanup orphaned data if safe to do so
 *
 * Returns true if cleanup was performed, false if user intervention needed
 */
export async function autoCleanupIfSafe(
  schema: string,
  plotId: number,
  censusId: number,
  maxAutoCleanupRows: number = 500
): Promise<{ cleaned: boolean; rowsCleaned: number; needsUserConfirmation: boolean }> {
  const check = await checkForOrphanedDataBeforeUpload(schema, plotId, censusId);

  if (!check.hasOrphanedData) {
    return { cleaned: false, rowsCleaned: 0, needsUserConfirmation: false };
  }

  // Only auto-cleanup if within safe threshold
  if (check.count <= maxAutoCleanupRows) {
    try {
      const result = await cleanupAllOrphanedTemporary(schema, plotId, censusId);
      ailogger.info(`[OrphanedDataCleanup] Auto-cleaned ${result.temporaryRowsDeleted} orphaned rows`);
      return { cleaned: true, rowsCleaned: result.temporaryRowsDeleted, needsUserConfirmation: false };
    } catch (error: unknown) {
      ailogger.error('[OrphanedDataCleanup] Auto-cleanup failed:', error instanceof Error ? error : new Error(String(error)));
      return { cleaned: false, rowsCleaned: 0, needsUserConfirmation: true };
    }
  }

  // Too many rows - need user confirmation
  return { cleaned: false, rowsCleaned: 0, needsUserConfirmation: true };
}

/**
 * Run the collapser procedure if there is data in temporarymeasurements
 * that appears to be fully processed but collapser wasn't run
 *
 * This is a recovery operation for when client disconnects after processing
 * but before collapser
 */
export async function runRecoveryCollapser(schema: string, censusId: number): Promise<{ success: boolean; message: string }> {
  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();

    // Check if there's data that needs collapsing
    const checkQuery = `
      SELECT COUNT(*) as count
      FROM ${schema}.coremeasurements cm
      WHERE cm.CensusID = ?
        AND EXISTS (
          SELECT 1 FROM ${schema}.trees t
          WHERE t.CensusID IS NULL
        )
    `;
    const checkResult = await runQuery(conn, checkQuery, [censusId]);
    const needsCollapsing = Array.isArray(checkResult) && checkResult.length > 0 && checkResult[0].count > 0;

    if (!needsCollapsing) {
      // Also check temporarymeasurements
      const tempCheckQuery = `SELECT COUNT(*) as count FROM ${schema}.temporarymeasurements WHERE CensusID = ?`;
      const tempResult = await runQuery(conn, tempCheckQuery, [censusId]);
      const hasTempData = Array.isArray(tempResult) && tempResult.length > 0 && tempResult[0].count > 0;

      if (!hasTempData) {
        return { success: true, message: 'No data needs recovery collapsing' };
      }
    }

    // Run the collapser
    ailogger.info(`[OrphanedDataCleanup] Running recovery collapser for census ${censusId}`);
    const collapserQuery = `CALL ${schema}.bulkingestioncollapser(?)`;
    await runQuery(conn, collapserQuery, [censusId]);

    return { success: true, message: 'Recovery collapser completed successfully' };
  } catch (error: any) {
    ailogger.error('[OrphanedDataCleanup] Recovery collapser failed:', error);
    return { success: false, message: `Recovery collapser failed: ${error.message}` };
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Comprehensive pre-upload check and cleanup
 *
 * Call this before any upload to ensure clean state
 */
export async function prepareForUpload(
  schema: string,
  plotId: number,
  censusId: number,
  options: {
    autoCleanup?: boolean;
    maxAutoCleanupRows?: number;
    runRecoveryCollapser?: boolean;
  } = {}
): Promise<{
  ready: boolean;
  orphanedDataFound: boolean;
  orphanedDataCleaned: boolean;
  rowsCleaned: number;
  recoveryCollapserRun: boolean;
  warnings: string[];
  errors: string[];
}> {
  const { autoCleanup = true, maxAutoCleanupRows = 500, runRecoveryCollapser: shouldRunCollapser = true } = options;

  const result = {
    ready: true,
    orphanedDataFound: false,
    orphanedDataCleaned: false,
    rowsCleaned: 0,
    recoveryCollapserRun: false,
    warnings: [] as string[],
    errors: [] as string[]
  };

  try {
    // Step 1: Check for orphaned data
    const check = await checkForOrphanedDataBeforeUpload(schema, plotId, censusId);
    result.orphanedDataFound = check.hasOrphanedData;

    if (check.hasOrphanedData) {
      result.warnings.push(`Found ${check.count} orphaned temporary measurements`);

      // Step 2: Auto-cleanup if enabled and safe
      if (autoCleanup) {
        const cleanupResult = await autoCleanupIfSafe(schema, plotId, censusId, maxAutoCleanupRows);

        if (cleanupResult.cleaned) {
          result.orphanedDataCleaned = true;
          result.rowsCleaned = cleanupResult.rowsCleaned;
        } else if (cleanupResult.needsUserConfirmation) {
          result.ready = false;
          result.warnings.push(`Too many orphaned rows (${check.count}) - user confirmation required`);
        }
      } else {
        result.ready = false;
        result.warnings.push('Orphaned data found but auto-cleanup is disabled');
      }
    }

    // Step 3: Run recovery collapser if needed
    if (shouldRunCollapser) {
      const collapserResult = await runRecoveryCollapser(schema, censusId);
      result.recoveryCollapserRun = collapserResult.success;
      if (!collapserResult.success) {
        result.warnings.push(collapserResult.message);
      }
    }

    return result;
  } catch (error: any) {
    result.ready = false;
    result.errors.push(error.message);
    return result;
  }
}
