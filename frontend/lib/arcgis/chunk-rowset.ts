import type { FileRowSet } from '@/config/macros/formdetails';

export function chunkFileRowSet(rowSet: FileRowSet, size: number): FileRowSet[] {
  if (size <= 0) throw new RangeError(`chunk size must be positive, received ${size}`);
  const entries = Object.entries(rowSet);
  const chunks: FileRowSet[] = [];
  for (let start = 0; start < entries.length; start += size) {
    chunks.push(Object.fromEntries(entries.slice(start, start + size)));
  }
  return chunks;
}
