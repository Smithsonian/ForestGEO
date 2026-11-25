import { z } from 'zod';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { parseStrictPositiveInteger } from '@/lib/censusoverview/summaryrequest';
import {
  DEFAULT_ERROR_EXPLORER_FILTERS,
  ERROR_EXPLORER_COLUMN_FIELDS,
  ERROR_EXPLORER_FILTER_OPERATORS,
  ERROR_EXPLORER_MAX_PAGE_SIZE,
  ERROR_EXPLORER_MIN_PAGE_SIZE,
  ERROR_EXPLORER_SORT_DIRECTIONS,
  isErrorExplorerNumberField,
  isOperatorAllowedForField,
  isValuelessFilterOperator,
  MAX_COLUMN_FILTER_VALUE_LENGTH,
  MAX_ERROR_EXPLORER_CENSUS_IDS,
  MAX_ERROR_EXPLORER_COLUMN_FILTERS,
  MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH,
  MAX_ERROR_EXPLORER_FILTER_STRINGS,
  MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH,
  MAX_ERROR_EXPLORER_SORT_ITEMS,
  MAX_ERROR_TYPE_CODE_LENGTH,
  MAX_ERROR_TYPE_MESSAGE_LENGTH,
  type ErrorExplorerFilters
} from '@/config/errorsexplorer';

const SOURCE_FILTER_VALUES = ['all', 'validation', 'ingestion'] as const;
const ERROR_SOURCE_VALUES = ['validation', 'ingestion'] as const;
const CONTRADICTION_TYPE_VALUES = ['duplicate_tag_stem', 'same_batch_conflict'] as const;
const ISSUE_PATH_SEPARATOR = '.';

export const INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE = { error: 'Invalid errors explorer request', code: 'INVALID_ERRORS_EXPLORER_REQUEST' } as const;
export const ERRORS_EXPLORER_FAILURE_RESPONSES = {
  query: { error: 'Unable to load errors', code: 'ERRORS_EXPLORER_QUERY_FAILED' },
  facets: { error: 'Unable to load the error totals', code: 'ERRORS_EXPLORER_FACETS_FAILED' },
  details: { error: 'Unable to load row details', code: 'ERRORS_EXPLORER_DETAILS_FAILED' }
} as const;

const boundedStrings = z.array(z.string().max(MAX_ERROR_EXPLORER_FILTER_STRING_LENGTH)).max(MAX_ERROR_EXPLORER_FILTER_STRINGS);

export const errorExplorerFiltersSchema = z.object({
  source: z.enum(SOURCE_FILTER_VALUES).optional().default(DEFAULT_ERROR_EXPLORER_FILTERS.source),
  exactMessages: boundedStrings.optional().default([]),
  affectedFields: boundedStrings.optional().default([]),
  contradictionOnly: z.boolean().optional().default(false),
  contradictionTypes: z.array(z.enum(CONTRADICTION_TYPE_VALUES)).max(CONTRADICTION_TYPE_VALUES.length).optional().default([]),
  quickSearch: z.string().max(MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH).optional().default('')
});

const scopeShape = {
  schema: z.string().refine(isValidSchema, 'Invalid schema'),
  plotID: z.coerce.number().int().positive(),
  censusID: z.coerce.number().int().positive(),
  censusIDs: z.array(z.coerce.number().int().positive()).max(MAX_ERROR_EXPLORER_CENSUS_IDS).optional().default([]),
  // prefault, not default: zod 4 returns a .default() value unparsed, so the filter defaults must be parsed through the schema.
  filters: errorExplorerFiltersSchema.prefault({})
};

const errorTypeSchema = z
  .object({
    source: z.enum(ERROR_SOURCE_VALUES),
    code: z.string().min(1).max(MAX_ERROR_TYPE_CODE_LENGTH),
    message: z.string().max(MAX_ERROR_TYPE_MESSAGE_LENGTH)
  })
  .strict();

export const errorExplorerExportRequestSchema = z.object({ ...scopeShape, errorType: errorTypeSchema.optional() }).strict();
export const errorExplorerFacetsRequestSchema = z.object(scopeShape).strict();

const sortItemSchema = z.object({ field: z.enum(ERROR_EXPLORER_COLUMN_FIELDS), sort: z.enum(ERROR_EXPLORER_SORT_DIRECTIONS) }).strict();

const columnFilterSchema = z
  .object({
    field: z.enum(ERROR_EXPLORER_COLUMN_FIELDS),
    operator: z.enum(ERROR_EXPLORER_FILTER_OPERATORS),
    value: z.union([z.string(), z.number()]).optional()
  })
  .strict()
  .superRefine((item, context) => {
    if (!isOperatorAllowedForField(item.field, item.operator)) {
      context.addIssue({ code: 'custom', path: ['operator'], message: 'Operator not allowed for this column' });
      return;
    }
    if (isValuelessFilterOperator(item.operator)) {
      if (item.value !== undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'This operator takes no value' });
      return;
    }
    if (isErrorExplorerNumberField(item.field)) {
      if (typeof item.value !== 'number' || !Number.isFinite(item.value))
        context.addIssue({ code: 'custom', path: ['value'], message: 'Expected a finite number' });
      return;
    }
    if (typeof item.value !== 'string' || item.value.trim().length === 0 || item.value.length > MAX_COLUMN_FILTER_VALUE_LENGTH) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Expected a non-blank text value within the length bound' });
    }
  });

export const errorExplorerQueryRequestSchema = z
  .object({
    ...scopeShape,
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().min(ERROR_EXPLORER_MIN_PAGE_SIZE).max(ERROR_EXPLORER_MAX_PAGE_SIZE),
    errorType: errorTypeSchema.optional(),
    sortModel: z.array(sortItemSchema).max(MAX_ERROR_EXPLORER_SORT_ITEMS).optional().default([]),
    columnFilters: z.array(columnFilterSchema).max(MAX_ERROR_EXPLORER_COLUMN_FILTERS).optional().default([])
  })
  .strict();

export type ParsedErrorExplorerQueryRequest = z.output<typeof errorExplorerQueryRequestSchema>;
export type ParsedErrorExplorerScopeRequest = z.output<typeof errorExplorerFacetsRequestSchema>;
export type ParsedErrorExplorerExportRequest = z.output<typeof errorExplorerExportRequestSchema>;

export interface ExplorerRequestIssue {
  path: string;
  code: string;
}

export type ExplorerRequestParseResult<T> = { ok: true; data: T } | { ok: false; issues: ExplorerRequestIssue[] };

/** Validates before any SQL runs; issues carry paths and codes only, never values. */
export function parseExplorerRequest<Schema extends z.ZodType>(schema: Schema, raw: unknown): ExplorerRequestParseResult<z.output<Schema>> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, issues: parsed.error.issues.map(issue => ({ path: issue.path.map(String).join(ISSUE_PATH_SEPARATOR), code: issue.code })) };
}

export type ExplorerJsonBody = { ok: true; body: unknown } | { ok: false };

export async function readExplorerRequestJson(request: Request): Promise<ExplorerJsonBody> {
  try {
    return { ok: true, body: await request.json() };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return { ok: false };
    throw error;
  }
}

/** Distinct census IDs in request order; the route's own census when the list is empty. */
export function resolveRequestCensusIDs({ censusID, censusIDs }: { censusID: number; censusIDs: readonly number[] }): number[] {
  return censusIDs.length > 0 ? Array.from(new Set(censusIDs)) : [censusID];
}

export type ErrorExplorerDetailsParams = { ok: true; measurementID: number; plotID: number; censusID: number } | { ok: false };

export function parseErrorExplorerDetailsParams(raw: {
  measurementID: string | undefined;
  plotID: string | null;
  censusID: string | null;
}): ErrorExplorerDetailsParams {
  const measurementID = parseStrictPositiveInteger(raw.measurementID);
  const plotID = parseStrictPositiveInteger(raw.plotID ?? undefined);
  const censusID = parseStrictPositiveInteger(raw.censusID ?? undefined);
  if (measurementID === null || plotID === null || censusID === null) return { ok: false };
  return { ok: true, measurementID, plotID, censusID };
}

// Stored filters (client restore). Only the keys the new UI can show and clear survive.
const storedFiltersSchema = z.object({
  source: z.enum(SOURCE_FILTER_VALUES).optional(),
  contradictionOnly: z.boolean().optional(),
  quickSearch: z.string().max(MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH).optional(),
  exactMessages: boundedStrings.optional()
});

function defaultFilters(): ErrorExplorerFilters {
  return { ...DEFAULT_ERROR_EXPLORER_FILTERS };
}

function readStoredJson(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Restores the four keys; an invalid value resets everything to the defaults. A saved
 * contradictionOnly with a narrower source restores as Show → Contradictions, which broadens
 * the old intersection (spec Request validation → Restored filters).
 */
export function parseStoredErrorExplorerFilters(stored: string | null): ErrorExplorerFilters {
  if (stored === null) return defaultFilters();
  const parsed = storedFiltersSchema.safeParse(readStoredJson(stored));
  if (!parsed.success) return defaultFilters();
  const restored: ErrorExplorerFilters = {
    ...defaultFilters(),
    ...(parsed.data.source !== undefined ? { source: parsed.data.source } : {}),
    ...(parsed.data.contradictionOnly !== undefined ? { contradictionOnly: parsed.data.contradictionOnly } : {}),
    ...(parsed.data.quickSearch !== undefined ? { quickSearch: parsed.data.quickSearch } : {}),
    ...(parsed.data.exactMessages !== undefined ? { exactMessages: parsed.data.exactMessages } : {})
  };
  return restored.contradictionOnly && restored.source !== 'all' ? { ...restored, source: 'all' } : restored;
}

export function serializeStoredErrorExplorerFilters({ source, contradictionOnly, quickSearch, exactMessages }: ErrorExplorerFilters): string {
  return JSON.stringify({ source, contradictionOnly, quickSearch, exactMessages });
}
