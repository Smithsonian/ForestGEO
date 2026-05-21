'use client';

import * as React from 'react';
import {
  GridSlotProps,
  gridPageCountSelector,
  gridPageSelector,
  gridPageSizeSelector,
  gridPaginationRowCountSelector,
  useGridApiContext,
  useGridRootProps,
  useGridSelector
} from '@mui/x-data-grid';
import { Box, Button, Chip, IconButton, Input, Option, Select, Typography } from '@mui/joy';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];
const INFINITE_VALUE = 'infinite' as const;
const INFINITY_GLYPH = '∞';
type PageSizeOption = number | { value: number; label: string };
type PageSizeSelectValue = number | typeof INFINITE_VALUE;

function getPageSizeOptionValue(option: PageSizeOption): number {
  return typeof option === 'number' ? option : option.value;
}

function getPageSizeOptionLabel(option: PageSizeOption): string {
  return typeof option === 'number' ? String(option) : option.label;
}

export interface InfiniteScrollPaginationProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  loadedCount: number;
  totalRows: number;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  softCapExceeded: boolean;
  onRetry: () => void;
}

export interface CustomGridPaginationProps extends NonNullable<GridSlotProps['pagination']> {
  disabled?: boolean;
  infiniteScroll?: InfiniteScrollPaginationProps;
}

declare module '@mui/x-data-grid' {
  interface PaginationPropsOverrides {
    infiniteScroll?: InfiniteScrollPaginationProps;
  }
}

function describeInfiniteStatus(p: InfiniteScrollPaginationProps): string {
  if (p.totalRows === 0 && !p.isLoadingMore) return 'No rows';
  if (p.isLoadingMore && p.loadedCount === 0) return 'Loading…';
  const loaded = p.loadedCount.toLocaleString();
  const total = p.totalRows.toLocaleString();
  if (p.isLoadingMore) return `Loaded ${loaded} of ${total} · Loading more…`;
  if (!p.hasMore) return `All ${total} rows loaded`;
  return `Loaded ${loaded} of ${total}`;
}

export default function CustomGridPagination(props: CustomGridPaginationProps) {
  const apiRef = useGridApiContext();
  const page = useGridSelector(apiRef, gridPageSelector);
  const pageSize = useGridSelector(apiRef, gridPageSizeSelector);
  const pageCount = useGridSelector(apiRef, gridPageCountSelector);
  const rowCount = useGridSelector(apiRef, gridPaginationRowCountSelector);
  const rootProps = useGridRootProps();
  const pageSizeOptions = (rootProps?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS) as readonly PageSizeOption[];
  const infiniteScroll = props.infiniteScroll;

  const isInfinite = !!infiniteScroll?.enabled;
  const isEmpty = !isInfinite && (pageCount === 0 || rowCount === 0);
  const disabled = !!props.disabled || isEmpty;
  const lastPageIndex = Math.max(pageCount - 1, 0);

  const [gotoValue, setGotoValue] = React.useState<string>('');

  const commitGoto = React.useCallback(() => {
    const raw = gotoValue.trim();
    if (raw === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setGotoValue('');
      return;
    }
    const clamped = Math.min(Math.max(parsed, 1), Math.max(pageCount, 1));
    apiRef.current.setPage(clamped - 1);
    setGotoValue('');
  }, [apiRef, gotoValue, pageCount]);

  const sizeSelectValue: PageSizeSelectValue = isInfinite ? INFINITE_VALUE : pageSize;

  const handleSizeChange = React.useCallback(
    (_: unknown, next: PageSizeSelectValue | null) => {
      if (next === null || next === undefined) return;
      if (next === INFINITE_VALUE) {
        infiniteScroll?.onToggle(true);
        return;
      }
      const numericValue = typeof next === 'number' ? next : Number(next);
      if (!Number.isFinite(numericValue)) return;
      if (isInfinite) infiniteScroll?.onToggle(false);
      apiRef.current.setPageSize(numericValue);
      apiRef.current.setPage(0);
    },
    [apiRef, infiniteScroll, isInfinite]
  );

  const navDisabled = disabled || isInfinite;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5, width: '100%', flexWrap: 'wrap', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {isInfinite && infiniteScroll ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography level="body-sm" data-testid="infinite-status">
              {describeInfiniteStatus(infiniteScroll)}
            </Typography>
            {infiniteScroll.error && (
              <Button size="sm" variant="soft" color="warning" onClick={infiniteScroll.onRetry} aria-label="Retry loading more rows">
                Retry
              </Button>
            )}
            {infiniteScroll.softCapExceeded && (
              <Chip size="sm" variant="soft" color="warning">
                Consider filtering
              </Chip>
            )}
          </Box>
        ) : (
          <>
            <IconButton size="sm" variant="plain" aria-label="Go to first page" disabled={navDisabled || page === 0} onClick={() => apiRef.current.setPage(0)}>
              <FirstPageIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="sm"
              variant="plain"
              aria-label="Go to previous page"
              disabled={navDisabled || page === 0}
              onClick={() => apiRef.current.setPage(page - 1)}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography level="body-sm" sx={{ mx: 0.5 }}>
              Page
            </Typography>
            <Input
              size="sm"
              type="number"
              aria-label="Jump to page"
              slotProps={{ input: { 'aria-label': 'Jump to page', min: 1, max: Math.max(pageCount, 1) } }}
              value={gotoValue}
              placeholder={String(page + 1)}
              onChange={e => setGotoValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitGoto();
              }}
              onBlur={commitGoto}
              disabled={navDisabled}
              sx={{ width: 80 }}
            />
            <Typography level="body-sm">of {pageCount}</Typography>
            <IconButton
              size="sm"
              variant="plain"
              aria-label="Go to next page"
              disabled={navDisabled || page >= lastPageIndex}
              onClick={() => apiRef.current.setPage(page + 1)}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="sm"
              variant="plain"
              aria-label="Go to last page"
              disabled={navDisabled || page >= lastPageIndex}
              onClick={() => apiRef.current.setPage(lastPageIndex)}
            >
              <LastPageIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography level="body-sm">Rows per page</Typography>
        <Select<PageSizeSelectValue>
          size="sm"
          value={sizeSelectValue}
          onChange={handleSizeChange}
          disabled={!!props.disabled}
          slotProps={{ button: { 'aria-label': 'Rows per page' } }}
        >
          {pageSizeOptions.map(opt => (
            <Option key={getPageSizeOptionValue(opt)} value={getPageSizeOptionValue(opt)}>
              {getPageSizeOptionLabel(opt)}
            </Option>
          ))}
          {infiniteScroll && (
            <Option key={INFINITE_VALUE} value={INFINITE_VALUE} aria-label="Infinite scroll">
              {INFINITY_GLYPH}
            </Option>
          )}
        </Select>
      </Box>
    </Box>
  );
}
