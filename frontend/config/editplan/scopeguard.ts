import type { Session } from 'next-auth';
import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';
import { ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS, STALE_VALIDATION_RUN_THRESHOLD_MINUTES } from '@/config/measurementscopepolicy';
import { getErrorCode } from '@/lib/errorhelpers';

export class ScopeAccessError extends Error {
  constructor(message = 'edit scope is not allowed for this user') {
    super(message);
    this.name = 'ScopeAccessError';
  }
}

export class ScopeBusyError extends Error {
  constructor(message = 'edit scope is currently busy') {
    super(message);
    this.name = 'ScopeBusyError';
  }
}

export interface MeasurementScopeInput {
  schema: string;
  plotID: number;
  censusID: number;
}

function isMissingTableError(error: unknown): boolean {
  return getErrorCode(error) === 'ER_NO_SUCH_TABLE';
}

function hasSchemaAccess(session: Session, schema: string): boolean {
  const role = session.user?.userStatus;
  if (role === 'global' || role === 'db admin') {
    return true;
  }

  return (session.user?.sites ?? []).some(site => site.schemaName === schema);
}

async function assertPlotCensusExists(cm: ConnectionManager, schema: string, plotID: number, censusID: number): Promise<void> {
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT 1 AS ok
       FROM ??.census c
       WHERE c.PlotID = ?
         AND c.CensusID = ?
         AND c.IsActive IS TRUE
       LIMIT 1`
    ),
    [plotID, censusID]
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ScopeAccessError('plot/census scope is not available');
  }
}

async function probeActiveUploadSession(cm: ConnectionManager, schema: string, plotID: number, censusID: number): Promise<void> {
  const placeholders = ACTIVE_UPLOAD_SESSION_STATES.map(() => '?').join(', ');
  try {
    const rows = await cm.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT session_id
         FROM ??.upload_sessions
         WHERE plot_id = ?
           AND census_id = ?
           AND state IN (${placeholders})
           AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
         ORDER BY last_heartbeat DESC, updated_at DESC, created_at DESC
         LIMIT 1`
      ),
      [plotID, censusID, ...ACTIVE_UPLOAD_SESSION_STATES, ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS]
    );

    if (Array.isArray(rows) && rows.length > 0) {
      throw new ScopeBusyError(`upload session ${rows[0].session_id} is active for this plot/census`);
    }
  } catch (error: unknown) {
    if (error instanceof ScopeBusyError) throw error;
    if (isMissingTableError(error)) return;
    throw error;
  }
}

async function probeActiveValidationRun(cm: ConnectionManager, schema: string, plotID: number, censusID: number): Promise<void> {
  try {
    const rows = await cm.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT RunID, StartedAt
         FROM ??.validation_runs
         WHERE PlotID = ?
           AND CensusID = ?
           AND Status = 'running'
         ORDER BY RunID DESC
         LIMIT 1`
      ),
      [plotID, censusID]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }

    const startedAt = new Date(rows[0].StartedAt).getTime();
    const ageMinutes = Number.isNaN(startedAt) ? 0 : (Date.now() - startedAt) / 60_000;
    if (ageMinutes < STALE_VALIDATION_RUN_THRESHOLD_MINUTES) {
      throw new ScopeBusyError(`validation run ${rows[0].RunID} is active for this plot/census`);
    }
  } catch (error: unknown) {
    if (error instanceof ScopeBusyError) throw error;
    if (isMissingTableError(error)) return;
    throw error;
  }
}

/**
 * Authorization gate: the session user may address the given plot/census
 * scope, and that plot/census actually exists. Does NOT probe for concurrent
 * activity — call `assertNoActiveMeasurementScopeConflict` for that.
 *
 * Callers that later acquire the authoritative scope lock (applyEdit,
 * revisionupload/apply) can skip the conflict probe and rely on the
 * in-transaction FOR UPDATE checks.
 *
 * Note: the plan's `assertTargetInScope` check is enforced implicitly by
 * `analyzer.loadCurrentRow`, which constrains its WHERE clause to
 * CoreMeasurementID + CensusID + PlotID + StemGUID shape and translates a
 * missed lookup to TargetNotFoundError (→ 404).
 */
export async function assertCanEditMeasurementScope(cm: ConnectionManager, session: Session, input: MeasurementScopeInput): Promise<void> {
  if (!hasSchemaAccess(session, input.schema)) {
    throw new ScopeAccessError();
  }

  await assertPlotCensusExists(cm, input.schema, input.plotID, input.censusID);
}

/**
 * Non-locking conflict probe: rejects if a recent upload session or a fresh
 * validation run is active for the given scope. Read-only routes
 * (preview, revert) use this before analysis; routes that take the
 * authoritative scope lock do not need it.
 */
export async function assertNoActiveMeasurementScopeConflict(cm: ConnectionManager, input: MeasurementScopeInput): Promise<void> {
  await probeActiveUploadSession(cm, input.schema, input.plotID, input.censusID);
  await probeActiveValidationRun(cm, input.schema, input.plotID, input.censusID);
}
