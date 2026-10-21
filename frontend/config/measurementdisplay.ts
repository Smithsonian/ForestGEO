const MEASUREMENT_DISPLAY_DECIMAL_PLACES = 2;

/**
 * Same rule as the DBH grid column (datagridcolumns.tsx valueFormatter): round to two places and drop
 * trailing zeros. mysql2 returns DECIMAL columns as strings, so a raw '120.000000' becomes '120'.
 * Non-numeric input is returned unchanged.
 */
export function formatMeasurementForDisplay(value: unknown): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return String(parseFloat(numericValue.toFixed(MEASUREMENT_DISPLAY_DECIMAL_PLACES)));
}
