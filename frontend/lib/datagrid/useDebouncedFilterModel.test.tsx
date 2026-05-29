import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridFilterModel } from '@mui/x-data-grid';
import { areGridFilterModelsEqual, toServerFilterModel } from './filterModel';
import { useDebouncedFilterModel } from './useDebouncedFilterModel';

const EMPTY: GridFilterModel = { items: [], quickFilterValues: [] };

describe('useDebouncedFilterModel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('updates uiModel synchronously and serverModel only after the debounce window', () => {
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual));

    act(() => result.current.applyChange({ items: [], quickFilterValues: ['AC'] }));
    expect(result.current.uiModel.quickFilterValues).toEqual(['AC']);
    expect(result.current.serverModel.quickFilterValues).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.serverModel.quickFilterValues).toEqual(['AC']);
  });

  it('coalesces rapid changes into a single server update', () => {
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual));

    act(() => result.current.applyChange({ items: [], quickFilterValues: ['A'] }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => result.current.applyChange({ items: [], quickFilterValues: ['AC'] }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => result.current.applyChange({ items: [], quickFilterValues: ['ACR'] }));

    const before = result.current.serverModel;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.serverModel).not.toBe(before);
    expect(result.current.serverModel.quickFilterValues).toEqual(['ACR']);
  });

  it('keeps serverModel reference identity stable when sanitised result equals previous', () => {
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual, toServerFilterModel));
    const initial = result.current.serverModel;

    act(() => result.current.applyChange({ items: [{ id: 1, field: 'spCode', operator: 'contains' }], quickFilterValues: [] }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.serverModel).toBe(initial);
  });

  it('keeps uiModel reference identity stable when the incoming model is equivalent', () => {
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual, toServerFilterModel));
    const initialUi = result.current.uiModel;

    act(() => result.current.applyChange({ items: [], quickFilterValues: [] }));

    expect(result.current.uiModel).toBe(initialUi);
  });

  it('flush() commits immediately and cancels the pending timer', () => {
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual));
    act(() => result.current.applyChange({ items: [], quickFilterValues: ['Z'] }));
    act(() => result.current.flush());
    expect(result.current.serverModel.quickFilterValues).toEqual(['Z']);
  });

  it('runs onCommit in the same commit that updates serverModel', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual, m => m, onCommit));

    act(() => result.current.applyChange({ items: [], quickFilterValues: ['ACRU'] }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ quickFilterValues: ['ACRU'] }), EMPTY);
    expect(result.current.serverModel.quickFilterValues).toEqual(['ACRU']);
  });

  it('clears a pending commit on unmount', () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedFilterModel(EMPTY, 500, areGridFilterModelsEqual, m => m, onCommit));

    act(() => result.current.applyChange({ items: [], quickFilterValues: ['ACRU'] }));
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });
});
