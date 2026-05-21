'use client';

import * as React from 'react';
import {
  GridSlotProps,
  gridPageCountSelector,
  gridPageSelector,
  gridPageSizeSelector,
  gridPaginationRowCountSelector,
  useGridApiContext,
  useGridSelector
} from '@mui/x-data-grid';
import { Box, IconButton, Input, Option, Select, Typography } from '@mui/joy';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

export interface CustomGridPaginationProps extends NonNullable<GridSlotProps['pagination']> {
  disabled?: boolean;
}

export default function CustomGridPagination(props: CustomGridPaginationProps) {
  const apiRef = useGridApiContext();
  const page = useGridSelector(apiRef, gridPageSelector);
  const pageSize = useGridSelector(apiRef, gridPageSizeSelector);
  const pageCount = useGridSelector(apiRef, gridPageCountSelector);
  const rowCount = useGridSelector(apiRef, gridPaginationRowCountSelector);
  const rootProps = (apiRef.current as unknown as { rootProps?: { pageSizeOptions?: number[] } }).rootProps;
  const pageSizeOptions = rootProps?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;

  const isEmpty = pageCount === 0 || rowCount === 0;
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

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5, width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton size="sm" variant="plain" aria-label="Go to first page" disabled={disabled || page === 0} onClick={() => apiRef.current.setPage(0)}>
          <FirstPageIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Go to previous page"
          disabled={disabled || page === 0}
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
          disabled={disabled}
          sx={{ width: 80 }}
        />
        <Typography level="body-sm">of {pageCount}</Typography>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Go to next page"
          disabled={disabled || page >= lastPageIndex}
          onClick={() => apiRef.current.setPage(page + 1)}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Go to last page"
          disabled={disabled || page >= lastPageIndex}
          onClick={() => apiRef.current.setPage(lastPageIndex)}
        >
          <LastPageIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography level="body-sm">Rows per page</Typography>
        <Select
          size="sm"
          value={pageSize}
          onChange={(_, next) => {
            if (typeof next === 'number') {
              apiRef.current.setPageSize(next);
              apiRef.current.setPage(0);
            }
          }}
          disabled={disabled}
          slotProps={{ button: { 'aria-label': 'Rows per page' } }}
        >
          {pageSizeOptions.map(opt => (
            <Option key={opt} value={opt}>
              {opt}
            </Option>
          ))}
        </Select>
      </Box>
    </Box>
  );
}
