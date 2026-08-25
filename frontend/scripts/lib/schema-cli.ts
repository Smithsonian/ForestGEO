/**
 * Shared connection + host-safety plumbing for the schema migrate/verify CLIs
 * (apply-schema-migrations.ts and check-schema-contract.ts).
 *
 * The host allow-list is security-relevant, so it lives here in exactly one place:
 * `--all-sites` targets the Azure server (validation-deploy env: AZURE_SQL_PASSWORD)
 * and `--schema` targets a LOCAL test database only (TEST_DB_* env), so the
 * single-schema tool can never silently touch production.
 */

import mysql from 'mysql2/promise';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';

export const AZURE_HOST = 'forestgeo-mysqldataserver.mysql.database.azure.com';
export const AZURE_USER = 'azureroot';
export const AZURE_PORT = 3306;

export const LOCAL_HOSTS = ['localhost', '127.0.0.1'] as const;

export const SITE_SCHEMA_LIKE = 'forestgeo\\_%';
export const SITE_SCHEMA_NAME = /^forestgeo_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;

/** Executes SQL and returns result rows (empty for writes/DDL). */
export type SqlExecutor = (sql: string, params?: unknown[]) => Promise<SchemaQueryRow[]>;

export class UnexpectedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnexpectedHostError';
  }
}

/** Refuses to run against a host outside the expected deployment environment. */
export function assertExpectedHost(host: string | undefined, allowedHosts: readonly string[]): void {
  if (!host) {
    throw new UnexpectedHostError(`REFUSING TO RUN: no database host resolved. Expected one of: ${allowedHosts.join(', ')}.`);
  }
  if (!allowedHosts.includes(host)) {
    throw new UnexpectedHostError(`REFUSING TO RUN: host "${host}" is not an expected deployment target. Expected one of: ${allowedHosts.join(', ')}.`);
  }
}

export interface ConnectionSettings {
  host: string;
  user: string;
  password: string;
  port: number;
  allowedHosts: readonly string[];
}

/**
 * --all-sites -> Azure credentials (AZURE_SQL_PASSWORD required), Azure host only.
 * --schema    -> LOCAL test credentials (TEST_DB_* env), localhost only.
 */
export function resolveConnectionSettings(allSites: boolean): ConnectionSettings {
  if (allSites) {
    const password = process.env.AZURE_SQL_PASSWORD;
    if (!password) {
      throw new Error('AZURE_SQL_PASSWORD is required for --all-sites (set it in the environment or .env.local).');
    }
    return { host: AZURE_HOST, user: AZURE_USER, password, port: AZURE_PORT, allowedHosts: [AZURE_HOST] };
  }
  return {
    host: process.env.TEST_DB_HOST ?? 'localhost',
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'testpassword',
    port: Number.parseInt(process.env.TEST_DB_PORT ?? '3306', 10),
    allowedHosts: LOCAL_HOSTS
  };
}

export interface SchemaConnectionOptions {
  database?: string;
  multipleStatements?: boolean;
}

/**
 * Opens a mysql2 connection, adding SSL only for the Azure host.
 *
 * `timezone: 'Z'` is load-bearing, not cosmetic. Without it mysql2 interprets
 * DATETIME columns in the Node process's LOCAL zone, so `toISOString()` on a
 * returned Date silently shifts every timestamp by the local UTC offset. On a
 * PDT machine that reads a 2026-07-27 18:28 UTC row back as "01:28Z" the next
 * day — which during the Harvard triage looked like an unexplained overnight
 * writer until the skew was measured. The runtime pool already pins 'Z' (see
 * lib/db/poolmonitorsingleton.ts); the CLI path must match it.
 */
export async function createSchemaCliConnection(settings: ConnectionSettings, options: SchemaConnectionOptions = {}): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: settings.host,
    user: settings.user,
    password: settings.password,
    port: settings.port,
    timezone: 'Z',
    multipleStatements: options.multipleStatements ?? false,
    ...(options.database !== undefined && { database: options.database }),
    ...(settings.host === AZURE_HOST && { ssl: { rejectUnauthorized: true } })
  });
}

export function executorFor(connection: mysql.Connection): SqlExecutor {
  return async (sql, params) => {
    const [rows] = await connection.query(sql, params ?? []);
    return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
  };
}

export async function discoverSiteSchemas(connection: mysql.Connection): Promise<string[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ? ESCAPE '\\\\' ORDER BY SCHEMA_NAME`,
    [SITE_SCHEMA_LIKE]
  );
  return rows.map(row => String(row.schema_name)).filter(schema => SITE_SCHEMA_NAME.test(schema));
}
