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

interface RecordMutationBase {
  /**
   * The mutation's own transaction executor. The changelog write MUST share the
   * mutation's connection so the two commit or roll back together: a rolled-back
   * edit must leave no log row, and a log row must always correspond to a
   * committed change.
   */
  tx: TxExecutor;
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

const INSERT_CHANGELOG_ROW = `INSERT INTO ??.unifiedchangelog
   (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
 VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`;

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
