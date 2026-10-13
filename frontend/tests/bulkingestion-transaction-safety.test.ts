/**
 * bulkingestionprocess must stay one transaction. In MySQL, CREATE INDEX implicitly commits and
 * ends the open transaction even on a TEMPORARY table (only CREATE/DROP TEMPORARY TABLE are
 * exempt), after which every statement autocommits and the procedure's ROLLBACK undoes nothing.
 * Temporary-table indexes must be declared inside CREATE TEMPORARY TABLE. See #527.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const STORED_PROCEDURES_FILE = 'db/sql/storedprocedures.sql';
const PROCEDURE_START = /CREATE PROCEDURE bulkingestionprocess\(/;
const PROCEDURE_END = /^END \$\$/m;

function bulkIngestionBody(): { body: string; firstLine: number } {
  const source = fs.readFileSync(path.join(process.cwd(), STORED_PROCEDURES_FILE), 'utf-8');
  const start = source.search(PROCEDURE_START);
  if (start < 0) throw new Error(`bulkingestionprocess not found in ${STORED_PROCEDURES_FILE}`);
  const rest = source.slice(start);
  const end = rest.search(PROCEDURE_END);
  if (end < 0) throw new Error('end of bulkingestionprocess not found');
  return { body: rest.slice(0, end), firstLine: source.slice(0, start).split('\n').length };
}

describe('bulkingestionprocess transaction safety (#527)', () => {
  it('declares every temporary-table index inline instead of with a committing CREATE INDEX or ALTER TABLE', () => {
    const { body, firstLine } = bulkIngestionBody();
    const offenders = body
      .split('\n')
      .map((text, offset) => ({ line: firstLine + offset, text: text.trim() }))
      .filter(({ text }) => /^(CREATE\s+(UNIQUE\s+)?INDEX|ALTER\s+TABLE)\b/i.test(text));

    expect(
      offenders,
      `statements that implicitly commit inside the procedure:\n${offenders.map(o => `  ${STORED_PROCEDURES_FILE}:${o.line}  ${o.text}`).join('\n')}`
    ).toEqual([]);
  });

  it('runs START TRANSACTION and COMMIT only when the procedure owns the transaction', () => {
    const { body, firstLine } = bulkIngestionBody();
    const meaningful = body
      .split('\n')
      .map((text, offset) => ({ line: firstLine + offset, text: text.trim() }))
      .filter(({ text }) => text !== '');
    const unguarded = meaningful.filter(({ text }, index) => {
      if (text !== 'START TRANSACTION;' && text !== 'COMMIT;') return false;
      return meaningful[index - 1]?.text !== 'IF NOT vCallerOwnsTransaction THEN';
    });

    expect(unguarded, `unguarded transaction control:\n${unguarded.map(o => `  ${STORED_PROCEDURES_FILE}:${o.line}  ${o.text}`).join('\n')}`).toEqual([]);
  });
});
