import { createHash } from 'crypto';
import type { DbhRescoreResult, DbhRescoreScope } from '@/lib/validations/dbh-rescore';
import { DBH_CHANGE_VALIDATION_ID_LIST } from '@/config/dbhchangevalidations';

export interface DbhSweepScope extends DbhRescoreScope {
  plotCensusNumber: number;
}
export interface DbhSweepPlan {
  scopes: DbhSweepScope[];
  followOn: DbhSweepScope[];
  targetSchemas?: string[];
}
export interface DbhSweepResult {
  results: DbhRescoreResult[];
  deferred: DbhSweepScope[];
  halted: boolean;
  earliestUnfinished: Map<string, DbhSweepScope>;
}

export interface DbhSweepDependencies {
  /** Present for --all-sites; kept separate from per-schema scope discovery. */
  discoverSchemas?(): Promise<string[]>;
  discoverScopes(schema: string): Promise<DbhSweepScope[]>;
  verifySchema(schema: string): Promise<{ revision: string; digests: Record<string, string> }>;
  advisoryPreflight(scope: DbhSweepScope): Promise<{ deferred?: string }>;
  rescore(scope: DbhRescoreScope): Promise<DbhRescoreResult>;
  writeArtifact(event: Record<string, unknown>): Promise<void>;
  now(): string;
}

const plotKey = (scope: DbhSweepScope) => `${scope.schema}:${scope.plotID}`;

/** Validate the complete plot sequence before selecting requested work. */
export function planDbhSweep(all: DbhSweepScope[], selection: { plotID?: number; censusID?: number } = {}, targetSchemas?: string[]): DbhSweepPlan {
  const groups = new Map<string, DbhSweepScope[]>();
  const ownership = new Map<string, number>();
  for (const scope of all) {
    if (
      !scope.schema ||
      !Number.isInteger(scope.plotID) ||
      scope.plotID <= 0 ||
      !Number.isInteger(scope.censusID) ||
      scope.censusID <= 0 ||
      !Number.isInteger(scope.plotCensusNumber) ||
      scope.plotCensusNumber <= 0
    ) {
      throw new Error('DBH sweep discovery returned an invalid active census scope');
    }
    const identity = `${scope.schema}:${scope.censusID}`;
    if (ownership.has(identity)) throw new Error(`Duplicate or conflicting ownership for census ${identity}`);
    ownership.set(identity, scope.plotID);
    const key = plotKey(scope);
    const group = groups.get(key) ?? [];
    group.push(scope);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    group.sort((a, b) => a.plotCensusNumber - b.plotCensusNumber || a.censusID - b.censusID);
    for (let i = 1; i < group.length; i++)
      if (group[i - 1].plotCensusNumber === group[i].plotCensusNumber) throw new Error(`${key} has duplicate PlotCensusNumber ${group[i].plotCensusNumber}`);
  }
  const scopes = [...groups.values()]
    .flat()
    .filter(
      scope =>
        (selection.plotID === undefined || scope.plotID === selection.plotID) && (selection.censusID === undefined || scope.censusID === selection.censusID)
    );
  if (scopes.length === 0 && (selection.plotID !== undefined || selection.censusID !== undefined)) {
    throw new Error('Requested plot/census does not identify an active discovered scope');
  }
  const requested = new Set(scopes.map(scope => `${scope.schema}:${scope.plotID}:${scope.censusID}`));
  const followOn = [...groups.values()].flat().filter(scope => {
    const selected = all.find(candidate => candidate.schema === scope.schema && candidate.plotID === scope.plotID && candidate.censusID === selection.censusID);
    return Boolean(selected && scope.plotCensusNumber > selected.plotCensusNumber && !requested.has(`${scope.schema}:${scope.plotID}:${scope.censusID}`));
  });
  return { scopes: scopes.sort((a, b) => plotKey(a).localeCompare(plotKey(b)) || a.plotCensusNumber - b.plotCensusNumber), followOn, targetSchemas };
}

export async function runDbhSweep(plan: DbhSweepPlan, deps: DbhSweepDependencies, apply: boolean): Promise<DbhSweepResult> {
  const results: DbhRescoreResult[] = [],
    deferred: DbhSweepScope[] = [];
  const blocked = new Set<string>();
  const earliestUnfinished = new Map<string, DbhSweepScope>();
  const schemas = [...new Set(plan.targetSchemas ?? plan.scopes.map(scope => scope.schema))];
  // This happens before any mutation, even if an earlier schema is clean.
  const verification: Record<string, { revision: string; digests: Record<string, string> }> = {};
  for (const schema of schemas) verification[schema] = await deps.verifySchema(schema);
  await deps.writeArtifact({
    event: 'sweep-plan',
    at: deps.now(),
    fixedValidationIDs: DBH_CHANGE_VALIDATION_ID_LIST,
    order: plan.scopes,
    followOn: plan.followOn,
    targetSchemas: schemas,
    verification,
    apply
  });
  for (const scope of plan.scopes) {
    const key = plotKey(scope);
    if (blocked.has(key)) {
      deferred.push(scope);
      earliestUnfinished.set(key, earliestUnfinished.get(key) ?? scope);
      await deps.writeArtifact({ event: 'deferred-prior', scope, at: deps.now() });
      continue;
    }
    if (!apply) {
      const preflight = await deps.advisoryPreflight(scope);
      if (preflight.deferred) {
        deferred.push(scope);
        blocked.add(key);
        earliestUnfinished.set(key, scope);
      }
      await deps.writeArtifact({ event: 'dry-run-preflight', scope, at: deps.now(), ...preflight });
      continue;
    }
    let result: DbhRescoreResult;
    try {
      result = await deps.rescore(scope);
    } catch (error) {
      result = {
        outcome: 'failed',
        databaseOutcome: 'unknown',
        attemptID: 'sweep-unhandled',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
    results.push(result);
    try {
      await deps.writeArtifact({ event: 'scope-outcome', scope, at: deps.now(), result });
    } catch (error) {
      const artifactError = error instanceof Error ? error.message : String(error);
      result = { ...result, outcome: 'artifact-failed', artifactError, errors: [...result.errors, artifactError] };
      results[results.length - 1] = result;
      for (const unfinished of plan.scopes.slice(plan.scopes.indexOf(scope))) {
        deferred.push(unfinished);
        const unfinishedKey = plotKey(unfinished);
        earliestUnfinished.set(unfinishedKey, earliestUnfinished.get(unfinishedKey) ?? unfinished);
      }
      return { results, deferred, halted: true, earliestUnfinished };
    }
    if (
      result.databaseOutcome === 'unknown' ||
      result.outcome === 'artifact-failed' ||
      (result.databaseOutcome === 'committed' && result.outcome !== 'completed')
    ) {
      for (const unfinished of plan.scopes.slice(plan.scopes.indexOf(scope))) {
        deferred.push(unfinished);
        const unfinishedKey = plotKey(unfinished);
        earliestUnfinished.set(unfinishedKey, earliestUnfinished.get(unfinishedKey) ?? unfinished);
      }
      await deps.writeArtifact({ event: 'sweep-halted', at: deps.now(), earliestUnfinished: Object.fromEntries(earliestUnfinished), deferred });
      return { results, deferred, halted: true, earliestUnfinished };
    }
    if (result.outcome !== 'completed' || result.databaseOutcome !== 'committed') {
      deferred.push(scope);
      blocked.add(key);
      earliestUnfinished.set(key, scope);
    }
  }
  await deps.writeArtifact({ event: 'sweep-summary', at: deps.now(), earliestUnfinished: Object.fromEntries(earliestUnfinished), deferred });
  return { results, deferred, halted: false, earliestUnfinished };
}

export function dbhRuleDigest(body: string): string {
  return createHash('sha256')
    .update(
      body
        .replace(/DEFINER\s*=\s*[^\s]+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .digest('hex');
}
