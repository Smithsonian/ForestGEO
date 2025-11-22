/**
 * Startup Cleanup Module
 *
 * This module provides cleanup functionality that should run:
 * 1. On application startup
 * 2. Periodically during runtime
 * 3. Before critical operations
 *
 * It ensures that orphaned data from previous crashed sessions is cleaned up.
 */

import ailogger from '@/ailogger';
import { runSessionCleanup, purgeOldSessions, ensureUploadSessionsTable } from './uploadsessiontracker';
import ConnectionManager from './connectionmanager';

let cleanupIntervalHandle: NodeJS.Timeout | null = null;
let isCleanupRunning = false;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run cleanup every 5 minutes

/**
 * Available schemas that may have upload sessions
 * This should be configured based on your deployment
 */
const KNOWN_SCHEMAS = ['forestgeo_panama', 'forestgeo_harvard', 'forestgeo_mpala', 'forestgeo_serc', 'forestgeo_testing'];

/**
 * Run cleanup for a single schema
 */
async function cleanupSchema(schema: string): Promise<{
  success: boolean;
  staleMarked: number;
  cleanedUp: number;
  tempDeleted: number;
  errors: string[];
}> {
  const result = {
    success: true,
    staleMarked: 0,
    cleanedUp: 0,
    tempDeleted: 0,
    errors: [] as string[]
  };

  try {
    // Ensure table exists
    await ensureUploadSessionsTable(schema);

    // Run session cleanup
    const cleanupResult = await runSessionCleanup(schema);
    result.staleMarked = cleanupResult.staleMarked;
    result.cleanedUp = cleanupResult.cleanedUp;
    result.tempDeleted = cleanupResult.totalTempDeleted;

    // Purge old sessions (older than 30 days)
    await purgeOldSessions(schema, 30);
  } catch (error: any) {
    result.success = false;
    result.errors.push(`${schema}: ${error.message}`);
  }

  return result;
}

/**
 * Run cleanup across all known schemas
 */
export async function runGlobalCleanup(): Promise<{
  schemasProcessed: number;
  totalStaleMarked: number;
  totalCleanedUp: number;
  totalTempDeleted: number;
  errors: string[];
}> {
  if (isCleanupRunning) {
    ailogger.info('[StartupCleanup] Cleanup already in progress, skipping');
    return {
      schemasProcessed: 0,
      totalStaleMarked: 0,
      totalCleanedUp: 0,
      totalTempDeleted: 0,
      errors: ['Cleanup already in progress']
    };
  }

  isCleanupRunning = true;
  const startTime = Date.now();

  const result = {
    schemasProcessed: 0,
    totalStaleMarked: 0,
    totalCleanedUp: 0,
    totalTempDeleted: 0,
    errors: [] as string[]
  };

  try {
    // Also cleanup stale transactions in ConnectionManager
    try {
      await ConnectionManager.getInstance().cleanupStaleTransactions();
    } catch (error: any) {
      result.errors.push(`Transaction cleanup: ${error.message}`);
    }

    // Run cleanup for each schema
    for (const schema of KNOWN_SCHEMAS) {
      try {
        const schemaResult = await cleanupSchema(schema);
        result.schemasProcessed++;
        result.totalStaleMarked += schemaResult.staleMarked;
        result.totalCleanedUp += schemaResult.cleanedUp;
        result.totalTempDeleted += schemaResult.tempDeleted;
        result.errors.push(...schemaResult.errors);
      } catch (error: any) {
        result.errors.push(`${schema}: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    ailogger.info(`[StartupCleanup] Global cleanup completed in ${duration}ms:`, {
      schemasProcessed: result.schemasProcessed,
      staleMarked: result.totalStaleMarked,
      cleanedUp: result.totalCleanedUp,
      tempDeleted: result.totalTempDeleted,
      errors: result.errors.length
    });
  } finally {
    isCleanupRunning = false;
  }

  return result;
}

/**
 * Start periodic cleanup
 */
export function startPeriodicCleanup(): void {
  if (cleanupIntervalHandle) {
    ailogger.warn('[StartupCleanup] Periodic cleanup already running');
    return;
  }

  ailogger.info(`[StartupCleanup] Starting periodic cleanup (interval: ${CLEANUP_INTERVAL_MS}ms)`);

  // Run initial cleanup
  runGlobalCleanup().catch(error => {
    ailogger.error('[StartupCleanup] Initial cleanup failed:', error);
  });

  // Schedule periodic cleanup
  cleanupIntervalHandle = setInterval(() => {
    runGlobalCleanup().catch(error => {
      ailogger.error('[StartupCleanup] Periodic cleanup failed:', error);
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop periodic cleanup
 */
export function stopPeriodicCleanup(): void {
  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    ailogger.info('[StartupCleanup] Periodic cleanup stopped');
  }
}

/**
 * Run cleanup for a specific schema (can be called from API)
 */
export async function cleanupSpecificSchema(schema: string): Promise<{
  success: boolean;
  staleMarked: number;
  cleanedUp: number;
  tempDeleted: number;
  errors: string[];
}> {
  return cleanupSchema(schema);
}

/**
 * Get cleanup status
 */
export function getCleanupStatus(): {
  isRunning: boolean;
  periodicEnabled: boolean;
  intervalMs: number;
  knownSchemas: string[];
} {
  return {
    isRunning: isCleanupRunning,
    periodicEnabled: cleanupIntervalHandle !== null,
    intervalMs: CLEANUP_INTERVAL_MS,
    knownSchemas: KNOWN_SCHEMAS
  };
}
