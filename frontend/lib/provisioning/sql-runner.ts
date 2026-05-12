import { readFile } from 'fs/promises';
import type { Pool } from 'mysql2/promise';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

export const STATEMENT_PREVIEW_MAX_LENGTH = 200;

export interface ParsedStatement {
  sql: string;
  lineNumber: number;
}

/**
 * Splits a MySQL .sql file into individual statements.
 * Handles DELIMITER directives (used in storedprocedures.sql) and tracks line numbers.
 *
 * Tracks single-quoted string literals character-by-character so that semicolons
 * embedded in string values (e.g., SQL snippets stored in VARCHAR columns in
 * corequeries.sql) are not mistaken for statement terminators. Escape sequences
 * handled: '' (doubled single-quote) and \' (backslash escape).
 *
 * Does not parse block comments containing delimiter characters — none of the
 * project's .sql files have that pattern.
 */
export function splitSqlFile(content: string): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let delimiter = ';';
  let buffer = '';
  let bufferStartLine = 1;
  // True when the character scanner is inside a single-quoted string literal.
  // Persists across lines because corequeries.sql has multi-line string values.
  let inString = false;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const trimmed = rawLine.trim();

    // Only skip blank/comment lines when we are outside a string literal and
    // haven't started accumulating a statement yet.
    if (!inString && buffer === '' && (trimmed === '' || trimmed.startsWith('--') || trimmed.startsWith('#'))) {
      bufferStartLine = lineNo + 1;
      continue;
    }

    if (!inString && buffer === '') {
      const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
      if (delimMatch) {
        delimiter = delimMatch[1];
        bufferStartLine = lineNo + 1;
        continue;
      }
    }

    if (buffer === '' && !inString) bufferStartLine = lineNo;
    buffer += rawLine + '\n';

    // Scan character-by-character to track string-literal state and find the
    // delimiter only at positions outside a string literal.
    let delimiterEndedStatement = false;
    let j = 0;
    while (j < rawLine.length) {
      if (inString) {
        if (rawLine[j] === '\\' && j + 1 < rawLine.length) {
          // Backslash escape: skip the escaped character (e.g. \')
          j += 2;
          continue;
        }
        if (rawLine[j] === "'") {
          if (j + 1 < rawLine.length && rawLine[j + 1] === "'") {
            // Doubled single-quote escape inside string: skip both characters
            j += 2;
            continue;
          }
          // Closing single-quote: exit string state
          inString = false;
          j++;
          continue;
        }
        j++;
        continue;
      }

      // Outside a string literal
      if (rawLine[j] === "'") {
        inString = true;
        j++;
        continue;
      }

      // Inline comment: -- marks the rest of the line as a comment; stop scanning.
      if (rawLine[j] === '-' && rawLine[j + 1] === '-') {
        break;
      }

      // Check whether the delimiter starts at this position. The delimiter ends
      // the statement when only whitespace or an inline comment follows it on the line.
      const remainingLine = rawLine.slice(j);
      if (remainingLine.startsWith(delimiter)) {
        const afterDelimiter = remainingLine.slice(delimiter.length);
        const afterTrimmed = afterDelimiter.trim();
        if (afterTrimmed === '' || afterTrimmed.startsWith('--') || afterTrimmed.startsWith('#')) {
          delimiterEndedStatement = true;
          break;
        }
      }
      j++;
    }

    if (delimiterEndedStatement && !inString) {
      const full = buffer.trimEnd();
      const stripped = full.slice(0, full.length - delimiter.length).trim();
      if (stripped) {
        statements.push({ sql: stripped, lineNumber: bufferStartLine });
      }
      buffer = '';
    }
  }

  if (buffer.trim()) {
    statements.push({ sql: buffer.trim(), lineNumber: bufferStartLine });
  }

  return statements;
}

export async function executeSqlFile(pool: Pool, filePath: string, schemaName?: string): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const statements = splitSqlFile(content);

  if (schemaName) {
    validateSchemaOrThrow(schemaName);
    await pool.query(`USE \`${schemaName}\``);
  }

  for (const stmt of statements) {
    try {
      await pool.query(stmt.sql);
    } catch (err: any) {
      const preview = stmt.sql.slice(0, STATEMENT_PREVIEW_MAX_LENGTH).replace(/\s+/g, ' ');
      const wrapped: any = new Error(`SQL error in ${filePath}:${stmt.lineNumber}: ${err.message}\nStatement: ${preview}`);
      wrapped.file = filePath;
      wrapped.lineNumber = stmt.lineNumber;
      wrapped.statementPreview = preview;
      wrapped.sqlState = err.sqlState;
      wrapped.errno = err.errno;
      wrapped.cause = err;
      throw wrapped;
    }
  }
}
