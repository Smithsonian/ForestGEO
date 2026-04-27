'use client';
import useSWR, { SWRConfiguration } from 'swr';
import type { QueryKey } from './queryKey';
import type { QueryError } from './fetcher';

export interface UseForestQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  error: QueryError | undefined;
  refetch: () => Promise<T | undefined>;
}

export function useForestQuery<T>(
  key: QueryKey | null,
  url: string | null,
  opts?: SWRConfiguration<T>
): UseForestQueryResult<T> {
  const enabled = key !== null && url !== null;
  const swrKey = enabled ? ([...(key as QueryKey), url as string] as const) : null;

  const swr = useSWR<T, QueryError>(swrKey, opts as SWRConfiguration<T> | undefined);

  return {
    data: swr.data,
    isLoading: !swr.data && !swr.error && swr.isValidating,
    isValidating: swr.isValidating,
    error: swr.error,
    refetch: async () => swr.mutate()
  };
}
