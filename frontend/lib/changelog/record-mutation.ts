import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

/**
 * Append-only audit writer for `unifiedchangelog`.
 *
 * Grid-driven metadata mutations (plots, census, quadrats, species, personnel,
 * attributes) had no audit trail: the trigger-based system these tables were
 * supposed to rely on was commented out in 2025-05 and no trigger has existed on
 * the server since. This writer closes the application path.
 *
 * It does NOT close the raw-SQL path — a change made outside the app still goes
 * unrecorded, and only a database trigger or binlog inspection would catch it.
 */

export enum ChangelogOperation {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE'
}

export type ChangelogRowState = Record<string, unknown>;

/**
 * mysql2 returns a BIT(1) column as a one-byte Buffer, which JSON.stringify writes as
 * `{"type":"Buffer","data":[1]}` and Recent Changes would show as an object. Callers that
 * capture images with `SELECT *` pass them through this to record 0/1 instead.
 */
export function normalizeBitColumns(row: ChangelogRowState): ChangelogRowState {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, value instanceof Uint8Array && value.length === 1 ? value[0] : value]));
}

interface RecordMutationBase {
  /**
   * The mutation's own transaction executor. The changelog write MUST share the
   * mutation's connection so the two commit or roll back together: a rolled-back
   * edit must leave no log row, and a log row must always correspond to a
   * committed change.
   */
  tx: Pick<TxExecutor, 'query'>;
  schema: string;
  /** The table actually mutated — never a view name, never a stand-in. */
  tableName: string;
  /** Primary key of the affected row. Stringified: the column is varchar(255). */
  recordID: string | number;
  changedBy: string;
  plotID?: number | null;
  censusID?: number | null;
}

/**
 * The three operations carry different state, and the discriminated union makes
 * the mapping a compile error to get wrong rather than a log that lies:
 * INSERT has only an after-state, DELETE has only a before-state, UPDATE has both.
 */
export type RecordMutationOptions =
  | (RecordMutationBase & { operation: ChangelogOperation.INSERT; newRowState: ChangelogRowState })
  | (RecordMutationBase & {
      operation: ChangelogOperation.UPDATE;
      /**
       * `null` records that the prior state was not captured — the only honest
       * answer for an INSERT ... ON DUPLICATE KEY UPDATE, which overwrites the
       * row before anything can read it. Every path that CAN read the prior
       * state must pass it; fabricating an empty object would claim the row
       * previously had no fields.
       */
      oldRowState: ChangelogRowState | null;
      newRowState: ChangelogRowState;
    })
  | (RecordMutationBase & { operation: ChangelogOperation.DELETE; oldRowState: ChangelogRowState });

// OldRowState/NewRowState bind through CONVERT(? USING utf8mb4): this prepared
// statement otherwise hit ER_INVALID_JSON_CHARSET (3144) against real MySQL.
// CONVERT(NULL USING utf8mb4) is still NULL, preserving SQL NULL on the absent side.
const INSERT_CHANGELOG_ROW = `INSERT INTO ??.unifiedchangelog
   (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
 VALUES (?, ?, ?, CONVERT(? USING utf8mb4), CONVERT(? USING utf8mb4), NOW(), ?, ?, ?)`;

function serializeRowState(state: ChangelogRowState | null | undefined): string | null {
  // `null`, not the string 'null': the absent side of the change must read as
  // SQL NULL so a consumer can tell "no prior state" from "prior state was null".
  return state === undefined || state === null ? null : JSON.stringify(state);
}

/**
 * PlotID/CensusID are nullable ints. Callers frequently resolve them from a
 * cookie via `parseInt(... ?? '0')`, which yields 0 when there is no context —
 * and a stored 0 would assert a plot/census that does not exist. Record the
 * absence instead of inventing an id.
 */
function normalizeScopeID(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export class ChangelogWriteError extends Error {
  readonly operation: ChangelogOperation;
  readonly tableName: string;
  readonly recordID: string;
  override readonly cause: unknown;

  constructor(operation: ChangelogOperation, tableName: string, recordID: string | number, cause: unknown) {
    const normalizedRecordID = String(recordID);
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to record ${operation} audit for ${tableName} record ${JSON.stringify(normalizedRecordID)}: ${causeMessage}`);
    this.name = 'ChangelogWriteError';
    this.operation = operation;
    this.tableName = tableName;
    this.recordID = normalizedRecordID;
    this.cause = cause;
  }
}

export async function recordMutation(options: RecordMutationOptions): Promise<void> {
  const { tx, schema, tableName, recordID, operation, changedBy, plotID, censusID } = options;
  const oldRowState = operation === ChangelogOperation.INSERT ? undefined : options.oldRowState;
  const newRowState = operation === ChangelogOperation.DELETE ? undefined : options.newRowState;
  // Identifier validation is an input-boundary failure, not a changelog write
  // failure; preserve its specific error for callers and security tests.
  const changelogSQL = safeFormatQuery(schema, INSERT_CHANGELOG_ROW);

  try {
    await tx.query(changelogSQL, [
      tableName,
      String(recordID),
      operation,
      serializeRowState(oldRowState),
      serializeRowState(newRowState),
      changedBy,
      normalizeScopeID(plotID),
      normalizeScopeID(censusID)
    ]);
  } catch (error: unknown) {
    throw new ChangelogWriteError(operation, tableName, recordID, error);
  }
}

const DELETED_ROWS_INSERT_CHUNK_SIZE = 500;

export interface DeletedRowImage {
  recordID: string | number;
  oldRowState: ChangelogRowState;
}

/**
 * Bulk form of a DELETE `recordMutation` for one table: one changelog row per entry in
 * `rows`, written in multi-row INSERTs of at most DELETED_ROWS_INSERT_CHUNK_SIZE rows so a
 * whole-table wipe (clearcensusfull on the last census, #507) is not one round trip per
 * row. Same transaction contract as `recordMutation`. Returns the number of rows written.
 */
export async function recordDeletedRows(options: {
  tx: Pick<TxExecutor, 'query'>;
  schema: string;
  tableName: string;
  rows: DeletedRowImage[];
  changedBy: string;
  plotID?: number | null;
  censusID?: number | null;
}): Promise<number> {
  const { tx, schema, tableName, rows, changedBy, plotID, censusID } = options;
  let totalWritten = 0;
  for (let start = 0; start < rows.length; start += DELETED_ROWS_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + DELETED_ROWS_INSERT_CHUNK_SIZE);
    const valueTuples = chunk.map(() => '(?, ?, ?, CONVERT(? USING utf8mb4), NULL, NOW(), ?, ?, ?)').join(', ');
    const sql = safeFormatQuery(
      schema,
      `INSERT INTO ??.unifiedchangelog
         (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
       VALUES ${valueTuples}`
    );
    const bindings = chunk.flatMap(row => [
      tableName,
      String(row.recordID),
      ChangelogOperation.DELETE,
      serializeRowState(row.oldRowState),
      changedBy,
      normalizeScopeID(plotID),
      normalizeScopeID(censusID)
    ]);
    try {
      const result = await tx.query(sql, bindings);
      totalWritten += Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
    } catch (error: unknown) {
      throw new ChangelogWriteError(ChangelogOperation.DELETE, tableName, chunk.map(row => String(row.recordID)).join(','), error);
    }
  }
  return totalWritten;
}
