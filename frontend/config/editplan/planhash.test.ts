import { describe, it, expect } from 'vitest';
import { canonicalizePlan, hashPlan } from './planhash';
import { BulkEditPlan, EditPlan } from './types';

const base: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 1,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [
    { id: 'R4', severity: 'warn', category: 'cross-row', title: 't', detail: 'd', affectedTable: 'stems', affectedRowCount: 3 }
  ],
  maxSeverity: 'warn',
  planHash: '',
  generatedAt: '2026-04-21T00:00:00Z'
};

describe('hashPlan', () => {
  it('is stable across key reordering on effects', () => {
    const reorderedA: EditPlan = {
      ...base,
      effects: [
        {
          id: 'R4',
          severity: 'warn',
          category: 'cross-row',
          title: 't',
          detail: 'd',
          affectedTable: 'stems',
          affectedRowCount: 3,
          references: { coreMeasurementIDs: [1, 2], treeIDs: [5] }
        }
      ]
    };
    const reorderedB: EditPlan = {
      ...base,
      effects: [
        {
          affectedTable: 'stems',
          references: { treeIDs: [5], coreMeasurementIDs: [1, 2] },
          severity: 'warn',
          id: 'R4',
          category: 'cross-row',
          affectedRowCount: 3,
          detail: 'd',
          title: 't'
        }
      ]
    };
    expect(hashPlan(reorderedA)).toBe(hashPlan(reorderedB));
  });

  it('ignores generatedAt and planHash', () => {
    const other: EditPlan = { ...base, planHash: 'zzzz', generatedAt: '2030-01-01T00:00:00Z' };
    expect(hashPlan(base)).toBe(hashPlan(other));
  });

  it('changes when a field change differs', () => {
    const other: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 13 }] };
    expect(hashPlan(base)).not.toBe(hashPlan(other));
  });

  it('changes when an effect detail differs', () => {
    const other: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], detail: 'd-changed' }]
    };
    expect(hashPlan(base)).not.toBe(hashPlan(other));
  });

  it('normalizes decimal precision for measured columns', () => {
    const a: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00001, to: 12.00001 }] };
    const b: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00002, to: 12.00002 }] };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('sorts reference arrays deterministically', () => {
    const a: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [2, 1], treeIDs: [9, 3] } }]
    };
    const b: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], references: { treeIDs: [3, 9], coreMeasurementIDs: [1, 2] } }]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('sorts fieldChanges by field name deterministically', () => {
    const a: EditPlan = {
      ...base,
      fieldChanges: [
        { field: 'MeasuredDBH', from: 10, to: 12 },
        { field: 'MeasuredHOM', from: 1.3, to: 1.5 }
      ]
    };
    const b: EditPlan = {
      ...base,
      fieldChanges: [
        { field: 'MeasuredHOM', from: 1.3, to: 1.5 },
        { field: 'MeasuredDBH', from: 10, to: 12 }
      ]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('normalizes Date ISO strings to YYYY-MM-DD', () => {
    const a: EditPlan = {
      ...base,
      fieldChanges: [{ field: 'MeasurementDate', from: '2026-04-21T12:00:00Z', to: '2026-05-01T00:00:00Z' }]
    };
    const b: EditPlan = {
      ...base,
      fieldChanges: [{ field: 'MeasurementDate', from: '2026-04-21T23:59:59Z', to: '2026-05-01T01:00:00Z' }]
    };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('canonicalizePlan is idempotent', () => {
    const once = canonicalizePlan(base);
    const twice = JSON.parse(JSON.stringify(once));
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('strips volatile fields from nested bulk row plans', () => {
    const bulkA: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: base }],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'a',
      generatedAt: '2026-04-21T00:00:00Z'
    };
    const bulkB: BulkEditPlan = {
      ...bulkA,
      planHash: 'b',
      generatedAt: '2030-01-01T00:00:00Z',
      rowPlans: [
        { rowIndex: 0, targetID: 1, status: 'matched', plan: { ...base, planHash: 'nested', generatedAt: '2030-01-01T00:00:00Z' } }
      ]
    };
    expect(hashPlan(bulkA)).toBe(hashPlan(bulkB));
  });

  it('hashes BulkEditPlan deterministically across reference-array order in nested row plans', () => {
    const effectOrderA = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [3, 1, 2], treeIDs: [9, 3] } }]
    };
    const effectOrderB = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [1, 2, 3], treeIDs: [3, 9] } }]
    };
    const bulkA: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 2,
      rowPlans: [
        { rowIndex: 0, targetID: 1, status: 'matched', plan: effectOrderA },
        { rowIndex: 1, targetID: 2, status: 'matched', plan: effectOrderA }
      ],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: '',
      generatedAt: '2026-04-21T00:00:00Z'
    };
    const bulkB: BulkEditPlan = {
      ...bulkA,
      rowPlans: [
        { rowIndex: 1, targetID: 2, status: 'matched', plan: effectOrderB },
        { rowIndex: 0, targetID: 1, status: 'matched', plan: effectOrderB }
      ]
    };
    expect(hashPlan(bulkA)).toBe(hashPlan(bulkB));
  });
});
