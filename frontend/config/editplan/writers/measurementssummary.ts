import ConnectionManager from '@/config/connectionmanager';
import { EditPlan, ApplyResult } from '../types';
import type { EditOperationStateRow } from '@/config/editoperations';
import type { ApplyInTransactionInput } from '../apply';

export interface WriterResult {
  updatedIDs: Record<string, number>;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  postValidation?: ApplyResult['postValidation'];
  validationPending: boolean;
}

export async function writeMeasurementsSummary(
  _cm: ConnectionManager,
  _input: ApplyInTransactionInput,
  _plan: EditPlan,
  _txID: string
): Promise<WriterResult> {
  throw new Error('Task 8 not yet implemented');
}
