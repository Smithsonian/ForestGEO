'use client';

import React, { useState } from 'react';
import { Button, Stack, Typography } from '@mui/joy';
import { ERROR_TYPE_GROUP_INITIAL_LIMIT, formatShowMoreErrorTypes, VIEW_ERRORS_TEXT, type ErrorTypeFacet } from '@/config/errorsexplorer';
import FilteredToChip from './filteredtochip';

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
      <FilteredToChip exactMessages={exactMessages} onClear={onClearExactMessages} clearDisabledReason={clearDisabledReason} />
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
