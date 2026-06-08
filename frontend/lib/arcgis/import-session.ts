import crypto from 'crypto';
import { format } from 'mysql2/promise';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import type { FileRow } from '@/config/macros/formdetails';
import type { ArcgisImportReference, TransformResult, TransformSummary, TransformWarning } from './types';

export class ArcgisImportSessionError extends Error {
  status: HTTPResponses;

  constructor(message: string, status: HTTPResponses = HTTPResponses.INVALID_REQUEST) {
    super(message);
    this.name = 'ArcgisImportSessionError';
    this.status = status;
  }
}

interface CreateArcgisImportSessionInput {
  schema: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
  result: TransformResult;
}

interface ArcgisSessionScope {
  userId: string;
  plotID: number;
  censusID: number;
  fileName: string;
}

interface ArcgisSessionRow {
  import_session_id?: string;
  user_id: string;
  plot_id: number;
  census_id: number;
  file_id: string;
  row_count?: number;
  summary_json?: unknown;
  warnings_json?: unknown;
  state: string;
  committed_file_id?: string | null;
  committed_batch_id?: string | null;
  committed_upload_session_id?: string | null;
  committed_row_count?: number | null;
  committed_at?: Date | string | null;
}

const STAGED_ROW_BATCH_SIZE = 1000;
const ARCGIS_SESSION_CLEANUP_MAX_AGE_SECONDS = 24 * 60 * 60;
const verifiedArcgisImportSchemas = new Set<string>();

export interface LoadedArcgisImportSession {
  rows: FileRow[];
  rowCount: number;
  fileName: string;
  summary: TransformSummary;
  warnings: TransformWarning[];
}

export type ClaimedArcgisImportSession =
  | (LoadedArcgisImportSession & { alreadyCommitted: false })
  | {
      alreadyCommitted: true;
      rowCount: number;
      fileName: string;
      committedBatchID: string;
      committedUploadSessionID: string | null;
    };

export function assertUploadableArcgisSession(session: ArcgisSessionRow | null, scope: ArcgisSessionScope): asserts session is ArcgisSessionRow {
  if (!session) {
    throw new ArcgisImportSessionError('ArcGIS import session was not found. Re-run the workbook pre-flight step.', HTTPResponses.NOT_FOUND);
  }
  if (session.user_id !== scope.userId) {
    throw new ArcgisImportSessionError('ArcGIS import session does not belong to the authenticated user.', HTTPResponses.FORBIDDEN);
  }
  if (Number(session.plot_id) !== scope.plotID || Number(session.census_id) !== scope.censusID) {
    throw new ArcgisImportSessionError('ArcGIS import session scope does not match the requested plot/census.', HTTPResponses.CONFLICT);
  }
  if (session.file_id !== scope.fileName) {
    throw new ArcgisImportSessionError('ArcGIS import session file does not match the requested file.', HTTPResponses.CONFLICT);
  }
  if (!['preflight', 'committing'].includes(session.state)) {
    throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

async function ensureArcgisImportSessionColumns(connectionManager: ConnectionManager, schema: string): Promise<void> {
  const columnCheckSQL = `
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME IN (
        'committed_file_id',
        'committed_batch_id',
        'committed_upload_session_id',
        'committed_row_count',
        'committed_at'
      )
  `;
  const rows = await connectionManager.executeQuery(columnCheckSQL, [schema]);
  const existing = new Set((Array.isArray(rows) ? rows : []).map((row: { COLUMN_NAME?: string }) => row.COLUMN_NAME));

  const additions: Array<{ name: string; sql: string }> = [
    {
      name: 'committed_file_id',
      sql: format(`ALTER TABLE ??.arcgis_import_sessions ADD COLUMN committed_file_id VARCHAR(255) NULL AFTER state`, [schema])
    },
    {
      name: 'committed_batch_id',
      sql: format(`ALTER TABLE ??.arcgis_import_sessions ADD COLUMN committed_batch_id VARCHAR(64) NULL AFTER committed_file_id`, [schema])
    },
    {
      name: 'committed_upload_session_id',
      sql: format(`ALTER TABLE ??.arcgis_import_sessions ADD COLUMN committed_upload_session_id VARCHAR(64) NULL AFTER committed_batch_id`, [schema])
    },
    {
      name: 'committed_row_count',
      sql: format(`ALTER TABLE ??.arcgis_import_sessions ADD COLUMN committed_row_count INT NULL AFTER committed_upload_session_id`, [schema])
    },
    {
      name: 'committed_at',
      sql: format(`ALTER TABLE ??.arcgis_import_sessions ADD COLUMN committed_at TIMESTAMP NULL AFTER committed_row_count`, [schema])
    }
  ];

  for (const addition of additions) {
    if (!existing.has(addition.name)) {
      await connectionManager.executeQuery(addition.sql);
    }
  }
}

export async function ensureArcgisImportTables(schema: string): Promise<void> {
  if (verifiedArcgisImportSchemas.has(schema)) return;

  const connectionManager = ConnectionManager.getInstance();
  await connectionManager.executeQuery(
    format(
      `CREATE TABLE IF NOT EXISTS ??.arcgis_import_sessions (
        import_session_id VARCHAR(64) NOT NULL PRIMARY KEY,
        plot_id INT NOT NULL,
        census_id INT NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        file_id VARCHAR(255) NOT NULL,
        row_count INT NOT NULL,
        warning_count INT NOT NULL,
        summary_json JSON NOT NULL,
        warnings_json JSON NOT NULL,
        state VARCHAR(32) NOT NULL DEFAULT 'preflight',
        committed_file_id VARCHAR(255) NULL,
        committed_batch_id VARCHAR(64) NULL,
        committed_upload_session_id VARCHAR(64) NULL,
        committed_row_count INT NULL,
        committed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_arcgis_import_scope (plot_id, census_id, user_id, state),
        KEY idx_arcgis_import_committed_batch (committed_batch_id),
        KEY idx_arcgis_import_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      [schema]
    )
  );

  await connectionManager.executeQuery(
    format(
      `CREATE TABLE IF NOT EXISTS ??.arcgis_import_rows (
        import_session_id VARCHAR(64) NOT NULL,
        row_index INT NOT NULL,
        row_json JSON NOT NULL,
        PRIMARY KEY (import_session_id, row_index),
        CONSTRAINT fk_arcgis_import_rows_session
          FOREIGN KEY (import_session_id)
          REFERENCES ??.arcgis_import_sessions(import_session_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      [schema, schema]
    )
  );

  await ensureArcgisImportSessionColumns(connectionManager, schema);
  verifiedArcgisImportSchemas.add(schema);
}

export async function createArcgisImportSession(input: CreateArcgisImportSessionInput): Promise<ArcgisImportReference> {
  await ensureArcgisImportTables(input.schema);

  const connectionManager = ConnectionManager.getInstance();
  const importSessionId = crypto.randomUUID();
  const rowCount = input.result.rows.length;

  await connectionManager.withTransaction(async transactionID => {
    const deletePreviousSQL = format(
      `DELETE FROM ??.arcgis_import_sessions
       WHERE plot_id = ?
         AND census_id = ?
         AND user_id = ?
         AND state IN ('preflight', 'committed', 'abandoned')`,
      [input.schema]
    );
    await connectionManager.executeQuery(deletePreviousSQL, [input.plotID, input.censusID, input.userId], transactionID);

    const insertSessionSQL = format(
      `INSERT INTO ??.arcgis_import_sessions
        (import_session_id, plot_id, census_id, user_id, file_id, row_count, warning_count, summary_json, warnings_json, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'preflight')`,
      [input.schema]
    );
    await connectionManager.executeQuery(
      insertSessionSQL,
      [
        importSessionId,
        input.plotID,
        input.censusID,
        input.userId,
        input.fileName,
        rowCount,
        input.result.warnings.length,
        JSON.stringify(input.result.summary),
        JSON.stringify(input.result.warnings)
      ],
      transactionID
    );

    const insertRowsSQLPrefix = format(`INSERT INTO ??.arcgis_import_rows (import_session_id, row_index, row_json) VALUES `, [input.schema]);
    for (let start = 0; start < input.result.rows.length; start += STAGED_ROW_BATCH_SIZE) {
      const slice = input.result.rows.slice(start, start + STAGED_ROW_BATCH_SIZE);
      const placeholders = slice.map(() => `(?, ?, ?)`).join(', ');
      const values = slice.flatMap((row, index) => [importSessionId, start + index, JSON.stringify(row)]);
      await connectionManager.executeQuery(`${insertRowsSQLPrefix}${placeholders}`, values, transactionID);
    }
  });

  return { importSessionId, fileName: input.fileName, rowCount };
}

function defaultSummary(rowCount: number): TransformSummary {
  return {
    treesTransformed: 0,
    stemsJoined: 0,
    blankQuadratCount: 0,
    tagMismatchCount: 0,
    orphanStemsEmitted: 0,
    duplicateTreeTags: 0,
    duplicateGlobalIds: 0,
    missingRequired: 0,
    totalRows: rowCount
  };
}

async function loadArcgisSessionRow(
  connectionManager: ConnectionManager,
  schema: string,
  importSessionId: string,
  transactionID?: string,
  forUpdate: boolean = false
): Promise<ArcgisSessionRow | null> {
  const sessionSQL = format(
    `SELECT import_session_id, plot_id, census_id, user_id, file_id, row_count, summary_json, warnings_json, state,
            committed_file_id, committed_batch_id, committed_upload_session_id, committed_row_count, committed_at
     FROM ??.arcgis_import_sessions WHERE import_session_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [schema]
  );
  const sessionRows = await connectionManager.executeQuery(sessionSQL, [importSessionId], transactionID);
  return Array.isArray(sessionRows) ? ((sessionRows[0] as ArcgisSessionRow | undefined) ?? null) : null;
}

async function loadArcgisSessionRows(
  connectionManager: ConnectionManager,
  schema: string,
  importSessionId: string,
  transactionID?: string
): Promise<FileRow[]> {
  const rowsSQL = format(`SELECT row_json FROM ??.arcgis_import_rows WHERE import_session_id = ? ORDER BY row_index ASC`, [schema]);
  const rowRecords = await connectionManager.executeQuery(rowsSQL, [importSessionId], transactionID);
  return (Array.isArray(rowRecords) ? rowRecords : []).map((row: { row_json: unknown }) => parseJsonColumn<FileRow>(row.row_json, {} as FileRow));
}

function toLoadedSession(session: ArcgisSessionRow, rows: FileRow[]): LoadedArcgisImportSession {
  const rowCount = Number(session.row_count) || 0;
  return {
    rows,
    rowCount,
    fileName: session.file_id,
    summary: parseJsonColumn<TransformSummary>(session.summary_json, defaultSummary(rowCount)),
    warnings: parseJsonColumn<TransformWarning[]>(session.warnings_json, [])
  };
}

export async function loadStagedArcgisSession(input: {
  schema: string;
  importSessionId: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
}): Promise<LoadedArcgisImportSession> {
  await ensureArcgisImportTables(input.schema);
  const connectionManager = ConnectionManager.getInstance();
  const session = await loadArcgisSessionRow(connectionManager, input.schema, input.importSessionId);
  assertUploadableArcgisSession(session, {
    userId: input.userId,
    plotID: input.plotID,
    censusID: input.censusID,
    fileName: input.fileName
  });

  return toLoadedSession(session, await loadArcgisSessionRows(connectionManager, input.schema, input.importSessionId));
}

export async function claimArcgisImportSessionForCommit(
  input: {
    schema: string;
    importSessionId: string;
    plotID: number;
    censusID: number;
    userId: string;
    fileName: string;
    batchID: string;
    uploadSessionID: string | null;
  },
  transactionID: string
): Promise<ClaimedArcgisImportSession> {
  await ensureArcgisImportTables(input.schema);
  const connectionManager = ConnectionManager.getInstance();
  const session = await loadArcgisSessionRow(connectionManager, input.schema, input.importSessionId, transactionID, true);

  if (!session) {
    throw new ArcgisImportSessionError('ArcGIS import session was not found. Re-run the workbook pre-flight step.', HTTPResponses.NOT_FOUND);
  }
  if (session.user_id !== input.userId) {
    throw new ArcgisImportSessionError('ArcGIS import session does not belong to the authenticated user.', HTTPResponses.FORBIDDEN);
  }
  if (Number(session.plot_id) !== input.plotID || Number(session.census_id) !== input.censusID) {
    throw new ArcgisImportSessionError('ArcGIS import session scope does not match the requested plot/census.', HTTPResponses.CONFLICT);
  }
  if (session.file_id !== input.fileName) {
    throw new ArcgisImportSessionError('ArcGIS import session file does not match the requested file.', HTTPResponses.CONFLICT);
  }

  if (session.state === 'committed') {
    if (session.committed_batch_id === input.batchID) {
      return {
        alreadyCommitted: true,
        rowCount: Number(session.committed_row_count ?? session.row_count) || 0,
        fileName: session.committed_file_id || session.file_id,
        committedBatchID: session.committed_batch_id,
        committedUploadSessionID: session.committed_upload_session_id ?? null
      };
    }
    throw new ArcgisImportSessionError(
      `ArcGIS import session has already been committed to batch "${session.committed_batch_id || 'unknown'}". Re-run pre-flight before committing again.`,
      HTTPResponses.CONFLICT
    );
  }

  if (session.state !== 'preflight') {
    throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);
  }

  const claimSQL = format(
    `UPDATE ??.arcgis_import_sessions
     SET state = 'committing',
         committed_file_id = file_id,
         committed_batch_id = ?,
         committed_upload_session_id = ?,
         committed_row_count = NULL,
         committed_at = NULL
     WHERE import_session_id = ? AND state = 'preflight'`,
    [input.schema]
  );
  const result = await connectionManager.executeQuery(claimSQL, [input.batchID, input.uploadSessionID, input.importSessionId], transactionID);
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
    throw new ArcgisImportSessionError('ArcGIS import session could not be claimed for commit. Retry the upload.', HTTPResponses.CONFLICT);
  }

  const rows = await loadArcgisSessionRows(connectionManager, input.schema, input.importSessionId, transactionID);
  return { ...toLoadedSession(session, rows), alreadyCommitted: false };
}

export async function markArcgisImportSessionCommitted(
  input: {
    schema: string;
    importSessionId: string;
    insertedRowCount: number;
  },
  transactionID: string
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const updateSQL = format(
    `UPDATE ??.arcgis_import_sessions
     SET state = 'committed',
         committed_row_count = ?,
         committed_at = NOW()
     WHERE import_session_id = ? AND state = 'committing'`,
    [input.schema]
  );
  const result = await connectionManager.executeQuery(updateSQL, [input.insertedRowCount, input.importSessionId], transactionID);
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
    throw new ArcgisImportSessionError('ArcGIS import session could not be marked committed.', HTTPResponses.CONFLICT);
  }
}

export async function cleanupStaleArcgisImportSessions(schema: string, maxAgeSeconds: number = ARCGIS_SESSION_CLEANUP_MAX_AGE_SECONDS): Promise<number> {
  await ensureArcgisImportTables(schema);
  const connectionManager = ConnectionManager.getInstance();
  const deleteSQL = format(
    `DELETE FROM ??.arcgis_import_sessions
     WHERE state IN ('preflight', 'committed', 'abandoned')
       AND updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [schema]
  );
  const result = await connectionManager.executeQuery(deleteSQL, [maxAgeSeconds]);
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}
