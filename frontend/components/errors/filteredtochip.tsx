'use client';

import React from 'react';
import { Box, Chip, ChipDelete, Stack } from '@mui/joy';
import { formatErrorTypeLabel, VIEW_ERRORS_TEXT } from '@/config/errorsexplorer';
import LockedControl from './lockedcontrol';

const LABEL_SEPARATOR = ', ';

export interface FilteredToChipProps {
  exactMessages: readonly string[];
  onClear: () => void;
  clearDisabledReason: string | null;
}

export default function FilteredToChip({ exactMessages, onClear, clearDisabledReason }: FilteredToChipProps) {
  if (exactMessages.length === 0) return null;
  return (
    <Stack direction="row">
      <Chip
        variant="soft"
        endDecorator={
          <Box component="span" sx={{ display: 'inherit', pointerEvents: 'auto' }}>
            <LockedControl reason={clearDisabledReason}>
              <ChipDelete aria-label={VIEW_ERRORS_TEXT.removeFilter} disabled={clearDisabledReason !== null} onDelete={onClear} />
            </LockedControl>
          </Box>
        }
      >
        {`${VIEW_ERRORS_TEXT.filteredToPrefix} ${exactMessages.map(formatErrorTypeLabel).join(LABEL_SEPARATOR)}`}
      </Chip>
    </Stack>
  );
}
