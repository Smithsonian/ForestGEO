/** Temporary DBH migration preflight, shared by advisory reads and locked execution.
 * Repeat under the current/prior census locks before mutation. Retire with the tool.
 */
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';
import { NON_TERMINAL_BACKGROUND_JOB_STATUSES } from '@/lib/background-jobs/types';

export interface DbhRescoreScope {
  schema: string;
  plotID: number;
  censusID: number;
}

type Executor = Pick<TxExecutor, 'query'>;
export type DbhPreflightReason = 'running' | 'upload' | 'pending' | 'background-job';
export const DBH_PREFLIGHT_MESSAGES: Record<DbhPreflightReason, string> = {
  running: 'running validation record',
  upload: 'active upload',
  pending: 'eligible pending measurements',
  'background-job': 'active background job'
};

async function countActiveBackgroundJobs(scope: DbhRescoreScope, tx: Executor): Promise<number> {
  const rows = await tx.query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM catalog.background_jobs
     WHERE SchemaName = ? AND PlotID = ? AND CensusID = ?
       AND Status IN (${NON_TERMINAL_BACKGROUND_JOB_STATUSES.map(() => '?').join(', ')})`,
    [scope.schema, scope.plotID, scope.censusID, ...NON_TERMINAL_BACKGROUND_JOB_STATUSES]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function preflightDbhScope(
  tx: Executor,
  scope: DbhRescoreScope,
  checkBackgroundJobs: (scope: DbhRescoreScope) => Promise<number> = scope => countActiveBackgroundJobs(scope, tx)
): Promise<{ reason: DbhPreflightReason; count: number } | null> {
  const runningSQL = safeFormatQuery(scope.schema, "SELECT COUNT(*) AS count FROM ??.validation_runs WHERE PlotID = ? AND CensusID = ? AND Status = 'running'");
  const uploadSQL = safeFormatQuery(
    scope.schema,
    `SELECT COUNT(*) AS count FROM ??.upload_sessions
     WHERE plot_id = ? AND census_id = ? AND state IN (${ACTIVE_UPLOAD_SESSION_STATES.map(() => '?').join(', ')})`
  );
  const pendingSQL = safeFormatQuery(
    scope.schema,
    'SELECT COUNT(*) AS count FROM ??.coremeasurements WHERE CensusID = ? AND IsActive = TRUE AND StemGUID IS NOT NULL AND IsValidated IS NULL'
  );
  for (const [reason, sql, params] of [
    ['running', runningSQL, [scope.plotID, scope.censusID]],
    ['upload', uploadSQL, [scope.plotID, scope.censusID, ...ACTIVE_UPLOAD_SESSION_STATES]],
    ['pending', pendingSQL, [scope.censusID]]
  ] as const) {
    const rows = (await tx.query(sql, [...params])) as Array<{ count: number }>;
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) return { reason, count };
  }
  const jobs = await checkBackgroundJobs(scope);
  return jobs > 0 ? { reason: 'background-job', count: jobs } : null;
}
