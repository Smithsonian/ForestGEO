import { DuplicateDeletion, Effect } from '../types';

export function applyDuplicateRules(duplicates: readonly DuplicateDeletion[]): Effect[] {
  if (duplicates.length === 0) return [];
  return [
    {
      id: 'R6',
      severity: 'destructive',
      category: 'destructive',
      title: `${duplicates.length} duplicate measurement(s) will be deleted`,
      detail: 'Survivor selection keeps one measurement per stem in this census; the rest are removed.',
      affectedTable: 'coremeasurements',
      affectedRowCount: duplicates.length
    }
  ];
}
