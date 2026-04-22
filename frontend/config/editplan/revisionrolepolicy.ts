import type { UserAuthRoles } from '@/config/macros';
import { BulkEditPlan, Effect, PreviewError } from './types';
import { isFieldEditableByRole } from './fieldpolicy';
import { hashPlan } from './planhash';

export interface RevisionRoleFieldCandidate {
  rowIndex: number;
  field: string;
}

function buildRevisionRoleError(candidate: RevisionRoleFieldCandidate, role: UserAuthRoles | null | undefined): PreviewError {
  const roleLabel = role ?? 'unknown';
  return {
    kind: 'RoleForbiddenField',
    field: candidate.field,
    role: roleLabel,
    rowIndex: candidate.rowIndex,
    message: `Row ${candidate.rowIndex + 1}: ${candidate.field} can only be edited by global or db admin users.`,
    severity: 'destructive',
    blocking: true
  };
}

function buildRevisionRoleEffect(error: PreviewError): Effect {
  return {
    id: `AUTH_ROLE_FORBIDDEN_REVISION_${error.rowIndex ?? 0}_${error.field}`,
    severity: 'destructive',
    category: 'validation',
    title: 'Field restricted by role',
    detail: error.message,
    affectedTable: 'species',
    affectedRowCount: 1
  };
}

export function applyRevisionRolePolicy(
  plan: BulkEditPlan,
  role: UserAuthRoles | null | undefined,
  candidates: RevisionRoleFieldCandidate[]
): BulkEditPlan {
  const errors = candidates.filter(candidate => !isFieldEditableByRole(candidate.field, role)).map(candidate => buildRevisionRoleError(candidate, role));

  if (errors.length === 0) {
    return plan;
  }

  const next: BulkEditPlan = {
    ...plan,
    aggregateEffects: [...plan.aggregateEffects, ...errors.map(buildRevisionRoleEffect)],
    errors: [...(plan.errors ?? []), ...errors],
    canApply: false,
    maxSeverity: 'destructive',
    planHash: ''
  };
  next.planHash = hashPlan(next);
  return next;
}
