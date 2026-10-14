/**
 * Utility functions for detecting and validating file delimiters
 *
 * Caching is now session-scoped with time-based expiration to prevent
 * cross-user cache collisions and memory buildup.
 */

import Papa, { ParseResult } from 'papaparse';
import { parseLineWithDelimiter } from './csvparserutils';
import { analyzeDelimiters, calculateVariance, DelimiterDetectionResult } from '@/lib/uploads/detect-delimiter';

export type { DelimiterDetectionResult } from '@/lib/uploads/detect-delimiter';

export enum DelimiterIssueCode {
  EMPTY_FIRST_ROW = 'EMPTY_FIRST_ROW',
  // Header parses but no real data record follows it anywhere in the file. STRUCTURAL
  // failure -- excluded from HEADER_COVERAGE_ISSUE_CODES in uploadparsefiles.tsx, so a
  // column mapping can never rescue an empty-data file.
  NO_DATA_ROWS = 'NO_DATA_ROWS',
  MISSING_REQUIRED_COLUMNS = 'MISSING_REQUIRED_COLUMNS',
  TOO_FEW_COLUMNS = 'TOO_FEW_COLUMNS',
  ROW_COLUMN_COUNT_MISMATCH = 'ROW_COLUMN_COUNT_MISMATCH',
  INCONSISTENT_COLUMNS = 'INCONSISTENT_COLUMNS'
}

export interface DelimiterIssue {
  code: DelimiterIssueCode;
  message: string;
}

export interface DelimiterValidationResult {
  isValid: boolean;
  delimiter: string;
  issues: DelimiterIssue[];
  preview: string[][];
}

// Cache entry with timestamp for expiration
interface CacheEntry<T> {
  result: T;
  timestamp: number;
  sessionId?: string;
}

// Cache configuration
const CACHE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100;

// Session-scoped caches with timestamps
const delimiterCache = new Map<string, CacheEntry<DelimiterDetectionResult>>();

/**
 * Generate a session-aware cache key
 */
function getCacheKey(file: File, sessionId?: string, ...extras: string[]): string {
  const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
  const sessionPart = sessionId ? `-session:${sessionId}` : '';
  const extraPart = extras.length > 0 ? `-${extras.join('-')}` : '';
  return `${fileKey}${sessionPart}${extraPart}`;
}

/**
 * Check if cache entry is expired
 */
function isCacheExpired<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.timestamp > CACHE_EXPIRY_MS;
}

/**
 * Clean expired entries from a cache
 */
function cleanExpiredEntries<T>(cache: Map<string, CacheEntry<T>>): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_EXPIRY_MS) {
      cache.delete(key);
    }
  }
}

/**
 * Clear all cache entries for a specific session
 */
export function clearSessionCache(sessionId: string): void {
  for (const [key] of delimiterCache.entries()) {
    if (key.includes(`-session:${sessionId}`)) {
      delimiterCache.delete(key);
    }
  }
  for (const [key] of validationCache.entries()) {
    if (key.includes(`-session:${sessionId}`)) {
      validationCache.delete(key);
    }
  }
}

/**
 * Clear all caches (useful for testing or memory pressure)
 */
export function clearAllCaches(): void {
  delimiterCache.clear();
  validationCache.clear();
}

/**
 * Analyzes file content to detect the most likely delimiter
 * @param file - The file to analyze
 * @param sessionId - Optional session ID for scoped caching
 */
export async function detectDelimiter(file: File, sessionId?: string): Promise<DelimiterDetectionResult> {
  // Clean expired entries periodically
  if (delimiterCache.size > MAX_CACHE_SIZE / 2) {
    cleanExpiredEntries(delimiterCache);
  }

  // Create session-aware cache key
  const cacheKey = getCacheKey(file, sessionId);

  // Return cached result if available and not expired
  const cached = delimiterCache.get(cacheKey);
  if (cached && !isCacheExpired(cached)) {
    return cached.result;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const result = analyzeDelimiters(content);

        // Cache the result with timestamp
        delimiterCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
          sessionId
        });

        // Limit cache size to prevent memory issues
        if (delimiterCache.size > MAX_CACHE_SIZE) {
          // Remove oldest entries first
          const entries = Array.from(delimiterCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
          for (let i = 0; i < entries.length - MAX_CACHE_SIZE; i++) {
            delimiterCache.delete(entries[i][0]);
          }
        }

        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));

    // Read only the first 20KB for analysis to improve performance
    const blob = file.slice(0, 20 * 1024);
    reader.readAsText(blob);
  });
}

/**
 * Validates a delimiter by parsing a preview of the file
 */
// Session-scoped cache for validation results
const validationCache = new Map<string, CacheEntry<DelimiterValidationResult>>();

/**
 * Validates a delimiter by parsing a preview of the file
 * @param file - The file to validate
 * @param delimiter - The delimiter to test
 * @param expectedHeaders - Optional list of expected header names
 * @param sessionId - Optional session ID for scoped caching
 */
export async function validateDelimiter(file: File, delimiter: string, expectedHeaders?: string[], sessionId?: string): Promise<DelimiterValidationResult> {
  // Clean expired entries periodically
  if (validationCache.size > MAX_CACHE_SIZE / 2) {
    cleanExpiredEntries(validationCache);
  }

  // Create session-aware cache key
  const expectedHeadersStr = expectedHeaders ? expectedHeaders.sort().join(',') : '';
  const cacheKey = getCacheKey(file, sessionId, delimiter, expectedHeadersStr);

  // Return cached result if available and not expired
  const cached = validationCache.get(cacheKey);
  if (cached && !isCacheExpired(cached)) {
    return cached.result;
  }

  // Read first 5KB for every OTHER check (header parsing, missing columns,
  // consistency, preview) -- unchanged for performance.
  const content = await readTextSlice(file, 0, 5 * 1024);

  // The 5KB sample can be all header + padding even when a real row exists further
  // into the file, so only fall back to scanning the whole file when the sample alone
  // shows no data row.
  const hasDataRowBeyondHeader = hasAtLeastOneDataRow(content, delimiter) || (await fileHasDataRowBeyondHeader(file, delimiter));

  const result = validateDelimiterContent(content, delimiter, expectedHeaders, hasDataRowBeyondHeader);

  // Cache the result with timestamp
  validationCache.set(cacheKey, {
    result,
    timestamp: Date.now(),
    sessionId
  });

  // Limit cache size to prevent memory issues
  if (validationCache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries first
    const entries = Array.from(validationCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < entries.length - MAX_CACHE_SIZE; i++) {
      validationCache.delete(entries[i][0]);
    }
  }

  return result;
}

/**
 * Reads `file.slice(start, end)` as text via FileReader.
 */
function readTextSlice(file: File, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve((e.target?.result as string | null) ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file.slice(start, end));
  });
}

/**
 * Streams the real File looking for one data row beyond the header, aborting as soon
 * as it finds one. Chunked (not a single `readAsText`) so a multi-gigabyte
 * empty-looking file is not fully buffered just to answer "is there a row at all".
 */
function fileHasDataRowBeyondHeader(file: File, delimiter: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let rowCount = 0;
    Papa.parse<string[]>(file, {
      delimiter,
      header: false,
      skipEmptyLines: 'greedy',
      chunkSize: 64 * 1024,
      chunk(results: ParseResult<string[]>, parser) {
        rowCount += results.data.length;
        // Row 0 is the header; one more row is enough to prove data exists.
        if (rowCount > 1) {
          parser.abort();
        }
      },
      complete() {
        resolve(rowCount > 1);
      },
      error: (err: Error) => reject(err)
    });
  });
}

/**
 * Strips a single matching pair of surrounding quotes from a trimmed cell.
 * `parseLineWithDelimiter` retains quote characters for other callers, so header
 * comparisons here must strip them directly (e.g. R's `write.table` emits `"Spcode"`).
 * Only removes a matching first/last quote char; mismatched or mid-cell quotes are untouched.
 */
function stripSurroundingQuotes(h: string): string {
  const trimmed = h.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === last && (first === '"' || first === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Determines whether `content` contains at least one real data record beyond the
 * header. Delegates to Papa's `skipEmptyLines: 'greedy'` to catch whitespace-only,
 * delimiter-only, and quoted-empty rows without hand-rolled cases. `content` is only
 * the sampled prefix, so `false` here is not conclusive -- the caller falls back to
 * `fileHasDataRowBeyondHeader` before reporting NO_DATA_ROWS.
 */
function hasAtLeastOneDataRow(content: string, delimiter: string): boolean {
  const parsed = Papa.parse<string[]>(content, {
    delimiter,
    header: false,
    skipEmptyLines: 'greedy'
  });
  // Greedy skipping removes every fully blank/padding line, so what survives is the
  // header row (if it itself has real content) plus any genuine data rows. Fewer than
  // two surviving rows means there is no data beyond the header.
  return parsed.data.length > 1;
}

/**
 * Validates delimiter against content and expected headers.
 * @param hasDataRowBeyondHeader - Whether a real data record exists anywhere in the
 * file, beyond the header (already resolved by the caller, including the whole-file
 * fallback scan when the sampled `content` alone did not show one).
 */
function validateDelimiterContent(
  content: string,
  delimiter: string,
  expectedHeaders: string[] | undefined,
  hasDataRowBeyondHeader: boolean
): DelimiterValidationResult {
  const lines = content.split('\n').slice(0, 5); // Check first 5 lines
  const issues: DelimiterIssue[] = [];
  const preview: string[][] = [];

  if (lines.length === 0) {
    return {
      isValid: false,
      delimiter,
      issues: [
        { code: DelimiterIssueCode.EMPTY_FIRST_ROW, message: 'File appears to be empty' },
        { code: DelimiterIssueCode.NO_DATA_ROWS, message: 'The file appears to be empty: no data rows were found beyond the header.' }
      ],
      preview: []
    };
  }

  // Parse header row
  const headerLine = lines[0].trim();
  if (!headerLine) {
    issues.push({ code: DelimiterIssueCode.EMPTY_FIRST_ROW, message: 'First row is empty or contains only whitespace' });
  }

  const headers = parseLineWithDelimiter(headerLine, delimiter);
  preview.push(headers);

  // Structural: a header-only file (or one padded only with blank/whitespace/
  // delimiter-only lines) has nothing to upload.
  if (!hasDataRowBeyondHeader) {
    issues.push({
      code: DelimiterIssueCode.NO_DATA_ROWS,
      message: 'The file appears to be empty: no data rows were found beyond the header.'
    });
  }

  // Check if headers match expected ones (if provided)
  if (expectedHeaders && expectedHeaders.length > 0) {
    // Normalize a header string for comparison:
    // - strip a single matching pair of surrounding quotes (parseLineWithDelimiter
    //   intentionally retains them, e.g. R's write.table emits `"Spcode"`)
    // - lowercase
    // - remove common separators (underscores, hyphens, spaces)
    // This allows "first_name", "FirstName", "first-name" to all match "firstname"
    const normalizeHeader = (h: string): string => {
      return stripSurroundingQuotes(h)
        .toLowerCase()
        .trim()
        .replace(/[_\-\s]/g, '');
    };

    // Filter out empty headers before comparison
    const headersNormalized = headers.map(h => normalizeHeader(h)).filter(h => h.length > 0);
    const expectedLower = expectedHeaders.map(h => h.toLowerCase().trim()).filter(h => h.length > 0);

    // Find missing required headers using normalized exact matching
    // This prevents false positives like "date" matching "update" or "id" matching "valid"
    const missingHeaders = expectedLower.filter(expected => {
      const expectedNormalized = normalizeHeader(expected);
      // Check if any actual header matches this expected header (exact match after normalization)
      return !headersNormalized.some(actual => actual === expectedNormalized);
    });

    if (missingHeaders.length > 0) {
      // Capitalize first letter of each missing header for display
      const formattedMissing = missingHeaders.map(h => h.charAt(0).toUpperCase() + h.slice(1));
      issues.push({ code: DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, message: `Missing required columns: ${formattedMissing.join(', ')}` });
    }

    // Count only non-empty headers for the column count check
    // (a quoted empty cell, e.g. `""`, is treated as empty too)
    const nonEmptyHeaderCount = headers.filter(h => stripSurroundingQuotes(h).trim().length > 0).length;
    if (nonEmptyHeaderCount < expectedHeaders.length * 0.7) {
      issues.push({
        code: DelimiterIssueCode.TOO_FEW_COLUMNS,
        message: `Too few columns detected (${nonEmptyHeaderCount}) compared to expected (${expectedHeaders.length})`
      });
    }
  }

  // Parse data rows and check consistency
  const columnCounts: number[] = [];

  for (let i = 1; i < lines.length && i <= 4; i++) {
    if (lines[i].trim()) {
      const columns = parseLineWithDelimiter(lines[i], delimiter);
      preview.push(columns);
      columnCounts.push(columns.length);

      if (columns.length !== headers.length) {
        issues.push({ code: DelimiterIssueCode.ROW_COLUMN_COUNT_MISMATCH, message: `Row ${i + 1} has ${columns.length} columns, expected ${headers.length}` });
      }
    }
  }

  // Check for consistency across data rows
  if (columnCounts.length > 0) {
    const variance = calculateVariance(columnCounts);
    if (variance > 1) {
      issues.push({ code: DelimiterIssueCode.INCONSISTENT_COLUMNS, message: 'Inconsistent number of columns across rows' });
    }
  }

  const isValid = issues.length === 0;

  return {
    isValid,
    delimiter,
    issues,
    preview
  };
}
