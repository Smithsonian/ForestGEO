import { describe, it, expect } from 'vitest';
import { ProvisioningError, errorToHttpStatus, errorToClientMessage } from './errors';
import { HTTPResponses } from '@/config/macros';

describe('ProvisioningError', () => {
  it('preserves kind, stepKey, and meta', () => {
    const err = new ProvisioningError('Run 7 not found', 'not_found', { runId: 7, stepKey: 'validate_inputs' });
    expect(err.kind).toBe('not_found');
    expect(err.meta).toEqual({ runId: 7, stepKey: 'validate_inputs' });
    expect(err.name).toBe('ProvisioningError');
  });

  it.each([
    ['not_found', HTTPResponses.NOT_FOUND],
    ['conflict', HTTPResponses.CONFLICT],
    ['invalid_input', HTTPResponses.INVALID_REQUEST],
    ['unsafe_input', HTTPResponses.INVALID_REQUEST],
    ['database_unavailable', HTTPResponses.SERVICE_UNAVAILABLE],
    ['internal', HTTPResponses.INTERNAL_SERVER_ERROR]
  ] as const)('maps %s → %d', (kind, expected) => {
    expect(errorToHttpStatus(kind)).toBe(expected);
  });

  it('redacts internal messages but preserves not_found/invalid_input wording', () => {
    expect(errorToClientMessage(new ProvisioningError('boom', 'internal'))).toBe('Internal provisioning error');
    expect(errorToClientMessage(new ProvisioningError('connect ECONNREFUSED 10.0.0.5:3306', 'database_unavailable'))).toBe('Database unavailable');
    expect(errorToClientMessage(new ProvisioningError('Run 7 not found', 'not_found'))).toBe('Run 7 not found');
    expect(errorToClientMessage(new ProvisioningError('Schema name unsafe', 'unsafe_input'))).toBe('Schema name unsafe');
    expect(errorToClientMessage(new ProvisioningError('schema in use', 'conflict'))).toBe('schema in use');
    expect(errorToClientMessage(new ProvisioningError('Plot dimensions not divisible', 'invalid_input'))).toBe('Plot dimensions not divisible');
  });
});
