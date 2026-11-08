'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Chip, CircularProgress, Divider, Drawer, IconButton, Link as JoyLink, Stack, Typography } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import {
  ATTRIBUTES_PAGE_PATH,
  canClearValidationErrors,
  computeDbhChangePercent,
  DBH_CHANGE_VALIDATION_CODES,
  DETAILS_SHEET_TEXT,
  ERROR_DETAILS_SHEET_WIDTH,
  ERROR_SOURCE,
  formatDbhChangeFact,
  formatErrorTypeLabel,
  formatMeasurementHeading,
  formatOpenRow,
  formatQuadratLine,
  formatTreeStemLine,
  formatUnresolvedErrorsHeading,
  isAttributeCodeErrorType,
  isClearableValidationError,
  isMarkedInvalidWithoutLoggedError,
  MARKED_INVALID_NO_ERROR_LOGGED_LABEL,
  type DetailsPanelRow,
  type ErrorDetailRecord,
  type ErrorExplorerDetailsResponse,
  type RelatedContradictionRow
} from '@/config/errorsexplorer';
import { designTokens } from '@/config/design-tokens';
import { getMaterializedCodesValue, getUploadedCodesValue, hasCodesMismatch, renderCodesChips } from './errorcodes';
import ContradictionComparisonPanel from './contradictioncomparisonpanel';
import { ErrorSourceChip } from './errorsourcechip';
import LockedControl from './lockedcontrol';

export type ErrorRowDetailsStatus = 'loading' | 'ready' | 'error' | 'stale';

export interface ErrorRowDetailsPanelProps {
  open: boolean;
  row: DetailsPanelRow | null;
  errorDetails?: ErrorExplorerDetailsResponse | null;
  status: ErrorRowDetailsStatus;
  notice?: string | null;
  onRetry: () => void;
  onClose: () => void;
  onEditRow?: () => void;
  editRowDisabledReason?: string | null;
  canOpenRelatedRow: (row: RelatedContradictionRow) => boolean;
  onOpenRelatedRow: (measurementID: number) => void;
  openRelatedRowDisabledReason?: string | null;
  onClearValidationErrors?: () => void;
  clearValidationErrorsDisabledReason?: string | null;
  clearValidationErrorsBusy?: boolean;
  priorCensusNumberFor?: (priorCensusID: number) => number | null;
  headerExtras?: React.ReactNode;
  measurementSection?: React.ReactNode;
  footerActions?: React.ReactNode;
}

function factLineFor(error: ErrorDetailRecord, currentDBH: unknown, priorCensusNumberFor: ErrorRowDetailsPanelProps['priorCensusNumberFor']): string | null {
  if (error.source !== ERROR_SOURCE.validation || !DBH_CHANGE_VALIDATION_CODES.has(error.code) || error.comparison?.priorDBH == null) return null;
  const { priorDBH, priorCensusID } = error.comparison;
  const priorCensusNumber = priorCensusID !== null && priorCensusNumberFor ? priorCensusNumberFor(priorCensusID) : null;
  return formatDbhChangeFact(priorDBH, priorCensusNumber, currentDBH, computeDbhChangePercent(priorDBH, currentDBH));
}

function ErrorCard({
  error,
  currentDBH,
  priorCensusNumberFor
}: {
  error: ErrorDetailRecord;
  currentDBH: unknown;
  priorCensusNumberFor: ErrorRowDetailsPanelProps['priorCensusNumberFor'];
}) {
  const fact = factLineFor(error, currentDBH, priorCensusNumberFor);
  return (
    <Card size="sm" variant="outlined" data-testid="error-row-details-error-card">
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Typography level="body-sm" fontWeight="lg">
            {formatErrorTypeLabel(error.message)}
          </Typography>
          <ErrorSourceChip source={error.source} />
        </Stack>
        {error.fields.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {error.fields.map(field => (
              <Chip key={field} size="sm" variant="outlined">
                {field}
              </Chip>
            ))}
          </Stack>
        )}
        {fact && <Typography level="body-xs">{fact}</Typography>}
        {isAttributeCodeErrorType(error) && (
          <JoyLink component={Link} href={ATTRIBUTES_PAGE_PATH} level="body-xs">
            {DETAILS_SHEET_TEXT.openAttributes}
          </JoyLink>
        )}
      </Stack>
    </Card>
  );
}

export default function ErrorRowDetailsPanel(props: ErrorRowDetailsPanelProps) {
  const {
    open,
    row,
    errorDetails,
    status,
    notice,
    onRetry,
    onClose,
    onEditRow,
    editRowDisabledReason,
    canOpenRelatedRow,
    onOpenRelatedRow,
    openRelatedRowDisabledReason
  } = props;
  const {
    onClearValidationErrors,
    clearValidationErrorsDisabledReason,
    clearValidationErrorsBusy,
    priorCensusNumberFor,
    headerExtras,
    measurementSection,
    footerActions
  } = props;
  const allErrors = errorDetails?.allErrors ?? [];
  // Fetched details are authoritative (DV5): once they arrive, a stale grid-row flag can't keep the fallback or Clear alive (P2-5).
  const isFallback = errorDetails ? isMarkedInvalidWithoutLoggedError(allErrors) : Boolean(row?.markedInvalidWithoutLoggedError);
  const showsClear =
    Boolean(onClearValidationErrors) &&
    row !== null &&
    canClearValidationErrors({
      isLinkedToStem: row.isLinkedToStem,
      hasUnresolvedValidationError: allErrors.some(isClearableValidationError),
      markedInvalidWithoutLoggedError: isFallback
    });
  const detailRow = errorDetails?.row ?? null;
  const relatedRows = errorDetails?.relatedRows ?? [];
  const retry = (
    <Button size="sm" variant="soft" onClick={onRetry}>
      {DETAILS_SHEET_TEXT.retry}
    </Button>
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{ zIndex: designTokens.zIndex.detailsSheet }}
      slotProps={{
        content: { sx: { width: { xs: '100%', sm: ERROR_DETAILS_SHEET_WIDTH }, p: 2, gap: 1.5 }, 'data-testid': 'error-row-details-sheet' } as never
      }}
    >
      {row && (
        <Stack spacing={0.25}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Typography level="title-lg" component="h2">
              {formatMeasurementHeading(row.measurementID)}
            </Typography>
            <IconButton variant="plain" size="sm" aria-label={DETAILS_SHEET_TEXT.closeDetails} onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <Typography level="body-sm">{formatTreeStemLine(row.treeTag, row.stemTag)}</Typography>
          <Typography level="body-sm">{formatQuadratLine(row.quadratName, row.speciesCode, row.measurementDate)}</Typography>
          {headerExtras}
        </Stack>
      )}
      {notice && (
        <Alert color="success" role="status">
          {notice}
        </Alert>
      )}
      {status === 'loading' && <CircularProgress size="sm" />}
      {status === 'error' && !errorDetails && (
        <Alert color="danger" role="alert" endDecorator={retry}>
          {DETAILS_SHEET_TEXT.loadFailed}
        </Alert>
      )}
      {status === 'stale' && (
        <Alert color="warning" role="alert" endDecorator={retry}>
          {DETAILS_SHEET_TEXT.rowsStale}
        </Alert>
      )}
      {errorDetails && detailRow === null && <Typography level="body-sm">{DETAILS_SHEET_TEXT.rowResolved}</Typography>}
      {(isFallback || (errorDetails && detailRow)) && (
        <Stack spacing={1}>
          {isFallback ? (
            <Typography level="body-sm" data-testid="error-row-details-fallback">
              {MARKED_INVALID_NO_ERROR_LOGGED_LABEL}
            </Typography>
          ) : (
            <>
              <Typography level="title-sm">{formatUnresolvedErrorsHeading(allErrors.length)}</Typography>
              {allErrors.map((error, index) => (
                <ErrorCard
                  key={`${error.source}:${error.code}:${index}`}
                  error={error}
                  currentDBH={detailRow?.measuredDBH}
                  priorCensusNumberFor={priorCensusNumberFor}
                />
              ))}
            </>
          )}
        </Stack>
      )}
      {detailRow && (getUploadedCodesValue(detailRow) || getMaterializedCodesValue(detailRow)) && (
        <Stack spacing={0.5}>
          <Typography level="title-sm">{DETAILS_SHEET_TEXT.codesHeading}</Typography>
          <Typography level="body-xs">{DETAILS_SHEET_TEXT.uploadedCodes}</Typography>
          {renderCodesChips(getUploadedCodesValue(detailRow))}
          {hasCodesMismatch(detailRow) && (
            <>
              <Typography level="body-xs">{DETAILS_SHEET_TEXT.materializedCodes}</Typography>
              {renderCodesChips(getMaterializedCodesValue(detailRow), 'None')}
            </>
          )}
        </Stack>
      )}
      {detailRow?.hasContradiction && relatedRows.length > 0 && (
        <>
          <Divider />
          <ContradictionComparisonPanel
            selectedRow={detailRow}
            relatedRows={relatedRows}
            onInspectRow={onOpenRelatedRow}
            canInspectRow={canOpenRelatedRow}
            inspectDisabledReason={openRelatedRowDisabledReason}
          />
        </>
      )}
      {measurementSection}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {onEditRow && (
          <LockedControl reason={editRowDisabledReason ?? null}>
            <Button size="sm" disabled={Boolean(editRowDisabledReason)} onClick={onEditRow}>
              {DETAILS_SHEET_TEXT.editThisRow}
            </Button>
          </LockedControl>
        )}
        {relatedRows.filter(canOpenRelatedRow).map(related => (
          <LockedControl key={related.coreMeasurementID} reason={openRelatedRowDisabledReason ?? null}>
            <Button size="sm" variant="outlined" disabled={Boolean(openRelatedRowDisabledReason)} onClick={() => onOpenRelatedRow(related.coreMeasurementID)}>
              {formatOpenRow(related.coreMeasurementID)}
            </Button>
          </LockedControl>
        ))}
        {showsClear && (
          <LockedControl reason={clearValidationErrorsDisabledReason ?? null}>
            <Button
              size="sm"
              variant="soft"
              color="warning"
              loading={clearValidationErrorsBusy}
              disabled={Boolean(clearValidationErrorsDisabledReason)}
              onClick={onClearValidationErrors}
            >
              {DETAILS_SHEET_TEXT.clearValidationErrors}
            </Button>
          </LockedControl>
        )}
        {footerActions}
      </Stack>
    </Drawer>
  );
}
