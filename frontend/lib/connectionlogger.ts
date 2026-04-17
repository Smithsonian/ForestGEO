// connectionlogger.ts
// Provides changelog tracking for database operations (INSERT/UPDATE/DELETE)
// Performance optimized: uses deferred logging to reduce query overhead
// Transaction-aware: buffers entries per transaction, flushes on commit, discards on rollback
import ailogger from '@/ailogger';

type TableScope = 'site' | 'plot' | 'census';

interface TableConfig {
  pk: string;
  fk?: string;
  scope: TableScope;
}

interface ChangelogEntry {
  schema: string;
  table: string;
  recordIDs: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRowState: string;
  newRowState: string;
  changedBy: string;
  plotID: number | null;
  censusID: number | null;
}

// Queue for deferred changelog entries (processed asynchronously)
const changelogQueue: ChangelogEntry[] = [];
let isProcessingQueue = false;

// Transaction-scoped buffers: entries are held until commit (flush) or rollback (discard)
const transactionBuffers = new Map<string, ChangelogEntry[]>();

// Reference to the original executeQuery, set during patching
let origExecuteQuery: ((sql: string, params?: unknown[]) => Promise<unknown>) | null = null;

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

/**
 * Flush buffered changelog entries for a committed transaction.
 * Called from ConnectionManager.commitTransaction().
 */
export function flushTransactionChangelog(transactionId: string) {
  const entries = transactionBuffers.get(transactionId);
  if (!entries || entries.length === 0) {
    transactionBuffers.delete(transactionId);
    return;
  }

  changelogQueue.push(...entries);
  transactionBuffers.delete(transactionId);

  if (origExecuteQuery) {
    const exec = origExecuteQuery;
    Promise.resolve()
      .then(() => processChangelogQueue(exec))
      .catch(err => {
        ailogger.error('Error processing changelog queue after commit:', err instanceof Error ? err : new Error(String(err)));
      });
  }
}

/**
 * Discard buffered changelog entries for a rolled-back transaction.
 * Called from ConnectionManager.rollbackTransaction().
 */
export function discardTransactionChangelog(transactionId: string) {
  const discarded = transactionBuffers.get(transactionId);
  if (discarded && discarded.length > 0) {
    ailogger.info(`Discarded ${discarded.length} changelog entries for rolled-back transaction ${transactionId}`);
  }
  transactionBuffers.delete(transactionId);
}

const SKIP_CHANGELOG_MARKER = '/* skip_changelog */';

export function patchConnectionManager(cm: { executeQuery: (sql: string, params?: unknown[], transactionId?: string) => Promise<unknown> }) {
  const tableConfigs: Record<string, TableConfig> = {
    coremeasurements: { pk: 'CoreMeasurementID', scope: 'census' },
    cmattributes: { pk: 'CMAID', fk: 'CoreMeasurementID', scope: 'census' },
    measurement_errors: { pk: 'ErrorID', scope: 'site' },
    measurement_error_log: { pk: 'MeasurementID', fk: 'ErrorID', scope: 'census' },
    stems: { pk: 'StemGUID', scope: 'census' },
    trees: { pk: 'TreeID', scope: 'census' },
    quadrats: { pk: 'QuadratID', scope: 'plot' },
    personnel: { pk: 'PersonnelID', scope: 'plot' },
    species: { pk: 'SpeciesID', scope: 'site' },
    genus: { pk: 'GenusID', scope: 'site' },
    family: { pk: 'FamilyID', scope: 'site' },
    attributes: { pk: 'Code', scope: 'site' },
    roles: { pk: 'RoleID', scope: 'site' },
    specieslimits: { pk: 'SpeciesLimitID', scope: 'site' }
  };

  const orig = cm.executeQuery.bind(cm);
  origExecuteQuery = orig;

  cm.executeQuery = async function (sql: string, params?: unknown[], transactionId?: string) {
    // Check for skip_changelog marker — used for system side-effect queries
    if (sql.includes(SKIP_CHANGELOG_MARKER)) {
      const cleanedSql = sql.replace(SKIP_CHANGELOG_MARKER, '').trim();
      return orig(cleanedSql, params, transactionId);
    }

    const cleaned = sql.trim().replace(/`/g, '');
    const regexOutput = /^(UPDATE|DELETE|INSERT)\s+(?:INTO\s+|FROM\s+)?(?:\w+\.)?(\w+)/i.exec(cleaned) || [];
    const op = regexOutput?.[1]?.toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE' | undefined;
    const table = regexOutput?.[2];
    if (!op || !table || !tableConfigs[table]) return orig(sql, params, transactionId);

    // Skip changelog tracking for queries with JOINs - the WHERE clause uses
    // aliases that are only valid in the context of the JOIN, so extracting the
    // WHERE clause for a standalone SELECT would produce invalid SQL.
    if (/\bJOIN\b/i.test(cleaned)) return orig(sql, params, transactionId);

    const config = tableConfigs[table];
    const { pk, fk, scope } = config;

    // Read cookies — only require what the table's scope demands
    const store = await getCookiesSafely();
    if (!store || !store.has('user') || !store.has('schema')) {
      return orig(sql, params, transactionId);
    }
    const user = String(store.get('user')?.value);
    const schema = String(store.get('schema')?.value);

    // Derive plotID and censusID based on table scope
    let plotID: number | null = null;
    let censusID: number | null = null;

    if (scope === 'plot' || scope === 'census') {
      if (!store.has('plotID')) return orig(sql, params, transactionId);
      const rawPlotID = Number(store.get('plotID')?.value);
      if (isNaN(rawPlotID) || rawPlotID <= 0) return orig(sql, params, transactionId);
      plotID = rawPlotID;
    }

    if (scope === 'census') {
      if (!store.has('censusID')) return orig(sql, params, transactionId);
      const rawCensusID = Number(store.get('censusID')?.value);
      if (isNaN(rawCensusID) || rawCensusID <= 0) return orig(sql, params, transactionId);
      censusID = rawCensusID;
    }

    // --- INSERT handling ---
    if (op === 'INSERT') {
      try {
        const result = await orig(sql, params, transactionId);
        const insertResult = result as { insertId?: number };

        // Fetch the newly inserted row for after-state
        let afterImages: Record<string, unknown>[] = [];
        if (insertResult?.insertId) {
          afterImages = (await orig(`SELECT * FROM \`${schema}\`.\`${table}\` WHERE \`${pk}\` = ?`, [insertResult.insertId], transactionId)) as Record<
            string,
            unknown
          >[];
        }

        const recordIDs = afterImages.length > 0 ? afterImages.map(r => r[pk]).join('|') : String(insertResult?.insertId ?? 'unknown');

        const entry: ChangelogEntry = {
          schema,
          table,
          recordIDs,
          operation: 'INSERT',
          oldRowState: '[]',
          newRowState: JSON.stringify(afterImages),
          changedBy: user,
          plotID,
          censusID
        };

        if (transactionId) {
          if (!transactionBuffers.has(transactionId)) transactionBuffers.set(transactionId, []);
          transactionBuffers.get(transactionId)!.push(entry);
        } else {
          changelogQueue.push(entry);
          Promise.resolve()
            .then(() => processChangelogQueue(orig))
            .catch(err => {
              ailogger.error('Error processing changelog queue:', err instanceof Error ? err : new Error(String(err)));
            });
        }

        return result;
      } catch (error: unknown) {
        ailogger.error(`Error in changelog tracking for ${table} ${op}:`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }

    // --- UPDATE / DELETE handling ---
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
        coreKey = fk;
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
      if (process.env.NODE_ENV === 'development') {
        ailogger.debug(`Changelog tracking skipped: Could not extract ${pk}${fk ? ` or ${fk}` : ''} from query for table ${table}`);
      }
      return orig(sql, params, transactionId);
    }

    const where = cleaned.toUpperCase().indexOf(' WHERE ') > 0 ? cleaned.slice(cleaned.toUpperCase().indexOf(' WHERE ')) : '';
    if (!where) {
      if (process.env.NODE_ENV === 'development') {
        ailogger.debug(`Changelog tracking skipped: No WHERE clause found for ${table} ${op}`);
      }
      return orig(sql, params, transactionId);
    }

    try {
      const searchQuery = `SELECT * FROM \`${schema}\`.\`${table}\` ${where}`;
      const beforeImages = (await orig(searchQuery, params, transactionId)) as Record<string, unknown>[];
      const recordIDs = beforeImages.map(r => r[coreKey]);

      const result = await orig(sql, params, transactionId);

      let afterImages: Record<string, unknown>[];
      if (op === 'DELETE') {
        afterImages = [];
      } else {
        afterImages = (await orig(searchQuery, params, transactionId)) as Record<string, unknown>[];
      }

      // Skip if no actual changes
      if (JSON.stringify(beforeImages) === JSON.stringify(afterImages)) {
        return result;
      }

      const entry: ChangelogEntry = {
        schema,
        table,
        recordIDs: recordIDs.join('|'),
        operation: op,
        oldRowState: JSON.stringify(beforeImages),
        newRowState: JSON.stringify(afterImages),
        changedBy: user,
        plotID,
        censusID
      };

      // Transaction-aware buffering: hold until commit/rollback
      if (transactionId) {
        if (!transactionBuffers.has(transactionId)) transactionBuffers.set(transactionId, []);
        transactionBuffers.get(transactionId)!.push(entry);
      } else {
        changelogQueue.push(entry);
        Promise.resolve()
          .then(() => processChangelogQueue(orig))
          .catch(err => {
            ailogger.error('Error processing changelog queue:', err instanceof Error ? err : new Error(String(err)));
          });
      }

      return result;
    } catch (error: unknown) {
      ailogger.error(`Error in changelog tracking for ${table} ${op}:`, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
}
