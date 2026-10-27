'use client';
import useSWR, { SWRConfiguration, useSWRConfig, unstable_serialize } from 'swr';
import type { QueryKey } from './queryKey';
import { defaultFetcher, QueryError } from './fetcher';

export interface RefetchOptions {
  strict?: boolean;
}

const MAX_STRICT_REFETCH_ATTEMPTS = 3;

/** Thrown by a strict refetch when every attempt was discarded by SWR because a later request on the same key was still pending. */
export class StrictRefetchIncompleteError extends Error {
  constructor(swrKey: string) {
    super(`refetch({ strict: true }) could not confirm success for key "${swrKey}": every attempt was superseded by a newer request that is still in flight`);
    this.name = 'StrictRefetchIncompleteError';
  }
}

export interface UseForestQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  error: QueryError | undefined;
  refetch: (options?: RefetchOptions) => Promise<T | undefined>;
}

type StringFetcher<T> = (url: string) => Promise<T>;

export function useForestQuery<T>(key: QueryKey | null, url: string | null, opts?: SWRConfiguration<T>): UseForestQueryResult<T> {
  const enabled = key !== null && url !== null;
  const swrKey = enabled ? ([...(key as QueryKey), url as string] as const) : null;
  const { fetcher: contextFetcher, cache } = useSWRConfig();

  const tupleFetcher = (args: readonly unknown[]): Promise<T> => {
    // SWR passes the full tuple key as one arg; URL is the last element.
    const u = args[args.length - 1] as string;
    const userFetcher = opts?.fetcher as StringFetcher<T> | undefined;
    return userFetcher
      ? userFetcher(u)
      : contextFetcher && contextFetcher !== defaultFetcher
        ? (contextFetcher as StringFetcher<T>)(u)
        : (defaultFetcher<T>(u) as Promise<T>);
  };

  const { fetcher: _ignored, ...restOpts } = opts ?? {};
  const swr = useSWR<T, QueryError>(swrKey, tupleFetcher, restOpts as SWRConfiguration<T>);

  const refetch = async (options?: RefetchOptions): Promise<T | undefined> => {
    if (!options?.strict || !swrKey) return swr.mutate();
    const serializedKey = unstable_serialize(swrKey);
    for (let attempt = 1; attempt <= MAX_STRICT_REFETCH_ATTEMPTS; attempt++) {
      await swr.mutate();
      // swr.mutate() never rejects on a revalidation failure, and the fetcher that
      // actually runs may belong to a different subscriber on this same key. SWR's
      // keyed cache entry is the authoritative state every subscriber shares.
      const keyedState = cache.get(serializedKey);
      if (keyedState?.error) throw keyedState.error as QueryError;
      // SWR discards a revalidation superseded by a later request on the same key,
      // leaving that request pending (isValidating). Revalidating again makes this
      // call the newest request, so its result is the one the cache keeps.
      if (!keyedState?.isValidating) return keyedState?.data as T | undefined;
    }
    throw new StrictRefetchIncompleteError(serializedKey);
  };

  return {
    data: swr.data,
    isLoading: !swr.data && !swr.error && swr.isValidating,
    isValidating: swr.isValidating,
    error: swr.error,
    refetch
  };
}
