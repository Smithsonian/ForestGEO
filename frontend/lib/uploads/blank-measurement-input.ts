/**
 * Shared "is this measurement upload input structurally empty" predicate, used by both
 * the worker and stage-measurements to detect a header-only/blank file before either
 * does destructive CLEAN_REUPLOAD census-replacement work (issue #504).
 *
 * A row is "blank" when every cell is null/undefined or, trimmed, empty. This covers
 * more than Papa Parse's `skipEmptyLines`: a delimiter-only line (",,,,,,") parses to a
 * row of empty-string cells rather than being skipped.
 *
 * Server-only guard logic — must NOT be exported for client use.
 */

export type MeasurementInputRow = Record<string, unknown>;

/**
 * True when a single cell is blank: null/undefined, a whitespace-only string, or
 * (Papa Parse's `__parsed_extra` overflow column) an array whose every element is
 * blank. Any other type (number incl. 0, boolean, Date, object) is never blank.
 */
function isBlankCell(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(isBlankCell);
  return false;
}

/** True when every cell of the row is blank per isBlankCell. */
export function isBlankMeasurementRow(row: MeasurementInputRow | null | undefined): boolean {
  if (!row) return true;
  const values = Object.values(row);
  if (values.length === 0) return true;
  return values.every(isBlankCell);
}

/**
 * True when there are no rows, or every row is blank (isBlankMeasurementRow). Not
 * semantic validity: a nonempty, partially-blank row must still reach normal row
 * validation so its failure is recorded, not conflated with an empty file.
 */
export function isEffectivelyEmptyMeasurementInput(rows: ReadonlyArray<MeasurementInputRow> | null | undefined): boolean {
  if (!rows || rows.length === 0) return true;
  return rows.every(isBlankMeasurementRow);
}
