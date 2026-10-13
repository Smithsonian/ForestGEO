import type { ProvisioningStepRecord } from './types';

export const VALIDATE_INPUTS_STEP_KEY = 'validate_inputs';
export const CREATE_SCHEMA_STEP_KEY = 'create_schema';

/**
 * Validation only establishes that a name was available. Cleanup also needs a
 * recorded successful creation; a failed/pending creation is ambiguous and must
 * leave the schema untouched. The server must additionally check for competing
 * runs under the schema lock before treating this history as ownership evidence.
 */
export function runCreatedSchemaArtifacts(steps: readonly Pick<ProvisioningStepRecord, 'stepKey' | 'status'>[]): boolean {
  return [VALIDATE_INPUTS_STEP_KEY, CREATE_SCHEMA_STEP_KEY].every(key => steps.some(step => step.stepKey === key && step.status === 'completed'));
}
