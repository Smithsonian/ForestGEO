'use client';
import { QueryNamespace, QueryScope } from './queryKey';
import { mutateKey } from './mutateKey';

export type MutationKind =
  | 'delete-measurement'
  | 'reingest'
  | 'save-edit-plan'
  | 'delete-quadrat'
  | 'delete-attribute'
  | 'delete-taxonomy'
  | 'census-creation';

const FAN_OUT: Record<MutationKind, readonly QueryNamespace[]> = {
  'delete-measurement': ['grid:measurements', 'grid:summary', 'dashboard:metrics'],
  reingest: ['grid:errors', 'grid:measurements', 'dashboard:metrics'],
  'save-edit-plan': ['grid:measurements', 'grid:errors', 'dashboard:metrics'],
  'delete-quadrat': ['grid:quadrats', 'grid:measurements', 'dashboard:metrics'],
  'delete-attribute': ['grid:attributes', 'grid:measurements', 'dashboard:metrics'],
  'delete-taxonomy': ['grid:taxonomies', 'grid:measurements', 'dashboard:metrics'],
  'census-creation': [
    'grid:measurements',
    'grid:summary',
    'grid:errors',
    'grid:quadrats',
    'grid:attributes',
    'grid:taxonomies',
    'grid:personnel',
    'grid:trees',
    'grid:stems',
    'dashboard:metrics',
    'dashboard:changelog',
    'dashboard:dataquality',
    'dashboard:progress'
  ]
};

export async function invalidateAfter(kind: MutationKind, scope: QueryScope): Promise<void> {
  const prefixes = FAN_OUT[kind];
  await Promise.all(prefixes.map(p => mutateKey(p, { scope, revalidate: true })));
}
