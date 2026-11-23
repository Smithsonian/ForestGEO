import { z } from 'zod';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import {
  CHANGE_EXPORT_ERROR_CODES,
  CHANGE_OPERATIONS,
  DEFAULT_RECENT_CHANGES_FILTERS,
  isDateRangeInverted,
  NO_DATE_BOUND
} from '@/config/recentchangesexplorer';

/** unifiedchangelog.TableName is varchar(64). */
export const CHANGE_TABLE_NAME_MAX_LENGTH = 64;
export const CHANGE_QUICK_SEARCH_MAX_LENGTH = 500;
export const RECENT_CHANGES_FIRST_PAGE = 0;
export const RECENT_CHANGES_MIN_PAGE_SIZE = 10;
export const RECENT_CHANGES_MAX_PAGE_SIZE = 100;
export const RECENT_CHANGES_DEFAULT_PAGE_SIZE = 25;

export const INVALID_RECENT_CHANGES_REQUEST_RESPONSE = { error: 'Invalid recent changes request', code: 'INVALID_RECENT_CHANGES_REQUEST' } as const;
export const INVALID_CHANGE_EXPORT_REQUEST_RESPONSE = { error: 'Invalid export request', code: CHANGE_EXPORT_ERROR_CODES.invalidRequest } as const;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** MySQL's DATE_ADD(day, INTERVAL 1 DAY) is NULL past 9999-12-31, which would make a To of that day match nothing. */
export const LATEST_FILTER_DATE_YEAR = 9998;
/** unifiedchangelog.ChangeTimestamp is a DATETIME, whose documented range starts in year 1000; year 0000 makes DATE_ADD raise ERROR 1525. */
export const EARLIEST_FILTER_DATE_YEAR = 1000;
const YEAR_PREFIX_LENGTH = 4;

/** True for a day that exists: `2026-02-30` has the right shape and is not a date. */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function isFilterableDate(value: string): boolean {
  if (!isCalendarDate(value)) return false;
  const year = Number(value.slice(0, YEAR_PREFIX_LENGTH));
  return year >= EARLIEST_FILTER_DATE_YEAR && year <= LATEST_FILTER_DATE_YEAR;
}

/** MySQL measures VARCHAR(n) in characters, so a bound on a stored value counts code points, not UTF-16 units. */
const characterCountAtMost = (maxCharacters: number) => (value: string) => Array.from(value).length <= maxCharacters;

const dateBound = z
  .string()
  .refine(value => value === NO_DATE_BOUND || isFilterableDate(value), 'Expected a calendar date YYYY-MM-DD')
  .optional()
  .default(DEFAULT_RECENT_CHANGES_FILTERS.changedFrom);

export const recentChangesFiltersSchema = z
  .object({
    operation: z.enum(CHANGE_OPERATIONS).optional().default(DEFAULT_RECENT_CHANGES_FILTERS.operation),
    changedBy: z
      .string()
      .refine(characterCountAtMost(CHANGED_BY_MAX_LENGTH), `Expected at most ${CHANGED_BY_MAX_LENGTH} characters`)
      .optional()
      .default(DEFAULT_RECENT_CHANGES_FILTERS.changedBy),
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

const PLOT_ID_DIGITS_PATTERN = /^\d+$/;
/** A number or a string of digits, so Number() never reads `true`, `[7]`, `"1e1"` or `"0x10"` as a plot. */
const plotIDSchema = z.union([z.number(), z.string().regex(PLOT_ID_DIGITS_PATTERN).transform(Number)]).pipe(z.number().int().positive());

const scopeShape = {
  schema: z.string().refine(isValidSchema, 'Invalid schema'),
  plotID: plotIDSchema,
  // prefault, not default: zod 4 returns a .default() value unparsed, so the filter defaults must be parsed through the schema.
  filters: recentChangesFiltersSchema.prefault({})
};

export const recentChangesQueryRequestSchema = z.object({
  ...scopeShape,
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

export const changeExportRequestSchema = z.object(scopeShape);

export type ParsedRecentChangesQueryRequest = z.output<typeof recentChangesQueryRequestSchema>;
export type ParsedChangeExportRequest = z.output<typeof changeExportRequestSchema>;
