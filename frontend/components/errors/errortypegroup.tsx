'use client';

import React, { useCallback, useId, useState } from 'react';
import { Button, Chip, Sheet, Stack, Typography } from '@mui/joy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  CONTRADICTION_REASONS,
  ERROR_SOURCE,
  errorTypeHintFor,
  formatErrorTypeLabel,
  formatGroupRowCount,
  isFallbackErrorType,
  toErrorTypeIdentity,
  VIEW_ERRORS_TEXT,
  type ContradictionType,
  type ErrorExplorerRow,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import ErrorsExplorerGrid, { type ErrorsExplorerGridProps } from './errorsexplorergrid';
import LockedControl from './lockedcontrol';

type GroupGridProps = Omit<ErrorsExplorerGridProps, 'variant' | 'gridKey' | 'ariaLabel' | 'errorType' | 'faultedFieldsFor' | 'errorLabelFor'>;

export interface ErrorTypeGroupProps {
  facet: ErrorTypeFacet;
  gridKey: string;
  expanded: boolean;
  onToggle: () => void;
  collapseDisabledReason: string | null;
  activeMeasurements: number | null;
  gridProps: GroupGridProps;
}

export default function ErrorTypeGroup({ facet, gridKey, expanded, onToggle, collapseDisabledReason, activeMeasurements, gridProps }: ErrorTypeGroupProps) {
  const label = formatErrorTypeLabel(facet.message);
  const [loadedContradictionTypes, setLoadedContradictionTypes] = useState<ContradictionType[]>([]);
  const faultedFields = React.useMemo(() => new Set(facet.fields), [facet.fields]);
  const faultedFieldsFor = useCallback(() => faultedFields, [faultedFields]);
  const errorLabelFor = useCallback(() => label, [label]);
  const parentOnRowsChange = gridProps.onRowsChange;
  const onRowsChange = useCallback(
    (key: string, rows: ErrorExplorerRow[], totalRows: number | null) => {
      const types = Array.from(new Set(rows.flatMap(row => row.contradictionTypes)));
      setLoadedContradictionTypes(previous => (previous.join() === types.join() ? previous : types));
      parentOnRowsChange?.(key, rows, totalRows);
    },
    [parentOnRowsChange]
  );
  const hint = errorTypeHintFor(facet);
  const collapseLocked = expanded && collapseDisabledReason !== null;
  const panelID = useId();

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'md', p: 1 }}>
      <Typography component="h2" level="title-md" sx={{ '& > span': { width: '100%' } }}>
        <LockedControl reason={collapseLocked ? collapseDisabledReason : null}>
          <Button
            variant="plain"
            color="neutral"
            aria-expanded={expanded}
            aria-controls={panelID}
            disabled={collapseLocked}
            onClick={onToggle}
            startDecorator={expanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
            sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, flexWrap: 'wrap' }}
          >
            <span>{label}</span>
            {!isFallbackErrorType(facet) && (
              <Chip size="sm" variant="soft" color={facet.source === ERROR_SOURCE.validation ? 'primary' : 'warning'}>
                {facet.source === ERROR_SOURCE.validation ? VIEW_ERRORS_TEXT.validationChip : VIEW_ERRORS_TEXT.ingestionChip}
              </Chip>
            )}
            {facet.hasContradiction && (
              <Chip size="sm" variant="soft" color="warning">
                {VIEW_ERRORS_TEXT.contradictionChip}
              </Chip>
            )}
            <Typography level="body-sm" sx={{ ml: 'auto' }}>
              {formatGroupRowCount(facet.count, activeMeasurements ?? 0)}
            </Typography>
          </Button>
        </LockedControl>
      </Typography>
      {!expanded && hint && (
        <Typography level="body-xs" sx={{ px: 1, color: 'text.tertiary' }}>
          {hint}
        </Typography>
      )}
      {expanded && facet.hasContradiction && loadedContradictionTypes.length > 0 && (
        <Stack sx={{ px: 1 }}>
          {loadedContradictionTypes.map(type => (
            <Typography key={type} level="body-xs">
              {CONTRADICTION_REASONS[type]}
            </Typography>
          ))}
        </Stack>
      )}
      {expanded && (
        <div id={panelID}>
          <ErrorsExplorerGrid
            {...gridProps}
            variant="group"
            gridKey={gridKey}
            ariaLabel={`${label} rows`}
            errorType={toErrorTypeIdentity(facet)}
            faultedFieldsFor={faultedFieldsFor}
            errorLabelFor={errorLabelFor}
            onRowsChange={onRowsChange}
          />
        </div>
      )}
    </Sheet>
  );
}
