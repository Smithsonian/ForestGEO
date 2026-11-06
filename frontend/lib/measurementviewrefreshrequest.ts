import { z } from 'zod';

/** The most stored-view rows one POST /api/refreshviews/[view]/[schema] may rebuild by ID (#544 remedy R4). */
export const MAX_VIEW_REFRESH_MEASUREMENT_IDS = 100;

const CORE_MEASUREMENT_IDS_FIELD = 'coreMeasurementIDs' as const;
const ISSUE_PATH_SEPARATOR = '.';

export const INVALID_VIEW_REFRESH_IDS_RESPONSE = {
  error: `coreMeasurementIDs must be 1 to ${MAX_VIEW_REFRESH_MEASUREMENT_IDS} distinct positive integers, sent with no other field`,
  code: 'INVALID_VIEW_REFRESH_IDS'
} as const;

const measurementViewRefreshIDsSchema = z
  .object({
    [CORE_MEASUREMENT_IDS_FIELD]: z
      .array(z.number().int().positive())
      .min(1)
      .max(MAX_VIEW_REFRESH_MEASUREMENT_IDS)
      .refine(ids => new Set(ids).size === ids.length, 'coreMeasurementIDs must be distinct')
  })
  .strict();

export type MeasurementViewRefreshIDsParseResult = { ok: true; coreMeasurementIDs: number[] } | { ok: false; issues: Array<{ path: string; code: string }> };

/** A body naming coreMeasurementIDs asks for the per-measurement rebuild; every other body keeps the route's plot-census or full-refresh parse. */
export function hasCoreMeasurementIDs(body: unknown): boolean {
  return typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, CORE_MEASUREMENT_IDS_FIELD);
}

/** Validates before any SQL runs; issues carry paths and codes only, never values. */
export function parseMeasurementViewRefreshIDs(body: unknown): MeasurementViewRefreshIDsParseResult {
  const parsed = measurementViewRefreshIDsSchema.safeParse(body);
  if (parsed.success) return { ok: true, coreMeasurementIDs: parsed.data.coreMeasurementIDs };
  return { ok: false, issues: parsed.error.issues.map(issue => ({ path: issue.path.map(String).join(ISSUE_PATH_SEPARATOR), code: issue.code })) };
}
