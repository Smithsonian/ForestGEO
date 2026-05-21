'use client';

import * as React from 'react';
import { GridApi } from '@mui/x-data-grid';

export interface InfiniteGridScrollBridgeProps {
  apiRef: React.MutableRefObject<GridApi | null>;
  enabled: boolean;
  onLoadMore: () => void;
  observeKey?: unknown;
  thresholdPx?: number;
}

const VIRTUAL_SCROLLER_SELECTOR = '.MuiDataGrid-virtualScroller';

function resolveVirtualScroller(apiRef: React.MutableRefObject<GridApi | null>): HTMLElement | null {
  const api = apiRef.current as
    | (GridApi & {
        rootElementRef?: React.RefObject<HTMLElement | null>;
        virtualScrollerRef?: React.RefObject<HTMLElement | null>;
      })
    | null;

  return api?.virtualScrollerRef?.current ?? api?.rootElementRef?.current?.querySelector<HTMLElement>(VIRTUAL_SCROLLER_SELECTOR) ?? null;
}

export default function InfiniteGridScrollBridge({ apiRef, enabled, onLoadMore, observeKey, thresholdPx = 160 }: InfiniteGridScrollBridgeProps) {
  const handlerRef = React.useRef(onLoadMore);
  handlerRef.current = onLoadMore;

  React.useEffect(() => {
    if (!enabled) return;

    const requestFrame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    const cancelFrame = window.cancelAnimationFrame ?? window.clearTimeout;
    let scroller: HTMLElement | null = null;
    let checkFrame: number | null = null;
    let attachFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const checkScrollPosition = () => {
      checkFrame = null;
      if (!scroller) return;
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceFromBottom <= thresholdPx) {
        handlerRef.current();
      }
    };

    const scheduleCheck = () => {
      if (checkFrame !== null) return;
      checkFrame = requestFrame(checkScrollPosition);
    };

    const attachScroller = () => {
      attachFrame = null;
      if (scroller) return;

      scroller = resolveVirtualScroller(apiRef);
      if (!scroller) {
        attachFrame = requestFrame(attachScroller);
        return;
      }

      scroller.addEventListener('scroll', scheduleCheck, { passive: true });
      resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleCheck) : null;
      resizeObserver?.observe(scroller);
      scheduleCheck();
    };

    attachScroller();

    return () => {
      scroller?.removeEventListener('scroll', scheduleCheck);
      resizeObserver?.disconnect();
      if (checkFrame !== null) cancelFrame(checkFrame);
      if (attachFrame !== null) cancelFrame(attachFrame);
    };
  }, [apiRef, enabled, observeKey, thresholdPx]);

  return null;
}
