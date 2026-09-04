/**
 * Unit tests for the deploy-validations-to-all-schemas CLI: mode parsing,
 * fail-closed dispatch, and per-schema connection ownership. Every dependency
 * is mocked here — no real SQL or connection is ever touched. Correctness of
 * deployProceduresOnly / activateValidation19 against a real schema is
 * covered by tests/integration/deploy-validations.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { main, parseMode, parseStoredProceduresSQL, withSchemaConnection, type DeployCliDeps } from './deploy-validations-to-all-schemas';

const STORED_PROCEDURES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'sql', 'storedprocedures.sql');

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    query: vi.fn().mockResolvedValue([[], []]),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as Connection;
}

function makeCliDeps(overrides: Partial<DeployCliDeps> = {}): DeployCliDeps {
  return {
    readSqlFile: vi.fn().mockReturnValue('-- sql source --'),
    createConnection: vi.fn().mockResolvedValue(makeConnection()),
    discoverSchemas: vi.fn().mockResolvedValue([]),
    checkMigrationStatus: vi.fn().mockResolvedValue({ migrated: true, missingTables: [] }),
    log: vi.fn(),
    ...overrides
  };
}

describe('parseMode', () => {
  it('defaults to legacy-full-reset with no flags', () => {
    expect(parseMode([])).toBe('legacy-full-reset');
  });

  it('recognizes --procedures-only', () => {
    expect(parseMode(['--procedures-only'])).toBe('procedures-only');
  });

  it('recognizes --activate-validation-19', () => {
    expect(parseMode(['--activate-validation-19'])).toBe('activate-validation-19');
  });

  it.each([[['--procedures-only', '--activate-validation-19']], [['--unknown-mode']]])('rejects invalid CLI mode combinations synchronously: %j', args => {
    expect(() => parseMode(args)).toThrow(/mode|argument/i);
  });
});

describe('parseStoredProceduresSQL', () => {
  it('returns each leading DROP as a separate statement for multipleStatements=false connections', () => {
    const statements = parseStoredProceduresSQL(fs.readFileSync(STORED_PROCEDURES_PATH, 'utf8'));
    const firstCreate = statements.findIndex(statement => /^create\s+procedure/i.test(statement));
    const leadingDrops = statements.slice(0, firstCreate);

    expect(firstCreate).toBeGreaterThan(0);
    expect(leadingDrops).toHaveLength(12);
    for (const statement of leadingDrops) {
      const executableSql = statement
        .split('\n')
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim();
      expect(executableSql).toMatch(/^drop\s+procedure\s+if\s+exists\s+[^;]+$/i);
    }
  });
});

describe('main CLI dispatch', () => {
  it('dispatches procedures-only mode without reading corequeries.sql', async () => {
    const deps = makeCliDeps({
      discoverSchemas: vi.fn().mockResolvedValue(['forestgeo_test']),
      checkMigrationStatus: vi.fn().mockResolvedValue({ migrated: false, missingTables: ['measurement_errors'] })
    });
    await main(['--procedures-only'], deps);
    expect(deps.readSqlFile).toHaveBeenCalledWith(expect.stringContaining('storedprocedures.sql'));
    expect(deps.readSqlFile).not.toHaveBeenCalledWith(expect.stringContaining('corequeries.sql'));
  });

  it('dispatches activate-validation-19 mode without reading any SQL file', async () => {
    const deps = makeCliDeps();
    await main(['--activate-validation-19'], deps);
    expect(deps.readSqlFile).not.toHaveBeenCalled();
  });

  it('dispatches legacy-full-reset mode (no flags), reading both SQL files', async () => {
    const deps = makeCliDeps({ discoverSchemas: vi.fn().mockResolvedValue(['forestgeo_test']) });
    await main([], deps);
    expect(deps.readSqlFile).toHaveBeenCalledWith(expect.stringContaining('corequeries.sql'));
    expect(deps.readSqlFile).toHaveBeenCalledWith(expect.stringContaining('storedprocedures.sql'));
  });

  it.each([[['--procedures-only', '--activate-validation-19']], [['--unknown-mode']]])(
    'rejects invalid CLI mode combinations before opening a connection: %j',
    async args => {
      const deps = makeCliDeps();
      await expect(main(args, deps)).rejects.toThrow(/mode|argument/i);
      expect(deps.createConnection).not.toHaveBeenCalled();
      expect(deps.readSqlFile).not.toHaveBeenCalled();
      expect(deps.discoverSchemas).not.toHaveBeenCalled();
    }
  );

  it('closes the legacy per-schema connection even when deployment fails mid-schema', async () => {
    const discoveryConn = makeConnection();
    const failingSchemaConn = makeConnection({
      query: vi.fn().mockRejectedValueOnce(new Error('boom: corequeries.sql failed'))
    });
    const deps = makeCliDeps({
      discoverSchemas: vi.fn().mockResolvedValue(['forestgeo_test']),
      createConnection: vi.fn().mockResolvedValueOnce(discoveryConn).mockResolvedValueOnce(failingSchemaConn)
    });

    await expect(main([], deps)).rejects.toThrow(/failed for 1 schema/i);

    expect(failingSchemaConn.end, 'a per-schema connection must close even when a later statement in the same schema fails').toHaveBeenCalledOnce();
    expect(discoveryConn.end).toHaveBeenCalledOnce();
  });

  it('reports a per-schema close failure alongside the primary deployment error', async () => {
    const discoveryConn = makeConnection();
    const failingSchemaConn = makeConnection({
      query: vi.fn().mockRejectedValueOnce(new Error('routine DDL failed')),
      end: vi.fn().mockRejectedValue(new Error('close failed')) as any
    });
    const deps = makeCliDeps({
      readSqlFile: vi.fn().mockReturnValue('DROP PROCEDURE IF EXISTS example;'),
      discoverSchemas: vi.fn().mockResolvedValue(['forestgeo_test']),
      createConnection: vi.fn().mockResolvedValueOnce(discoveryConn).mockResolvedValueOnce(failingSchemaConn)
    });

    await expect(main(['--procedures-only'], deps)).rejects.toThrow(/failed for 1 schema/i);
    expect(deps.log).toHaveBeenCalledWith('  FAILED: routine DDL failed (connection cleanup also failed: close failed)');
  });

  it('preserves a discovery failure when closing that connection also fails', async () => {
    const discoveryConn = makeConnection({ end: vi.fn().mockRejectedValue(new Error('discovery close failed')) as any });
    const deps = makeCliDeps({
      createConnection: vi.fn().mockResolvedValue(discoveryConn),
      discoverSchemas: vi.fn().mockRejectedValue(new Error('schema discovery failed'))
    });

    await expect(main(['--activate-validation-19'], deps)).rejects.toThrow('schema discovery failed');
    expect(deps.log).toHaveBeenCalledWith('Discovery connection cleanup failed after schema discovery failed: discovery close failed');
  });
});

describe('withSchemaConnection', () => {
  it('closes a per-schema connection when deployment fails', async () => {
    const conn = makeConnection();
    await expect(
      withSchemaConnection(
        'forestgeo_test',
        async () => {
          throw new Error('routine DDL failed');
        },
        async () => conn
      )
    ).rejects.toThrow('routine DDL failed');
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it('closes a per-schema connection on success too', async () => {
    const conn = makeConnection();
    const result = await withSchemaConnection(
      'forestgeo_test',
      async () => 'ok',
      async () => conn
    );
    expect(result).toBe('ok');
    expect(conn.end).toHaveBeenCalledOnce();
  });

  it('preserves the deployment error when closing the failed connection also errors', async () => {
    const conn = makeConnection({ end: vi.fn().mockRejectedValue(new Error('close failed')) as any });
    const deploymentError = new Error('routine DDL failed');

    await expect(
      withSchemaConnection(
        'forestgeo_test',
        async () => {
          throw deploymentError;
        },
        async () => conn
      )
    ).rejects.toBe(deploymentError);
    expect((deploymentError as Error & { cleanupError?: unknown }).cleanupError).toMatchObject({ message: 'close failed' });
  });

  it('validates the schema name before ever connecting', async () => {
    const connect = vi.fn();
    await expect(withSchemaConnection('drop database; --', async () => undefined, connect)).rejects.toThrow(/invalid|unauthorized/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
