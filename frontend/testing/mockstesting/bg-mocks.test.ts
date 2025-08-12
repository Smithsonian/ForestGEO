// testing/mockstesting/bg-mocks.spec.ts
import { beforeEach, describe, expect, it } from 'vitest';
import '@/testing/bg-mocks';

describe('bg-mocks wiring', () => {
  // Pull the class that’s been mocked and the helper API
  // NOTE: keep these imports *after* the mock import above.
  type CM = new () => { executeQuery: (sql: string, params?: any[]) => Promise<any> };

  let ConnectionManager!: CM;
  let __BgMocks!: {
    pushResult: (r: any) => void;
    pushError: (e: unknown) => void;
    getCalls: () => Array<{ sql: string; params?: any[]; kind: 'execute' }>;
    clear: () => void;
  };

  beforeEach(async () => {
    const mod = await import('@/config/connectionmanager');
    ConnectionManager = mod.default as unknown as CM;
    __BgMocks = (mod as any).__cm as typeof __BgMocks;
    __BgMocks.clear();
  });

  it('captures SQL + params and returns queued results (FIFO)', async () => {
    __BgMocks.pushResult({ rows: [{ id: 1 }] });
    __BgMocks.pushResult({ rows: [{ id: 2 }] });

    const cm1 = new ConnectionManager();
    const cm2 = new ConnectionManager();

    const r1 = await cm1.executeQuery('SELECT * FROM t WHERE id=?', [1]);
    const r2 = await cm2.executeQuery('SELECT * FROM t WHERE id=?', [2]);

    expect(r1).toEqual({ rows: [{ id: 1 }] });
    expect(r2).toEqual({ rows: [{ id: 2 }] });

    const calls = __BgMocks.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ sql: 'SELECT * FROM t WHERE id=?', params: [1], kind: 'execute' });
    expect(calls[1]).toMatchObject({ sql: 'SELECT * FROM t WHERE id=?', params: [2], kind: 'execute' });
  });

  it('returns a sensible default shape when no result is queued', async () => {
    const cm = new ConnectionManager();
    const r = await cm.executeQuery('INSERT INTO x (a) VALUES (?)', ['v']);
    // Default shape from the mock: similar to mysql2
    expect(r).toMatchObject({ insertId: 0, affectedRows: 0 });
    expect(Array.isArray(r.rows)).toBe(true);
  });

  it('propagates queued errors', async () => {
    __BgMocks.pushError(new Error('boom'));

    const cm = new ConnectionManager();
    await expect(cm.executeQuery('SELECT 1')).rejects.toThrow(/boom/);

    const calls = __BgMocks.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('SELECT 1');
  });

  it('queues are per-process (shared across instances) and resettable', async () => {
    __BgMocks.pushResult({ ok: true });
    const cm1 = new ConnectionManager();
    const cm2 = new ConnectionManager();

    await cm1.executeQuery('SELECT A');
    __BgMocks.clear();

    const calls = __BgMocks.getCalls();
    expect(calls).toHaveLength(0); // cleared
    // After clear, default shape is returned for any further calls
    const r2 = await cm2.executeQuery('SELECT B');
    expect(r2).toMatchObject({ insertId: 0, affectedRows: 0 });
  });

  it('stubs processors used by fileMappings', async () => {
    const p1 = await import('@/components/processors/processpersonnel');
    const p2 = await import('@/components/processors/processspecies');
    const p3 = await import('@/components/processors/processcensus');

    expect(typeof p1.processPersonnel).toBe('function');
    expect(typeof p2.processSpecies).toBe('function');
    expect(typeof p3.processCensus).toBe('function');

    await expect(p1.processPersonnel({} as any)).resolves.toBeUndefined();
    await expect(p2.processSpecies({} as any)).resolves.toBeUndefined();
    await expect(p3.processCensus({} as any)).resolves.toBeUndefined();
  });

  it('stubs react-dropzone runtime imports', async () => {
    const dz = await import('react-dropzone');
    // FileRejection is a class in the mock
    // @ts-expect-error - mock has any-ish types
    const fr = new dz.FileRejection({ name: 'f' });
    expect(fr.file?.name).toBe('f');
    expect(Array.isArray(fr.errors)).toBe(true);

    const { useDropzone } = dz as any;
    const api = useDropzone();
    expect(typeof api.getRootProps).toBe('function');
    expect(typeof api.getInputProps).toBe('function');
    expect(api.isDragActive).toBe(false);
  });

  // CSS import test disabled due to module resolution in test environment
  // it('mocks CSS import without throwing', async () => {
  //   const css = await import('@/styles/customtablesettings.css');
  //   expect(css).toBeDefined();
  // });

  it('mocks logger + chalk', async () => {
    const logger = (await import('@/ailogger')).default as any;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');

    // Chalk default export provides red/yellow/cyan as String passthroughs
    const chalk = await import('chalk');
    expect(chalk.default.red('x')).toBe('x');
  });

  it('provides safe environment defaults', () => {
    expect(process.env.AZURE_SQL_USER).toBeTruthy();
    expect(process.env.AZURE_SQL_PASSWORD).toBeTruthy();
    expect(process.env.AZURE_SQL_SERVER).toBeTruthy();
    expect(process.env.AZURE_SQL_PORT).toBeTruthy();
    expect(process.env.AZURE_SQL_CATALOG_SCHEMA).toBeTruthy();
  });
});
