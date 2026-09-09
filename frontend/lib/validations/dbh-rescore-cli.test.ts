import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  buildDbhExpectedManifest,
  buildRealSweepDeps,
  dbhRuntimeConnectionOptions,
  getDbhRuntimeSettings,
  parseDbhRescoreArgs,
  runDbhRescoreCli
} from './dbh-rescore-cli';
import type { DbhSweepDependencies } from './dbh-rescore-sweep';

const deps = (): DbhSweepDependencies => ({
  discoverSchemas: vi.fn().mockResolvedValue(['forestgeo_testing']),
  discoverScopes: vi.fn().mockResolvedValue([{ schema: 'forestgeo_testing', plotID: 1, censusID: 1, plotCensusNumber: 1 }]),
  verifySchema: vi.fn().mockResolvedValue({ revision: 'r', digests: {} }),
  advisoryPreflight: vi.fn().mockResolvedValue({}),
  rescore: vi.fn(),
  writeArtifact: vi.fn(),
  now: () => 'now'
});

describe('parseDbhRescoreArgs', () => {
  it('requires narrow selectors and apply acknowledgement', () => {
    expect(parseDbhRescoreArgs(['--schema', 'forestgeo_testing', '--plot', '2'])).toMatchObject({ schema: 'forestgeo_testing', plotID: 2, apply: false });
    expect(() => parseDbhRescoreArgs(['--all-sites', '--schema', 'forestgeo_testing'])).toThrow(/exactly one/);
    expect(() => parseDbhRescoreArgs(['--schema', 'forestgeo_testing', '--census', '3'])).toThrow(/requires/);
    expect(() => parseDbhRescoreArgs(['--schema', 'forestgeo_testing', '--validations', '1'])).toThrow(/Unknown/);
    expect(() => parseDbhRescoreArgs(['--schema', 'forestgeo_testing', '--apply'])).toThrow(/requires/);
    expect(() => parseDbhRescoreArgs(['--schema', 'forestgeo_testing', '--schema', 'forestgeo_other'])).toThrow(/only once/);
    expect(() => parseDbhRescoreArgs(['--all-sites', '--plot', '1'])).toThrow(/requires --schema/);
  });

  it('accepts known SHOW CREATE formatting but rejects a substantive body change', async () => {
    const manifest = buildDbhExpectedManifest(
      'DELIMITER $$\nCREATE PROCEDURE BuildDBHChangePairs() SQL SECURITY DEFINER BEGIN SELECT 65; END $$\nCREATE PROCEDURE RunSharedDBHChangeValidations() BEGIN CALL BuildDBHChangePairs(); END $$',
      "VALUES (1, 'growth', 'description one', 'x', 'definition one');\nVALUES (2, 'shrink', 'description two', 'x', 'definition two');",
      'r'
    );
    const response =
      (tamper = false) =>
      async (sql: string) => {
        if (sql.includes('information_schema.TABLES'))
          return [
            [
              ...[
                'census',
                'coremeasurements',
                'trees',
                'stems',
                'plots',
                'cmattributes',
                'attributes',
                'measurement_error_log',
                'measurement_errors',
                'sitespecificvalidations',
                'validation_runs',
                'upload_sessions',
                'measurementssummary',
                'viewfulltable'
              ].map(TABLE_NAME => ({ TABLE_NAME }))
            ]
          ];
        if (sql.includes('SHOW CREATE'))
          return [
            [
              {
                'Create Procedure': sql.includes('BuildDBH')
                  ? 'CREATE DEFINER=`u`@`%` PROCEDURE `forestgeo_testing`.`BuildDBHChangePairs`() BEGIN SELECT ' + (tamper ? '66' : '65') + '; END'
                  : 'CREATE DEFINER=`u`@`%` PROCEDURE `forestgeo_testing`.`RunSharedDBHChangeValidations`() BEGIN CALL BuildDBHChangePairs(); END'
              }
            ]
          ];
        if (sql.includes('sitespecificvalidations'))
          return [
            [
              { ValidationID: 1, ProcedureName: 'growth', Description: 'description one', Definition: 'definition one', IsEnabled: 1 },
              { ValidationID: 2, ProcedureName: 'shrink', Description: 'description two', Definition: 'definition two', IsEnabled: 1 }
            ]
          ];
        if (sql.includes('measurement_errors')) return [[{ ErrorCode: '1' }, { ErrorCode: '2' }]];
        return [[]];
      };
    await expect(buildRealSweepDeps({ query: response() } as any, manifest).verifySchema('forestgeo_testing')).resolves.toMatchObject({ revision: 'r' });
    await expect(buildRealSweepDeps({ query: response(true) } as any, manifest).verifySchema('forestgeo_testing')).rejects.toThrow(/differs/);
  });
});

describe('DBH runtime target', () => {
  it('uses application pool settings even when TEST_DB points elsewhere', () => {
    expect(
      getDbhRuntimeSettings({
        AZURE_SQL_SERVER: '127.0.0.1',
        AZURE_SQL_USER: 'runtime',
        AZURE_SQL_PASSWORD: 'secret',
        AZURE_SQL_PORT: '3306',
        TEST_DB_HOST: 'other-host'
      })
    ).toMatchObject({ host: '127.0.0.1', user: 'runtime', port: 3306 });
  });

  it('uses verified TLS for remote DBH operator connections and plaintext only locally', () => {
    const remote = getDbhRuntimeSettings({
      AZURE_SQL_SERVER: 'forestgeo-mysqldataserver.mysql.database.azure.com',
      AZURE_SQL_USER: 'runtime',
      AZURE_SQL_PASSWORD: 'secret',
      AZURE_SQL_PORT: '3306'
    });
    const local = { ...remote, host: '127.0.0.1' };
    expect(dbhRuntimeConnectionOptions(remote)).toMatchObject({ ssl: { rejectUnauthorized: true, verifyIdentity: true } });
    expect(dbhRuntimeConnectionOptions(local)).not.toHaveProperty('ssl');
  });
});

describe('DBH expected manifest', () => {
  it('uses whole procedure and seed bodies instead of a marker substring', () => {
    const manifest = buildDbhExpectedManifest(
      'DELIMITER $$\nCREATE PROCEDURE BuildDBHChangePairs() BEGIN SELECT 1; END $$\nCREATE PROCEDURE RunSharedDBHChangeValidations() BEGIN SELECT 2; END $$',
      "VALUES (1, 'growth', 'description one', 'x', 'definition one');\nVALUES (2, 'shrink', 'description two', 'x', 'definition two');",
      'rollback-r'
    );
    expect(manifest.revision).toBe('rollback-r');
    expect(manifest.procedures.BuildDBHChangePairs).toContain('SELECT 1');
    expect(manifest.seeds).toEqual(expect.arrayContaining([expect.objectContaining({ validationID: 2, definition: 'definition two' })]));
  });

  it('builds the current deployment manifest from both SQL sources', () => {
    const manifest = buildDbhExpectedManifest(
      readFileSync(path.join(process.cwd(), 'db/sql/storedprocedures.sql'), 'utf8'),
      readFileSync(path.join(process.cwd(), 'db/sql/corequeries.sql'), 'utf8')
    );
    expect(manifest.procedures.RunSharedDBHChangeValidations).toContain('BuildDBHChangePairs');
    expect(manifest.seeds.map(seed => seed.validationID).sort()).toEqual([1, 2]);
  });

  it('discovers all-site schemas and returns clean dry-run success', async () => {
    const dependency = deps();
    const code = await runDbhRescoreCli(parseDbhRescoreArgs(['--all-sites']), dependency, vi.fn());
    expect(code).toBe(0);
    expect(dependency.discoverSchemas).toHaveBeenCalledOnce();
  });

  it('prints each read-only preflight reason and the deferred recovery point', async () => {
    const dependency = deps();
    dependency.discoverScopes = vi.fn().mockResolvedValue([
      { schema: 'forestgeo_testing', plotID: 1, censusID: 11, plotCensusNumber: 1 },
      { schema: 'forestgeo_testing', plotID: 1, censusID: 12, plotCensusNumber: 2 }
    ]);
    dependency.advisoryPreflight = vi.fn(async scope => (scope.censusID === 11 ? { deferred: 'eligible pending measurements' } : {}));
    const log = vi.fn();
    await expect(runDbhRescoreCli(parseDbhRescoreArgs(['--schema', 'forestgeo_testing']), dependency, log)).resolves.toBe(1);
    expect(log.mock.calls.map(([line]) => line)).toEqual(
      expect.arrayContaining([
        'Read-only preflight forestgeo_testing/1/11#1: eligible pending measurements',
        'Read-only preflight forestgeo_testing/1/12#2: blocked by an earlier deferred scope in this plot',
        'Deferred scopes: forestgeo_testing/1/11#1, forestgeo_testing/1/12#2',
        'Earliest unfinished by plot: forestgeo_testing:1=11#1'
      ])
    );
  });
});
