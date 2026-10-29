import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import {
  BATCH_FAMILY_SCAN_INDEX,
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  deleteBatchFamilyRowsWindow,
  deleteStagedRowsForFileWindow,
  STALE_BATCH_SCAN_INDEX
} from './temporary-measurements';
import { buildSubBatchPattern } from '@/lib/uploads/batch-family';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 22;
const CENSUS_ID = 32;
const FILE_NAME = 'arcgis.xlsx';
const FAMILY_BATCH = 'arc0000000000000000000000001';
const CHANGED_BY = 'leftover-test';
const TX = 'leftover-tx';
const STAGED_WINDOW_LIMIT = 5_000;
const STAGED_ROWS_DELETED = 42;
const FAMILY_WINDOW_IDS = [11, 12, 13];
const INVALID_ROW_LIMITS = [0, -1, 1.5, Number.NaN];
const LOGGED_STATEMENT_PREFIX_LENGTH = 140;

function collapseWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

function recorder(answer: (sql: string) => unknown) {
  const statements: Array<{ sql: string; params: unknown[]; transactionID?: string }> = [];
  const manager = {
    executeQuery: vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
      statements.push({ sql, params, transactionID });
      return answer(sql);
    })
  } as unknown as ConnectionManager;
  return { manager, statements };
}

describe('deleteStagedRowsForFileWindow (S0)', () => {
  it('deletes one bounded window of the file in the plot/census, pinned to the plot/census/file index', async () => {
    const { manager, statements } = recorder(() => ({ affectedRows: STAGED_ROWS_DELETED }));
    const deleted = await deleteStagedRowsForFileWindow(manager, SCHEMA, FILE_NAME, PLOT_ID, CENSUS_ID, STAGED_WINDOW_LIMIT, TX);
    console.log(`[S0] deleted=${deleted} statement=${collapseWhitespace(statements[0].sql)} params=${JSON.stringify(statements[0].params)}`);
    expect(deleted).toBe(STAGED_ROWS_DELETED);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain(`/*+ INDEX(temporarymeasurements ${STALE_BATCH_SCAN_INDEX}) */`);
    expect(collapseWhitespace(statements[0].sql)).toMatch(new RegExp(`WHERE PlotID = \\? AND CensusID = \\? AND FileID = \\? LIMIT ${STAGED_WINDOW_LIMIT}$`));
    expect(statements[0].params).toEqual([PLOT_ID, CENSUS_ID, FILE_NAME]);
    expect(statements[0].transactionID).toBe(TX);
  });

  it.each(INVALID_ROW_LIMITS)('refuses row limit %s before any statement', async rowLimit => {
    const { manager, statements } = recorder(() => ({ affectedRows: 0 }));
    await expect(deleteStagedRowsForFileWindow(manager, SCHEMA, FILE_NAME, PLOT_ID, CENSUS_ID, rowLimit, TX)).rejects.toBeInstanceOf(RangeError);
    console.log(`[S0] row limit ${rowLimit} refused with ${statements.length} statement(s) issued`);
    expect(statements).toHaveLength(0);
  });
});

describe('deleteBatchFamilyRowsWindow (F0)', () => {
  it('locks the family window, then deletes links, audits and deletes exactly those ids', async () => {
    const { manager, statements } = recorder(sql => {
      if (sql.includes('SELECT') && sql.includes('FOR UPDATE')) return FAMILY_WINDOW_IDS.map(id => ({ CoreMeasurementID: id }));
      return { affectedRows: FAMILY_WINDOW_IDS.length };
    });
    const deleted = await deleteBatchFamilyRowsWindow(manager, SCHEMA, FILE_NAME, FAMILY_BATCH, PLOT_ID, CENSUS_ID, CHANGED_BY, TX);
    console.log(
      `[F0] deleted=${deleted}\n${statements.map(s => `${collapseWhitespace(s.sql).slice(0, LOGGED_STATEMENT_PREFIX_LENGTH)} ${JSON.stringify(s.params)}`).join('\n')}`
    );
    expect(deleted).toBe(FAMILY_WINDOW_IDS.length);
    const [select, ...rest] = statements;
    expect(select.sql).toContain(`/*+ INDEX(coremeasurements ${BATCH_FAMILY_SCAN_INDEX}) */`);
    expect(collapseWhitespace(select.sql)).toContain(
      `ORDER BY UploadFileID, UploadBatchID, CensusID, StemGUID, CoreMeasurementID LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} FOR UPDATE`
    );
    expect(select.params).toEqual([FILE_NAME, FAMILY_BATCH, buildSubBatchPattern(FAMILY_BATCH), CENSUS_ID]);
    expect(rest[0].sql).toMatch(/DELETE FROM\s+\S+\.measurement_error_log WHERE MeasurementID IN/);
    expect(rest.at(-1)!.sql).toMatch(/DELETE FROM\s+\S+\.coremeasurements WHERE CoreMeasurementID IN/);
    expect(rest.at(-1)!.params).toEqual(FAMILY_WINDOW_IDS);
    expect(statements.every(statement => statement.transactionID === TX)).toBe(true);
  });

  it('issues nothing after an empty window and returns 0', async () => {
    const { manager, statements } = recorder(() => []);
    const deleted = await deleteBatchFamilyRowsWindow(manager, SCHEMA, FILE_NAME, FAMILY_BATCH, PLOT_ID, CENSUS_ID, CHANGED_BY, TX);
    console.log(`[F0] empty window: deleted=${deleted} statements=${statements.length}`);
    expect(deleted).toBe(0);
    expect(statements).toHaveLength(1);
  });
});
