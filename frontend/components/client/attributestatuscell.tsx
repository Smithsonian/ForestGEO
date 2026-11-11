import { Tooltip, Typography } from '@mui/joy';
import { GridRenderCellParams } from '@mui/x-data-grid';
import React from 'react';
import { ATTRIBUTE_STATUS_UNSPECIFIED_HINT } from '@/lib/db/definitions/core';

export const renderAttributeStatusCell = (params: GridRenderCellParams) => {
  const value = params.value as string | null | undefined;
  if (value) {
    return <Typography level="body-sm">{value}</Typography>;
  }
  return (
    <Tooltip title={ATTRIBUTE_STATUS_UNSPECIFIED_HINT} arrow>
      {/* params.tabIndex follows the grid's roving tabindex: 0 for the current cell, -1 otherwise. */}
      <Typography level="body-sm" color="neutral" tabIndex={params.tabIndex} aria-label={ATTRIBUTE_STATUS_UNSPECIFIED_HINT} sx={{ fontStyle: 'italic' }}>
        Unspecified
      </Typography>
    </Tooltip>
  );
};
