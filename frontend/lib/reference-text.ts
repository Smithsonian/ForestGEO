/**
 * Reference-data text normalization at the shared grid persistence boundary
 * (config/macros/coreapifunctions POST/PATCH).
 *
 * Only the outer whitespace of the listed free-text reference fields is removed. Internal
 * spaces, case and leading zeros are untouched, null/undefined stay as they are, and
 * non-string values pass through. Existing stored rows are never rewritten here.
 */
const TRIMMED_REFERENCE_FIELDS: Record<string, readonly string[]> = {
  // Demapped (DB column) names, as produced by MapperFactory.demapData.
  attributes: ['Code', 'Description']
};

export function trimReferenceTextFields<T extends Record<string, unknown>>(dataType: string, row: T): T {
  const fields = TRIMMED_REFERENCE_FIELDS[dataType];
  if (!fields) return row;
  const trimmed: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = trimmed[field];
    if (typeof value === 'string') trimmed[field] = value.trim();
  }
  return trimmed as T;
}
