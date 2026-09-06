import { describe, it, expect } from 'vitest';
import os from 'os';
import {
  SCHEMA_GATE_TABLE,
  SchemaGateUnavailableError,
  currentRunRef,
  pruneGateRows,
  readQuarantinedSchemas,
  readSchemaGateRows,
  recordGatePass,
  recordGateQuarantine,
  recordGateBlock
} from './schema-gate';
import type { SqlExecutor } from './schema-cli';

const ER_NO_SUCH_TABLE = 1146;
const ER_ACCESS_DENIED = 1045;

interface FakeRow {
  SchemaName: string;
  LastPassedAt: Date | null;
  LastFailedAt: Date | null;
  QuarantinedAt: Date | null;
  QuarantineReason: string | null;
  LastRunRef: string | null;
}

/** Minimal in-memory catalog: answers the exact SQL shapes schema-gate.ts issues. */
class FakeCatalog {
  rows = new Map<string, FakeRow>();
  statements: string[] = [];
  failWithErrno: number | null = null;

  exec: SqlExecutor = async (sql, params = []) => {
    this.statements.push(sql);
    if (this.failWithErrno !== null) {
      const error = new Error(`fake mysql error ${this.failWithErrno}`) as Error & { errno: number };
      error.errno = this.failWithErrno;
      throw error;
    }
    if (sql.startsWith('SELECT')) return [...this.rows.values()] as unknown as Awaited<ReturnType<SqlExecutor>>;
    if (sql.startsWith('DELETE')) {
      this.rows.delete(String(params[0]));
      return [];
    }
    if (sql.startsWith('INSERT')) {
      const schema = String(params[0]);
      const existing = this.rows.get(schema) ?? {
        SchemaName: schema,
        LastPassedAt: null,
        LastFailedAt: null,
        QuarantinedAt: null,
        QuarantineReason: null,
        LastRunRef: null
      };
      if (sql.includes('LastPassedAt = NOW()')) {
        this.rows.set(schema, { ...existing, LastPassedAt: new Date(), QuarantinedAt: null, QuarantineReason: null, LastRunRef: String(params[1]) });
      } else if (sql.includes('COALESCE(QuarantinedAt, NOW())')) {
        this.rows.set(schema, {
          ...existing,
          LastFailedAt: new Date(),
          QuarantinedAt: existing.QuarantinedAt ?? new Date(),
          QuarantineReason: String(params[1]),
          LastRunRef: String(params[2])
        });
      } else {
        this.rows.set(schema, { ...existing, LastFailedAt: new Date(), LastRunRef: String(params[1]) });
      }
      return [];
    }
    throw new Error(`FakeCatalog does not understand: ${sql}`);
  };
}

describe('schema-gate', () => {
  it('names the table the catalog migration creates', () => {
    expect(SCHEMA_GATE_TABLE).toBe('schema_contract_gate');
  });

  it('reads rows keyed by lower-cased schema name', async () => {
    const catalog = new FakeCatalog();
    catalog.rows.set('forestgeo_Mixed', {
      SchemaName: 'forestgeo_Mixed',
      LastPassedAt: new Date(),
      LastFailedAt: null,
      QuarantinedAt: null,
      QuarantineReason: null,
      LastRunRef: 'r'
    });

    const rows = await readSchemaGateRows(catalog.exec);
    console.log(`[gate read] keys=${JSON.stringify([...rows.keys()])}`);

    expect([...rows.keys()]).toEqual(['forestgeo_mixed']);
    expect(rows.get('forestgeo_mixed')?.lastPassedAt).toBeInstanceOf(Date);
    // The stored casing is preserved so writes address the row MySQL actually has.
    expect(rows.get('forestgeo_mixed')?.schemaName).toBe('forestgeo_Mixed');
  });

  it('maps a missing table to SchemaGateUnavailableError and lets other errors through', async () => {
    const missing = new FakeCatalog();
    missing.failWithErrno = ER_NO_SUCH_TABLE;
    await expect(readSchemaGateRows(missing.exec)).rejects.toBeInstanceOf(SchemaGateUnavailableError);
    await expect(readSchemaGateRows(missing.exec)).rejects.toThrow(/apply-catalog-migrations/);

    const denied = new FakeCatalog();
    denied.failWithErrno = ER_ACCESS_DENIED;
    await expect(readSchemaGateRows(denied.exec)).rejects.not.toBeInstanceOf(SchemaGateUnavailableError);
  });

  it('quarantine keeps the first QuarantinedAt and pass clears it', async () => {
    const catalog = new FakeCatalog();
    await recordGateQuarantine(catalog.exec, 'forestgeo_new', 'DRIFT [stems] column "X" missing', 'run-1');
    const first = catalog.rows.get('forestgeo_new')!.QuarantinedAt;
    await new Promise(resolve => setTimeout(resolve, 5));
    await recordGateQuarantine(catalog.exec, 'forestgeo_new', 'DRIFT again', 'run-2');
    console.log(`[gate quarantine] first=${first?.toISOString()} after=${catalog.rows.get('forestgeo_new')!.QuarantinedAt?.toISOString()}`);

    expect(catalog.rows.get('forestgeo_new')!.QuarantinedAt).toBe(first);
    expect(catalog.rows.get('forestgeo_new')!.QuarantineReason).toBe('DRIFT again');

    const quarantined = await readQuarantinedSchemas(catalog.exec);
    expect([...quarantined.keys()]).toEqual(['forestgeo_new']);

    await recordGatePass(catalog.exec, 'forestgeo_new', 'run-3');
    const row = catalog.rows.get('forestgeo_new')!;
    expect(row.QuarantinedAt).toBeNull();
    expect(row.QuarantineReason).toBeNull();
    expect(row.LastPassedAt).toBeInstanceOf(Date);
    expect((await readQuarantinedSchemas(catalog.exec)).size).toBe(0);
  });

  it('block records a failure without touching quarantine', async () => {
    const catalog = new FakeCatalog();
    await recordGatePass(catalog.exec, 'forestgeo_old', 'run-1');
    await recordGateBlock(catalog.exec, 'forestgeo_old', 'run-2');
    const row = catalog.rows.get('forestgeo_old')!;
    console.log(`[gate block] passedAt=${row.LastPassedAt?.toISOString()} failedAt=${row.LastFailedAt?.toISOString()} quarantinedAt=${row.QuarantinedAt}`);

    expect(row.LastFailedAt).toBeInstanceOf(Date);
    expect(row.QuarantinedAt).toBeNull();
    expect(row.LastPassedAt).toBeInstanceOf(Date);
  });

  it('prunes only rows whose schema was not discovered', async () => {
    const catalog = new FakeCatalog();
    await recordGatePass(catalog.exec, 'forestgeo_keep', 'r');
    await recordGatePass(catalog.exec, 'forestgeo_gone', 'r');

    const pruned = await pruneGateRows(catalog.exec, ['forestgeo_keep']);
    console.log(`[gate prune] pruned=${JSON.stringify(pruned)} remaining=${JSON.stringify([...catalog.rows.keys()])}`);

    expect(pruned).toEqual(['forestgeo_gone']);
    expect([...catalog.rows.keys()]).toEqual(['forestgeo_keep']);
  });

  it('matches the discovery list case-insensitively when pruning', async () => {
    const catalog = new FakeCatalog();
    await recordGatePass(catalog.exec, 'forestgeo_Keep', 'r');

    expect(await pruneGateRows(catalog.exec, ['FORESTGEO_KEEP'])).toEqual([]);
    expect(catalog.rows.size).toBe(1);
  });

  it('refuses to prune when discovery returned nothing', async () => {
    const catalog = new FakeCatalog();
    await recordGatePass(catalog.exec, 'forestgeo_keep', 'r');

    expect(await pruneGateRows(catalog.exec, [])).toEqual([]);
    expect(catalog.rows.size).toBe(1);
  });

  it('builds the run ref from Actions env, else hostname', () => {
    expect(currentRunRef({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'Smithsonian/ForestGEO', GITHUB_RUN_ID: '42' })).toBe(
      'https://github.com/Smithsonian/ForestGEO/actions/runs/42'
    );
    expect(currentRunRef({})).toBe(`local:${os.hostname()}`);
  });
});
