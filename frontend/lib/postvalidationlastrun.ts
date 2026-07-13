import ailogger from '@/ailogger';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

const UNKNOWN_COLUMN_ERRNO = 1054;

export interface PostValidationLastRun {
  queryID: number;
  plotID: number;
  censusID: number;
  ranAt: string;
  status: 'success' | 'failure';
  /** undefined = leave LastRunResult untouched; null = clear it; string = store it */
  result?: string | null;
}

function isUnknownColumnError(error: unknown): boolean {
  const mysqlError = error as { code?: string; errno?: number } | null;
  return mysqlError?.code === 'ER_BAD_FIELD_ERROR' || mysqlError?.errno === UNKNOWN_COLUMN_ERRNO;
}

function buildLastRunUpdate(run: PostValidationLastRun, includeScopeColumns: boolean): { statement: string; params: (string | number | null)[] } {
  const assignments: string[] = ['LastRunAt = ?'];
  const params: (string | number | null)[] = [run.ranAt];

  if (run.result !== undefined) {
    assignments.push('LastRunResult = ?');
    params.push(run.result);
  }

  assignments.push('LastRunStatus = ?');
  params.push(run.status);

  if (includeScopeColumns) {
    assignments.push('LastRunPlotID = ?', 'LastRunCensusID = ?');
    params.push(run.plotID, run.censusID);
  }

  params.push(run.queryID);
  return { statement: `UPDATE ??.postvalidationqueries SET ${assignments.join(', ')} WHERE QueryID = ?`, params };
}

/**
 * Records a post-validation query's last-run status, scoped to the plot/census it
 * ran against. Existing site schemas only gain the LastRunPlotID/LastRunCensusID
 * columns once migration 61 is applied, so if the scoped UPDATE fails with an
 * unknown-column error we fall back to the legacy unscoped UPDATE rather than
 * failing the whole run.
 */
export async function updatePostValidationLastRun(connectionManager: ConnectionManager, schema: string, run: PostValidationLastRun): Promise<void> {
  const scoped = buildLastRunUpdate(run, true);
  try {
    await connectionManager.executeQuery(safeFormatQuery(schema, scoped.statement), scoped.params);
    return;
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    ailogger.warn(
      `postvalidationqueries in ${schema} is missing LastRunPlotID/LastRunCensusID (migration 61 not applied); recording unscoped last-run status for query ${run.queryID}.`
    );
  }
  const unscoped = buildLastRunUpdate(run, false);
  await connectionManager.executeQuery(safeFormatQuery(schema, unscoped.statement), unscoped.params);
}
