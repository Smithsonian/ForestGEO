import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentChangesExplorer from './recentchangesexplorer';

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1 }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing' })
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data
  };
}

function makeEntry(changeID: number, tableName: string) {
  return {
    changeID,
    tableName,
    recordID: String(changeID),
    operation: 'UPDATE' as const,
    oldRowState: { MeasuredDBH: 10 },
    newRowState: { MeasuredDBH: 12 },
    changeTimestamp: '2026-04-10T12:00:00.000Z',
    changedBy: 'mason@si.edu'
  };
}

describe('RecentChangesExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores stale query responses after filters change', async () => {
    const staleQuery = deferred<ReturnType<typeof jsonResponse>>();
    const freshResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(2, 'fresh_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };
    const staleResponse = {
      items: [{ type: 'single' as const, entry: makeEntry(1, 'stale_table') }],
      totalItems: 1,
      summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
      hasMore: false
    };

    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/changes/explorer/facets') {
        return Promise.resolve(
          jsonResponse({
            users: [],
            tables: [],
            operationCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 }
          })
        );
      }

      if (url === '/api/changes/explorer/query') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.filters?.quickSearch === 'fresh') {
          return Promise.resolve(jsonResponse(freshResponse));
        }
        return staleQuery.promise;
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }) as any;

    render(<RecentChangesExplorer />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByLabelText('Quick Search'), { target: { value: 'fresh' } });

    await waitFor(() => {
      expect(screen.getByText('fresh_table')).toBeInTheDocument();
    });
    expect(screen.queryByText('stale_table')).not.toBeInTheDocument();

    await act(async () => {
      staleQuery.resolve(jsonResponse(staleResponse));
      await Promise.resolve();
    });

    expect(screen.getByText('fresh_table')).toBeInTheDocument();
    expect(screen.queryByText('stale_table')).not.toBeInTheDocument();
  });
});
