'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GridRowId } from '@mui/x-data-grid';

// Long enough to swallow the second click of a double-click on Cancel, short
// enough that a deliberate delete does not feel blocked.
export const DELETE_AFTER_CANCEL_GUARD_MS = 1000;

export interface DeleteAfterCancelGuard {
  markCancelled: (id: GridRowId) => void;
  isDeleteGuarded: (id: GridRowId) => boolean;
}

export function useDeleteAfterCancelGuard(): DeleteAfterCancelGuard {
  const guardTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [guardVersion, setGuardVersion] = useState(0);

  const markCancelled = useCallback((id: GridRowId) => {
    const rowKey = String(id);
    const guardTimers = guardTimersRef.current;
    const existingTimer = guardTimers.get(rowKey);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    guardTimers.set(
      rowKey,
      setTimeout(() => {
        guardTimers.delete(rowKey);
        setGuardVersion(version => version + 1);
      }, DELETE_AFTER_CANCEL_GUARD_MS)
    );
    setGuardVersion(version => version + 1);
  }, []);

  // Reads the ref so a handler running before the next render sees the guard;
  // guardVersion only gives the callback a new identity when a guard starts or
  // expires, which re-renders the actions column with the right disabled state.
  const isDeleteGuarded = useCallback(
    (id: GridRowId) => guardTimersRef.current.has(String(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guardVersion]
  );

  useEffect(() => {
    const guardTimers = guardTimersRef.current;
    return () => {
      guardTimers.forEach(timer => clearTimeout(timer));
      guardTimers.clear();
    };
  }, []);

  return { markCancelled, isDeleteGuarded };
}
