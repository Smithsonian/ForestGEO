import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const queriesFile = path.join(process.cwd(), 'db/sql/corequeries.sql');
const proceduresFile = path.join(process.cwd(), 'db/sql/storedprocedures.sql');

function dbhSeedDescriptions(source: string): Map<number, string> {
  const descriptions = new Map<number, string>();
  const expression = /VALUES\s*\(\s*([12])\s*,\s*'ValidateDBH(?:Growth|Shrinkage)[^']*'\s*,\s*'([^']+)'/g;
  for (const match of source.matchAll(expression)) descriptions.set(Number(match[1]), match[2]);
  return descriptions;
}

describe('DBH validation seed parity', () => {
  it('keeps the core seed and reinsertdefaultvalidations descriptions identical', () => {
    const core = dbhSeedDescriptions(readFileSync(queriesFile, 'utf8'));
    const procedure = dbhSeedDescriptions(readFileSync(proceduresFile, 'utf8'));
    expect(core).toEqual(procedure);
    expect(core).toEqual(
      new Map([
        [1, 'DBH growth exceeds 65 mm per year against the prior census (both DBH >= 10 mm, HOM unchanged)'],
        [2, 'DBH shrinkage is at least 5 percent per year against the prior census (both DBH >= 10 mm, HOM unchanged)']
      ])
    );
  });
});
