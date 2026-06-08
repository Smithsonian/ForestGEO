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

interface LoadArcgisImportRowsInput {
  schema: string;
  importSessionId: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
  offset: number;
  limit: number;
}

export interface LoadedArcgisImportRows {
  rows: FileRow[];
  rowCount: number;
  fileName: string;
  summary: TransformSummary;
  warnings: TransformWarning[];
}

interface ArcgisSessionScope {
  userId: string;
  plotID: number;
  censusID: number;
  fileName: string;
}

interface ArcgisSessionRow {
  user_id: string;
  plot_id: number;
  census_id: number;
  file_id: string;
  state: string;
}

const STAGED_ROW_BATCH_SIZE = 1000;
const verifiedArcgisImportSchemas = new Set<string>();

export function assertUploadableArcgisSession(session: ArcgisSessionRow | null, scope: ArcgisSessionScope): void {
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
  if (!['preflight', 'committing'].includes(String(session.state))) {
    throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
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
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_arcgis_import_scope (plot_id, census_id, user_id, state),
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

export async function loadArcgisImportRows(input: LoadArcgisImportRowsInput): Promise<LoadedArcgisImportRows> {
  await ensureArcgisImportTables(input.schema);

  const connectionManager = ConnectionManager.getInstance();
  const sessionSQL = format(
    `SELECT import_session_id, plot_id, census_id, user_id, file_id, row_count, summary_json, warnings_json, state
     FROM ??.arcgis_import_sessions
     WHERE import_session_id = ?
     LIMIT 1`,
    [input.schema]
  );
  const sessionRows = await connectionManager.executeQuery(sessionSQL, [input.importSessionId]);
  const session = Array.isArray(sessionRows) ? sessionRows[0] : null;

  assertUploadableArcgisSession(session, {
    userId: input.userId,
    plotID: input.plotID,
    censusID: input.censusID,
    fileName: input.fileName
  });

  const rowsSQL = format(
    `SELECT row_json
     FROM ??.arcgis_import_rows
     WHERE import_session_id = ?
       AND row_index >= ?
     ORDER BY row_index ASC
     LIMIT ?`,
    [input.schema]
  );
  const rowRecords = await connectionManager.executeQuery(rowsSQL, [input.importSessionId, input.offset, input.limit]);
  const rows = (Array.isArray(rowRecords) ? rowRecords : []).map((row: { row_json: unknown }) => parseJsonColumn<FileRow>(row.row_json, {} as FileRow));

  return {
    rows,
    rowCount: Number(session.row_count),
    fileName: session.file_id,
    summary: parseJsonColumn<TransformSummary>(session.summary_json, {
      treesTransformed: 0,
      stemsJoined: 0,
      blankQuadratCount: 0,
      tagMismatchCount: 0,
      orphanStemsEmitted: 0,
      duplicateTreeTags: 0,
      duplicateGlobalIds: 0,
      missingRequired: 0,
      totalRows: Number(session.row_count) || 0
    }),
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
}): Promise<{ rows: FileRow[]; rowCount: number; fileName: string; summary: TransformSummary; warnings: TransformWarning[] }> {
  await ensureArcgisImportTables(input.schema);
  const connectionManager = ConnectionManager.getInstance();

  const sessionSQL = format(
    `SELECT import_session_id, plot_id, census_id, user_id, file_id, row_count, summary_json, warnings_json, state
     FROM ??.arcgis_import_sessions WHERE import_session_id = ? LIMIT 1`,
    [input.schema]
  );
  const sessionRows = await connectionManager.executeQuery(sessionSQL, [input.importSessionId]);
  const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
  assertUploadableArcgisSession(session, {
    userId: input.userId,
    plotID: input.plotID,
    censusID: input.censusID,
    fileName: input.fileName
  });

  const rowsSQL = format(`SELECT row_json FROM ??.arcgis_import_rows WHERE import_session_id = ? ORDER BY row_index ASC`, [input.schema]);
  const rowRecords = await connectionManager.executeQuery(rowsSQL, [input.importSessionId]);
  const rows = (Array.isArray(rowRecords) ? rowRecords : []).map((row: { row_json: unknown }) => parseJsonColumn<FileRow>(row.row_json, {} as FileRow));

  return {
    rows,
    rowCount: Number(session.row_count),
    fileName: session.file_id,
    summary: parseJsonColumn<TransformSummary>(session.summary_json, {
      treesTransformed: 0,
      stemsJoined: 0,
      blankQuadratCount: 0,
      tagMismatchCount: 0,
      orphanStemsEmitted: 0,
      duplicateTreeTags: 0,
      duplicateGlobalIds: 0,
      missingRequired: 0,
      totalRows: Number(session.row_count) || 0
    }),
    warnings: parseJsonColumn<TransformWarning[]>(session.warnings_json, [])
  };
}
