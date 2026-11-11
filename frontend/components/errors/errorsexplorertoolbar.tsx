'use client';

import React from 'react';
import { Button, CircularProgress, FormControl, FormLabel, Input, Option, Select, Stack, ToggleButtonGroup, Tooltip } from '@mui/joy';
import { formatCount } from '@/config/censusoverview';
import {
  ERRORS_EXPLORER_SHOW_OPTIONS,
  MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH,
  SHOW_INGESTION_TOOLTIP,
  VIEW_ERRORS_TEXT,
  type ErrorCensusTotals,
  type ErrorsExplorerShowValue
} from '@/config/errorsexplorer';
import LockedControl from './lockedcontrol';

export type ErrorsExplorerGroupMode = 'byType' | 'none';
const SEARCH_INPUT_ID = 'errors-explorer-search';
const GROUP_ROWS_ID = 'errors-explorer-group-rows';
const COUNT_SEPARATOR = ' · ';

export interface ErrorsExplorerToolbarProps {
  showValue: ErrorsExplorerShowValue;
  onShowChange: (value: ErrorsExplorerShowValue) => void;
  totals: ErrorCensusTotals | null;
  totalsLoading: boolean;
  quickSearch: string;
  onQuickSearchChange: (value: string) => void;
  groupMode: ErrorsExplorerGroupMode;
  onGroupModeChange: (mode: ErrorsExplorerGroupMode) => void;
  lockReason: string | null;
}

export default function ErrorsExplorerToolbar(props: ErrorsExplorerToolbarProps) {
  const { showValue, onShowChange, totals, totalsLoading, quickSearch, onQuickSearchChange, groupMode, onGroupModeChange, lockReason } = props;
  const locked = Boolean(lockReason);
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
      <FormControl>
        <FormLabel>{VIEW_ERRORS_TEXT.showLabel}</FormLabel>
        <LockedControl reason={lockReason} testID="errors-toolbar-show-lock">
          <ToggleButtonGroup
            aria-label={VIEW_ERRORS_TEXT.showLabel}
            value={showValue}
            disabled={locked}
            onChange={(_event, next) => {
              if (next) onShowChange(next as ErrorsExplorerShowValue);
            }}
            sx={{ flexWrap: 'wrap' }}
          >
            {ERRORS_EXPLORER_SHOW_OPTIONS.map(option => {
              const count = totals ? formatCount(totals[option.countKey]) : VIEW_ERRORS_TEXT.unavailable;
              const button = (
                <Button key={option.value} value={option.value}>
                  {option.label}
                  {COUNT_SEPARATOR}
                  {totalsLoading && !totals ? <CircularProgress size="sm" aria-label={VIEW_ERRORS_TEXT.loadingCount} /> : count}
                </Button>
              );
              return option.value === 'ingestion' && !locked ? (
                <Tooltip key={option.value} title={SHOW_INGESTION_TOOLTIP} describeChild>
                  {button}
                </Tooltip>
              ) : (
                button
              );
            })}
          </ToggleButtonGroup>
        </LockedControl>
      </FormControl>
      <FormControl sx={{ flex: 1, minWidth: 220 }}>
        <FormLabel htmlFor={SEARCH_INPUT_ID}>{VIEW_ERRORS_TEXT.searchLabel}</FormLabel>
        <LockedControl reason={lockReason}>
          {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- the label is set on the native input through slotProps */}
          <Input
            value={quickSearch}
            disabled={locked}
            placeholder={VIEW_ERRORS_TEXT.searchPlaceholder}
            onChange={event => onQuickSearchChange(event.target.value)}
            slotProps={{ input: { id: SEARCH_INPUT_ID, 'aria-label': VIEW_ERRORS_TEXT.searchLabel, maxLength: MAX_ERROR_EXPLORER_QUICK_SEARCH_LENGTH } }}
            sx={{ width: '100%' }}
          />
        </LockedControl>
      </FormControl>
      <FormControl sx={{ minWidth: 180 }}>
        <FormLabel id={`${GROUP_ROWS_ID}-label`}>{VIEW_ERRORS_TEXT.groupRowsLabel}</FormLabel>
        <LockedControl reason={lockReason}>
          <Select
            value={groupMode}
            disabled={locked}
            onChange={(_event, next) => {
              if (next) onGroupModeChange(next);
            }}
            slotProps={{ button: { 'aria-label': VIEW_ERRORS_TEXT.groupRowsLabel } }}
          >
            <Option value="byType">{VIEW_ERRORS_TEXT.groupByErrorType}</Option>
            <Option value="none">{VIEW_ERRORS_TEXT.noGrouping}</Option>
          </Select>
        </LockedControl>
      </FormControl>
    </Stack>
  );
}
