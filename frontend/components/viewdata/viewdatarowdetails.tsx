'use client';

import React, { useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import { Button, Chip, Link as JoyLink, Stack, Typography } from '@mui/joy';
import ErrorRowDetailsPanel, { type ErrorRowDetailsPanelProps, type ErrorRowDetailsStatus } from '@/components/errors/errorrowdetailspanel';
import { ErrorSourceChip } from '@/components/errors/errorsourcechip';
import LockedControl from '@/components/errors/lockedcontrol';
import {
  buildErrorsExplorerMessageHref,
  CLEAR_MEASUREMENT_ERRORS_CODES,
  CLEAR_NOTHING_TO_CLEAR_MESSAGE,
  CLEAR_UNCONFIRMED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_SUCCESS,
  isClearableValidationError,
  type DetailsPanelRow,
  type ErrorExplorerDetailsResponse,
  type RelatedContradictionRow
} from '@/config/errorsexplorer';
import {
  describeValidationCell,
  EMPTY_CELL_DISPLAY,
  FAULT_FONT_WEIGHT,
  formatStemState,
  formatStemStatuses,
  formatViewDataCellValue,
  toViewDataRowSummary,
  VIEW_DATA_MEASUREMENT_FIELDS,
  VIEW_DATA_TEXT
} from '@/config/viewdata';
import { formatCalendarDate } from '@/config/dateformats';
import { requestClearValidationErrors, type ClearValidationErrorsOutcome } from '@/lib/errorsexplorer/requestclearvalidationerrors';
import ailogger from '@/ailogger';

const ERROR_DETAILS_ENDPOINT = '/api/errors/explorer/details';
const STEM_STATUS_FIELD = 'stemStatus';
const DATE_FIELD = 'measurementDate';
const ABORT_ERROR_NAME = 'AbortError';
/** The panel has no 'idle' status; with no errorDetails, 'ready' renders the header, slots and actions only. */
const NO_DETAILS_PANEL_STATUS: ErrorRowDetailsStatus = 'ready';

type GridRowRecord = Record<string, unknown>;
type DetailsLoadState = 'idle' | ErrorRowDetailsStatus;
/** After a clear the shown rows may be stale until the grid re-read and, when the row still needs them, the details re-read succeed (A26). */
type ReadAfterClearState = 'current' | 'refreshing' | 'awaitingDetails' | 'stale';
type RefreshResult = 'ok' | 'failed';
/** The clears the sheet re-reads after: the row changed, may have changed, or was already resolved by someone else (409 NOTHING_TO_CLEAR). */
type SentClearOutcome = Exclude<ClearValidationErrorsOutcome['status'], 'failed'> | 'nothingToClear';

/** The details state is tagged with the reload token it belongs to, so a state left from an earlier read never resolves a newer refresh. */
interface DetailsRead {
  state: DetailsLoadState;
  reloadToken: number;
}

export interface ViewDataSheetTarget {
  coreMeasurementID: number;
  censusID: number;
  /** The row as loaded on the current grid page, or null for a related row that is not on it. */
  gridRow: GridRowRecord | null;
  /** The row's data as the grid last held it. It outlives the row leaving the page (a Clear under a filter); it carries no right to edit or delete. */
  lastKnownRow?: GridRowRecord | null;
}

export interface ViewDataRowDetailsProps {
  target: ViewDataSheetTarget | null;
  schema: string;
  plotID: number;
  plotCensusNumber: number;
  canEditRows: boolean;
  isAnyRowEditing: boolean;
  isDeleteGuarded: boolean;
  faultedFields: ReadonlySet<string>;
  priorCensusNumberFor?: ErrorRowDetailsPanelProps['priorCensusNumberFor'];
  onClose: () => void;
  onOpenRelatedRow: (coreMeasurementID: number) => void;
  onEditRow: (coreMeasurementID: number) => void;
  onDeleteRow: (coreMeasurementID: number) => Promise<void>;
  /** Strict re-read of the grid rows and counts; rejects when any read fails. */
  onCleared: () => Promise<void>;
  notify: (message: string, severity: 'success' | 'error') => void;
}

class DetailsRequestError extends Error {
  constructor(readonly status: number) {
    super(`details request returned ${status}`);
    this.name = 'DetailsRequestError';
  }
}

/** What the grid would show for a row whose last error a Clear deleted. */
const CLEARED_ROW_FIELDS: GridRowRecord = {
  measurementStatus: 'pending',
  unresolvedErrorCount: 0,
  primaryErrorMessage: null,
  primaryErrorSource: null,
  unresolvedErrorCodes: '',
  unresolvedErrorMessages: '',
  hasContradiction: false
};

/** [D1] Only rows in the error set can be opened; View Errors Task 11 marks the others inErrorSet: false. */
const canOpenRelatedRow = (row: RelatedContradictionRow) => row.inErrorSet;

/** One final message per refresh, posted after the grid's own count snackbar, as revertEditAndRefresh does (measurementscommonsutils.ts:431-444). */
function describeRefreshOutcome(clearOutcome: SentClearOutcome | null, result: RefreshResult): { message: string; severity: 'success' | 'error' } | null {
  if (clearOutcome === 'unconfirmed') return { message: CLEAR_UNCONFIRMED_MESSAGE, severity: 'error' };
  if (clearOutcome === 'nothingToClear') return { message: CLEAR_NOTHING_TO_CLEAR_MESSAGE, severity: 'error' };
  if (clearOutcome === 'cleared')
    return result === 'ok'
      ? { message: CLEAR_VALIDATION_ERRORS_SUCCESS, severity: 'success' }
      : { message: VIEW_DATA_TEXT.clearRefreshFailed, severity: 'error' };
  return result === 'ok' ? null : { message: VIEW_DATA_TEXT.rowsRefreshFailed, severity: 'error' };
}

function formatMeasurementValue(field: string, value: unknown): string {
  const formatted = formatViewDataCellValue(field, value);
  return field === DATE_FIELD && formatted !== EMPTY_CELL_DISPLAY ? formatCalendarDate(value as string) : formatted;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

export default function ViewDataRowDetails({
  target,
  schema,
  plotID,
  plotCensusNumber,
  canEditRows,
  isAnyRowEditing,
  isDeleteGuarded,
  faultedFields,
  priorCensusNumberFor,
  onClose,
  onOpenRelatedRow,
  onEditRow,
  onDeleteRow,
  onCleared,
  notify
}: ViewDataRowDetailsProps) {
  const [details, setDetails] = useState<ErrorExplorerDetailsResponse | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [detailsRead, setDetailsRead] = useState<DetailsRead>({ state: 'idle', reloadToken: 0 });
  const [isClearing, setIsClearing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [readAfterClear, setReadAfterClear] = useState<ReadAfterClearState>('current');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [clearedEveryError, setClearedEveryError] = useState(false);
  const refreshClearOutcomeRef = useRef<SentClearOutcome | null>(null);

  const gridRow = target?.gridRow ?? null;
  const lastKnownRow = target?.lastKnownRow ?? null;
  const displayRow = gridRow ?? (lastKnownRow && clearedEveryError ? { ...lastKnownRow, ...CLEARED_ROW_FIELDS } : lastKnownRow);
  const summary = displayRow ? toViewDataRowSummary(displayRow) : null;
  const needsDetails = Boolean(target) && (!summary || summary.measurementStatus === 'ingestionFailed' || summary.measurementStatus === 'unresolvedErrors');
  const coreMeasurementID = target?.coreMeasurementID ?? null;
  const censusID = target?.censusID ?? null;

  // Disabled reasons (A23, A26, R2-P2-8): Clear and Delete never overlap, and one reason covers Delete and its confirm button.
  const staleReason =
    readAfterClear === 'refreshing' || readAfterClear === 'awaitingDetails'
      ? VIEW_DATA_TEXT.refreshingAfterClear
      : readAfterClear === 'stale'
        ? VIEW_DATA_TEXT.refreshBeforeClearing
        : null;
  const lockReason = isAnyRowEditing ? VIEW_DATA_TEXT.editLockTooltip : (staleReason ?? (isClearing ? VIEW_DATA_TEXT.clearInProgress : null));
  const rowActionDisabledReason = lockReason ?? (gridRow ? null : VIEW_DATA_TEXT.offPageRowTooltip);
  const deleteReason = isConfirmingDelete || isDeleting ? VIEW_DATA_TEXT.deleteInProgress : null;
  const editDisabledReason = rowActionDisabledReason ?? deleteReason;
  const clearDisabledReason = lockReason ?? deleteReason;
  const isDeleteBlocked = isDeleteGuarded || Boolean(rowActionDisabledReason);

  useEffect(() => {
    setIsConfirmingDelete(false);
    setClearedEveryError(false);
    setReadAfterClear('current');
    refreshClearOutcomeRef.current = null;
  }, [coreMeasurementID, censusID]);

  useEffect(() => {
    if (isDeleteBlocked && !isDeleting) setIsConfirmingDelete(false);
  }, [isDeleteBlocked, isDeleting]);

  useEffect(() => {
    setDetails(null);
    if (coreMeasurementID === null || censusID === null || !needsDetails) {
      setDetailsRead({ state: 'idle', reloadToken });
      return;
    }
    const controller = new AbortController();
    setDetailsRead({ state: 'loading', reloadToken });
    const search = new URLSearchParams({ schema, plotID: String(plotID), censusID: String(censusID) });
    fetch(`${ERROR_DETAILS_ENDPOINT}/${coreMeasurementID}?${search.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new DetailsRequestError(response.status);
        return (await response.json()) as ErrorExplorerDetailsResponse;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setDetails(data);
        setDetailsRead({ state: 'ready', reloadToken });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === ABORT_ERROR_NAME) return;
        ailogger.error('[viewdata] row details request failed', error instanceof Error ? error : new Error(String(error)));
        if (!controller.signal.aborted) setDetailsRead({ state: 'error', reloadToken });
      });
    return () => controller.abort();
  }, [coreMeasurementID, censusID, needsDetails, schema, plotID, reloadToken]);

  const finishRefresh = (result: RefreshResult) => {
    setReadAfterClear(result === 'ok' ? 'current' : 'stale');
    const notice = describeRefreshOutcome(refreshClearOutcomeRef.current, result);
    refreshClearOutcomeRef.current = null;
    if (notice) notify(notice.message, notice.severity);
  };

  // P3-2: the refresh after a clear ends only when the details read of the same reload token has settled.
  useEffect(() => {
    if (readAfterClear !== 'awaitingDetails' || detailsRead.reloadToken !== reloadToken) return;
    if (detailsRead.state === 'idle' || detailsRead.state === 'ready') finishRefresh('ok');
    else if (detailsRead.state === 'error') finishRefresh('failed');
    // finishRefresh reads refs and the latest notify; the guard above makes this act once per refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAfterClear, detailsRead, reloadToken]);

  if (!target) return null;

  const sourceRow: GridRowRecord | null = displayRow ?? (details?.row as GridRowRecord | null | undefined) ?? null;
  const panelRow: DetailsPanelRow = {
    measurementID: target.coreMeasurementID,
    treeTag: textOrNull(sourceRow?.treeTag),
    stemTag: textOrNull(sourceRow?.stemTag),
    quadratName: textOrNull(sourceRow?.quadratName),
    speciesCode: textOrNull(sourceRow?.speciesCode),
    measurementDate: textOrNull(sourceRow?.measurementDate),
    // r4 P5-5: decides the fallback until details are fetched; then the panel follows the fetched list (View Errors P2-5).
    markedInvalidWithoutLoggedError: summary?.measurementStatus === 'invalidNoLog',
    isLinkedToStem: summary ? summary.measurementStatus !== 'ingestionFailed' : details?.row ? !details.row.isFailedRow : false
  };
  const treeTag = panelRow.treeTag ?? EMPTY_CELL_DISPLAY;
  const stemTag = panelRow.stemTag ?? EMPTY_CELL_DISPLAY;

  /** clearOutcome is null for "Retry refresh", which reports only a failure, in neutral words. */
  const rereadAfterClear = async (clearOutcome: SentClearOutcome | null) => {
    refreshClearOutcomeRef.current = clearOutcome;
    setReadAfterClear('refreshing');
    setReloadToken(token => token + 1);
    try {
      await onCleared();
    } catch (error: unknown) {
      ailogger.error('[viewdata] re-read after clear failed', error instanceof Error ? error : new Error(String(error)));
      finishRefresh('failed');
      return;
    }
    setReadAfterClear('awaitingDetails');
  };

  const handleClear = async () => {
    setIsClearing(true);
    const outcome = await requestClearValidationErrors({ schema, plotID, censusID: target.censusID, measurementID: target.coreMeasurementID });
    setIsClearing(false);
    if (outcome.status === 'failed') {
      if (outcome.code === CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear) {
        await rereadAfterClear('nothingToClear');
        return;
      }
      notify(CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE, 'error');
      return;
    }
    if (outcome.status === 'cleared') setClearedEveryError(!details || details.allErrors.every(isClearableValidationError));
    await rereadAfterClear(outcome.status);
  };

  const handleConfirmDelete = async () => {
    if (isDeleteBlocked || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteRow(target.coreMeasurementID);
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  const cell = summary ? describeValidationCell(summary) : null;
  const headerExtras = summary && cell && (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }} data-testid="view-data-status-chips">
      {cell.source && <ErrorSourceChip source={cell.source} />}
      <Chip size="sm" variant="soft">
        {cell.text}
      </Chip>
      {formatStemState(displayRow?.userDefinedFields) !== EMPTY_CELL_DISPLAY && (
        <Chip size="sm" variant="outlined">
          {formatStemState(displayRow?.userDefinedFields)}
        </Chip>
      )}
      {summary.stemStatuses.length > 0 && (
        <Chip size="sm" variant="outlined">
          {formatStemStatuses(summary.stemStatuses)}
        </Chip>
      )}
    </Stack>
  );

  // The panel has no errors-footer slot, so the cross-spec 6 link opens the Measurement section, directly under the errors.
  const viewErrorsLink =
    needsDetails && details?.row ? (
      <JoyLink component={NextLink} href={buildErrorsExplorerMessageHref(details.row.primaryErrorMessage)} level="body-sm">
        {VIEW_DATA_TEXT.openViewErrors}
      </JoyLink>
    ) : null;

  const measurementSection = sourceRow && (
    <Stack spacing={0.5} data-testid="view-data-measurement-section">
      {viewErrorsLink}
      <Typography level="title-sm">{VIEW_DATA_TEXT.measurementHeading}</Typography>
      {VIEW_DATA_MEASUREMENT_FIELDS.filter(({ field }) => field !== STEM_STATUS_FIELD || displayRow).map(({ field, label }) => {
        const value = field === STEM_STATUS_FIELD ? formatStemStatuses(summary?.stemStatuses ?? []) : formatMeasurementValue(field, sourceRow[field]);
        const isFaulted = faultedFields.has(field);
        return (
          <Stack key={field} direction="row" justifyContent="space-between" spacing={2} data-testid={`measurement-field-${field}`}>
            <Typography level="body-sm" textColor="text.tertiary">
              {label}
            </Typography>
            <Typography level="body-sm" sx={isFaulted ? { color: 'warning.plainColor', fontWeight: FAULT_FONT_WEIGHT } : undefined}>
              {value}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );

  const retryRefreshButton =
    readAfterClear === 'stale' ? (
      <Button size="sm" variant="soft" onClick={() => void rereadAfterClear(null)}>
        {VIEW_DATA_TEXT.retryRefresh}
      </Button>
    ) : null;
  const footerActions = canEditRows ? (
    <>
      {retryRefreshButton}
      {isConfirmingDelete ? (
        <Stack spacing={1} role="alertdialog" aria-label={VIEW_DATA_TEXT.deleteConfirmTitle(treeTag, stemTag, plotCensusNumber)}>
          <Typography level="title-sm">{VIEW_DATA_TEXT.deleteConfirmTitle(treeTag, stemTag, plotCensusNumber)}</Typography>
          <Typography level="body-sm">{VIEW_DATA_TEXT.deleteConfirmBody(plotCensusNumber)}</Typography>
          <Stack direction="row" spacing={1}>
            <LockedControl reason={rowActionDisabledReason}>
              <Button size="sm" color="danger" loading={isDeleting} disabled={isDeleteBlocked} onClick={() => void handleConfirmDelete()}>
                {VIEW_DATA_TEXT.deleteConfirm}
              </Button>
            </LockedControl>
            <Button size="sm" variant="plain" disabled={isDeleting} onClick={() => setIsConfirmingDelete(false)}>
              {VIEW_DATA_TEXT.deleteKeep}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <LockedControl reason={rowActionDisabledReason}>
          <Button size="sm" variant="outlined" color="danger" disabled={isDeleteBlocked} onClick={() => setIsConfirmingDelete(true)}>
            {VIEW_DATA_TEXT.deleteMeasurement}
          </Button>
        </LockedControl>
      )}
    </>
  ) : null;

  return (
    <ErrorRowDetailsPanel
      open
      row={panelRow}
      errorDetails={details}
      status={detailsRead.state === 'idle' ? NO_DETAILS_PANEL_STATUS : detailsRead.state}
      onRetry={() => (readAfterClear === 'stale' ? void rereadAfterClear(null) : setReloadToken(token => token + 1))}
      onClose={onClose}
      canOpenRelatedRow={canOpenRelatedRow}
      onOpenRelatedRow={onOpenRelatedRow}
      onEditRow={canEditRows ? () => onEditRow(target.coreMeasurementID) : undefined}
      editRowDisabledReason={editDisabledReason}
      onClearValidationErrors={canEditRows ? () => void handleClear() : undefined}
      clearValidationErrorsDisabledReason={clearDisabledReason}
      clearValidationErrorsBusy={isClearing}
      priorCensusNumberFor={priorCensusNumberFor}
      headerExtras={headerExtras}
      measurementSection={measurementSection}
      footerActions={footerActions}
    />
  );
}
