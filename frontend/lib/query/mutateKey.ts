'use client';
import { mutate } from 'swr';
import { QueryNamespace, QueryScope, queryKey } from './queryKey';

export interface MutateKeyOptions {
  scope?: QueryScope;
  revalidate?: boolean;
}

export async function mutateKey(
  prefix: QueryNamespace,
  opts: MutateKeyOptions = {}
): Promise<void> {
  const { scope, revalidate = true } = opts;
  const targetScopeKey = scope ? queryKey(prefix, scope)[1] : undefined;

  await mutate(
    (key: unknown) => {
      if (!Array.isArray(key) || key.length < 2) return false;
      if (key[0] !== prefix) return false;
      if (targetScopeKey !== undefined && key[1] !== targetScopeKey) return false;
      return true;
    },
    undefined,
    { revalidate }
  );
}
