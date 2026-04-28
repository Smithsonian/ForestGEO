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

  // Read the ambient SWR context fetcher (set via <SWRConfig value={{ fetcher }}>) so
  // that test helpers using wrapperFor() continue to work without changes.
  const { fetcher: contextFetcher } = useSWRConfig();

  // SWR passes the whole tuple key to the fetcher as ONE argument. Adapt it: pull
  // out the URL (last tuple element) and call the caller-provided fetcher (or the
  // SWR context fetcher, or the canonical defaultFetcher) with the URL string.
  const tupleFetcher = (args: readonly unknown[]): Promise<T> => {
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
