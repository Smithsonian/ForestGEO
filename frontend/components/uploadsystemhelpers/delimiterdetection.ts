/**
 * Utility functions for detecting and validating file delimiters
 */

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

/**
 * Analyzes file content to detect the most likely delimiter
 */
// Cache to prevent excessive file reads
const delimiterCache = new Map<string, DelimiterDetectionResult>();

export async function detectDelimiter(file: File): Promise<DelimiterDetectionResult> {
  // Create cache key based on file characteristics
  const cacheKey = `${file.name}-${file.size}-${file.lastModified}`;

  // Return cached result if available
  if (delimiterCache.has(cacheKey)) {
    return delimiterCache.get(cacheKey)!;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const result = analyzeDelimiters(content);

        // Cache the result
        delimiterCache.set(cacheKey, result);

        // Limit cache size to prevent memory issues
        if (delimiterCache.size > 50) {
          const firstKey = delimiterCache.keys().next().value;
          if (firstKey !== undefined) {
            delimiterCache.delete(firstKey);
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
 * Parses a line with the specified delimiter, respecting quoted fields
 */
function parseLineWithDelimiter(line: string, delimiter: string): string[] {
  const columns: string[] = [];
  let currentColumn = '';
  let insideQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (!insideQuotes && (char === '"' || char === "'")) {
      insideQuotes = true;
      quoteChar = char;
      currentColumn += char;
    } else if (insideQuotes && char === quoteChar) {
      // Check for escaped quotes
      if (i + 1 < line.length && line[i + 1] === quoteChar) {
        currentColumn += char + char;
        i++; // Skip next character
      } else {
        insideQuotes = false;
        currentColumn += char;
      }
    } else if (!insideQuotes && char === delimiter) {
      columns.push(currentColumn.trim());
      currentColumn = '';
    } else {
      currentColumn += char;
    }
  }

  // Add the last column
  columns.push(currentColumn.trim());

  return columns;
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
// Cache for validation results
const validationCache = new Map<string, DelimiterValidationResult>();

export async function validateDelimiter(file: File, delimiter: string, expectedHeaders?: string[]): Promise<DelimiterValidationResult> {
  // Create cache key
  const expectedHeadersStr = expectedHeaders ? expectedHeaders.sort().join(',') : '';
  const cacheKey = `${file.name}-${file.size}-${file.lastModified}-${delimiter}-${expectedHeadersStr}`;

  // Return cached result if available
  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const result = validateDelimiterContent(content, delimiter, expectedHeaders);

        // Cache the result
        validationCache.set(cacheKey, result);

        // Limit cache size
        if (validationCache.size > 100) {
          const firstKey = validationCache.keys().next().value;
          if (firstKey !== undefined) {
            validationCache.delete(firstKey);
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
    const headersLower = headers.map(h => h.toLowerCase().trim());
    const expectedLower = expectedHeaders.map(h => h.toLowerCase().trim());

    const missingHeaders = expectedLower.filter(expected => !headersLower.some(actual => actual.includes(expected) || expected.includes(actual)));

    if (missingHeaders.length > 0) {
      issues.push(`Missing expected headers: ${missingHeaders.join(', ')}`);
    }

    if (headers.length < expectedHeaders.length * 0.7) {
      issues.push(`Too few columns detected (${headers.length}) compared to expected (${expectedHeaders.length})`);
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
