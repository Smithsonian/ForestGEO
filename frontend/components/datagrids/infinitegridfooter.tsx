'use client';

import * as React from 'react';
import { Alert, Box, Button, Typography } from '@mui/joy';
import { INFINITE_SOFT_CAP } from './hooks/useinfinitegridrows';

export interface InfiniteGridFooterProps {
  loadedCount: number;
  totalRows: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  softCapExceeded: boolean;
  onRetry: () => void;
}

export default function InfiniteGridFooter(props: InfiniteGridFooterProps) {
  const { loadedCount, totalRows, isLoadingMore, hasMore, error, softCapExceeded, onRetry } = props;

  let status: string;
  if (totalRows === 0 && !isLoadingMore) status = 'No rows';
  else if (isLoadingMore && loadedCount === 0) status = 'Loading…';
  else if (isLoadingMore) status = `Loaded ${loadedCount.toLocaleString()} of ${totalRows.toLocaleString()} rows · Loading more…`;
  else if (!hasMore) status = `All ${totalRows.toLocaleString()} rows loaded`;
  else status = `Loaded ${loadedCount.toLocaleString()} of ${totalRows.toLocaleString()} rows`;

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography level="body-sm">{status}</Typography>
        {error && (
          <Button size="sm" variant="soft" color="warning" onClick={onRetry} aria-label="Retry loading more rows">
            Retry
          </Button>
        )}
      </Box>
      {error && (
        <Alert size="sm" color="danger" variant="soft">
          {error.message || 'Failed to load more rows.'}
        </Alert>
      )}
      {softCapExceeded && (
        <Alert size="sm" color="warning" variant="soft">
          Loaded {loadedCount.toLocaleString()} of {totalRows.toLocaleString()} rows — consider filtering for better performance (soft cap{' '}
          {INFINITE_SOFT_CAP.toLocaleString()}).
        </Alert>
      )}
    </Box>
  );
}
