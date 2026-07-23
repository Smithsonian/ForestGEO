import type { QuadratCsvRow, QuadratReferenceCorner } from './types';

export type { QuadratReferenceCorner };

export const REFERENCE_CORNER_OPTIONS: ReadonlyArray<{ value: QuadratReferenceCorner; label: string }> = [
  { value: 'SW', label: 'South-west (lower-left)' },
  { value: 'SE', label: 'South-east (lower-right)' },
  { value: 'NW', label: 'North-west (upper-left)' },
  { value: 'NE', label: 'North-east (upper-right)' }
];

export const DEFAULT_REFERENCE_CORNER: QuadratReferenceCorner = 'SW';

export function isQuadratReferenceCorner(value: unknown): value is QuadratReferenceCorner {
  return typeof value === 'string' && REFERENCE_CORNER_OPTIONS.some(option => option.value === value);
}

export function getReferenceCornerLabel(corner: QuadratReferenceCorner): string {
  return REFERENCE_CORNER_OPTIONS.find(option => option.value === corner)?.label ?? corner;
}

export function normalizeToSouthwest(row: QuadratCsvRow, referenceCorner: QuadratReferenceCorner): QuadratCsvRow {
  const shiftX = referenceCorner === 'SE' || referenceCorner === 'NE' ? row.dimensionX : 0;
  const shiftY = referenceCorner === 'NW' || referenceCorner === 'NE' ? row.dimensionY : 0;
  // Same reference is intentional: SW is the default and therefore the common
  // case, and this runs per-row on files up to MAX_GENERATED_QUADRATS — once
  // in a client-side preview and again in the server-side schema transform.
  if (shiftX === 0 && shiftY === 0) return row;
  return { ...row, startX: row.startX - shiftX, startY: row.startY - shiftY };
}

/**
 * Provisioning runs recorded before reference-corner support stored CSV rows
 * without the canonical discriminant. Those coordinates could only ever have
 * been south-west, since that was the sole interpretation the app supported.
 * Retry and teardown load stored payloads with a bare JSON.parse, so without
 * this the discriminant would be a compile-time fiction on historical rows.
 *
 * The return value is still unvalidated JSON: callers must parse it through
 * CanonicalProvisioningSchema, never cast it.
 */
export function upgradeLegacyQuadratConfig(quadrats: unknown): unknown {
  if (typeof quadrats !== 'object' || quadrats === null) return quadrats;
  const candidate = quadrats as Record<string, unknown>;
  if (candidate.mode !== 'csv') return quadrats;
  if (candidate.coordinates === 'canonical-sw') return quadrats;
  return {
    ...candidate,
    coordinates: 'canonical-sw',
    sourceCoordinateReferenceCorner: DEFAULT_REFERENCE_CORNER
  };
}
