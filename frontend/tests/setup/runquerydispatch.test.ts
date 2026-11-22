import { describe, expect, it, vi } from 'vitest';
import { runQueryDispatch } from './runquerydispatch';
import { usesTextProtocol } from '@/lib/db/statementprotocol';

const LABELLED_SELECT = '/* errors-explorer:page */\nWITH x AS (SELECT 1 AS n) SELECT n FROM x LIMIT ? OFFSET ?';
const BULK_VALUES = [
  [1, 'a'],
  [2, 'b']
];

function fakeTarget() {
  return {
    query: vi.fn(async () => [[{ via: 'query' }], []]),
    execute: vi.fn(async () => [[{ via: 'execute' }], []])
  };
}

describe('runQueryDispatch', () => {
  it.each([
    ['SELECT 1', undefined, 'execute'],
    [LABELLED_SELECT, ['25', '0'], 'execute'],
    ['  CALL forestgeo_x.bulkingestionprocess(?, ?)', ['f', 'b'], 'query'],
    ['USE `forestgeo_x`', undefined, 'query'],
    ['START TRANSACTION', undefined, 'query'],
    ['SAVEPOINT sp1', undefined, 'query'],
    ['RELEASE SAVEPOINT sp1', undefined, 'query'],
    ['ROLLBACK TO SAVEPOINT sp1', undefined, 'query'],
    ['INSERT INTO t (a, b) VALUES ?', [BULK_VALUES], 'query']
  ])('sends %j through %s', async (sql, params, expectedProtocol) => {
    const target = fakeTarget();
    const rows = await runQueryDispatch(target as never, sql, params as unknown[] | undefined);
    console.log(`[dispatch] ${sql.slice(0, 40)} -> ${JSON.stringify(rows)}`);
    expect(rows).toEqual([{ via: expectedProtocol }]);
    expect(usesTextProtocol(sql, params as unknown[] | undefined)).toBe(expectedProtocol === 'query');
  });

  it('binds undefined parameters as NULL, as runQuery does', async () => {
    const target = fakeTarget();
    await runQueryDispatch(target as never, 'SELECT ? AS a, ? AS b', [undefined, 3]);
    expect(target.execute).toHaveBeenCalledWith('SELECT ? AS a, ? AS b', [null, 3]);
  });
});
