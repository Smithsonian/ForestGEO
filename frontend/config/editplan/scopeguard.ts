import type { Session } from 'next-auth';
import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { ACTIVE_UPLOAD_SESSION_STATES, SESSION_TIMEOUTS } from '@/config/uploadsessiontracker';
import { errorMessageContains, getErrorCode } from '@/lib/errorhelpers';

const ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS = Math.ceil(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);
const STALE_VALIDATION_RUN_THRESHOLD_MINUTES = 15;

export class EditScopeForbiddenError extends Error {
  constructor(message = 'edit scope is not allowed for this user') {
    super(message);
    this.name = 'EditScopeForbiddenError';
  }
}

export class EditScopeConflictError extends Error {
  constructor(message = 'edit scope is currently busy') {
    super(message);
    this.name = 'EditScopeConflictError';
  }
}

export interface EditScopeGuardInput {
  schema: string;
  plotID: number;
  censusID: number;
  rejectActiveOperations?: boolean;
}

function isMissingTableError(error: unknown): boolean {
  return getErrorCode(error) === 'ER_NO_SUCH_TABLE' || errorMessageContains(error, "doesn't exist");
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
    throw new EditScopeForbiddenError('plot/census scope is not available');
  }
}

async function assertNoActiveUploadSession(cm: ConnectionManager, schema: string, plotID: number, censusID: number): Promise<void> {
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
      throw new EditScopeConflictError(`upload session ${rows[0].session_id} is active for this plot/census`);
    }
  } catch (error: unknown) {
    if (error instanceof EditScopeConflictError) throw error;
    if (isMissingTableError(error)) return;
    throw error;
  }
}

async function assertNoActiveValidationRun(cm: ConnectionManager, schema: string, plotID: number, censusID: number): Promise<void> {
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
      throw new EditScopeConflictError(`validation run ${rows[0].RunID} is active for this plot/census`);
    }
  } catch (error: unknown) {
    if (error instanceof EditScopeConflictError) throw error;
    if (isMissingTableError(error)) return;
    throw error;
  }
}

export async function assertEditScopeAllowed(cm: ConnectionManager, session: Session, input: EditScopeGuardInput): Promise<void> {
  if (!hasSchemaAccess(session, input.schema)) {
    throw new EditScopeForbiddenError();
  }

  await assertPlotCensusExists(cm, input.schema, input.plotID, input.censusID);

  if (input.rejectActiveOperations !== false) {
    await assertNoActiveUploadSession(cm, input.schema, input.plotID, input.censusID);
    await assertNoActiveValidationRun(cm, input.schema, input.plotID, input.censusID);
  }
}
