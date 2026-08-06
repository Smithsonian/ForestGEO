import { describe, expect, it, vi } from 'vitest';
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { ChangelogOperation, recordMutation } from './record-mutation';

const TEST_SCHEMA = 'forestgeo_harvard';
const TEST_TABLE = 'plots';
const TEST_CHANGED_BY = 'jess@si.edu';
const TEST_PLOT_ID = 17;
const TEST_CENSUS_ID = 42;

/**
 * Positional decode of the INSERT's parameter list. The writer's whole job is
 * putting the right value in the right column, so the tests assert against named
 * fields rather than array indices — an off-by-one in the writer shows up as a
 * wrong field here instead of a silently-passing index shuffle.
 */
const CHANGELOG_PARAM_ORDER = ['tableName', 'recordID', 'operation', 'oldRowState', 'newRowState', 'changedBy', 'plotID', 'censusID'] as const;

type DecodedChangelogRow = Record<(typeof CHANGELOG_PARAM_ORDER)[number], unknown>;

function createTxSpy() {
  const query = vi.fn(async () => ({ affectedRows: 1 }));
  const tx: TxExecutor = { id: 'tx-under-test', query: query as unknown as TxExecutor['query'] };
  return { tx, query };
}

function decodeWrittenRow(query: ReturnType<typeof createTxSpy>['query']): { sql: string; row: DecodedChangelogRow } {
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
  expect(params).toHaveLength(CHANGELOG_PARAM_ORDER.length);
  const row = Object.fromEntries(CHANGELOG_PARAM_ORDER.map((name, index) => [name, params[index]])) as DecodedChangelogRow;
  // eslint-disable-next-line no-console
  console.log('[record-mutation] wrote', { sql, row });
  return { sql, row };
}

describe('recordMutation', () => {
  describe('state mapping by operation', () => {
    it('writes an INSERT with a null OldRowState and the created row as NewRowState', async () => {
      const { tx, query } = createTxSpy();
      const createdRow = { PlotID: 17, PlotName: 'Harvard Forest', DefaultDBHUnits: 'cm' };

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: 17,
        operation: ChangelogOperation.INSERT,
        newRowState: createdRow,
        changedBy: TEST_CHANGED_BY,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID
      });

      const { row } = decodeWrittenRow(query);
      expect(row.operation).toBe(ChangelogOperation.INSERT);
      // SQL NULL, not the string 'null' — a consumer must be able to tell
      // "no prior state" from "prior state was the JSON value null".
      expect(row.oldRowState).toBeNull();
      expect(row.newRowState).toBe(JSON.stringify(createdRow));
    });

    it('writes an UPDATE carrying both the before and after states', async () => {
      const { tx, query } = createTxSpy();
      const before = { PlotID: 17, DefaultDBHUnits: 'mm' };
      const after = { PlotID: 17, DefaultDBHUnits: 'cm' };

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: 17,
        operation: ChangelogOperation.UPDATE,
        oldRowState: before,
        newRowState: after,
        changedBy: TEST_CHANGED_BY,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID
      });

      const { row } = decodeWrittenRow(query);
      expect(row.operation).toBe(ChangelogOperation.UPDATE);
      expect(JSON.parse(row.oldRowState as string)).toEqual(before);
      expect(JSON.parse(row.newRowState as string)).toEqual(after);
    });

    it('writes a DELETE carrying the removed row and a null NewRowState', async () => {
      const { tx, query } = createTxSpy();
      const removed = { QuadratID: 8, QuadratName: 'Q-08' };

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: 'quadrats',
        recordID: 8,
        operation: ChangelogOperation.DELETE,
        oldRowState: removed,
        changedBy: TEST_CHANGED_BY,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID
      });

      const { row } = decodeWrittenRow(query);
      expect(row.operation).toBe(ChangelogOperation.DELETE);
      expect(JSON.parse(row.oldRowState as string)).toEqual(removed);
      expect(row.newRowState).toBeNull();
    });
  });

  describe('column mapping', () => {
    it('records the table actually mutated and stringifies an integer key', async () => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: 'species',
        recordID: 909,
        operation: ChangelogOperation.DELETE,
        oldRowState: { SpeciesID: 909 },
        changedBy: TEST_CHANGED_BY
      });

      const { row } = decodeWrittenRow(query);
      expect(row.tableName).toBe('species');
      // RecordID is varchar(255) even when the key is an int.
      expect(row.recordID).toBe('909');
      expect(typeof row.recordID).toBe('string');
    });

    it('preserves a non-numeric natural key verbatim', async () => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: 'attributes',
        recordID: 'DEAD',
        operation: ChangelogOperation.INSERT,
        newRowState: { Code: 'DEAD', Description: 'dead stem' },
        changedBy: TEST_CHANGED_BY
      });

      expect(decodeWrittenRow(query).row.recordID).toBe('DEAD');
    });

    it('records plot and census scope when supplied', async () => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: TEST_PLOT_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: {},
        newRowState: {},
        changedBy: TEST_CHANGED_BY,
        plotID: TEST_PLOT_ID,
        censusID: TEST_CENSUS_ID
      });

      const { row } = decodeWrittenRow(query);
      expect(row.plotID).toBe(TEST_PLOT_ID);
      expect(row.censusID).toBe(TEST_CENSUS_ID);
      expect(row.changedBy).toBe(TEST_CHANGED_BY);
    });

    it.each([
      ['omitted', undefined],
      ['null', null],
      // Callers resolve census context via parseInt(cookie ?? '0'); a stored 0
      // would assert a plot/census that does not exist.
      ['zero from a missing cookie', 0],
      ['NaN from an unparseable cookie', Number.NaN],
      ['negative', -1]
    ])('records absent scope as NULL when plot/census id is %s', async (_label, scopeValue) => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: TEST_PLOT_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: {},
        newRowState: {},
        changedBy: TEST_CHANGED_BY,
        plotID: scopeValue,
        censusID: scopeValue
      });

      const { row } = decodeWrittenRow(query);
      expect(row.plotID).toBeNull();
      expect(row.censusID).toBeNull();
    });
  });

  describe('schema interpolation', () => {
    it('routes the schema through safeFormatQuery, escaping it as an identifier', async () => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: TEST_PLOT_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: {},
        newRowState: {},
        changedBy: TEST_CHANGED_BY
      });

      const { sql } = decodeWrittenRow(query);
      expect(sql).toContain(`\`${TEST_SCHEMA}\`.unifiedchangelog`);
      // The placeholder must be consumed by safeFormatQuery, not left for mysql2
      // to fill from the value list (which would shift every positional param).
      expect(sql).not.toContain('??');
    });

    it.each([
      ['a statement-terminating injection', 'forestgeo_x`; DROP TABLE plots; --'],
      ['a cross-database reference', 'mysql'],
      ['an empty schema', ''],
      ['a backtick escape attempt', '`forestgeo_harvard`']
    ])('rejects %s before any query is issued', async (_label, hostileSchema) => {
      const { tx, query } = createTxSpy();

      await expect(
        recordMutation({
          tx,
          schema: hostileSchema,
          tableName: TEST_TABLE,
          recordID: TEST_PLOT_ID,
          operation: ChangelogOperation.UPDATE,
          oldRowState: {},
          newRowState: {},
          changedBy: TEST_CHANGED_BY
        })
      ).rejects.toThrow(/Invalid or unauthorized schema/);

      // Nothing may reach the database: the throw must precede the write, so the
      // caller's transaction rolls back rather than logging against a bad schema.
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('transaction sharing', () => {
    it('writes through the caller-supplied transaction executor, never a fresh pool connection', async () => {
      const { tx, query } = createTxSpy();

      await recordMutation({
        tx,
        schema: TEST_SCHEMA,
        tableName: TEST_TABLE,
        recordID: TEST_PLOT_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: {},
        newRowState: {},
        changedBy: TEST_CHANGED_BY
      });

      // The single call above IS the proof at unit level: the writer has no other
      // execution path. The commit/rollback consequence is proven against real
      // MySQL in tests/integration/metadata-changelog-audit.integration.test.ts.
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('propagates a write failure so the caller rolls back rather than committing an unlogged edit', async () => {
      const query = vi.fn(async () => {
        throw new Error('ER_DATA_TOO_LONG');
      });
      const tx: TxExecutor = { id: 'tx-failing', query: query as unknown as TxExecutor['query'] };

      await expect(
        recordMutation({
          tx,
          schema: TEST_SCHEMA,
          tableName: TEST_TABLE,
          recordID: TEST_PLOT_ID,
          operation: ChangelogOperation.UPDATE,
          oldRowState: {},
          newRowState: {},
          changedBy: TEST_CHANGED_BY
        })
      ).rejects.toThrow('ER_DATA_TOO_LONG');
    });
  });
});
