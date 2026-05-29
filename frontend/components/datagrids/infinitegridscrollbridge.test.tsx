import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InfiniteGridScrollBridge from './infinitegridscrollbridge';

function setScrollGeometry(element: HTMLElement, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(element, 'scrollHeight', { value: geometry.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: geometry.clientHeight, configurable: true });
  Object.defineProperty(element, 'scrollTop', { value: geometry.scrollTop, configurable: true });
}

function buildApiRef(scroller?: HTMLElement) {
  const root = document.createElement('div');
  if (scroller) root.appendChild(scroller);
  return { current: { rootElementRef: { current: root } } } as any;
}

describe('InfiniteGridScrollBridge', () => {
  it('calls onLoadMore when the community DataGrid virtual scroller is near the bottom', async () => {
    const scroller = document.createElement('div');
    scroller.className = 'MuiDataGrid-virtualScroller';
    setScrollGeometry(scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 410 });
    const onLoadMore = vi.fn();

    render(<InfiniteGridScrollBridge apiRef={buildApiRef(scroller)} enabled onLoadMore={onLoadMore} thresholdPx={100} />);

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  });

  it('does not call onLoadMore when the virtual scroller is above the threshold', async () => {
    const scroller = document.createElement('div');
    scroller.className = 'MuiDataGrid-virtualScroller';
    setScrollGeometry(scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 250 });
    const onLoadMore = vi.fn();

    render(<InfiniteGridScrollBridge apiRef={buildApiRef(scroller)} enabled onLoadMore={onLoadMore} thresholdPx={100} />);

    await new Promise(resolve => setTimeout(resolve, 40));
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('attaches when the virtual scroller appears after the first effect pass', async () => {
    const apiRef = buildApiRef();
    const scroller = document.createElement('div');
    scroller.className = 'MuiDataGrid-virtualScroller';
    setScrollGeometry(scroller, { scrollHeight: 1000, clientHeight: 500, scrollTop: 410 });
    const onLoadMore = vi.fn();

    render(<InfiniteGridScrollBridge apiRef={apiRef} enabled onLoadMore={onLoadMore} thresholdPx={100} />);
    apiRef.current.rootElementRef.current.appendChild(scroller);

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  });
});
