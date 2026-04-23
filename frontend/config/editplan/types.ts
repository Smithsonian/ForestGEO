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

export interface RoleForbiddenFieldPreviewError {
  kind: 'RoleForbiddenField';
  field: string;
  role: UserAuthRoles | 'unknown';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export interface TreeStemResolutionPreviewError {
  kind: 'TreeStemResolution';
  subject: 'species' | 'quadrat' | 'tree' | 'stem';
  reason: 'missing' | 'inactive' | 'different_quadrat' | 'cannot_create';
  field: 'SpeciesCode' | 'QuadratName' | 'TreeTag' | 'StemTag';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export type PreviewError = RoleForbiddenFieldPreviewError | TreeStemResolutionPreviewError;

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

export interface DuplicateDeletion {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

export interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
  canonicalNewRow?: Record<string, unknown>;
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
  duplicateDeletions: DuplicateDeletion[];
}

export interface ApplyResult {
  updatedIDs: Record<string, number>;
  applyErrors: Array<{ ruleID?: string; coreMeasurementID?: number; csvIndex?: number; reason: string }>;
  editOperationID: number | null;
  validationPending: boolean;
  postValidation?: { newErrors: number; clearedErrors: number };
}
