'use client';

import React, { useId } from 'react';
import NextLink from 'next/link';
import { Button, FormControl, FormHelperText, FormLabel, IconButton, Input, Link as JoyLink, Stack, ToggleButtonGroup, Typography } from '@mui/joy';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import { ERRORS_PAGE_PATH } from '@/config/errorsexplorer';
import { VIEW_DATA_SHOW_OPTIONS, VIEW_DATA_TEXT, withErrorsCount, type ViewDataShowOption, type ViewDataStateCounts } from '@/config/viewdata';

const SEARCH_MAX_WIDTH = 480;
const ENTER_KEY = 'Enter';

export interface ViewDataFilterBarProps {
  stateCounts: ViewDataStateCounts | null;
  showOption: ViewDataShowOption;
  onShowOptionChange: (next: ViewDataShowOption) => void;
  searchText: string;
  appliedSearchText: string;
  onSearchTextChange: (text: string) => void;
  onSearchApply: () => void;
  onSearchClear: () => void;
}

export default function ViewDataFilterBar({
  stateCounts,
  showOption,
  onShowOptionChange,
  searchText,
  appliedSearchText,
  onSearchTextChange,
  onSearchApply,
  onSearchClear
}: ViewDataFilterBarProps) {
  const showLabelId = useId();
  return (
    <Stack spacing={1} sx={{ mb: 1, width: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
        <Stack spacing={0.5}>
          <FormLabel id={showLabelId}>{VIEW_DATA_TEXT.showLabel}</FormLabel>
          <ToggleButtonGroup
            role="group"
            aria-labelledby={showLabelId}
            size="sm"
            value={showOption}
            onChange={(_event, next) => {
              if (next) onShowOptionChange(next as ViewDataShowOption);
            }}
          >
            {VIEW_DATA_SHOW_OPTIONS.map(option => (
              <Button key={option.value} value={option.value}>
                {stateCounts ? `${option.label} ${option.count(stateCounts).toLocaleString()}` : option.label}
              </Button>
            ))}
          </ToggleButtonGroup>
        </Stack>
        <FormControl sx={{ flex: 1, maxWidth: { md: SEARCH_MAX_WIDTH } }}>
          <FormLabel>{VIEW_DATA_TEXT.searchLabel}</FormLabel>
          <Input
            size="sm"
            aria-label={VIEW_DATA_TEXT.searchLabel}
            placeholder={VIEW_DATA_TEXT.searchPlaceholder}
            value={searchText}
            startDecorator={<SearchIcon />}
            onChange={event => onSearchTextChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === ENTER_KEY) onSearchApply();
            }}
            endDecorator={
              searchText !== '' || appliedSearchText !== '' ? (
                <IconButton size="sm" variant="plain" aria-label={VIEW_DATA_TEXT.clearSearch} onClick={onSearchClear}>
                  <ClearIcon />
                </IconButton>
              ) : null
            }
          />
          {searchText !== appliedSearchText && <FormHelperText>{VIEW_DATA_TEXT.searchApplyHint}</FormHelperText>}
        </FormControl>
      </Stack>
      {showOption === 'withErrors' && stateCounts && (
        <Typography level="body-sm" data-testid="view-data-with-errors-hint">
          {VIEW_DATA_TEXT.withErrorsHint(withErrorsCount(stateCounts))}{' '}
          <JoyLink component={NextLink} href={ERRORS_PAGE_PATH}>
            {VIEW_DATA_TEXT.openViewErrors}
          </JoyLink>
        </Typography>
      )}
    </Stack>
  );
}
