/**
 * CSV Parser Utilities
 * Shared utility functions for CSV parsing across the upload system
 */

/**
 * Parses a line with the specified delimiter, respecting quoted fields
 * Handles both single and double quotes, and escaped quotes
 *
 * @param line - The CSV line to parse
 * @param delimiter - The delimiter character (e.g., ',', '\t', '|')
 * @returns Array of column values
 */
export function parseLineWithDelimiter(line: string, delimiter: string): string[] {
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
