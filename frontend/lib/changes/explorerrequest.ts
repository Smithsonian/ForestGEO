import { z } from 'zod';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import { CHANGE_OPERATIONS, DEFAULT_RECENT_CHANGES_FILTERS, isDateRangeInverted } from '@/config/recentchangesexplorer';

/** unifiedchangelog.TableName is varchar(64). */
export const CHANGE_TABLE_NAME_MAX_LENGTH = 64;
export const CHANGE_QUICK_SEARCH_MAX_LENGTH = 500;
export const RECENT_CHANGES_FIRST_PAGE = 0;
export const RECENT_CHANGES_MIN_PAGE_SIZE = 10;
export const RECENT_CHANGES_MAX_PAGE_SIZE = 100;
export const RECENT_CHANGES_DEFAULT_PAGE_SIZE = 25;

export const INVALID_RECENT_CHANGES_REQUEST_RESPONSE = { error: 'Invalid recent changes request', code: 'INVALID_RECENT_CHANGES_REQUEST' } as const;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NO_DATE_BOUND = '';

/** True for a day that exists: `2026-02-30` has the right shape and is not a date. */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const dateBound = z
  .string()
  .refine(value => value === NO_DATE_BOUND || isCalendarDate(value), 'Expected a calendar date YYYY-MM-DD')
  .optional()
  .default(DEFAULT_RECENT_CHANGES_FILTERS.changedFrom);

export const recentChangesFiltersSchema = z
  .object({
    operation: z.enum(CHANGE_OPERATIONS).optional().default(DEFAULT_RECENT_CHANGES_FILTERS.operation),
    changedBy: z.string().max(CHANGED_BY_MAX_LENGTH).optional().default(DEFAULT_RECENT_CHANGES_FILTERS.changedBy),
    tableName: z.string().max(CHANGE_TABLE_NAME_MAX_LENGTH).optional().default(DEFAULT_RECENT_CHANGES_FILTERS.tableName),
    quickSearch: z.string().max(CHANGE_QUICK_SEARCH_MAX_LENGTH).optional().default(DEFAULT_RECENT_CHANGES_FILTERS.quickSearch),
    changedFrom: dateBound,
    changedTo: dateBound,
    presetId: z.unknown().optional()
  })
  .superRefine((filters, context) => {
    if (isDateRangeInverted(filters.changedFrom, filters.changedTo)) {
      context.addIssue({ code: 'custom', path: ['changedTo'], message: 'changedTo is before changedFrom' });
    }
  })
  .transform(filters => ({
    operation: filters.operation,
    changedBy: filters.changedBy,
    tableName: filters.tableName,
    quickSearch: filters.quickSearch,
    changedFrom: filters.changedFrom,
    changedTo: filters.changedTo
  }));

const clampPage = (page: number) => Math.max(RECENT_CHANGES_FIRST_PAGE, page);
const clampPageSize = (pageSize: number) => Math.min(RECENT_CHANGES_MAX_PAGE_SIZE, Math.max(RECENT_CHANGES_MIN_PAGE_SIZE, pageSize));

export const recentChangesQueryRequestSchema = z.object({
  schema: z.string().refine(isValidSchema, 'Invalid schema'),
  plotID: z.coerce.number().int().positive(),
  // prefault, not default: zod 4 returns a .default() value unparsed, so the filter defaults must be parsed through the schema.
  filters: recentChangesFiltersSchema.prefault({}),
  page: z.coerce
    .number()
    .int()
    .nullish()
    .transform(page => clampPage(page ?? RECENT_CHANGES_FIRST_PAGE)),
  pageSize: z.coerce
    .number()
    .int()
    .nullish()
    .transform(pageSize => clampPageSize(pageSize ?? RECENT_CHANGES_DEFAULT_PAGE_SIZE))
});

export type ParsedRecentChangesQueryRequest = z.output<typeof recentChangesQueryRequestSchema>;
