import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseStoredProceduresSQL } from './stored-procedure-sql';

const STORED_PROCEDURES_PATH = path.join(process.cwd(), 'db', 'sql', 'storedprocedures.sql');

describe('parseStoredProceduresSQL', () => {
  it('returns each leading DROP as a separate statement for multipleStatements=false connections', () => {
    const statements = parseStoredProceduresSQL(fs.readFileSync(STORED_PROCEDURES_PATH, 'utf8'));
    const firstCreate = statements.findIndex(statement => /^create\s+procedure/i.test(statement));
    const leadingDrops = statements.slice(0, firstCreate);

    expect(firstCreate).toBeGreaterThan(0);
    expect(leadingDrops).toHaveLength(13);
    for (const statement of leadingDrops) {
      const executableSql = statement
        .split('\n')
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim();
      expect(executableSql).toMatch(/^drop\s+procedure\s+if\s+exists\s+[^;]+$/i);
    }
  });
});
