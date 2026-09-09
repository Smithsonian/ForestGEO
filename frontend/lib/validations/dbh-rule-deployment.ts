import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import type { SchemaGateRow } from '@/scripts/lib/schema-gate';
import { buildDbhExpectedManifest, buildRealSweepDeps, type DbhExpectedManifest } from './dbh-rescore-cli';

type DbhRuleRow = {
  ValidationID: number | string;
  ProcedureName: string;
  Description: string;
  Definition: string;
  Criteria: string;
  ChangelogDefinition: string;
  IsEnabled: number | boolean | Buffer;
};

export interface DbhRuleDeploymentArgs {
  allSites: boolean;
  schema?: string;
  apply: boolean;
  acknowledgedHost?: string;
}

export class DbhRuleDeploymentArgumentError extends Error {}

export interface DbhRuleDeploymentSelection {
  schemas: string[];
  quarantined: Array<{ schema: string; gate: SchemaGateRow }>;
  notMigrated: Array<{ schema: string; missingTables: string[] }>;
}

const EXPECTED_IDENTITIES = new Map([
  [1, DBH_GROWTH_PROCEDURE],
  [2, DBH_SHRINKAGE_PROCEDURE]
]);

function enabled(value: unknown): boolean {
  return Buffer.isBuffer(value) ? value[0] === 1 : value === true || Number(value) === 1;
}

function qualified(schema: string, table: string): string {
  validateSchemaOrThrow(schema);
  return mysql.format('??.??', [schema, table]);
}

export function parseDbhRuleDeploymentArgs(argv: readonly string[]): DbhRuleDeploymentArgs {
  const result: DbhRuleDeploymentArgs = { allSites: false, apply: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new DbhRuleDeploymentArgumentError(`${flag} requires a value`);
      return next;
    };
    if (seen.has(flag)) throw new DbhRuleDeploymentArgumentError(`Flag may be specified only once: ${flag}`);
    seen.add(flag);
    if (flag === '--all-sites') result.allSites = true;
    else if (flag === '--schema') result.schema = value();
    else if (flag === '--apply') result.apply = true;
    else if (flag === '--i-understand-this-writes-to') result.acknowledgedHost = value();
    else throw new DbhRuleDeploymentArgumentError(`Unknown or disallowed flag: ${flag}`);
  }
  if (result.allSites === Boolean(result.schema)) throw new DbhRuleDeploymentArgumentError('Specify exactly one of --all-sites or --schema');
  if (result.schema) validateSchemaOrThrow(result.schema);
  if (result.apply && !result.acknowledgedHost) throw new DbhRuleDeploymentArgumentError('--apply requires --i-understand-this-writes-to <host>');
  return result;
}

/** Match the established deploy policy: all-site sweeps skip quarantines, while an explicit target fails closed. */
export function selectDbhRuleDeploymentSchemas(
  schemas: readonly string[],
  quarantined: ReadonlyMap<string, SchemaGateRow>,
  explicitlySelected: boolean,
  migrationStatus: ReadonlyMap<string, { migrated: boolean; missingTables: string[] }>
): DbhRuleDeploymentSelection {
  for (const schema of schemas) {
    if (!migrationStatus.has(schema.toLowerCase())) throw new Error(`${schema}: DBH rule refresh could not determine migration status`);
  }
  const blocked = schemas.flatMap(schema => {
    const gate = quarantined.get(schema.toLowerCase());
    return gate ? [{ schema, gate }] : [];
  });
  if (explicitlySelected && blocked.length) throw new Error(`${blocked[0].schema}: DBH rule refresh refuses an explicitly selected quarantined schema`);
  const notMigrated = schemas.flatMap(schema => {
    if (quarantined.has(schema.toLowerCase())) return [];
    const status = migrationStatus.get(schema.toLowerCase());
    return status && !status.migrated ? [{ schema, missingTables: status.missingTables }] : [];
  });
  if (explicitlySelected && notMigrated.length)
    throw new Error(
      `${notMigrated[0].schema}: DBH rule refresh refuses an explicitly selected schema that is not migrated (missing tables: ${notMigrated[0].missingTables.join(', ')})`
    );
  const selected = schemas.filter(schema => !quarantined.has(schema.toLowerCase()) && migrationStatus.get(schema.toLowerCase())?.migrated !== false);
  if (selected.length === 0) throw new Error('No eligible ForestGEO schemas selected for DBH rule refresh');
  return { schemas: selected, quarantined: blocked, notMigrated };
}

/** The two SQL-owned seed definitions are parsed by the re-score manifest builder. */
export function buildDbhRuleDeploymentManifest(storedProcedures: string, coreQueries: string): DbhExpectedManifest {
  return buildDbhExpectedManifest(storedProcedures, coreQueries);
}

export function assertEligibleDbhRuleRows(
  rows: readonly DbhRuleRow[],
  manifest: DbhExpectedManifest,
  schema: string,
  options: { requireEnabled?: boolean } = {}
): void {
  const requireEnabled = options.requireEnabled ?? false;
  const expectedByID = new Map(manifest.seeds.map(seed => [seed.validationID, seed]));
  if (expectedByID.size !== 2) throw new Error(`DBH manifest ${manifest.revision} does not have exactly two seeds`);
  if (rows.length !== 2) throw new Error(`${schema}: expected exactly two DBH validation rows, found ${rows.length}`);

  for (const row of rows) {
    const numericID = Number(row.ValidationID);
    if (numericID !== 1 && numericID !== 2) throw new Error(`${schema}: DBH validation identity is missing or collides with another row`);
    const id = numericID;
    const expected = expectedByID.get(id);
    const identity = EXPECTED_IDENTITIES.get(id);
    if (!expected || !identity || row.ProcedureName !== identity || expected.procedureName !== identity)
      throw new Error(`${schema}: DBH validation identity is missing or collides with another row`);
    if (requireEnabled && !enabled(row.IsEnabled))
      throw new Error(`${schema}: DBH validation ${id} is disabled; enable it through the approved preparation process`);
  }
}

async function readDbhRows(connection: mysql.Connection, schema: string, lockRows = false): Promise<DbhRuleRow[]> {
  const [rows] = await connection.query<Array<DbhRuleRow & RowDataPacket>>(
    `SELECT ValidationID, ProcedureName, Description, Definition, Criteria, ChangelogDefinition, IsEnabled
       FROM ${qualified(schema, 'sitespecificvalidations')}
      WHERE ValidationID IN (1, 2) OR ProcedureName IN (?, ?)
      ORDER BY ValidationID${lockRows ? ' FOR UPDATE' : ''}`,
    [DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE]
  );
  return rows;
}

/**
 * Confirms every selected schema can receive a seed change before any mutation.
 * This intentionally accepts old descriptions/definitions: those are the only
 * two fields the apply phase changes.
 */
export async function preflightDbhRuleDeployment(connection: mysql.Connection, schemas: readonly string[], manifest: DbhExpectedManifest): Promise<void> {
  if (schemas.length === 0) throw new Error('No ForestGEO schemas selected for DBH rule refresh');
  for (const schema of schemas) {
    validateSchemaOrThrow(schema);
    const rows = await readDbhRows(connection, schema);
    assertEligibleDbhRuleRows(rows, manifest, schema);
    const observedByID = new Map(rows.map(row => [Number(row.ValidationID), row]));
    const preflightManifest: DbhExpectedManifest = {
      ...manifest,
      seeds: manifest.seeds.map(seed => {
        const row = observedByID.get(seed.validationID);
        if (!row) throw new Error(`${schema}: DBH validation ${seed.validationID} disappeared during preflight`);
        return { ...seed, description: row.Description, definition: row.Definition };
      })
    };
    // This keeps the two current seed texts flexible, but requires the entire
    // release structure (catalog, tables, procedures, identities) to pass
    // before any selected schema is changed. Rule enablement is operator state.
    await buildRealSweepDeps(connection, preflightManifest, undefined, undefined, { requireEnabled: false }).verifySchema(schema);
  }
}

async function applyOneSchema(connection: mysql.Connection, schema: string, manifest: DbhExpectedManifest): Promise<void> {
  await connection.beginTransaction();
  try {
    assertEligibleDbhRuleRows(await readDbhRows(connection, schema, true), manifest, schema);
    for (const seed of manifest.seeds) {
      await connection.query(
        `UPDATE ${qualified(schema, 'sitespecificvalidations')}
            SET Description = ?, Definition = ?
          WHERE ValidationID = ? AND ProcedureName = ?`,
        [seed.description, seed.definition, seed.validationID, seed.procedureName]
      );
    }

    assertEligibleDbhRuleRows(await readDbhRows(connection, schema), manifest, schema);
    // Reuse the release sweep's complete revision verification before commit.
    await buildRealSweepDeps(connection, manifest, undefined, undefined, { requireEnabled: false }).verifySchema(schema);
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      if (error instanceof Error) (error as Error & { rollbackError?: unknown }).rollbackError = rollbackError;
    }
    throw error;
  }
}

export async function refreshDbhRuleSeeds(
  connection: mysql.Connection,
  schemas: readonly string[],
  manifest: DbhExpectedManifest,
  apply: boolean
): Promise<void> {
  await preflightDbhRuleDeployment(connection, schemas, manifest);
  if (!apply) return;
  for (const schema of schemas) await applyOneSchema(connection, schema, manifest);
}
