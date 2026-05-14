import { HTTPResponses } from '@/config/macros';
import type { StepKey } from './types';

export type ProvisioningErrorKind = 'not_found' | 'conflict' | 'invalid_input' | 'unsafe_input' | 'database_unavailable' | 'internal';

export class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly kind: ProvisioningErrorKind,
    public readonly meta: { stepKey?: StepKey; runId?: number; schemaName?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export function errorToHttpStatus(kind: ProvisioningErrorKind): number {
  switch (kind) {
    case 'not_found':
      return HTTPResponses.NOT_FOUND;
    case 'conflict':
      return HTTPResponses.CONFLICT;
    case 'invalid_input':
    case 'unsafe_input':
      return HTTPResponses.INVALID_REQUEST;
    case 'database_unavailable':
      return HTTPResponses.SERVICE_UNAVAILABLE;
    case 'internal':
      return HTTPResponses.INTERNAL_SERVER_ERROR;
  }
}

export function errorToClientMessage(err: ProvisioningError): string {
  if (err.kind === 'internal') return 'Internal provisioning error';
  if (err.kind === 'database_unavailable') return 'Database unavailable';
  return err.message;
}
