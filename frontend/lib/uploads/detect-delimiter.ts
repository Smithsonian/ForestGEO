/**
 * Shared delimiter sniffer for CSV/TSV uploads.
 *
 * Single mechanism used by both the client upload flow
 * (components/uploadsystemhelpers/delimiterdetection.ts wraps this for File objects
 * with session-scoped caching) and server-side upload processing. The scoring
 * implementation was moved verbatim from delimiterdetection.ts; the
 * text/fileName/selected signature follows the server-side sniffer that lived in
 * app/api/uploadjobs/[jobId]/process/route.ts (removed; see git history e01cdb33).
 */

import { parseLineWithDelimiter } from '@/components/uploadsystemhelpers/csvparserutils';

export const SUPPORTED_DELIMITERS = [',', '\t', ';', '|'] as const;

const DETECTION_SAMPLE_LINE_COUNT = 10;
const TSV_FILE_EXTENSION = '.tsv';
const TAB_DELIMITER = '\t';
const COMMA_DELIMITER = ',';

export interface DelimiterDetectionResult {
  delimiter: string;
  confidence: number;
  sampleRows: number;
  avgColumnsPerRow: number;
}

/**
 * Detects the delimiter for a text sample.
 *
 * - An explicitly selected delimiter always wins.
 * - Otherwise the candidate with the highest confidence score is returned.
 * - When no candidate scores (e.g. single-column or empty content), falls back
 *   by file extension: tab for .tsv, comma for everything else.
 */
export function detectDelimiter(text: string, fileName: string, selected?: string): string {
  if (typeof selected === 'string' && selected.length > 0) return selected;

  const best = analyzeDelimiters(text);
  if (best.confidence > 0) return best.delimiter;

  return fileName.toLowerCase().endsWith(TSV_FILE_EXTENSION) ? TAB_DELIMITER : COMMA_DELIMITER;
}

/**
 * Analyzes text content to determine the most likely delimiter
 */
export function analyzeDelimiters(content: string): DelimiterDetectionResult {
  const lines = content.split('\n').slice(0, DETECTION_SAMPLE_LINE_COUNT);
  const results: Array<DelimiterDetectionResult> = [];

  for (const delimiter of SUPPORTED_DELIMITERS) {
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
export function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;

  const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;

  return variance;
}
