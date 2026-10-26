import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_AFTER_CANCEL_GUARD_MS, useDeleteAfterCancelGuard } from './usedeleteaftercancelguard';

const CANCELLED_ROW_ID = 'row-cancelled';
const OTHER_ROW_ID = 'row-untouched';
const NUMERIC_ROW_ID = 42;
const ONE_MS = 1;
const HALF_GUARD_MS = DELETE_AFTER_CANCEL_GUARD_MS / 2;

describe('useDeleteAfterCancelGuard (#525 item 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guards the row synchronously, so a handler running before the next render already sees it', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    const guardBeforeRender = result.current;
    let guardedInSameTick: boolean | undefined;

    act(() => {
      guardBeforeRender.markCancelled(CANCELLED_ROW_ID);
      guardedInSameTick = guardBeforeRender.isDeleteGuarded(CANCELLED_ROW_ID);
    });

    console.log(`[#525 item 1] guarded in the same tick as Cancel: ${guardedInSameTick}`);
    expect(guardedInSameTick).toBe(true);
  });

  it('stays guarded until the last millisecond of the window and clears exactly at its end', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));

    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS - ONE_MS));
    const guardedJustBeforeExpiry = result.current.isDeleteGuarded(CANCELLED_ROW_ID);
    act(() => vi.advanceTimersByTime(ONE_MS));
    const guardedAtExpiry = result.current.isDeleteGuarded(CANCELLED_ROW_ID);

    console.log(
      `[#525 item 1] at ${DELETE_AFTER_CANCEL_GUARD_MS - ONE_MS}ms: ${guardedJustBeforeExpiry}; at ${DELETE_AFTER_CANCEL_GUARD_MS}ms: ${guardedAtExpiry}`
    );
    expect(guardedJustBeforeExpiry).toBe(true);
    expect(guardedAtExpiry).toBe(false);
  });

  it('never guards a row that was not cancelled', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));

    console.log(`[#525 item 1] other row guarded: ${result.current.isDeleteGuarded(OTHER_ROW_ID)}`);
    expect(result.current.isDeleteGuarded(OTHER_ROW_ID)).toBe(false);
  });

  it('restarts the window when the same row is cancelled again', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));
    act(() => vi.advanceTimersByTime(HALF_GUARD_MS));
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));

    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS - ONE_MS));
    const guardedPastTheFirstWindow = result.current.isDeleteGuarded(CANCELLED_ROW_ID);
    act(() => vi.advanceTimersByTime(ONE_MS));
    const guardedAtSecondExpiry = result.current.isDeleteGuarded(CANCELLED_ROW_ID);

    console.log(
      `[#525 item 1] after the first window would have ended: ${guardedPastTheFirstWindow}; at the second expiry: ${guardedAtSecondExpiry}; pending timers: ${vi.getTimerCount()}`
    );
    expect(guardedPastTheFirstWindow).toBe(true);
    expect(guardedAtSecondExpiry).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can guard the same row again after its window expired', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));
    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS));
    expect(result.current.isDeleteGuarded(CANCELLED_ROW_ID)).toBe(false);

    act(() => result.current.markCancelled(CANCELLED_ROW_ID));
    expect(result.current.isDeleteGuarded(CANCELLED_ROW_ID)).toBe(true);
  });

  it('treats a numeric row id and its string form as the same row, like the grid rowKey does', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => result.current.markCancelled(NUMERIC_ROW_ID));

    expect(result.current.isDeleteGuarded(String(NUMERIC_ROW_ID))).toBe(true);
  });

  it('gives isDeleteGuarded a new identity when a guard starts and when it expires, so the actions column re-renders', () => {
    const { result } = renderHook(() => useDeleteAfterCancelGuard());
    const identityBeforeCancel = result.current.isDeleteGuarded;
    act(() => result.current.markCancelled(CANCELLED_ROW_ID));
    const identityWhileGuarded = result.current.isDeleteGuarded;
    act(() => vi.advanceTimersByTime(DELETE_AFTER_CANCEL_GUARD_MS));
    const identityAfterExpiry = result.current.isDeleteGuarded;

    expect(identityWhileGuarded).not.toBe(identityBeforeCancel);
    expect(identityAfterExpiry).not.toBe(identityWhileGuarded);
  });

  it('clears every pending guard timer on unmount', () => {
    const { result, unmount } = renderHook(() => useDeleteAfterCancelGuard());
    act(() => {
      result.current.markCancelled(CANCELLED_ROW_ID);
      result.current.markCancelled(OTHER_ROW_ID);
    });
    const timersBeforeUnmount = vi.getTimerCount();
    unmount();

    console.log(`[#525 item 1] timers before unmount: ${timersBeforeUnmount}; after: ${vi.getTimerCount()}`);
    expect(timersBeforeUnmount).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
