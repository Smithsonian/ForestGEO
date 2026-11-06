'use client';

import React, { useState } from 'react';
import { Button, Chip, ChipDelete, Stack, Typography } from '@mui/joy';
import { ERROR_TYPE_GROUP_INITIAL_LIMIT, formatErrorTypeLabel, formatShowMoreErrorTypes, VIEW_ERRORS_TEXT, type ErrorTypeFacet } from '@/config/errorsexplorer';
import LockedControl from './lockedcontrol';

const LABEL_SEPARATOR = ', ';

export interface ErrorTypeGroupListProps {
  errorTypes: ErrorTypeFacet[];
  renderGroup: (facet: ErrorTypeFacet) => React.ReactNode;
  exactMessages: string[];
  onClearExactMessages: () => void;
  clearDisabledReason: string | null;
}

export default function ErrorTypeGroupList({ errorTypes, renderGroup, exactMessages, onClearExactMessages, clearDisabledReason }: ErrorTypeGroupListProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? errorTypes : errorTypes.slice(0, ERROR_TYPE_GROUP_INITIAL_LIMIT);
  const remaining = errorTypes.length - visible.length;
  return (
    <Stack spacing={1}>
      {exactMessages.length > 0 && (
        <Stack direction="row">
          <Chip
            variant="soft"
            endDecorator={
              <LockedControl reason={clearDisabledReason}>
                <ChipDelete aria-label={VIEW_ERRORS_TEXT.removeFilter} disabled={clearDisabledReason !== null} onDelete={onClearExactMessages} />
              </LockedControl>
            }
          >
            {`${VIEW_ERRORS_TEXT.filteredToPrefix} ${exactMessages.map(formatErrorTypeLabel).join(LABEL_SEPARATOR)}`}
          </Chip>
        </Stack>
      )}
      {visible.map(renderGroup)}
      {remaining > 0 && (
        <Button variant="plain" onClick={() => setShowAll(true)} sx={{ alignSelf: 'flex-start' }}>
          {formatShowMoreErrorTypes(remaining)}
        </Button>
      )}
      <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
        {VIEW_ERRORS_TEXT.footnote}
      </Typography>
    </Stack>
  );
}
