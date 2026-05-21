'use client';

import * as React from 'react';
import { GridApi } from '@mui/x-data-grid';

export interface InfiniteGridScrollBridgeProps {
  apiRef: React.MutableRefObject<GridApi | null>;
  enabled: boolean;
  onLoadMore: () => void;
}

export default function InfiniteGridScrollBridge({ apiRef, enabled, onLoadMore }: InfiniteGridScrollBridgeProps) {
  const handlerRef = React.useRef(onLoadMore);
  handlerRef.current = onLoadMore;

  React.useEffect(() => {
    if (!enabled) return;
    const api = apiRef.current;
    if (!api || typeof api.subscribeEvent !== 'function') return;
    const unsubscribe = api.subscribeEvent('rowsScrollEndIntersection', () => handlerRef.current());
    return () => unsubscribe();
  }, [apiRef, enabled]);

  return null;
}
