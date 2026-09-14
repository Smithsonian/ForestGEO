/**
 * App-side view of catalog.schema_contract_gate (see #429).
 *
 * A quarantined schema failed the deploy contract gate and has never passed it,
 * so the running app code may be incompatible with it. Site-scoped routes refuse
 * such schemas with 503 SCHEMA_QUARANTINED until a later deploy passes the gate
 * and clears QuarantinedAt. The table is written only by scripts/apply-schema-
 * migrations.ts; this module only reads it.
 *
 * Node runtime only: never import from lib/authz.ts or middleware.
 */

import { NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export const SCHEMA_QUARANTINE_CACHE_TTL_MS = 60_000;
export const SCHEMA_QUARANTINED_CODE = 'SCHEMA_QUARANTINED';
export const SCHEMA_GATE_UNAVAILABLE_CODE = 'SCHEMA_GATE_UNAVAILABLE';

const SCHEMA_GATE_TABLE = 'catalog.schema_contract_gate';
const ER_NO_SUCH_TABLE = 1146;
const QUARANTINED_SCHEMAS_QUERY = `SELECT SchemaName, QuarantinedAt, QuarantineReason, LastRunRef FROM ${SCHEMA_GATE_TABLE} WHERE QuarantinedAt IS NOT NULL`;

export interface QuarantineRecord {
  schemaName: string;
  quarantinedAt: Date;
  reason: string;
  runRef: string | null;
}

export type QuarantineReader = () => Promise<QuarantineRecord[]>;

interface QuarantineCache {
  records: Map<string, QuarantineRecord>;
  expiresAt: number;
}

let cache: QuarantineCache | null = null;
let missingTableWarned = false;

function isNoSuchTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { errno?: unknown }).errno === ER_NO_SUCH_TABLE;
}

function warnMissingGateTableOnce(): void {
  if (missingTableWarned) return;
  ailogger.warn(`[schema-quarantine] ${SCHEMA_GATE_TABLE} does not exist; catalog migrations have not run on this server. Treating no schema as quarantined.`);
  missingTableWarned = true;
}

function toRecord(row: Record<string, unknown>): QuarantineRecord {
  return {
    schemaName: String(row.SchemaName),
    quarantinedAt: row.QuarantinedAt instanceof Date ? row.QuarantinedAt : new Date(String(row.QuarantinedAt)),
    reason: row.QuarantineReason === null || row.QuarantineReason === undefined ? '' : String(row.QuarantineReason),
    runRef: row.LastRunRef === null || row.LastRunRef === undefined ? null : String(row.LastRunRef)
  };
}

async function readQuarantinedFromCatalog(): Promise<QuarantineRecord[]> {
  const connectionManager = ConnectionManager.getInstance();
  try {
    const rows = await connectionManager.executeQuery(QUARANTINED_SCHEMAS_QUERY);
    return (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).map(toRecord);
  } finally {
    await connectionManager.closeConnection();
  }
}

async function loadQuarantined(reader: QuarantineReader, now: number): Promise<Map<string, QuarantineRecord>> {
  if (cache && cache.expiresAt > now) return cache.records;

  let records: QuarantineRecord[];
  try {
    records = await reader();
  } catch (error) {
    // A server whose catalog migrations have not run yet has no gate table. That
    // is the ONLY tolerated failure: anything else (auth, timeout, connectivity)
    // must reach the caller, which fails the request closed with a 503.
    if (!isNoSuchTableError(error)) throw error;
    warnMissingGateTableOnce();
    records = [];
  }

  cache = { records: new Map(records.map(record => [record.schemaName.toLowerCase(), record])), expiresAt: now + SCHEMA_QUARANTINE_CACHE_TTL_MS };
  return cache.records;
}

export async function findSchemaQuarantine(
  schema: string,
  reader: QuarantineReader = readQuarantinedFromCatalog,
  now: number = Date.now()
): Promise<QuarantineRecord | null> {
  const records = await loadQuarantined(reader, now);
  return records.get(schema.toLowerCase()) ?? null;
}

export function invalidateSchemaQuarantineCache(): void {
  cache = null;
}

export function schemaQuarantinedResponse(record: QuarantineRecord): NextResponse {
  const quarantinedAt = record.quarantinedAt.toISOString();
  return NextResponse.json(
    {
      error: `Site ${record.schemaName} is quarantined: its database schema failed the deploy contract gate on ${quarantinedAt}. It is released automatically when a deploy passes.`,
      code: SCHEMA_QUARANTINED_CODE,
      schema: record.schemaName,
      quarantinedAt,
      reason: record.reason,
      runRef: record.runRef
    },
    { status: HTTPResponses.SERVICE_UNAVAILABLE }
  );
}

export function schemaGateUnavailableResponse(error: unknown): NextResponse {
  const detail = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    { error: `schema contract gate unavailable: ${detail}`, code: SCHEMA_GATE_UNAVAILABLE_CODE },
    { status: HTTPResponses.SERVICE_UNAVAILABLE }
  );
}
