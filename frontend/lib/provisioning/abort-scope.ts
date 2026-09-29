import type { ProvisioningStepRecord } from './types';

export const VALIDATE_INPUTS_STEP_KEY = 'validate_inputs';

/**
 * validate_inputs refuses to start when catalog.sites or MySQL already holds the run's
 * schema, so a run that never completed it created nothing. Whatever sits under that
 * schema name belongs to an earlier run or to a live site, and aborting must not drop it.
 */
export function runCreatedSchemaArtifacts(steps: readonly Pick<ProvisioningStepRecord, 'stepKey' | 'status'>[]): boolean {
  return steps.some(step => step.stepKey === VALIDATE_INPUTS_STEP_KEY && step.status === 'completed');
}
