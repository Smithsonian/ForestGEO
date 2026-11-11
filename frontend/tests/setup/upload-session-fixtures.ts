import type { Connection } from 'mysql2/promise';
import { ACTIVE_UPLOAD_SESSION_STATES, UploadSessionState } from '@/config/uploadsessiontracker';

export const TEST_UPLOAD_SESSION_USER = 'integration-test@forestgeo.test';

export interface ActiveUploadSessionFixture {
  schema: string;
  sessionID: string;
  plotID: number;
  censusID: number;
}

/**
 * Leaves `sessionID` as the one active upload session for its plot/census, with the
 * census-replacement marker unset: the state a new upload attempt starts in. Any
 * other active session of the scope is completed first, as a finished upload would be,
 * because the active-scope unique key allows only one.
 */
export async function startFreshUploadSession(connection: Connection, fixture: ActiveUploadSessionFixture): Promise<void> {
  await connection.query(
    `UPDATE upload_sessions SET state = ?
     WHERE schema_name = ? AND plot_id = ? AND census_id = ? AND session_id <> ? AND state IN (?)`,
    [UploadSessionState.COMPLETED, fixture.schema, fixture.plotID, fixture.censusID, fixture.sessionID, [...ACTIVE_UPLOAD_SESSION_STATES]]
  );
  await connection.query(
    `INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE plot_id = VALUES(plot_id), census_id = VALUES(census_id), state = VALUES(state), census_replacement_completed_at = NULL`,
    [fixture.sessionID, fixture.schema, fixture.plotID, fixture.censusID, TEST_UPLOAD_SESSION_USER, UploadSessionState.UPLOADING]
  );
}
