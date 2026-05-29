'use client';
import useSWR, { SWRConfiguration, useSWRConfig } from 'swr';
import type { QueryKey } from './queryKey';
import { defaultFetcher, QueryError } from './fetcher';

export interface UseForestQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  error: QueryError | undefined;
  refetch: () => Promise<T | undefined>;
}

type StringFetcher<T> = (url: string) => Promise<T>;

export function useForestQuery<T>(key: QueryKey | null, url: string | null, opts?: SWRConfiguration<T>): UseForestQueryResult<T> {
  const enabled = key !== null && url !== null;
  const swrKey = enabled ? ([...(key as QueryKey), url as string] as const) : null;
  const { fetcher: contextFetcher } = useSWRConfig();

  const tupleFetcher = (args: readonly unknown[]): Promise<T> => {
    // SWR passes the full tuple key as one arg; URL is the last element.
    const u = args[args.length - 1] as string;
    const userFetcher = opts?.fetcher as StringFetcher<T> | undefined;
    if (userFetcher) return userFetcher(u);
    if (contextFetcher && contextFetcher !== defaultFetcher) {
      return (contextFetcher as StringFetcher<T>)(u);
    }
    return defaultFetcher<T>(u) as Promise<T>;
  };

  const { fetcher: _ignored, ...restOpts } = opts ?? {};
  const swr = useSWR<T, QueryError>(swrKey, tupleFetcher, restOpts as SWRConfiguration<T>);

  return {
    data: swr.data,
    isLoading: !swr.data && !swr.error && swr.isValidating,
    isValidating: swr.isValidating,
    error: swr.error,
    refetch: async () => swr.mutate()
  };
}
