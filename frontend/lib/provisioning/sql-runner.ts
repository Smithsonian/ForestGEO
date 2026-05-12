import { readFile } from 'fs/promises';
import type { Pool } from 'mysql2/promise';

export const STATEMENT_PREVIEW_MAX_LENGTH = 200;

export interface ParsedStatement {
  sql: string;
  lineNumber: number;
}

/**
 * Splits a MySQL .sql file into individual statements.
 * Handles DELIMITER directives (used in storedprocedures.sql) and tracks line numbers.
 *
 * Does not attempt to parse string literals or block comments containing delimiter
 * characters — none of the project's .sql files have those patterns. If that
 * changes, this splitter will need a real tokenizer.
 */
export function splitSqlFile(content: string): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let delimiter = ';';
  let buffer = '';
  let bufferStartLine = 1;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('--') || trimmed.startsWith('#')) {
      if (buffer === '') bufferStartLine = lineNo + 1;
      continue;
    }

    const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      if (buffer.trim()) {
        statements.push({ sql: buffer.trim(), lineNumber: bufferStartLine });
        buffer = '';
      }
      delimiter = delimMatch[1];
      bufferStartLine = lineNo + 1;
      continue;
    }

    if (buffer === '') bufferStartLine = lineNo;
    buffer += rawLine + '\n';

    if (rawLine.trimEnd().endsWith(delimiter)) {
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
    if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
      throw new Error(`Unsafe schema name: ${schemaName}`);
    }
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
