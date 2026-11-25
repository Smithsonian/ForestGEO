import type { Connection } from 'mysql2/promise';
import { normalizeStatementParams, usesTextProtocol } from '@/lib/db/statementprotocol';

/** A mysql2 promise Connection, PoolConnection or Pool. */
export type DispatchTarget = Pick<Connection, 'query' | 'execute'>;

/** Runs one statement exactly as lib/db/primitives.ts runQuery does, and returns its rows. */
export async function runQueryDispatch(target: DispatchTarget, sql: string, params?: readonly unknown[]): Promise<unknown> {
  const normalizedParams = normalizeStatementParams(params);
  const [rows] = usesTextProtocol(sql, normalizedParams) ? await target.query(sql, normalizedParams) : await target.execute(sql, normalizedParams);
  return rows;
}
