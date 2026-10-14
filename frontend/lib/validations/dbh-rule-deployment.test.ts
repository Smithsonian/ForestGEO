import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { Connection } from 'mysql2/promise';
import {
  assertEligibleDbhRuleRows,
  parseDbhRuleDeploymentArgs,
  preflightDbhRuleDeployment,
  refreshDbhRuleSeeds,
  selectDbhRuleDeploymentSchemas
} from './dbh-rule-deployment';
import type { DbhExpectedManifest } from './dbh-rescore-cli';

const manifest: DbhExpectedManifest = {
  revision: 'annual-rules',
  procedures: {
    BuildDBHChangePairs: 'CREATE PROCEDURE BuildDBHChangePairs() BEGIN SELECT 1; END',
    RunSharedDBHChangeValidations: 'CREATE PROCEDURE RunSharedDBHChangeValidations() BEGIN SELECT 2; END'
  },
  seeds: [
    { validationID: 1, procedureName: 'ValidateDBHGrowthExceedsMax', description: 'annual growth', definition: 'CALL annual_growth();' },
    { validationID: 2, procedureName: 'ValidateDBHShrinkageExceedsMax', description: 'annual shrinkage', definition: 'CALL annual_shrinkage();' }
  ]
};

const migrated = (schemas: readonly string[]) => new Map(schemas.map(schema => [schema.toLowerCase(), { migrated: true, missingTables: [] }]));

function rows(enabled = true) {
  return [
    {
      ValidationID: 1,
      ProcedureName: 'ValidateDBHGrowthExceedsMax',
      Description: 'legacy growth',
      Definition: 'CALL legacy_growth();',
      Criteria: 'measuredDBH',
      ChangelogDefinition: 'keep-growth-metadata',
      IsEnabled: enabled ? 1 : 0
    },
    {
      ValidationID: 2,
      ProcedureName: 'ValidateDBHShrinkageExceedsMax',
      Description: 'legacy shrinkage',
      Definition: 'CALL legacy_shrinkage();',
      Criteria: 'measuredDBH',
      ChangelogDefinition: 'keep-shrinkage-metadata',
      IsEnabled: enabled ? 1 : 0
    }
  ];
}

function connection(ruleRows = rows(), options: { mismatchAfterUpdate?: boolean; bodyMismatch?: boolean; missingRunStorage?: boolean } = {}) {
  let updates = 0;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SHOW CREATE PROCEDURE')) {
      const build = sql.includes('BuildDBHChangePairs');
      const body = build ? manifest.procedures.BuildDBHChangePairs : manifest.procedures.RunSharedDBHChangeValidations;
      return [[{ 'Create Procedure': (options.bodyMismatch || (options.mismatchAfterUpdate && updates > 0)) && build ? `${body} SELECT 99;` : body }], []];
    }
    if (/^\s*UPDATE\s/i.test(sql)) {
      const id = Number(params[2]);
      const target = ruleRows.find(row => row.ValidationID === id)!;
      target.Description = String(params[0]);
      target.Definition = String(params[1]);
      updates++;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('sitespecificvalidations')) return [[...ruleRows], []];
    if (sql.includes('information_schema.TABLES')) {
      const TABLE_NAME = [
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
      ];
      return [TABLE_NAME.map(name => ({ TABLE_NAME: name })), []];
    }
    if (sql.includes('catalog.background_jobs')) return [[], []];
    if (sql.startsWith('SELECT RescoreAttemptID, Notices FROM ')) {
      if (options.missingRunStorage) throw new Error('Unknown column RescoreAttemptID');
      return [[], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return {
    query,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined)
  } as unknown as Connection;
}

describe('DBH rule deployment arguments', () => {
  it('requires a narrow target and exact write acknowledgement', () => {
    expect(parseDbhRuleDeploymentArgs(['--schema', 'forestgeo_testing'])).toMatchObject({ schema: 'forestgeo_testing', apply: false });
    expect(() => parseDbhRuleDeploymentArgs(['--all-sites', '--schema', 'forestgeo_testing'])).toThrow(/exactly one/);
    expect(() => parseDbhRuleDeploymentArgs(['--all-sites', '--apply'])).toThrow(/understand-this-writes-to/);
  });

  it('skips quarantined schemas in all-site deployments but rejects an explicit quarantined target', () => {
    const gate = {
      schemaName: 'forestgeo_quarantined',
      lastPassedAt: null,
      lastFailedAt: new Date(),
      quarantinedAt: new Date(),
      quarantineReason: 'drift',
      lastRunRef: 'test'
    };
    const quarantined = new Map([['forestgeo_quarantined', gate]]);
    expect(
      selectDbhRuleDeploymentSchemas(
        ['forestgeo_healthy', 'forestgeo_quarantined'],
        quarantined,
        false,
        migrated(['forestgeo_healthy', 'forestgeo_quarantined'])
      )
    ).toMatchObject({
      schemas: ['forestgeo_healthy'],
      quarantined: [{ schema: 'forestgeo_quarantined' }]
    });
    expect(() => selectDbhRuleDeploymentSchemas(['forestgeo_quarantined'], quarantined, true, migrated(['forestgeo_quarantined']))).toThrow(
      /explicitly selected/
    );
    expect(() => selectDbhRuleDeploymentSchemas(['forestgeo_quarantined'], quarantined, false, migrated(['forestgeo_quarantined']))).toThrow(/No eligible/);
  });

  it('matches procedures-only migration gating: all-site skips stale schemas, explicit selection fails', () => {
    const migrationStatus = new Map([
      ['forestgeo_ready', { migrated: true, missingTables: [] }],
      ['forestgeo_stale', { migrated: false, missingTables: ['measurement_errors'] }]
    ]);
    expect(selectDbhRuleDeploymentSchemas(['forestgeo_ready', 'forestgeo_stale'], new Map(), false, migrationStatus)).toMatchObject({
      schemas: ['forestgeo_ready'],
      notMigrated: [{ schema: 'forestgeo_stale', missingTables: ['measurement_errors'] }]
    });
    expect(() => selectDbhRuleDeploymentSchemas(['forestgeo_stale'], new Map(), true, migrationStatus)).toThrow(/not migrated/);
  });

  it('fails closed when migration status cannot be determined', () => {
    expect(() => selectDbhRuleDeploymentSchemas(['forestgeo_unknown'], new Map(), false, new Map())).toThrow(/could not determine migration status/);
  });
});

describe('DBH rule seed refresh', () => {
  it('updates only the two SQL-owned fields while preserving enabled flags and metadata', async () => {
    const ruleRows = rows();
    const conn = connection(ruleRows);

    await refreshDbhRuleSeeds(conn, ['forestgeo_testing'], manifest, true);

    expect(ruleRows).toEqual([
      expect.objectContaining({
        Description: 'annual growth',
        Definition: 'CALL annual_growth();',
        Criteria: 'measuredDBH',
        ChangelogDefinition: 'keep-growth-metadata',
        IsEnabled: 1
      }),
      expect.objectContaining({
        Description: 'annual shrinkage',
        Definition: 'CALL annual_shrinkage();',
        Criteria: 'measuredDBH',
        ChangelogDefinition: 'keep-shrinkage-metadata',
        IsEnabled: 1
      })
    ]);
    const updates = (conn.query as ReturnType<typeof vi.fn>).mock.calls.filter(([sql]) => /^\s*UPDATE\s/i.test(String(sql)));
    expect(updates).toHaveLength(2);
    expect(updates.every(([sql]) => !String(sql).includes('IsEnabled') && !String(sql).includes('Criteria') && !String(sql).includes('TRUNCATE'))).toBe(true);
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it('fails closed for an identity collision before opening a transaction', async () => {
    const collision = rows();
    collision[0].ProcedureName = 'WrongProcedure';
    const identityConnection = connection(collision);
    await expect(refreshDbhRuleSeeds(identityConnection, ['forestgeo_testing'], manifest, true)).rejects.toThrow(/identity/);
    expect(identityConnection.beginTransaction).not.toHaveBeenCalled();
  });

  it('refreshes disabled DBH rules without re-enabling them', async () => {
    const ruleRows = rows(false);
    const conn = connection(ruleRows);

    await refreshDbhRuleSeeds(conn, ['forestgeo_testing'], manifest, true);

    expect(ruleRows.map(row => row.IsEnabled)).toEqual([0, 0]);
    expect(ruleRows.map(row => row.Definition)).toEqual(['CALL annual_growth();', 'CALL annual_shrinkage();']);
    expect(
      (conn.query as ReturnType<typeof vi.fn>).mock.calls
        .filter(([sql]) => /^\s*UPDATE\s/i.test(String(sql)))
        .every(([sql]) => !String(sql).includes('IsEnabled'))
    ).toBe(true);
  });

  it('rejects a schema missing recovery storage before opening a seed transaction', async () => {
    const conn = connection(rows(), { missingRunStorage: true });
    await expect(refreshDbhRuleSeeds(conn, ['forestgeo_testing'], manifest, true)).rejects.toThrow(/Unknown column RescoreAttemptID/);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalledWith(expect.stringMatching(/^\s*UPDATE\s/i), expect.anything());
  });

  it('rejects a DBH procedure body that did not match the reviewed SQL manifest', async () => {
    const conn = connection(rows(), { bodyMismatch: true });
    await expect(preflightDbhRuleDeployment(conn, ['forestgeo_testing'], manifest)).rejects.toThrow(/differs/);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it('rolls back the seed transaction when final full-manifest verification fails', async () => {
    const conn = connection(rows(), { mismatchAfterUpdate: true });
    await expect(refreshDbhRuleSeeds(conn, ['forestgeo_testing'], manifest, true)).rejects.toThrow(/differs/);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('rejects duplicate or missing DBH rows', () => {
    expect(() => assertEligibleDbhRuleRows([...rows(), { ...rows()[0] }], manifest, 'forestgeo_testing')).toThrow(/exactly two/);
    expect(() => assertEligibleDbhRuleRows(rows(false), manifest, 'forestgeo_testing', { requireEnabled: true })).toThrow(/disabled/);
  });
});

describe('DBH legacy rollback seed patch', () => {
  it('preserves the existing enabled flags on duplicate DBH rows', () => {
    const rollback = readFileSync(path.join(process.cwd(), 'db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql'), 'utf8');
    expect(rollback).not.toMatch(/IsEnabled\s*=\s*VALUES\(IsEnabled\)/i);
    expect(rollback.match(/ON DUPLICATE KEY UPDATE/gi) ?? []).toHaveLength(2);
  });
});
