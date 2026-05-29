import ConnectionManager from '@/config/connectionmanager';
import { EditPlanDataType } from '../types';

export interface RuleContext {
  cm: ConnectionManager;
  schema: string;
  transactionID?: string;
  dataType: EditPlanDataType;
  plotID: number;
  censusID: number;
  oldRow: Record<string, unknown>;
  newRow: Record<string, unknown>;
  changedFields: Set<string>;
}

export class SpeciesNotFoundError extends Error {
  constructor(public code: string) {
    super(`Species not found: ${code}`);
    this.name = 'SpeciesNotFoundError';
  }
}
