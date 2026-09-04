/**
 * Read/write access to catalog.schema_contract_gate for the deploy CLIs.
 *
 * One row per site schema. The apply script writes outcomes; the read-only check
 * and the procedure/view sweeps read them so a quarantined schema is reported and
 * skipped, never re-failed. The app reads the same table through
 * lib/schema-quarantine.ts. Nothing else writes it — release is earned by a
 * passing apply run, never by hand.
 */

import os from 'os';
import { CATALOG_DATABASE_NAME } from '../../db/migrations/catalog-manifest';
import type { SqlExecutor } from './schema-cli';

export const SCHEMA_GATE_TABLE = 'schema_contract_gate';

const ER_NO_SUCH_TABLE = 1146;

export interface SchemaGateRow {
  schemaName: string;
  lastPassedAt: Date | null;
  lastFailedAt: Date | null;
  quarantinedAt: Date | null;
  quarantineReason: string | null;
  lastRunRef: string | null;
}

/**
 * Environment lookup shape for the run-ref and reporting helpers. Deliberately
 * not the global process-env type: next/types/global.d.ts augments it with a
 * REQUIRED NODE_ENV, so a caller could not pass a small literal env.
 */
export type EnvVars = Readonly<Record<string, string | undefined>>;

export class SchemaGateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaGateUnavailableError';
  }
}

function qualifiedGateTable(): string {
  return `\`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\``;
}

function isNoSuchTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { errno?: unknown }).errno === ER_NO_SUCH_TABLE;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toGateRow(row: Record<string, unknown>): SchemaGateRow {
  return {
    schemaName: String(row.SchemaName),
    lastPassedAt: toDate(row.LastPassedAt),
    lastFailedAt: toDate(row.LastFailedAt),
    quarantinedAt: toDate(row.QuarantinedAt),
    quarantineReason: toNullableString(row.QuarantineReason),
    lastRunRef: toNullableString(row.LastRunRef)
  };
}

/** Actions run URL when running in CI, otherwise a hostname-tagged local marker. */
export function currentRunRef(env: EnvVars = process.env): string {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return `local:${os.hostname()}`;
}

/** Every gate row, keyed by lower-cased schema name. */
export async function readSchemaGateRows(exec: SqlExecutor): Promise<Map<string, SchemaGateRow>> {
  let rows: Record<string, unknown>[];
  try {
    rows = await exec(`SELECT SchemaName, LastPassedAt, LastFailedAt, QuarantinedAt, QuarantineReason, LastRunRef FROM ${qualifiedGateTable()}`);
  } catch (error) {
    if (isNoSuchTableError(error)) {
      throw new SchemaGateUnavailableError(
        `${CATALOG_DATABASE_NAME}.${SCHEMA_GATE_TABLE} does not exist. Run "npx tsx scripts/apply-catalog-migrations.ts --apply" ` +
          `(add --azure for the Azure server) before the schema gate.`
      );
    }
    throw error;
  }
  return new Map(rows.map(row => [String(row.SchemaName).toLowerCase(), toGateRow(row)]));
}

/** Only the rows with QuarantinedAt set, keyed by lower-cased schema name. */
export async function readQuarantinedSchemas(exec: SqlExecutor): Promise<Map<string, SchemaGateRow>> {
  const all = await readSchemaGateRows(exec);
  return new Map([...all].filter(([, row]) => row.quarantinedAt !== null));
}

export async function recordGatePass(exec: SqlExecutor, schemaName: string, runRef: string): Promise<void> {
  await exec(
    `INSERT INTO ${qualifiedGateTable()} (SchemaName, LastPassedAt, LastRunRef)
     VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE LastPassedAt = NOW(), QuarantinedAt = NULL, QuarantineReason = NULL, LastRunRef = VALUES(LastRunRef)`,
    [schemaName, runRef]
  );
}

/** Sets QuarantinedAt only if not already set, so the first quarantine time survives re-runs. */
export async function recordGateQuarantine(exec: SqlExecutor, schemaName: string, reason: string, runRef: string): Promise<void> {
  await exec(
    `INSERT INTO ${qualifiedGateTable()} (SchemaName, LastFailedAt, QuarantinedAt, QuarantineReason, LastRunRef)
     VALUES (?, NOW(), NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE LastFailedAt = NOW(), QuarantinedAt = COALESCE(QuarantinedAt, NOW()), QuarantineReason = VALUES(QuarantineReason), LastRunRef = VALUES(LastRunRef)`,
    [schemaName, reason, runRef]
  );
}

/** A previously-passing schema failed: record the failure, never quarantine. */
export async function recordGateBlock(exec: SqlExecutor, schemaName: string, runRef: string): Promise<void> {
  await exec(
    `INSERT INTO ${qualifiedGateTable()} (SchemaName, LastFailedAt, LastRunRef)
     VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE LastFailedAt = NOW(), LastRunRef = VALUES(LastRunRef)`,
    [schemaName, runRef]
  );
}

/**
 * Deletes rows for schemas that no longer exist (torn down). Refuses to act on an
 * empty discovery list — that is a discovery failure, not "every site is gone".
 */
export async function pruneGateRows(exec: SqlExecutor, discoveredSchemas: string[]): Promise<string[]> {
  if (discoveredSchemas.length === 0) return [];
  const discovered = new Set(discoveredSchemas.map(schema => schema.toLowerCase()));
  const rows = await readSchemaGateRows(exec);
  const pruned: string[] = [];
  for (const [key, row] of rows) {
    if (discovered.has(key)) continue;
    await exec(`DELETE FROM ${qualifiedGateTable()} WHERE SchemaName = ?`, [row.schemaName]);
    pruned.push(row.schemaName);
  }
  return pruned;
}
