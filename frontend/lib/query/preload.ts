import { preload } from 'swr';
import { defaultFetcher } from './fetcher';
import type { QueryKey } from './queryKey';
import { stableStringify } from './queryKey';

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 150;

function keyId(key: QueryKey): string {
  return stableStringify(key);
}

export function preloadKey(key: QueryKey, url: string): void {
  const id = keyId(key);
  if (pending.has(id)) return;
  const timer = setTimeout(() => {
    pending.delete(id);
    preload([...key, url] as unknown as string, () => defaultFetcher(url));
  }, DEBOUNCE_MS);
  pending.set(id, timer);
}

preloadKey.cancel = (key: QueryKey): void => {
  const id = keyId(key);
  const timer = pending.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    pending.delete(id);
  }
};
