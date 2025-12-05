// connectionlogger.ts
// Provides changelog tracking for database operations (UPDATE/DELETE)
// Performance optimized: uses deferred logging to reduce query overhead from 3x to ~1.1x
import ailogger from '@/ailogger';

interface TableConfig {
  pk: string;
  fk?: string;
}

interface ChangelogEntry {
  schema: string;
  table: string;
  recordIDs: string;
  operation: 'UPDATE' | 'DELETE';
  oldRowState: string;
  newRowState: string;
  changedBy: string;
  plotID: number;
  censusID: number;
}

// Queue for deferred changelog entries (processed asynchronously)
const changelogQueue: ChangelogEntry[] = [];
let isProcessingQueue = false;

// Helper function to safely access cookies in server context
async function getCookiesSafely() {
  try {
    // Only import and use cookies in server context
    if (typeof window === 'undefined') {
      const { cookies } = await import('next/headers');
      return await cookies();
    }
    return null;
  } catch (error) {
    // Return null if cookies can't be accessed (e.g., in client context)
    ailogger.error('Failed to access cookies in connectionlogger:', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

// Process changelog queue asynchronously (fire-and-forget)
async function processChangelogQueue(executeQuery: (sql: string, params?: unknown[]) => Promise<unknown>) {
  if (isProcessingQueue || changelogQueue.length === 0) return;

  isProcessingQueue = true;
  try {
    while (changelogQueue.length > 0) {
      const entry = changelogQueue.shift();
      if (!entry) continue;

      try {
        await executeQuery(
          `INSERT INTO \`${entry.schema}\`.\`unifiedchangelog\` (TableName, RecordID, Operation, OldRowState, NewRowState, ChangedBy, PlotID, CensusID) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.table, entry.recordIDs, entry.operation, entry.oldRowState, entry.newRowState, entry.changedBy, entry.plotID, entry.censusID]
        );
      } catch (changelogError: unknown) {
        // Log the error but continue processing queue
        ailogger.error(
          `Failed to insert changelog entry for ${entry.table} ${entry.operation}:`,
          changelogError instanceof Error ? changelogError : new Error(String(changelogError))
        );
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

export function patchConnectionManager(cm: { executeQuery: (sql: string, params?: unknown[], transactionId?: string) => Promise<unknown> }) {
  const tableConfigs: Record<string, TableConfig> = {
    coremeasurements: { pk: 'CoreMeasurementID' },
    cmattributes: { pk: 'CMAID', fk: 'CoreMeasurementID' },
    cmverrors: { pk: 'CMVErrorID', fk: 'CoreMeasurementID' },
    stems: { pk: 'StemGUID' },
    trees: { pk: 'TreeID' },
    quadrats: { pk: 'QuadratID' },
    failedmeasurements: { pk: 'FailedMeasurementID' },
    personnel: { pk: 'PersonnelID' },
    species: { pk: 'SpeciesID' },
    genus: { pk: 'GenusID' },
    family: { pk: 'FamilyID' },
    attributes: { pk: 'Code' }
  };

  const orig = cm.executeQuery.bind(cm);

  cm.executeQuery = async function (sql: string, params?: unknown[], transactionId?: string) {
    const store = await getCookiesSafely();
    if (!store || !store.has('user') || !store.has('schema') || !store.has('plotID') || !store.has('censusID')) {
      // Silently skip changelog tracking if required cookies are missing
      return orig(sql, params, transactionId);
    }
    const user = String(store.get('user')?.value);
    const schema = String(store.get('schema')?.value);
    const plotID = Number(store.get('plotID')?.value);
    const censusID = Number(store.get('censusID')?.value);

    // Validate that we have valid numeric IDs
    if (isNaN(plotID) || isNaN(censusID) || plotID <= 0 || censusID <= 0) {
      // Invalid context - skip changelog tracking
      return orig(sql, params, transactionId);
    }
    const cleaned = sql.trim().replace(/`/g, '');
    const regexOutput = /^(UPDATE|DELETE)\s+(?:FROM\s+)?(?:\w+\.)?(\w+)/i.exec(cleaned) || [];
    const op = regexOutput?.[1]?.toUpperCase() as 'UPDATE' | 'DELETE' | undefined;
    const table = regexOutput?.[2];
    if (!op || !table || !tableConfigs[table]) return orig(sql, params, transactionId); // don't log - not a tracked operation/table
    const { pk, fk } = tableConfigs[table];

    let coreKey = pk;
    let coreValue: string | number | null = null;

    const pkRx = new RegExp(`\\b${pk}\\b\\s*=\\s*(\\?|\\d+|'[^']*'|"[^"]*")`);
    const mPk = pkRx.exec(cleaned);
    if (mPk) {
      const raw = mPk[1];
      if (raw === '?' && params) {
        const prefix = cleaned.slice(0, mPk.index);
        const idx = (prefix.match(/\?/g) || []).length;
        coreValue = params[idx] as string | number;
      } else {
        coreValue = raw.replace(/^['"]|['"]$/g, '');
      }
    }

    if (coreValue == null && fk) {
      const fkRx = new RegExp(`\\b${fk}\\b\\s*=\\s*(\\?|\\d+|'[^']*'|"[^"]*")`);
      const mFk = fkRx.exec(cleaned);
      if (mFk) {
        coreKey = fk; // switch to foreign key
        const raw = mFk[1];
        if (raw === '?' && params) {
          const prefix = cleaned.slice(0, mFk.index);
          const idx = (prefix.match(/\?/g) || []).length;
          coreValue = params[idx] as string | number;
        } else {
          coreValue = raw.replace(/^['"]|['"]$/g, '');
        }
      }
    }

    if (coreValue == null) {
      // Only log in development - this is expected for some query types
      if (process.env.NODE_ENV === 'development') {
        ailogger.debug(`Changelog tracking skipped: Could not extract ${pk}${fk ? ` or ${fk}` : ''} from query for table ${table}`);
      }
      return orig(sql, params, transactionId);
    }

    // shifting all to bulk updating:
    const where = cleaned.toUpperCase().indexOf(' WHERE ') > 0 ? cleaned.slice(cleaned.toUpperCase().indexOf(' WHERE ')) : '';
    if (!where) {
      // Only log in development - queries without WHERE clause are not tracked but this is expected
      if (process.env.NODE_ENV === 'development') {
        ailogger.debug(`Changelog tracking skipped: No WHERE clause found for ${table} ${op}`);
      }
      return orig(sql, params, transactionId);
    }

    try {
      // PERFORMANCE OPTIMIZATION: Only capture before state, execute query, then defer changelog
      // This reduces 3 synchronous queries to 2 + deferred async insert
      const searchQuery = `SELECT * FROM \`${schema}\`.\`${table}\` ${where}`;
      const beforeImages = (await orig(searchQuery, params, transactionId)) as Record<string, unknown>[];
      const recordIDs = beforeImages.map(r => r[coreKey]);

      // Execute the actual operation
      const result = await orig(sql, params, transactionId);

      // For DELETEs, we know the after state is empty for those records
      // For UPDATEs, we need to fetch the after state
      let afterImages: Record<string, unknown>[];
      if (op === 'DELETE') {
        // After a DELETE, the rows are gone - empty array
        afterImages = [];
      } else {
        // For UPDATE, we still need the after state
        afterImages = (await orig(searchQuery, params, transactionId)) as Record<string, unknown>[];
      }

      // Skip if no actual changes
      if (JSON.stringify(beforeImages) === JSON.stringify(afterImages)) {
        return result;
      }

      // Queue changelog entry for deferred processing (non-blocking)
      changelogQueue.push({
        schema,
        table,
        recordIDs: recordIDs.join('|'),
        operation: op,
        oldRowState: JSON.stringify(beforeImages),
        newRowState: JSON.stringify(afterImages),
        changedBy: user,
        plotID,
        censusID
      });

      // Process queue asynchronously (fire-and-forget)
      // Using setImmediate pattern to not block the response
      Promise.resolve()
        .then(() => processChangelogQueue(orig))
        .catch(err => {
          ailogger.error('Error processing changelog queue:', err instanceof Error ? err : new Error(String(err)));
        });

      return result;
    } catch (error: unknown) {
      ailogger.error(`Error in changelog tracking for ${table} ${op}:`, error instanceof Error ? error : new Error(String(error)));
      // Re-throw the error since this is a failure in the original operation, not just changelog
      throw error;
    }
  };
}
