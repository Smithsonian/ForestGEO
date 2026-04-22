import type { UserAuthRoles } from '@/config/macros';

export type Severity = 'info' | 'warn' | 'destructive';

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  destructive: 2
};

export type EffectCategory = 'field' | 'cross-row' | 'identity' | 'destructive' | 'validation';

export interface Effect {
  id: string;
  severity: Severity;
  category: EffectCategory;
  title: string;
  detail: string;
  affectedTable: string;
  affectedRowCount: number;
  references?: {
    coreMeasurementIDs?: number[];
    speciesID?: number;
    stemGUIDs?: number[];
    treeIDs?: number[];
  };
}

export type EditPlanDataType = 'measurementssummary' | 'failedmeasurements';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PreviewError {
  kind: 'RoleForbiddenField';
  field: string;
  role: UserAuthRoles | 'unknown';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export interface EditPlan {
  dataType: EditPlanDataType;
  targetID: number;
  fieldChanges: FieldChange[];
  effects: Effect[];
  errors?: PreviewError[];
  canApply?: boolean;
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
}

export interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
}

export interface BulkEditPlan {
  dataType: EditPlanDataType;
  rowCount: number;
  rowPlans: RowPlan[];
  aggregateEffects: Effect[];
  errors?: PreviewError[];
  canApply?: boolean;
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
}

export interface ApplyResult {
  updatedIDs: Record<string, number>;
  applyErrors: Array<{ ruleID?: string; coreMeasurementID?: number; csvIndex?: number; reason: string }>;
  editOperationID: number | null;
  validationPending: boolean;
  postValidation?: { newErrors: number; clearedErrors: number };
}
