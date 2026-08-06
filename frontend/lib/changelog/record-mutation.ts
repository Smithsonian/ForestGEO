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
  | (RecordMutationBase & { operation: ChangelogOperation.UPDATE; oldRowState: ChangelogRowState; newRowState: ChangelogRowState })
  | (RecordMutationBase & { operation: ChangelogOperation.DELETE; oldRowState: ChangelogRowState });

const INSERT_CHANGELOG_ROW = `INSERT INTO ??.unifiedchangelog
   (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
 VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`;

function serializeRowState(state: ChangelogRowState | undefined): string | null {
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

export async function recordMutation(options: RecordMutationOptions): Promise<void> {
  const { tx, schema, tableName, recordID, operation, changedBy, plotID, censusID } = options;
  const oldRowState = operation === ChangelogOperation.INSERT ? undefined : options.oldRowState;
  const newRowState = operation === ChangelogOperation.DELETE ? undefined : options.newRowState;

  await tx.query(safeFormatQuery(schema, INSERT_CHANGELOG_ROW), [
    tableName,
    String(recordID),
    operation,
    serializeRowState(oldRowState),
    serializeRowState(newRowState),
    changedBy,
    normalizeScopeID(plotID),
    normalizeScopeID(censusID)
  ]);
}
