export interface DiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export const EXCLUDED_FIELDS: ReadonlySet<string> = new Set(['id', 'changeID', 'ChangeID', 'CreatedAt', 'UpdatedAt', 'createdAt', 'updatedAt']);

export function computeDiff(oldRowState: Record<string, unknown> | null, newRowState: Record<string, unknown> | null): DiffEntry[] {
  if (!oldRowState && !newRowState) return [];

  const oldObj = oldRowState ?? {};
  const newObj = newRowState ?? {};
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const diffs: DiffEntry[] = [];

  for (const key of allKeys) {
    if (EXCLUDED_FIELDS.has(key)) continue;

    const oldVal = oldObj[key];
    const newVal = newObj[key];

    const oldSerialized = JSON.stringify(oldVal);
    const newSerialized = JSON.stringify(newVal);

    if (oldSerialized !== newSerialized) {
      diffs.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs.sort((a, b) => a.field.localeCompare(b.field));
}

/** The fields of one row image that carry a value a reader can see: not null, not excluded, in the order computeDiff uses. */
export function recordedFieldNames(rowState: Record<string, unknown>): string[] {
  return Object.keys(rowState)
    .filter(field => !EXCLUDED_FIELDS.has(field) && rowState[field] !== null && rowState[field] !== undefined)
    .sort((a, b) => a.localeCompare(b));
}
