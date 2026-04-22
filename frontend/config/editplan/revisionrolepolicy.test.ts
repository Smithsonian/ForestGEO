import { describe, expect, it } from 'vitest';
import { BulkEditPlan } from './types';
import { applyRevisionRolePolicy } from './revisionrolepolicy';

const basePlan: BulkEditPlan = {
  dataType: 'measurementssummary',
  rowCount: 1,
  rowPlans: [{ rowIndex: 0, status: 'new' }],
  aggregateEffects: [],
  maxSeverity: 'info',
  planHash: 'base-plan-hash',
  generatedAt: '2026-04-22T00:00:00.000Z'
};

describe('applyRevisionRolePolicy', () => {
  it('marks revision spcode candidates as blocking for field crew users', () => {
    const plan = applyRevisionRolePolicy(basePlan, 'field crew', [{ rowIndex: 3, field: 'spcode' }]);

    expect(plan.canApply).toBe(false);
    expect(plan.maxSeverity).toBe('destructive');
    expect(plan.errors?.[0]).toMatchObject({
      kind: 'RoleForbiddenField',
      field: 'spcode',
      role: 'field crew',
      rowIndex: 3,
      blocking: true
    });
    expect(plan.aggregateEffects[0]).toMatchObject({
      id: 'AUTH_ROLE_FORBIDDEN_REVISION_3_spcode',
      severity: 'destructive'
    });
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves the plan unchanged for db admin users', () => {
    expect(applyRevisionRolePolicy(basePlan, 'db admin', [{ rowIndex: 3, field: 'spcode' }])).toBe(basePlan);
  });
});
