/**
 * Utility functions for detecting and validating file delimiters
 *
 * Caching is now session-scoped with time-based expiration to prevent
 * cross-user cache collisions and memory buildup.
 */

import { parseLineWithDelimiter } from './csvparserutils';

export interface DelimiterDetectionResult {
  delimiter: string;
  confidence: number;
  sampleRows: number;
  avgColumnsPerRow: number;
}

export interface DelimiterValidationResult {
  isValid: boolean;
  delimiter: string;
  issues: string[];
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
 * Analyzes text content to determine the most likely delimiter
 */
function analyzeDelimiters(content: string): DelimiterDetectionResult {
  const lines = content.split('\n').slice(0, 10); // Analyze first 10 lines
  const delimiters = [',', '\t', ';', '|'];
  const results: Array<DelimiterDetectionResult> = [];

  for (const delimiter of delimiters) {
    const analysis = analyzeDelimiter(lines, delimiter);
    results.push(analysis);
  }

  // Return the delimiter with highest confidence
  return results.reduce((best, current) => (current.confidence > best.confidence ? current : best));
}

/**
 * Analyzes how well a specific delimiter works for the given lines
 */
function analyzeDelimiter(lines: string[], delimiter: string): DelimiterDetectionResult {
  let totalColumns = 0;
  let validRows = 0;
  const columnCounts: number[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    const columns = parseLineWithDelimiter(line, delimiter);
    const columnCount = columns.length;

    if (columnCount > 1) {
      columnCounts.push(columnCount);
      totalColumns += columnCount;
      validRows++;
    }
  }

  if (validRows === 0) {
    return {
      delimiter,
      confidence: 0,
      sampleRows: 0,
      avgColumnsPerRow: 0
    };
  }

  const avgColumns = totalColumns / validRows;
  const columnVariance = calculateVariance(columnCounts);

  // Calculate confidence based on:
  // 1. Consistency of column count across rows (lower variance = higher confidence)
  // 2. Average number of columns (more columns usually = more confident)
  // 3. Number of valid rows processed
  const consistencyScore = Math.max(0, 1 - columnVariance / Math.max(avgColumns, 1));
  const volumeScore = Math.min(1, validRows / lines.length);
  const columnScore = Math.min(1, avgColumns / 10); // Normalize around 10 columns

  const confidence = (consistencyScore * 0.6 + volumeScore * 0.2 + columnScore * 0.2) * 100;

  return {
    delimiter,
    confidence,
    sampleRows: validRows,
    avgColumnsPerRow: avgColumns
  };
}

/**
 * Calculates variance for an array of numbers
 */
function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;

  const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;

  return variance;
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

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const result = validateDelimiterContent(content, delimiter, expectedHeaders);

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

        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));

    // Read first 5KB for validation to improve performance
    const blob = file.slice(0, 5 * 1024);
    reader.readAsText(blob);
  });
}

/**
 * Validates delimiter against content and expected headers
 */
function validateDelimiterContent(content: string, delimiter: string, expectedHeaders?: string[]): DelimiterValidationResult {
  const lines = content.split('\n').slice(0, 5); // Check first 5 lines
  const issues: string[] = [];
  const preview: string[][] = [];

  if (lines.length === 0) {
    return {
      isValid: false,
      delimiter,
      issues: ['File appears to be empty'],
      preview: []
    };
  }

  // Parse header row
  const headerLine = lines[0].trim();
  if (!headerLine) {
    issues.push('First row is empty or contains only whitespace');
  }

  const headers = parseLineWithDelimiter(headerLine, delimiter);
  preview.push(headers);

  // Check if headers match expected ones (if provided)
  if (expectedHeaders && expectedHeaders.length > 0) {
    // Normalize a header string for comparison:
    // - lowercase
    // - remove common separators (underscores, hyphens, spaces)
    // This allows "first_name", "FirstName", "first-name" to all match "firstname"
    const normalizeHeader = (h: string): string => {
      return h
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
      issues.push(`Missing required columns: ${formattedMissing.join(', ')}`);
    }

    // Count only non-empty headers for the column count check
    const nonEmptyHeaderCount = headers.filter(h => h.trim().length > 0).length;
    if (nonEmptyHeaderCount < expectedHeaders.length * 0.7) {
      issues.push(`Too few columns detected (${nonEmptyHeaderCount}) compared to expected (${expectedHeaders.length})`);
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
        issues.push(`Row ${i + 1} has ${columns.length} columns, expected ${headers.length}`);
      }
    }
  }

  // Check for consistency across data rows
  if (columnCounts.length > 0) {
    const variance = calculateVariance(columnCounts);
    if (variance > 1) {
      issues.push('Inconsistent number of columns across rows');
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
