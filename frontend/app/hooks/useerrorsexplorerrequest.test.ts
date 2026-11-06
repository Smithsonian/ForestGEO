import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorsExplorerReadGatedError, useErrorsExplorerRequest } from './useerrorsexplorerrequest';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('useErrorsExplorerRequest (P3-1)', () => {
  it('drops a stale response that arrives after a newer one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const { result, rerender } = renderHook(({ requestKey }) => useErrorsExplorerRequest({ requestKey, load }), { initialProps: { requestKey: 'search=a' } });
    rerender({ requestKey: 'search=ab' });
    await act(async () => {
      second.resolve('rows for ab');
    });
    await act(async () => {
      first.resolve('rows for a');
    });
    console.log('[view-errors request stale]', JSON.stringify({ data: result.current.data, aborted: signals.map(signal => signal.aborted) }));
    expect(result.current.data).toBe('rows for ab');
    expect(signals[0].aborted, 'the superseded request is aborted').toBe(true);
  });

  it('separates a first-load failure from a refresh failure', async () => {
    let failNext = true;
    const load = vi.fn(async () => {
      if (failNext) throw new Error('first load failed');
      return 'rows';
    });
    const { result } = renderHook(() => useErrorsExplorerRequest({ requestKey: 'k', load }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
    expect(result.current.isStale).toBe(false);
    failNext = false;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe('rows');
    failNext = true;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data, 'older data stays').toBe('rows');
    expect(result.current.isStale).toBe(true);
    expect(result.current.errorMessage).toBe('first load failed');
  });

  it('rejects a strict reload on failure and resolves a non-strict one', async () => {
    const load = vi.fn(async () => {
      throw new Error('refresh failed');
    });
    const { result } = renderHook(() => useErrorsExplorerRequest({ requestKey: 'k', load }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    await expect(result.current.reload({ strict: true })).rejects.toThrow('refresh failed');
    await expect(result.current.reload()).resolves.toBeUndefined();
  });

  it('makes a strict reload that a same-key reload superseded report the replacement failure (P3-1)', async () => {
    const strictRead = deferred<string>();
    const replacementRead = deferred<string>();
    const load = vi.fn(() => {
      const call = load.mock.calls.length;
      return call === 1 ? Promise.resolve('rows') : call === 2 ? strictRead.promise : replacementRead.promise;
    });
    const { result } = renderHook(() => useErrorsExplorerRequest({ requestKey: 'k', load }));
    await waitFor(() => expect(result.current.data).toBe('rows'));
    let strictOutcome: { status: 'resolved' } | { status: 'rejected'; message: string } | undefined;
    let strict!: Promise<void>;
    act(() => {
      strict = result.current.reload({ strict: true }).then(
        () => {
          strictOutcome = { status: 'resolved' };
        },
        (error: Error) => {
          strictOutcome = { status: 'rejected', message: error.message };
        }
      );
    });
    act(() => {
      void result.current.reload();
    });
    await act(async () => {
      strictRead.resolve('superseded rows');
    });
    console.log('[view-errors strict superseded]', JSON.stringify({ afterSupersededSettles: strictOutcome ?? 'pending', calls: load.mock.calls.length }));
    expect(strictOutcome, 'the strict caller waits for the replacement read').toBeUndefined();
    await act(async () => {
      replacementRead.reject(new Error('replacement failed'));
      await strict;
    });
    console.log('[view-errors strict superseded]', JSON.stringify({ final: strictOutcome }));
    expect(strictOutcome).toEqual({ status: 'rejected', message: 'replacement failed' });
  });

  it('rejects a strict reload while gated with the gated error, resolves a non-strict one, and runs nothing (P3-1)', async () => {
    const load = vi.fn(async () => 'rows');
    const { result } = renderHook(() => useErrorsExplorerRequest({ requestKey: 'k', load, gated: true }));
    await expect(result.current.reload({ strict: true })).rejects.toBeInstanceOf(ErrorsExplorerReadGatedError);
    await expect(result.current.reload()).resolves.toBeUndefined();
    console.log('[view-errors strict gated]', JSON.stringify({ loads: load.mock.calls.length }));
    expect(load).not.toHaveBeenCalled();
  });

  it('resolves a strict reload quietly when the key changes under it', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => (load.mock.calls.length === 2 ? pending.promise : Promise.resolve('rows')));
    const { result, rerender } = renderHook(({ requestKey }) => useErrorsExplorerRequest({ requestKey, load }), { initialProps: { requestKey: 'census A' } });
    await waitFor(() => expect(result.current.data).toBe('rows'));
    let strict!: Promise<void>;
    act(() => {
      strict = result.current.reload({ strict: true });
    });
    rerender({ requestKey: 'census B' });
    await act(async () => {
      pending.resolve('census A rows');
    });
    await expect(strict).resolves.toBeUndefined();
  });

  it('runs nothing while gated, shows stale, and runs once the gate lifts', async () => {
    const load = vi.fn(async () => 'rows');
    const { result, rerender } = renderHook(({ gated }) => useErrorsExplorerRequest({ requestKey: 'k', load, gated }), { initialProps: { gated: true } });
    expect(load).not.toHaveBeenCalled();
    expect(result.current.isStale).toBe(true);
    rerender({ gated: false });
    await waitFor(() => expect(result.current.data).toBe('rows'));
    expect(result.current.isStale).toBe(false);
  });

  it('settles a read the gate aborted: ready with its older data, idle without any', async () => {
    const inFlight = deferred<string>();
    const load = vi.fn(() => (load.mock.calls.length === 2 ? inFlight.promise : Promise.resolve('rows')));
    const { result, rerender } = renderHook(({ gated, requestKey }) => useErrorsExplorerRequest({ requestKey, load, gated }), {
      initialProps: { gated: false, requestKey: 'k' }
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      void result.current.reload();
    });
    expect(result.current.status, 'the reload is in flight').toBe('loading');

    rerender({ gated: true, requestKey: 'k' });
    await act(async () => {
      inFlight.resolve('rows that the gate made stale');
    });

    console.log(
      '[view-errors gate aborts read]',
      JSON.stringify({ status: result.current.status, isStale: result.current.isStale, data: result.current.data })
    );
    expect(result.current.status, 'a gated read is not "loading" for as long as the gate holds').toBe('ready');
    expect(result.current.isStale).toBe(true);
    expect(result.current.data, 'the older data stays').toBe('rows');
  });

  it('settles a first read the gate aborted as idle', async () => {
    const firstRead = deferred<string>();
    const load = vi.fn(() => firstRead.promise);
    const { result, rerender } = renderHook(({ gated }) => useErrorsExplorerRequest({ requestKey: 'k', load, gated }), { initialProps: { gated: false } });
    await waitFor(() => expect(result.current.status).toBe('loading'));

    rerender({ gated: true });
    await act(async () => {
      firstRead.resolve('rows');
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
  });

  it('never shows data from another data scope, but keeps it across keys of the same scope', async () => {
    const next = deferred<string>();
    const load = vi.fn(() => (load.mock.calls.length === 1 ? Promise.resolve('census A totals') : next.promise));
    const { result, rerender } = renderHook(({ requestKey, dataScopeKey }) => useErrorsExplorerRequest({ requestKey, load, dataScopeKey }), {
      initialProps: { requestKey: 'A|search=', dataScopeKey: 'A' }
    });
    await waitFor(() => expect(result.current.data).toBe('census A totals'));
    rerender({ requestKey: 'A|search=x', dataScopeKey: 'A' });
    expect(result.current.data, 'same scope: old totals stay while loading').toBe('census A totals');
    rerender({ requestKey: 'B|search=x', dataScopeKey: 'B' });
    expect(result.current.data, 'another census: nothing old shows').toBeNull();
    expect(result.current.status).toBe('loading');
  });

  it('aborts on unmount', async () => {
    let captured: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useErrorsExplorerRequest({
        requestKey: 'k',
        load: signal => {
          captured = signal;
          return new Promise<string>(() => undefined);
        }
      })
    );
    unmount();
    expect(captured?.aborted).toBe(true);
  });
});
