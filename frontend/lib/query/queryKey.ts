export type QueryNamespace =
  | 'grid:measurements'
  | 'grid:measurementssummary'
  | 'grid:measurementssummary_staging'
  | 'grid:summary'
  | 'grid:quadrats'
  | 'grid:quadratpersonnel'
  | 'grid:attributes'
  | 'grid:taxonomies'
  | 'grid:alltaxonomiesview'
  | 'grid:stemtaxonomiesview'
  | 'grid:errors'
  | 'grid:failedmeasurements'
  | 'grid:personnel'
  | 'grid:roles'
  | 'grid:trees'
  | 'grid:stems'
  | 'grid:unifiedchangelog'
  | 'dashboard:metrics'
  | 'dashboard:changelog'
  | 'dashboard:dataquality'
  | 'dashboard:progress'
  | 'select:species'
  | 'select:quadrats'
  | 'select:attributes'
  | 'select:trees'
  | 'select:stems';

export interface QueryScope {
  siteSchema?: string;
  plotID?: number;
  censusID?: number;
}

export type QueryKey = readonly [QueryNamespace, string, string | undefined];

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function queryKey(
  namespace: QueryNamespace,
  scope: QueryScope,
  params?: Record<string, unknown>
): QueryKey {
  const scopeKey = `${scope.siteSchema ?? ''}|${scope.plotID ?? ''}|${scope.censusID ?? ''}`;
  const paramKey = params ? stableStringify(params) : undefined;
  return [namespace, scopeKey, paramKey] as const;
}
