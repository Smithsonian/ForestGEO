import { Effect } from '../types';

export function applyDuplicateRules(duplicateCount: number): Effect[] {
  if (duplicateCount <= 0) return [];
  return [
    {
      id: 'R6',
      severity: 'destructive',
      category: 'destructive',
      title: `${duplicateCount} duplicate measurement(s) will be deleted`,
      detail: 'Survivor selection keeps one measurement per stem in this census; the rest are removed.',
      affectedTable: 'coremeasurements',
      affectedRowCount: duplicateCount
    }
  ];
}
