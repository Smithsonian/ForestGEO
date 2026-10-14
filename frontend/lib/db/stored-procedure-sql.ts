/**
 * Parse storedprocedures.sql into executable statements.
 *
 * The file uses MySQL client DELIMITER directives which mysql2 cannot handle
 * directly. We strip the DELIMITER lines and return every statement
 * individually, including the ordinary semicolon-delimited statements before
 * and between stored procedure blocks. This keeps the output executable on
 * the production connections, which deliberately disable multipleStatements.
 */
export function parseStoredProceduresSQL(raw: string): string[] {
  const statements: string[] = [];
  let currentDelimiter = ';';
  let buffer = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      // Flush anything accumulated before the delimiter change
      const pending = buffer.trim();
      if (pending.length > 0 && pending !== currentDelimiter) {
        statements.push(pending);
      }
      buffer = '';
      currentDelimiter = trimmed.replace(/^DELIMITER\s+/i, '').trim();
      continue;
    }

    buffer += line + '\n';

    // Check if the buffer ends with the current delimiter. This applies to the
    // ordinary semicolon delimiter too; otherwise all leading DROP statements
    // are bundled into one query that production mysql2 connections reject.
    const trimmedBuffer = buffer.trimEnd();
    if (trimmedBuffer.endsWith(currentDelimiter)) {
      const stmt = trimmedBuffer.slice(0, -currentDelimiter.length).trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      buffer = '';
    }
  }

  // Flush an unterminated trailing statement, if present.
  const remaining = buffer.trim();
  if (remaining.length > 0 && !remaining.startsWith('--')) {
    statements.push(remaining);
  }

  return statements;
}
