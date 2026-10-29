import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ executeQuery: null as unknown as (sql: string, params?: unknown[]) => Promise<unknown> }));

vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({ executeQuery: state.executeQuery }) } }));

import { ARCGIS_IMPORT_SESSION_STATE, cleanupStaleArcgisImportSessions } from './import-session';

const JANITOR_SCHEMA = 'forestgeo_testing';
const CUSTOM_MAX_AGE_SECONDS = 3600;
const DELETED_ROW_COUNT = 4;
const STATEMENT_LOG_WIDTH = 160;
const DELETE_STATEMENT = /^\s*DELETE FROM\s+\S+\.arcgis_import_sessions/;

describe('cleanupStaleArcgisImportSessions (spec section 10, AU4, AC 12)', () => {
  let statements: Array<{ sql: string; params: unknown[] }>;

  beforeEach(() => {
    statements = [];
    state.executeQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      return DELETE_STATEMENT.test(sql) ? { affectedRows: DELETED_ROW_COUNT } : {};
    });
  });

  it('deletes preflight, committing and committed rows older than the cut-off and returns the count', async () => {
    const deletedCount = await cleanupStaleArcgisImportSessions(JANITOR_SCHEMA, CUSTOM_MAX_AGE_SECONDS);

    const deleteStatement = statements.find(({ sql }) => DELETE_STATEMENT.test(sql));
    console.log(
      `[AU4] janitor delete=${deleteStatement?.sql.replace(/\s+/g, ' ').slice(0, STATEMENT_LOG_WIDTH)} params=${JSON.stringify(deleteStatement?.params)}`
    );
    expect(deleteStatement).toBeDefined();
    expect(deleteStatement!.sql.replace(/\s+/g, ' ')).toContain('WHERE state IN (?, ?, ?) AND updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)');
    expect(deleteStatement!.params).toEqual([
      ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT,
      ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
      ARCGIS_IMPORT_SESSION_STATE.COMMITTED,
      CUSTOM_MAX_AGE_SECONDS
    ]);
    expect(deletedCount).toBe(DELETED_ROW_COUNT);
  });
});
