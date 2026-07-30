import { createHash } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';

const DEFAULT_LOCK_TIMEOUT_SECONDS = 10;

/**
 * Keep the historical `provisioning:` prefix so mixed-version deployments
 * synchronize with orchestrators that still define this lock locally.
 */
function lockNameForSchema(schemaName: string): string {
  return `provisioning:${createHash('sha256').update(schemaName).digest('hex').slice(0, 48)}`;
}

/**
 * Serializes lifecycle operations that can create or destroy schema-bound work.
 * The lock is connection-scoped, so callers must release it before returning
 * the connection to its pool.
 */
export async function tryAcquireSchemaOperationLock(conn: PoolConnection, schemaName: string, timeoutSeconds = DEFAULT_LOCK_TIMEOUT_SECONDS): Promise<boolean> {
  const [rows]: any = await conn.query(`SELECT GET_LOCK(?, ?) AS gotLock`, [lockNameForSchema(schemaName), timeoutSeconds]);
  return Number(rows[0]?.gotLock ?? rows[0]?.gotlock ?? 0) === 1;
}

export async function releaseSchemaOperationLock(conn: PoolConnection, schemaName: string): Promise<void> {
  await conn.query(`SELECT RELEASE_LOCK(?)`, [lockNameForSchema(schemaName)]).catch(() => {});
}
