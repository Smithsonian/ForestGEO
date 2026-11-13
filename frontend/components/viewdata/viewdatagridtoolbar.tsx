'use client';

import React from 'react';
import { ColumnsPanelTrigger, FilterPanelTrigger, Toolbar, ToolbarButton, type GridDensity, type GridSlotProps } from '@mui/x-data-grid';
import { Chip, Typography } from '@mui/joy';
import { VIEW_DATA_TEXT } from '@/config/viewdata';

export const VIEW_DATA_DENSITY_ORDER: readonly GridDensity[] = ['standard', 'compact', 'comfortable'];

export function nextViewDataDensity(current: GridDensity): GridDensity {
  const index = VIEW_DATA_DENSITY_ORDER.indexOf(current);
  return VIEW_DATA_DENSITY_ORDER[(index + 1) % VIEW_DATA_DENSITY_ORDER.length];
}

export interface ViewDataGridToolbarSettings {
  density: GridDensity;
  onCycleDensity: () => void;
  hidingEmpty: boolean;
  onToggleHidingEmpty: () => void;
  caption: string | null;
}

declare module '@mui/x-data-grid' {
  interface ToolbarPropsOverrides {
    viewDataToolbar?: ViewDataGridToolbarSettings;
  }
}

export default function ViewDataGridToolbar({ viewDataToolbar }: GridSlotProps['toolbar']) {
  if (!viewDataToolbar) return null;
  const { density, onCycleDensity, hidingEmpty, onToggleHidingEmpty, caption } = viewDataToolbar;
  return (
    <Toolbar style={{ width: '100%', alignItems: 'center' }}>
      <ColumnsPanelTrigger render={<ToolbarButton>{VIEW_DATA_TEXT.columnsButton}</ToolbarButton>} />
      <FilterPanelTrigger
        render={(triggerProps, state) => (
          <ToolbarButton {...triggerProps}>
            {VIEW_DATA_TEXT.filtersButton}
            {state.filterCount > 0 && (
              <Chip size="sm" variant="solid" color="primary" sx={{ ml: 0.5 }} data-testid="view-data-filter-count">
                {state.filterCount}
              </Chip>
            )}
          </ToolbarButton>
        )}
      />
      <ToolbarButton onClick={onCycleDensity} data-density={density}>
        {VIEW_DATA_TEXT.densityButton}
      </ToolbarButton>
      <ToolbarButton onClick={onToggleHidingEmpty} aria-pressed={hidingEmpty}>
        {VIEW_DATA_TEXT.hideEmptyColumns}
      </ToolbarButton>
      {caption && (
        <Typography level="body-xs" textColor="text.tertiary" sx={{ ml: 'auto', pr: 1 }} noWrap>
          {caption}
        </Typography>
      )}
    </Toolbar>
  );
}
