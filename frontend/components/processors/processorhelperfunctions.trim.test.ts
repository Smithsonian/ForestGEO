import { beforeEach, describe, expect, it, vi } from 'vitest';

const txQuery = vi.fn();

vi.mock('@/config/utils', () => ({
  handleUpsert: vi.fn(),
  toTxExecutor: () => ({ query: txQuery })
}));
vi.mock('@/lib/db/sqlsecurity', () => ({
  safeFormatQuery: (_schema: string, sql: string) => sql,
  safeEscapeId: (id: string) => `\`${id}\``
}));
vi.mock('@/lib/changelog/record-mutation', () => ({
  recordMutation: vi.fn(async () => undefined),
  ChangelogOperation: { INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));
vi.mock('@/config/measurementerrors', () => ({ ensureMeasurementErrorDefinition: vi.fn(), VALIDATION_ERROR_SOURCE: 'validation' }));
vi.mock('@/config/macros', () => ({
  fileMappings: {
    attributes: { columnMappings: { code: 'Code', description: 'Description', status: 'Status' } }
  }
}));

import { insertOrUpdate } from './processorhelperfunctions';

async function runAttributeUpsert(rowData: Record<string, unknown>) {
  let selects = 0;
  txQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT')) {
      selects += 1;
      return selects === 1 ? [] : [{ Code: 'persisted', IsActive: 1 }];
    }
    return { affectedRows: 1 };
  });
  await insertOrUpdate({
    schema: 'testschema',
    connectionManager: {} as never,
    formType: 'attributes',
    rowData: rowData as never,
    plot: undefined,
    census: undefined,
    quadratID: undefined,
    transactionID: 'tx-1',
    fullName: 'tester'
  } as never);
  const insert = txQuery.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'));
  return insert?.[1] as unknown[];
}

describe('insertOrUpdate attributes trimming', () => {
  beforeEach(() => {
    txQuery.mockReset();
  });

  it('trims outer whitespace from Code and Description but keeps internal spaces and case; Status is untouched', async () => {
    const values = await runAttributeUpsert({ code: '  A1 ', description: ' Dead  Stem ', status: ' alive ' });
    expect(values).toEqual(['A1', 'Dead  Stem', ' alive ']);
  });

  it('keeps leading zeros and stores whitespace-only Description as null', async () => {
    const values = await runAttributeUpsert({ code: ' 007', description: '   ', status: 'alive' });
    expect(values).toEqual(['007', null, 'alive']);
  });
});
