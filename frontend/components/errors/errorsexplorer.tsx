'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import type { GridColumnVisibilityModel, GridFilterModel, GridSortModel } from '@mui/x-data-grid';
import { useOrgCensusContext, useOrgCensusListContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { getDateRangeCensusIDs } from '@/lib/censusscope';
import { loadSelectableOptions } from '@/components/client/clientmacros';
import PreviewDialog from '@/components/editplan/previewdialog';
import UndoToast from '@/components/editplan/undotoast';
import { isFieldEditableByRole } from '@/config/editplan/fieldpolicy';
import type { RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';
import {
  applyShowValue,
  buildErrorTypeKey,
  buildReadScopeKey,
  CLEAR_MEASUREMENT_ERRORS_CODES,
  CLEAR_NOTHING_TO_CLEAR_MESSAGE,
  CLEAR_UNCONFIRMED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE,
  CLEAR_VALIDATION_ERRORS_SUCCESS,
  DEFAULT_ERROR_EXPLORER_FILTERS,
  EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP,
  FALLBACK_ERROR_CODE,
  FIX_FAILED_UPLOADS_HREF,
  formatErrorTypeLabel,
  formatFixFailedUploads,
  formatViewErrorsFactsLine,
  resolveErrorsExplorerDeepLinkFilters,
  resolveShowValue,
  VIEW_ERRORS_ALERTS,
  VIEW_ERRORS_TEXT,
  type DetailsPanelRow,
  type ErrorExplorerDetailsResponse,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorExplorerRow,
  type ErrorsExplorerReadScope,
  type ErrorTypeFacet,
  type RelatedContradictionRow,
  type RowMutationScope
} from '@/config/errorsexplorer';
import { parseStoredErrorExplorerFilters, serializeStoredErrorExplorerFilters } from '@/lib/errorsexplorer/explorerrequest';
import { getErrorsExplorerDetails, postErrorsExplorerExport, postErrorsExplorerFacets } from '@/lib/errorsexplorer/explorertransport';
import { requestClearValidationErrors } from '@/lib/errorsexplorer/requestclearvalidationerrors';
import { useErrorsExplorerRequest } from '@/app/hooks/useerrorsexplorerrequest';
import { useErrorsExplorerRowEdit } from '@/app/hooks/useerrorsexplorerrowedit';
import { mergeEditedRow } from '@/app/hooks/useerrorsexplorerrows';
import ErrorsTotalsTiles from './errorstotalstiles';
import ErrorsExplorerToolbar, { type ErrorsExplorerGroupMode } from './errorsexplorertoolbar';
import ErrorTypeGroupList from './errortypegrouplist';
import FilteredToChip from './filteredtochip';
import ErrorTypeGroup from './errortypegroup';
import ErrorsExplorerGrid, { type ErrorsExplorerGridHandle, type ErrorsExplorerGridModels } from './errorsexplorergrid';
import ErrorRowDetailsPanel, { type ErrorRowDetailsStatus } from './errorrowdetailspanel';
import { buildGroupColumnVisibility, ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS } from './errorsexplorercolumns';
import LockedControl from './lockedcontrol';

export { extractFilenameFromContentDisposition } from '@/lib/errorsexplorer/explorertransport';

const FLAT_GRID_KEY = 'flat';
const FILTER_STORAGE_PREFIX = 'errors-explorer-filters';

export function getFilterStorageKey(schema?: string, plotID?: number, censusID?: number) {
  if (!schema || !plotID || !censusID) return null;
  return `${FILTER_STORAGE_PREFIX}:${schema}:${plotID}:${censusID}`;
}

function defaultFilters(): ErrorExplorerFilters {
  return { ...DEFAULT_ERROR_EXPLORER_FILTERS };
}

function groupGridKey(facet: ErrorTypeFacet): string {
  return `group:${buildErrorTypeKey(facet)}`;
}

// MUI reads a new filterModel object as a filter change and jumps to page 1, so a default must keep one identity.
const NO_SORT: GridSortModel = [];
const NO_COLUMN_FILTERS: GridFilterModel = { items: [] };

function emptyModels(columnVisibilityModel: GridColumnVisibilityModel): ErrorsExplorerGridModels {
  return { sortModel: NO_SORT, filterModel: NO_COLUMN_FILTERS, columnVisibilityModel };
}

function useDefaultGroupModels(): (facet: ErrorTypeFacet) => ErrorsExplorerGridModels {
  const cacheRef = useRef(new Map<string, ErrorsExplorerGridModels>());
  return useCallback((facet: ErrorTypeFacet) => {
    const identityKey = buildErrorTypeKey(facet);
    const columnVisibilityModel = buildGroupColumnVisibility(facet);
    const cached = cacheRef.current.get(identityKey);
    if (cached && JSON.stringify(cached.columnVisibilityModel) === JSON.stringify(columnVisibilityModel)) return cached;
    const created = emptyModels(columnVisibilityModel);
    cacheRef.current.set(identityKey, created);
    return created;
  }, []);
}

export function toDetailsPanelRow(row: ErrorExplorerRow): DetailsPanelRow {
  return {
    measurementID: Number(row.coreMeasurementID),
    treeTag: row.treeTag ?? null,
    stemTag: row.stemTag ?? null,
    quadratName: row.quadratName ?? null,
    speciesCode: row.speciesCode ?? null,
    measurementDate: row.measurementDate ?? null,
    isLinkedToStem: !row.isFailedRow,
    markedInvalidWithoutLoggedError: row.totalErrorCount === 1 && row.errorCodes.length === 1 && row.errorCodes[0] === FALLBACK_ERROR_CODE
  };
}

function relatedDetailsPanelRow(related: RelatedContradictionRow): DetailsPanelRow {
  return {
    measurementID: related.coreMeasurementID,
    treeTag: related.treeTag ?? null,
    stemTag: related.stemTag ?? null,
    quadratName: related.quadratName ?? null,
    speciesCode: related.speciesCode ?? null,
    measurementDate: related.measurementDate ?? null,
    isLinkedToStem: false,
    markedInvalidWithoutLoggedError: false
  };
}

interface ScopedViewState {
  scopeKey: string;
  expansionInitialized: boolean;
  expanded: ReadonlySet<string>;
  groupModels: Readonly<Record<string, ErrorsExplorerGridModels>>;
  flatModels: ErrorsExplorerGridModels;
  visibleRowIDs: Readonly<Record<string, readonly number[]>>;
  flatTotalRows: number | null;
}

function initialViewState(scopeKey: string): ScopedViewState {
  return {
    scopeKey,
    expansionInitialized: false,
    expanded: new Set(),
    groupModels: {},
    flatModels: emptyModels(ERRORS_EXPLORER_DEFAULT_HIDDEN_COLUMNS),
    visibleRowIDs: {},
    flatTotalRows: null
  };
}

interface DetailsSheetState {
  scopeKey: string;
  gridKey: string | null;
  row: DetailsPanelRow;
  mutationScope: RowMutationScope;
}

/** One Clear, keyed to the row it clears, so its busy state and notice never land on another row's sheet (P3-3). */
interface ClearOperationState {
  measurementID: number;
  readScopeKey: string;
  status: 'busy' | 'cleared';
}

function readStoredFilters(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch (error: unknown) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

function writeStoredFilters(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch (error: unknown) {
    if (!(error instanceof DOMException)) throw error;
  }
}

export default function ErrorsExplorer() {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const censusList = useOrgCensusListContext();
  const { data: session } = useSession();
  const activeCensusID = currentCensus?.dateRanges?.[0]?.censusID;
  const activeCensusIDsKey = getDateRangeCensusIDs(currentCensus).join(',');
  const schema = currentSite?.schemaName;
  const plotID = currentPlot?.plotID;
  const readScope = useMemo<ErrorsExplorerReadScope | null>(() => {
    if (!schema || !plotID || !activeCensusID) return null;
    const censusIDs = activeCensusIDsKey
      .split(',')
      .map(Number)
      .filter(censusID => censusID > 0);
    return { schema, plotID, censusID: activeCensusID, censusIDs: censusIDs.length > 0 ? censusIDs : [activeCensusID] };
  }, [schema, plotID, activeCensusID, activeCensusIDsKey]);
  const readScopeKey = buildReadScopeKey(readScope);
  const userStatus = session?.user?.userStatus;
  const canEditRows = Boolean(userStatus && userStatus !== 'pending');
  const canEditSpeciesCode = isFieldEditableByRole('SpeciesCode', userStatus);
  const storageKey = useMemo(() => getFilterStorageKey(schema, plotID, activeCensusID), [schema, plotID, activeCensusID]);

  const [filters, setFilters] = useState<ErrorExplorerFilters>(defaultFilters);
  const [groupMode, setGroupMode] = useState<ErrorsExplorerGroupMode>('byType');
  const [pageAlert, setPageAlert] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [selectableOpts, setSelectableOpts] = useState<{ codes: string[] }>({ codes: [] });
  const codeOptions = selectableOpts.codes;
  const [clearState, setClearState] = useState<ClearOperationState | null>(null);
  const defaultGroupModelsFor = useDefaultGroupModels();
  const gridsRef = useRef(new Map<string, ErrorsExplorerGridHandle>());
  const facetsReloadRef = useRef<(options?: RefreshOptions) => Promise<void>>(async () => undefined);
  const detailsReloadRef = useRef<(options?: RefreshOptions) => Promise<void>>(async () => undefined);
  const detailsPatchRef = useRef<(row: ErrorExplorerRow) => void>(() => undefined);

  const refreshAllReads = useCallback(async (options?: RefreshOptions) => {
    const settled = await Promise.allSettled([
      facetsReloadRef.current(options),
      ...Array.from(gridsRef.current.values(), grid => grid.refresh(options)),
      detailsReloadRef.current(options)
    ]);
    const rejection = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (options?.strict && rejection) throw rejection.reason;
  }, []);
  const patchRowEverywhere = useCallback((row: ErrorExplorerRow) => {
    gridsRef.current.forEach(grid => grid.patchRow(row));
    detailsPatchRef.current(row);
  }, []);
  const rowEdit = useErrorsExplorerRowEdit({ readScope, readScopeKey, refreshAllReads, patchRowEverywhere, showPageAlert: setPageAlert });
  const gated = rowEdit.isReadScopeGated;
  const pageLockReason = rowEdit.reasons.pageControl;
  const clearPageAlert = useCallback(() => setPageAlert(null), []);

  // An alert answers the operation that raised it: a new edit, Clear, Undo or Export, or a refresh that lifts the gate, ends it.
  const editOperationID = rowEdit.lock?.operationID ?? null;
  const previousEditOperationIDRef = useRef(editOperationID);
  useEffect(() => {
    if (editOperationID !== null && editOperationID !== previousEditOperationIDRef.current) clearPageAlert();
    previousEditOperationIDRef.current = editOperationID;
  }, [clearPageAlert, editOperationID]);
  const wasGatedRef = useRef(gated);
  useEffect(() => {
    if (wasGatedRef.current && !gated) clearPageAlert();
    wasGatedRef.current = gated;
  }, [clearPageAlert, gated]);

  const searchParams = useSearchParams();
  // A ?message= / ?view=all link applies once per visit, on the first restore run that has a storage key. It stays
  // pending for THAT key (StrictMode re-runs the effect for the same key) and is dropped the first time the key changes.
  const deepLinkRef = useRef<{ filters: ErrorExplorerFilters | null; appliedStorageKey: string | null } | null>(null);
  if (deepLinkRef.current === null) deepLinkRef.current = { filters: resolveErrorsExplorerDeepLinkFilters(searchParams), appliedStorageKey: null };

  useEffect(() => {
    if (!storageKey) return;
    const deepLink = deepLinkRef.current;
    if (deepLink?.filters) {
      if (deepLink.appliedStorageKey === null || deepLink.appliedStorageKey === storageKey) {
        deepLink.appliedStorageKey = storageKey;
        setFilters(deepLink.filters);
        return;
      }
      deepLink.filters = null;
    }
    setFilters(parseStoredErrorExplorerFilters(readStoredFilters(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    if (storageKey) writeStoredFilters(storageKey, serializeStoredErrorExplorerFilters(filters));
  }, [filters, storageKey]);

  useEffect(() => {
    if (!currentSite?.schemaName) return;
    const controller = new AbortController();
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [currentSite, currentPlot, currentCensus]);

  const facets = useErrorsExplorerRequest<ErrorExplorerFacetsResponse>({
    requestKey: readScope ? `facets|${readScopeKey}|${JSON.stringify(filters)}` : null,
    load: signal => {
      if (!readScope) throw new Error(VIEW_ERRORS_TEXT.totalsLoadFailed);
      return postErrorsExplorerFacets(readScope, filters, signal);
    },
    gated,
    dataScopeKey: readScopeKey
  });
  facetsReloadRef.current = facets.reload;
  const totals = facets.data?.censusTotals ?? null;
  const errorTypes = facets.data?.errorTypes ?? [];

  const [viewState, setViewState] = useState<ScopedViewState>(() => initialViewState(readScopeKey));
  const view = viewState.scopeKey === readScopeKey ? viewState : initialViewState(readScopeKey);
  if (viewState.scopeKey !== readScopeKey) setViewState(view);

  useEffect(() => {
    if (view.expansionInitialized || facets.status !== 'ready' || !facets.data) return;
    const firstType = facets.data.errorTypes[0];
    setViewState(previous => ({ ...previous, expansionInitialized: true, expanded: new Set(firstType ? [buildErrorTypeKey(firstType)] : []) }));
  }, [facets.data, facets.status, view.expansionInitialized]);

  const [sheetState, setSheetState] = useState<DetailsSheetState | null>(null);
  const sheet = sheetState?.scopeKey === readScopeKey ? sheetState : null;
  const detailsKey = sheet ? `details|${readScopeKey}|${sheet.mutationScope.censusID}|${sheet.row.measurementID}` : null;
  const sheetGated = sheet !== null && rowEdit.isMutationScopeGated(sheet.mutationScope);
  const details = useErrorsExplorerRequest<ErrorExplorerDetailsResponse>({
    requestKey: detailsKey,
    load: signal => {
      if (!sheet) throw new Error(VIEW_ERRORS_TEXT.rowsLoadFailed);
      return getErrorsExplorerDetails(sheet.mutationScope, sheet.row.measurementID, signal);
    },
    gated: sheetGated,
    dataScopeKey: detailsKey
  });
  detailsReloadRef.current = sheet ? details.reload : async () => undefined;
  detailsPatchRef.current = row =>
    details.updateData(current =>
      current.row && current.row.coreMeasurementID === row.coreMeasurementID ? { ...current, row: mergeEditedRow(current.row, row) } : current
    );

  const registerGrid = useCallback((gridKey: string, handle: ErrorsExplorerGridHandle | null) => {
    if (handle) gridsRef.current.set(gridKey, handle);
    else gridsRef.current.delete(gridKey);
  }, []);

  const onRowsChange = useCallback((gridKey: string, rows: ErrorExplorerRow[], totalRows: number | null) => {
    const ids = rows.map(row => Number(row.id));
    setViewState(previous => {
      const known = previous.visibleRowIDs[gridKey];
      const sameRows = known !== undefined && known.length === ids.length && known.every((id, index) => id === ids[index]);
      const sameTotal = gridKey !== FLAT_GRID_KEY || previous.flatTotalRows === totalRows;
      if (sameRows && sameTotal) return previous;
      return { ...previous, visibleRowIDs: { ...previous.visibleRowIDs, [gridKey]: ids }, ...(gridKey === FLAT_GRID_KEY ? { flatTotalRows: totalRows } : {}) };
    });
  }, []);

  // A finished Clear's notice belongs to that sheet visit; a Clear still in flight keeps its state (P3-3).
  const dropFinishedClear = useCallback(() => setClearState(previous => (previous?.status === 'busy' ? previous : null)), []);

  const openDetails = useCallback(
    (gridKey: string, row: ErrorExplorerRow) => {
      if (!readScope) return;
      dropFinishedClear();
      setSheetState({
        scopeKey: readScopeKey,
        gridKey,
        row: toDetailsPanelRow(row),
        mutationScope: { schema: readScope.schema, plotID: readScope.plotID, censusID: Number(row.censusID) }
      });
    },
    [dropFinishedClear, readScope, readScopeKey]
  );

  const openRelatedRow = (measurementID: number) => {
    const related = details.data?.relatedRows.find(candidate => candidate.coreMeasurementID === measurementID);
    if (!sheet || !related) return;
    dropFinishedClear();
    setSheetState({ ...sheet, gridKey: null, row: relatedDetailsPanelRow(related) });
  };

  const editThisRow = () => {
    if (!sheet?.gridKey) return;
    const grid = gridsRef.current.get(sheet.gridKey);
    setSheetState(null);
    grid?.startRowEdit(sheet.row.measurementID);
  };

  const originOnScreen = sheet?.gridKey ? (view.visibleRowIDs[sheet.gridKey] ?? []).includes(sheet.row.measurementID) : false;
  // The same rule beginPageMutation refuses by, so a detached old-scope saving lock disables Clear here too (r3, P2-8).
  const pageMutationReason = rowEdit.reasons.pageMutationBlocked;
  const editRowDisabledReason = pageLockReason ?? pageMutationReason ?? (originOnScreen ? null : EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP);

  const clearMatchesSheet =
    clearState !== null && sheet !== null && clearState.measurementID === sheet.row.measurementID && clearState.readScopeKey === readScopeKey;
  const clearBusyOnSheet = clearMatchesSheet && clearState.status === 'busy';
  const clearNotice = clearMatchesSheet && clearState.status === 'cleared' ? CLEAR_VALIDATION_ERRORS_SUCCESS : null;

  const handleClearValidationErrors = async () => {
    if (!sheet) return;
    const release = rowEdit.beginPageMutation('clear');
    if (!release) return;
    clearPageAlert();
    const operation = { measurementID: sheet.row.measurementID, readScopeKey };
    setClearState({ ...operation, status: 'busy' });
    try {
      const outcome = await requestClearValidationErrors({ ...sheet.mutationScope, measurementID: operation.measurementID });
      if (outcome.status === 'failed') {
        const nothingToClear = outcome.code === CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear;
        setPageAlert(nothingToClear ? CLEAR_NOTHING_TO_CLEAR_MESSAGE : CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE);
        // The row was resolved elsewhere after the sheet opened: re-read it so the sheet shows its current state (r3, R2).
        if (nothingToClear) await refreshAllReads();
        setClearState(null);
        return;
      }
      if (outcome.status === 'unconfirmed') setPageAlert(CLEAR_UNCONFIRMED_MESSAGE);
      await refreshAllReads();
      setClearState(outcome.status === 'cleared' ? { ...operation, status: 'cleared' } : null);
    } finally {
      release();
    }
  };

  const clearExactMessages = () => setFilters(previous => ({ ...previous, exactMessages: [] }));

  const clearAllFilters = () => {
    setFilters(defaultFilters());
    setViewState(previous => ({ ...previous, flatModels: { ...previous.flatModels, filterModel: { items: [] } } }));
  };

  const handleExportCsv = async () => {
    if (!readScope) return;
    clearPageAlert();
    setIsExportingCsv(true);
    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const { blob, filename } = await postErrorsExplorerExport(readScope, filters);
      objectUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } catch (error: unknown) {
      setPageAlert(VIEW_ERRORS_ALERTS.exportFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      anchor?.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsExportingCsv(false);
    }
  };

  const priorCensusNumberFor = useCallback(
    (priorCensusID: number) => censusList?.find(entry => entry?.censusIDs.includes(priorCensusID))?.plotCensusNumber ?? null,
    [censusList]
  );

  const gridProps = {
    readScope,
    readScopeKey,
    filters,
    canEditRows,
    canEditSpeciesCode,
    codeOptions,
    censusList,
    rowEdit,
    onOpenDetails: openDetails,
    registerGrid,
    onRowsChange
  };

  const sheetStatus: ErrorRowDetailsStatus = details.isStale ? 'stale' : details.status === 'error' ? 'error' : details.data ? 'ready' : 'loading';
  const panelRow = details.data?.row ? toDetailsPanelRow(details.data.row) : (sheet?.row ?? null);
  const censusHasNoErrors = totals !== null && totals.affectedMeasurements === 0;
  const showsGroupEmptyState = groupMode === 'byType' && facets.status === 'ready' && errorTypes.length === 0;
  const showsFlatEmptyState = groupMode === 'none' && view.flatTotalRows === 0;

  const factsLine = totals ? formatViewErrorsFactsLine(totals.affectedMeasurements, totals.activeMeasurements, totals.errorTypeCount) : null;

  return (
    <Stack spacing={2} sx={{ width: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'flex-start' }}>
        <Stack spacing={0.5}>
          <Typography level="h1" data-testid="errors-explorer-title">
            {VIEW_ERRORS_TEXT.pageTitle}
          </Typography>
          <Typography level="body-sm" data-testid="errors-explorer-facts">
            {factsLine ??
              (facets.status === 'error' ? VIEW_ERRORS_TEXT.unavailable : <CircularProgress size="sm" aria-label={VIEW_ERRORS_TEXT.loadingTotals} />)}
            {!canEditRows && <span data-testid="errorsexplorer-readonly-banner">{` · ${VIEW_ERRORS_TEXT.readOnlySuffix}`}</span>}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          {canEditRows && totals !== null && totals.failedMeasurements > 0 && (
            <Button
              component={Link}
              href={FIX_FAILED_UPLOADS_HREF}
              size="sm"
              variant="outlined"
              color="warning"
              startDecorator={<BuildCircleOutlinedIcon />}
              data-testid="errorsexplorer-fix-failed-link"
            >
              {formatFixFailedUploads(totals.failedMeasurements)}
            </Button>
          )}
          <Button
            size="sm"
            variant="outlined"
            color="neutral"
            startDecorator={<FileDownloadOutlinedIcon />}
            loading={isExportingCsv}
            disabled={isExportingCsv}
            onClick={handleExportCsv}
            data-testid="errorsexplorer-export-csv"
          >
            {VIEW_ERRORS_TEXT.exportCsv}
          </Button>
        </Stack>
      </Stack>

      {(pageAlert || gated) && (
        <Alert
          color="danger"
          startDecorator={<ReportProblemOutlinedIcon />}
          data-testid="errors-explorer-page-alert"
          endDecorator={
            <Stack direction="row" spacing={1} alignItems="center">
              {gated && (
                <Button size="sm" variant="soft" color="danger" onClick={() => void rowEdit.retryRefresh()}>
                  {VIEW_ERRORS_TEXT.retryRefresh}
                </Button>
              )}
              {pageAlert !== null && (
                <IconButton size="sm" variant="plain" color="danger" aria-label={VIEW_ERRORS_TEXT.dismissAlert} onClick={clearPageAlert}>
                  <CloseIcon />
                </IconButton>
              )}
            </Stack>
          }
        >
          {pageAlert ?? VIEW_ERRORS_ALERTS.pendingRebuild}
        </Alert>
      )}

      <ErrorsTotalsTiles
        totals={totals}
        status={facets.status}
        isStale={facets.isStale}
        onRetry={() => (gated ? void rowEdit.retryRefresh() : void facets.reload())}
      />

      <ErrorsExplorerToolbar
        showValue={resolveShowValue(filters)}
        onShowChange={value => setFilters(previous => applyShowValue(previous, value))}
        totals={totals}
        totalsLoading={facets.status === 'loading'}
        quickSearch={filters.quickSearch}
        onQuickSearchChange={quickSearch => setFilters(previous => ({ ...previous, quickSearch }))}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        lockReason={pageLockReason}
      />

      {(showsGroupEmptyState || showsFlatEmptyState) && (
        <Stack data-testid="errors-explorer-empty" spacing={1} alignItems="center" sx={{ py: 4, textAlign: 'center' }}>
          <Typography level="title-md">{censusHasNoErrors ? VIEW_ERRORS_TEXT.emptyCensus : VIEW_ERRORS_TEXT.emptyFiltered}</Typography>
          {!censusHasNoErrors && (
            <LockedControl reason={pageLockReason}>
              <Button size="sm" variant="soft" disabled={pageLockReason !== null} onClick={clearAllFilters}>
                {VIEW_ERRORS_TEXT.clearFilters}
              </Button>
            </LockedControl>
          )}
        </Stack>
      )}

      {groupMode === 'byType' && !showsGroupEmptyState && facets.data && (
        <ErrorTypeGroupList
          errorTypes={errorTypes}
          exactMessages={filters.exactMessages}
          onClearExactMessages={clearExactMessages}
          clearDisabledReason={pageLockReason}
          renderGroup={facet => {
            const identityKey = buildErrorTypeKey(facet);
            const gridKey = groupGridKey(facet);
            return (
              <ErrorTypeGroup
                key={`${readScopeKey}::${identityKey}`}
                facet={facet}
                gridKey={gridKey}
                expanded={view.expanded.has(identityKey)}
                onToggle={() =>
                  setViewState(previous => {
                    const expanded = new Set(previous.expanded);
                    if (expanded.has(identityKey)) expanded.delete(identityKey);
                    else expanded.add(identityKey);
                    return { ...previous, expanded };
                  })
                }
                collapseDisabledReason={rowEdit.reasons.owningGrid(gridKey)}
                activeMeasurements={totals?.activeMeasurements ?? null}
                gridProps={{
                  ...gridProps,
                  models: view.groupModels[identityKey] ?? defaultGroupModelsFor(facet),
                  onModelsChange: models => setViewState(previous => ({ ...previous, groupModels: { ...previous.groupModels, [identityKey]: models } }))
                }}
              />
            );
          }}
        />
      )}

      {groupMode === 'none' && <FilteredToChip exactMessages={filters.exactMessages} onClear={clearExactMessages} clearDisabledReason={pageLockReason} />}

      {groupMode === 'none' && (
        <ErrorsExplorerGrid
          key={`${readScopeKey}::${FLAT_GRID_KEY}`}
          {...gridProps}
          variant="flat"
          gridKey={FLAT_GRID_KEY}
          ariaLabel={VIEW_ERRORS_TEXT.flatGridLabel}
          models={view.flatModels}
          onModelsChange={models => setViewState(previous => ({ ...previous, flatModels: models }))}
          faultedFieldsFor={row => new Set(row.errorFields)}
          errorLabelFor={row => formatErrorTypeLabel(row.primaryErrorMessage)}
        />
      )}

      <ErrorRowDetailsPanel
        open={sheet !== null}
        row={panelRow}
        errorDetails={details.data}
        status={sheetStatus}
        notice={clearNotice}
        onRetry={() => (sheetGated ? void rowEdit.retryRefresh() : void details.reload())}
        onClose={() => setSheetState(null)}
        onEditRow={canEditRows ? editThisRow : undefined}
        editRowDisabledReason={editRowDisabledReason}
        canOpenRelatedRow={related => related.inErrorSet}
        onOpenRelatedRow={openRelatedRow}
        openRelatedRowDisabledReason={pageLockReason}
        onClearValidationErrors={canEditRows ? handleClearValidationErrors : undefined}
        clearValidationErrorsDisabledReason={pageLockReason ?? (clearBusyOnSheet ? null : pageMutationReason)}
        clearValidationErrorsBusy={clearBusyOnSheet}
        priorCensusNumberFor={priorCensusNumberFor}
      />

      {rowEdit.editFlow.dialogState.open && rowEdit.editFlow.dialogState.plan && (
        <PreviewDialog
          plan={rowEdit.editFlow.dialogState.plan}
          busy={rowEdit.editFlow.dialogState.busy}
          wasRefreshed={rowEdit.editFlow.dialogState.wasRefreshed}
          onConfirm={rowEdit.editFlow.confirmDialog}
          onCancel={rowEdit.editFlow.cancelDialog}
        />
      )}
      {rowEdit.undo && (
        <UndoToast
          editOperationID={rowEdit.undo.editOperationID}
          onUndo={confirmedPlanHash => {
            clearPageAlert();
            return rowEdit.onUndo(confirmedPlanHash);
          }}
          onDismiss={rowEdit.dismissUndo}
          disabledReason={rowEdit.reasons.undo}
        />
      )}
    </Stack>
  );
}
