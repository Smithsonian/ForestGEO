// measurementcommons datagrid
'use client';
import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedFilterModel } from '@/lib/datagrid/useDebouncedFilterModel';
import { useIsMounted } from '@/app/hooks/useismounted';
import { ErrorBoundary } from '@/components/errorboundary';
import { isMuiRowEditCancelled } from '@/lib/muirowedit';
import {
  GridActionsCellItem,
  GridCellParams,
  GridColDef,
  GridEventListener,
  GridFilterModel,
  GridRenderEditCellParams,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridSortModel,
  MuiEvent,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import Box from '@mui/joy/Box';
import {
  Autocomplete,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Input,
  Modal,
  ModalDialog,
  Stack,
  Tooltip,
  Typography
} from '@mui/joy';
import { designTokens } from '@/config/design-tokens';
import { ALWAYS_VISIBLE_COLUMN_MENU_SX, StyledDataGrid } from '@/config/styleddatagrid';
import { buildViewDataColumns, hideEmptyViewDataColumns } from '@/components/viewdata/viewdatacolumns';
import {
  CellItemContainer,
  createDeleteQuery,
  createPostPatchQuery,
  createQFFetchQuery,
  ExtendedGridFilterModel,
  getColumnVisibilityModel,
  getGridID,
  MeasurementsCommonsProps,
  PendingAction,
  VisibleFilter
} from '@/config/datagridhelpers';
import { useForestQuery, queryKey, QueryNamespace, QueryScope, invalidateAfter } from '@/lib/query';
import { QueryError } from '@/lib/query/fetcher';
import { LoadingBar, ContentSkeleton } from '@/components/loading';
import { CMError, CoreMeasurementError, ErrorMap, ValidationPair } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, useOrgCensusListContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useRouter } from 'next/navigation';
import moment from 'moment';
import { formatMeasurementDateForCsv, measurementDateToSaveString } from '@/components/datagrids/measurementdatecolumn';
import { bitToBoolean, HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';
import { useBackgroundValidationState } from '@/config/store/appstore';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { getGridTypeLabel } from '@/config/macros/siteconfigs';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import { InputChip } from '@/components/client/datagridcolumns';
import ValidationOverrideModal from '@/components/client/modals/validationoverridemodal';
import { MeasurementsSummaryResult } from '@/lib/db/definitions/views';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/lib/db/definitions/core';
import ValidationCore from '@/components/client/validationcore';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';
import CustomGridPagination, { DEFAULT_PAGE_SIZE_OPTIONS } from '@/components/datagrids/customgridpagination';
import InfiniteGridScrollBridge from '@/components/datagrids/infinitegridscrollbridge';
import { useInfiniteGridRows } from '@/components/datagrids/hooks/useinfinitegridrows';
import { useReloadOnFinishedUploadJob } from '@/components/datagrids/hooks/usereloadonfinisheduploadjob';
import { useDeleteAfterCancelGuard } from '@/components/datagrids/hooks/usedeleteaftercancelguard';
import { getSelectableOptionsForField, loadSelectableOptions } from '@/components/client/clientmacros';
import ailogger from '@/ailogger';
import { EditOperationCancelledError, useEditPreviewFlow } from '@/app/hooks/useEditPreviewFlow';
import PreviewDialog from '@/components/editplan/previewdialog';
import UndoToast, { UndoRevertOutcome } from '@/components/editplan/undotoast';
import { isFieldEditableByRole, isFieldEditableOnSurface } from '@/config/editplan/fieldpolicy';
import { getMeasurementCsvErrorValue } from './measurementsexportutils';
import {
  areExtendedFilterModelsEqual,
  areGridSortModelsEqual,
  arePaginationModelsEqual,
  MeasurementEditValidationError,
  runMeasurementEditSave,
  createResetValidationErrorsQuery,
  createResetValidationStatesQuery,
  findPlotCensusNumberForCensusID,
  NEW_ROW_ADDED_MESSAGE,
  revertMeasurementEdit,
  ROW_DELETED_MESSAGE,
  resolveEnterNavigationTarget,
  selectMeasurementStateSnackbar,
  shouldRefreshMeasurementsAfterValidationTransition,
  toServerMeasurementFilterModel,
  toUnpaginatedExportQuery
} from './measurementscommonsutils';
import { buildMeasurementStateCountsSql } from '@/config/measurementstatefilters';
import type { GridDensity } from '@mui/x-data-grid';
import MeasurementsExportModal from '@/components/client/modals/measurementsexportmodal';
import ViewDataGridToolbar, { nextViewDataDensity } from '@/components/viewdata/viewdatagridtoolbar';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import ViewDataRowDetails, { type ClearRefreshState, type ViewDataSheetTarget } from '@/components/viewdata/viewdatarowdetails';
import {
  ALL_TREE_STEM_STATES,
  buildRowFieldFaults,
  buildValidationFieldFaults,
  canEditMeasurementRows,
  EMPTY_CELL_DISPLAY,
  getViewDataShowOption,
  parseViewDataStateCounts,
  resolveInitialShowOption,
  toViewDataRowSummary,
  totalActiveMeasurements,
  VIEW_DATA_ACTIONS_COLUMN_WIDTH,
  VIEW_DATA_DEFAULT_HIDDEN_COLUMNS,
  VIEW_DATA_FIELDS,
  VIEW_DATA_ROW_HEIGHT,
  VIEW_DATA_TEXT,
  type ValidationFieldFaultsByMeasurement,
  type ViewDataFieldFaults,
  type ViewDataShowOption,
  type ViewDataStateCounts
} from '@/config/viewdata';

export const FILTER_APPLY_DEBOUNCE_MS = 500;
const SEARCH_WORD_SEPARATOR = ' ';

const NEGATIVE_DBH_INPUT_MESSAGE = 'DBH must be non-negative';

/** View Data sorts from the column menu alone, so a header click no longer toggles MUI's sort. */
const preventHeaderClickSort: GridEventListener<'columnHeaderClick'> = (_params, event) => {
  event.defaultMuiPrevented = true;
};

export function EditMeasurements({ params }: { params: GridRenderEditCellParams }) {
  const initialValue = params.value ? Number(params.value).toFixed(2) : '0.00';
  const [value, setValue] = useState(initialValue);
  const { isMountedRef } = useIsMounted();
  // DBH accepts a typed leading '-' (instead of silently dropping it and reverting to the old
  // value) so the invalid entry is visible, flagged inline, and blocked from saving.
  const isDbhField = params.field === 'measuredDBH';
  const invalidMessage = isDbhField && Number(value) < 0 ? NEGATIVE_DBH_INPUT_MESSAGE : null;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    const pattern = isDbhField ? /^-?\d*\.?\d{0,2}$/ : /^\d*\.?\d{0,2}$/;

    if (pattern.test(newValue) || newValue === '') {
      setValue(newValue);
      // Push an invalid value into the grid edit state immediately so the cell error set by the
      // column preprocessor blocks Save even if the click lands before this input's blur is handled.
      if (isDbhField && Number(newValue) < 0) {
        params.api.setEditCellValue({ id: params.id, field: params.field, value: parseFloat(newValue) });
      }
    }
  };

  const handleBlur = () => {
    if (!isMountedRef.current) return;
    const parsed = parseFloat(value);
    // '', '-' and '.' are not numbers: leave the edit value alone rather than writing NaN.
    if (Number.isNaN(parsed)) return;
    params.api.setEditCellValue({ id: params.id, field: params.field, value: parsed === 0 ? null : parseFloat(parsed.toFixed(2)) });
  };

  return (
    <Input
      aria-label={'edit measurements input'}
      aria-invalid={invalidMessage ? true : undefined}
      title={invalidMessage ?? undefined}
      color={invalidMessage ? 'danger' : undefined}
      error={invalidMessage !== null}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      size="sm"
      sx={{ width: '100%', height: '100%' }}
      type="text"
    />
  );
}

export type ViewDataMeasurementsCommonsProps = MeasurementsCommonsProps & {
  /** Renders above the grid (View Data's header and filter bar) with the grid's page controls. */
  renderAboveGrid?: (controls: ViewDataAboveGridControls) => React.ReactNode;
  /** Shown in the empty-census overlay, e.g. the Add measurements menu. */
  emptyCensusAction?: React.ReactNode;
};

function MeasurementsCommonsInner(props: Readonly<ViewDataMeasurementsCommonsProps>) {
  const {
    gridType,
    gridColumns,
    initialVisibleFilters,
    rows = [],
    setRows,
    rowCount,
    setRowCount,
    rowModesModel,
    setRowModesModel,
    snackbar,
    setSnackbar,
    refresh,
    setRefresh,
    paginationModel,
    setPaginationModel,
    isNewRowAdded,
    setIsNewRowAdded,
    setShouldAddRowAfterFetch,
    handleSelectQuadrat,
    locked = false,
    enablePageJump = false,
    enableInfiniteScroll = false,
    renderAboveGrid,
    emptyCensusAction
  } = props;

  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isValidationOverrideModalOpen, setIsValidationOverrideModalOpen] = useState(false);
  const [isResetValidationModalOpen, setIsResetValidationModalOpen] = useState(false);
  const [isResettingValidations, setIsResettingValidations] = useState(false);
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: unknown) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [isSaveHighlighted, setIsSaveHighlighted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ErrorMap>({});
  const [validationFaults, setValidationFaults] = useState<ValidationFieldFaultsByMeasurement>(new Map());
  const initialShowOption = resolveInitialShowOption(initialVisibleFilters);
  const [showOption, setShowOption] = useState<ViewDataShowOption>(initialShowOption);
  const [searchText, setSearchText] = useState('');
  const [appliedSearchText, setAppliedSearchText] = useState('');
  const [stateCounts, setStateCounts] = useState<ViewDataStateCounts | null>(null);
  const [density, setDensity] = useState<GridDensity>('standard');
  const [isExportOpen, setIsExportOpen] = useState(false);

  const [hidingEmpty, setHidingEmpty] = useState(true);

  const initialFilterModel: ExtendedGridFilterModel = {
    items: [],
    quickFilterValues: [],
    visible: getViewDataShowOption(initialShowOption).visible,
    tss: [...ALL_TREE_STEM_STATES]
  };

  const resetPageOnFilterCommit = useCallback(() => {
    setPaginationModel(prev => (prev.page === 0 ? prev : { ...prev, page: 0 }));
  }, [setPaginationModel]);

  const {
    uiModel: gridFilterModel,
    serverModel: filterModel,
    applyChange: applyFilterChange,
    flush: flushFilterChange
  } = useDebouncedFilterModel<ExtendedGridFilterModel>(
    initialFilterModel,
    FILTER_APPLY_DEBOUNCE_MS,
    areExtendedFilterModelsEqual,
    toServerMeasurementFilterModel,
    resetPageOnFilterCommit
  );
  const [hasLoadedGrid, setHasLoadedGrid] = useState(false);
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);
  const [selectableAttributes, setSelectableAttributes] = useState<string[]>([]);
  const [attributesMap, setAttributesMap] = useState<Map<string, AttributesRDS>>(new Map());
  const [selectableOpts, setSelectableOpts] = useState<{ [optName: string]: string[] }>({
    treeTag: [],
    stemTag: [],
    quadratName: [],
    speciesCode: []
  });
  const [reloadAttrs, setReloadAttrs] = useState(true);

  // const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

  // context pulls and definitions
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const router = useRouter();
  const { setLoading } = useLoading();
  // use the session
  const { data: session } = useSession();
  const { status: backgroundValidationStatus } = useBackgroundValidationState();
  // Track mounted state for safe state updates in deferred callbacks
  const { isMountedRef } = useIsMounted();

  const apiRef = useGridApiRef();
  const { markCancelled, isDeleteGuarded } = useDeleteAfterCancelGuard();
  const activeCensusID = currentCensus?.dateRanges?.[0]?.censusID;

  const [undoToastScope, setUndoToastScope] = useState<{ editOperationID: number; censusID: number } | null>(null);
  const [sheetTarget, setSheetTarget] = useState<ViewDataSheetTarget | null>(null);
  /** Measurements (census + measurement) whose Clear re-read failed; kept here so closing the sheet does not lose it. */
  const [clearRefreshStates, setClearRefreshStates] = useState<ReadonlyMap<string, ClearRefreshState>>(new Map());
  /** The census the page last settled on; a save compares it with the census it started in (A25). */
  const previousCensusIDRef = useRef(activeCensusID);
  // The counts re-read replaces only a counts message: an action's outcome (a delete, an unsaved edit) must stay readable.
  const countsSnackbarRef = useRef<typeof snackbar>(null);
  const orgCensusList = useOrgCensusListContext();
  const priorCensusNumberFor = useCallback((censusID: number) => findPlotCensusNumberForCensusID(orgCensusList, censusID), [orgCensusList]);
  const canEditRows = !locked && canEditMeasurementRows(session?.user?.userStatus);
  const canEditSpeciesCode = canEditRows && isFieldEditableByRole('SpeciesCode', session?.user?.userStatus);
  // MUI renders every cell of a row with the same row object: one fault map per row, not one per cell.
  const faultsForRow = useMemo(() => {
    const faultsByRow = new WeakMap<GridRowModel, ViewDataFieldFaults>();
    return (row: GridRowModel): ViewDataFieldFaults => {
      const cachedFaults = faultsByRow.get(row);
      if (cachedFaults) return cachedFaults;
      const faults = buildRowFieldFaults(toViewDataRowSummary(row), validationFaults.get(Number(row.coreMeasurementID)));
      faultsByRow.set(row, faults);
      return faults;
    };
  }, [validationFaults]);
  const isAnyRowEditing = Object.values(rowModesModel).some(mode => mode?.mode === GridRowModes.Edit);

  useEffect(() => {
    if (!isAnyRowEditing) setIsSaveHighlighted(false);
  }, [isAnyRowEditing]);
  const editPreviewLoadingMessage = 'Saving changes...';

  const editFlow = useEditPreviewFlow({
    schema: currentSite?.schemaName ?? '',
    plotID: currentPlot?.plotID ?? 0,
    censusID: activeCensusID ?? 0,
    dataType: 'measurementssummary',
    onError: error => {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
    },
    onBlockingBusyChange: busy => {
      setLoading(busy, editPreviewLoadingMessage, undefined, 'api');
    }
  });

  const previousValidationStatusRef = useRef(backgroundValidationStatus);

  const refreshMeasurementsSummaryView = useCallback(async () => {
    if (!currentSite?.schemaName) {
      throw new Error('Measurements Summary View Refresh failure');
    }

    const body =
      currentPlot?.plotID != null && activeCensusID != null
        ? JSON.stringify({
            plotID: currentPlot.plotID,
            censusID: activeCensusID
          })
        : undefined;

    const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite.schemaName}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body
    });

    if (!response.ok) {
      throw new Error('Measurements Summary View Refresh failure');
    }
  }, [activeCensusID, currentPlot?.plotID, currentSite?.schemaName]);

  // Defined early so it can be used in other hooks. `strict` rethrows instead
  // of only logging, so the awaited undo refresh chain learns of a failure.
  const refreshCounts = useCallback(
    async (options?: { strict?: boolean }) => {
      if (!currentSite?.schemaName || !currentPlot || !currentCensus) return;
      const requestedCensusID = currentCensus.dateRanges?.[0]?.censusID;

      try {
        const stateCountsProjection = buildMeasurementStateCountsSql(currentSite.schemaName, 'vft');
        const query = `SELECT ${stateCountsProjection},
                            MIN(vft.MeasurementDate) AS FirstMeasurementDate,
                            MAX(vft.MeasurementDate) AS LastMeasurementDate
                     FROM ${currentSite.schemaName}.${gridType} vft
                            JOIN ${currentSite.schemaName}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID AND c.IsActive IS TRUE
                     WHERE vft.PlotID = ${currentPlot.plotID}
                       AND c.PlotID = ${currentPlot.plotID}
                       AND c.PlotCensusNumber = ${currentCensus.plotCensusNumber}`;
        const response = await fetch(`/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(query)
        });
        if (!response.ok) throw new Error('measurementscommons failure. runquery execution for errorRowCount failed.');
        const data = await response.json();
        if (previousCensusIDRef.current !== requestedCensusID) return;
        const counts = parseViewDataStateCounts(data[0]);
        setStateCounts(counts);

        const snackbarByState = selectMeasurementStateSnackbar({
          unresolvedLogged: counts.unresolvedLogged,
          failedNoLog: counts.failedNoLog,
          pending: counts.pending,
          valid: counts.valid
        });
        if (snackbarByState) {
          const previousCountsSnackbar = countsSnackbarRef.current;
          const countsSnackbar = { children: snackbarByState.message, severity: snackbarByState.severity };
          countsSnackbarRef.current = countsSnackbar;
          setSnackbar(shown => (shown === null || shown === previousCountsSnackbar ? countsSnackbar : shown));
        }
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ailogger.error('Error refreshing counts:', errorObj);
        if (options?.strict) throw errorObj;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [currentSite, currentPlot, currentCensus, gridType]
  );

  const fetchUrl = React.useMemo(() => {
    if (!currentSite?.schemaName) return null;
    return createQFFetchQuery(
      currentSite.schemaName,
      gridType,
      paginationModel.page,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      undefined
    );
  }, [currentSite?.schemaName, gridType, paginationModel.page, paginationModel.pageSize, currentPlot?.plotID, currentCensus?.plotCensusNumber]);

  const queryScope: QueryScope = useMemo(
    () => ({
      siteSchema: currentSite?.schemaName,
      plotID: currentPlot?.plotID,
      censusID: currentCensus?.dateRanges?.[0]?.censusID
    }),
    [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]
  );

  const gridQueryKey = fetchUrl
    ? queryKey(`grid:${gridType}` as QueryNamespace, queryScope, {
        page: paginationModel.page,
        pageSize: paginationModel.pageSize,
        filterModel,
        sortModel
      })
    : null;

  const filterBodyFetcher = React.useCallback(
    async (u: string): Promise<{ output: any[]; totalCount: number }> => {
      const res = await fetch(u, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterModel, sortModel })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new QueryError(res.status, body, `POST ${u} ${res.status}`);
      }
      return (await res.json()) as { output: any[]; totalCount: number };
    },
    [filterModel, sortModel]
  );

  const {
    data: gridData,
    isLoading,
    isValidating,
    error: gridError,
    refetch
  } = useForestQuery<{ output: any[]; totalCount: number }>(
    gridQueryKey,
    fetchUrl,
    useMemo(
      () => ({
        fetcher: filterBodyFetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false
      }),
      [filterBodyFetcher]
    )
  );

  useEffect(() => {
    if (gridData) {
      setRows(gridData.output);
      setRowCount(gridData.totalCount);
      setHasLoadedGrid(true);
    }
  }, [gridData, setRows, setRowCount]);

  const infiniteFetcher = useCallback(
    async ({ page: p, pageSize: ps, signal }: { page: number; pageSize: number; signal: AbortSignal }) => {
      if (!currentSite?.schemaName) return { rows: [], totalRows: 0 };
      const url = createQFFetchQuery(currentSite.schemaName, gridType, p, ps, currentPlot?.plotID, currentCensus?.plotCensusNumber, undefined);
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterModel, sortModel }),
        signal
      });
      if (!res.ok) throw new QueryError(res.status, undefined, `POST ${url} ${res.status}`);
      const json = (await res.json()) as { output?: any[]; totalCount?: number };
      return { rows: json.output ?? [], totalRows: json.totalCount ?? 0 };
    },
    [currentSite?.schemaName, gridType, currentPlot?.plotID, currentCensus?.plotCensusNumber, filterModel, sortModel]
  );

  const infiniteResetKey = useMemo(
    () =>
      JSON.stringify({
        filter: filterModel,
        sort: sortModel,
        site: currentSite?.schemaName,
        plot: currentPlot?.plotID,
        census: currentCensus?.plotCensusNumber,
        gridType
      }),
    [filterModel, sortModel, currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, gridType]
  );

  const infinite = useInfiniteGridRows<GridRowModel>({
    fetcher: infiniteFetcher,
    initialPageSize: paginationModel.pageSize,
    resetKey: infiniteResetKey,
    rowIdKey: 'id',
    paginated: { rows: rows as GridRowModel[], totalRows: rowCount, isLoading: isValidating }
  });

  const isInfiniteOn = enableInfiniteScroll && infinite.mode === 'infinite';
  useReloadOnFinishedUploadJob(queryScope, isInfiniteOn, infinite.refresh);
  const gridRows = isInfiniteOn ? infinite.rows : rows;
  const gridRowCount = isInfiniteOn ? infinite.rows.length : rowCount;

  const infiniteScrollDescriptor = useMemo(
    () =>
      enableInfiniteScroll
        ? {
            enabled: isInfiniteOn,
            onToggle: (next: boolean) => infinite.setMode(next ? 'infinite' : 'paginated'),
            loadedCount: infinite.rows.length,
            totalRows: infinite.totalRows,
            isLoadingMore: infinite.isLoadingMore,
            hasMore: infinite.hasMore,
            error: infinite.error,
            softCapExceeded: infinite.softCapExceeded,
            onRetry: infinite.retry
          }
        : undefined,
    [enableInfiniteScroll, isInfiniteOn, infinite]
  );

  const PaginationSlot = useMemo(() => {
    if (!enablePageJump && !enableInfiniteScroll) return undefined;
    const Slot = () => <CustomGridPagination gridType={gridType} infiniteScroll={infiniteScrollDescriptor} />;
    Slot.displayName = 'CustomGridPaginationSlot';
    (Slot as unknown as { infiniteScroll?: typeof infiniteScrollDescriptor }).infiniteScroll = infiniteScrollDescriptor;
    return Slot;
  }, [enablePageJump, enableInfiniteScroll, gridType, infiniteScrollDescriptor]);

  useEffect(() => {
    if (gridError) {
      ailogger.error('Error fetching data:', gridError);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    }
  }, [gridError, setSnackbar]);

  // strict rethrows on failure instead of only logging, so runFetchPaginated's
  // strict call (used only by the awaited undo refresh chain) can propagate it.
  const fetchValidationErrors = useCallback(
    async (options?: { strict?: boolean }) => {
      const requestedCensusID = activeCensusID;
      try {
        const response = await fetch(
          `/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}&plotIDParam=${currentPlot?.plotID ?? ''}&censusPCNParam=${currentCensus?.plotCensusNumber ?? ''}`
        );
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Failed to fetch validation errors (${response.status}): ${errorBody}`);
        }
        const data = await response.json();
        if (previousCensusIDRef.current !== requestedCensusID) return;
        const errorMap: ErrorMap = Array.isArray(data?.failed as CMError[])
          ? (data.failed as CMError[]).reduce<Record<number, CoreMeasurementError>>((acc, error) => {
              if (error.coreMeasurementID) {
                const errorDetailsMap = new Map<number, ValidationPair[]>();

                (error.validationErrorIDs || []).forEach((id, index) => {
                  const descriptions = error.descriptions?.[index]?.split(';') || [];
                  const criteria = error.criteria?.[index]?.split(';') || [];

                  // Ensure descriptions and criteria are paired correctly
                  const validationPairs = descriptions.map((description, i) => ({
                    description,
                    criterion: criteria[i] ?? '' // Default to empty if criteria is missing
                  }));

                  if (!errorDetailsMap.has(id)) {
                    errorDetailsMap.set(id, []);
                  }

                  // Append validation pairs to the corresponding ID
                  errorDetailsMap.get(id)!.push(...validationPairs);
                });

                acc[error.coreMeasurementID] = {
                  coreMeasurementID: error.coreMeasurementID,
                  errors: Array.from(errorDetailsMap.entries()).map(([id, validationPairs]) => ({
                    id,
                    validationPairs
                  }))
                };
              }
              return acc;
            }, {})
          : {};
        setValidationErrors(errorMap);
        setValidationFaults(buildValidationFieldFaults(Array.isArray(data?.failed) ? (data.failed as CMError[]) : []));
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ailogger.error('Error fetching validation errors:', errorObj);
        if (options?.strict) throw errorObj;
      }
    },
    [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, activeCensusID]
  );

  // Promise.all settles as soon as either read rejects, leaving the other
  // still running unawaited. A strict caller must await both before
  // surfacing the first failure, so refetch and fetchValidationErrors both get `strict`.
  const runFetchPaginated = useCallback(
    async (options?: { strict?: boolean }) => {
      if (!options?.strict) {
        await Promise.all([refetch(), fetchValidationErrors(options)]);
        return;
      }
      const results = await Promise.allSettled([refetch(options), fetchValidationErrors(options)]);
      const firstRejection = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (firstRejection) throw firstRejection.reason;
    },
    [refetch, fetchValidationErrors]
  );

  useEffect(() => {
    if (!currentPlot || !currentCensus || paginationModel.page < 0) return;
    fetchValidationErrors().catch(ailogger.error);
  }, [currentPlot, currentCensus, paginationModel.page, sortModel, fetchValidationErrors]);

  // Handle refresh signal - use ref to guard against concurrent/redundant fetches
  const isRefreshing = useRef(false);
  useEffect(() => {
    if (!refresh || isRefreshing.current) return;
    isRefreshing.current = true;

    Promise.all([runFetchPaginated(), refreshCounts()])
      .catch(ailogger.error)
      .finally(() => {
        isRefreshing.current = false;
        setRefresh(false);
      });
    // Only trigger on refresh flag changes — callback identity changes should not re-trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    const previousStatus = previousValidationStatusRef.current;
    if (shouldRefreshMeasurementsAfterValidationTransition(previousStatus, backgroundValidationStatus)) {
      setRefresh(true);
    }
    previousValidationStatusRef.current = backgroundValidationStatus;
  }, [backgroundValidationStatus, setRefresh]);

  useEffect(() => {
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts).catch(ailogger.error);
  }, [currentSite, currentPlot, currentCensus]);

  const loadAttributes = useCallback(async () => {
    if (!currentSite?.schemaName) return;
    try {
      const response = await fetch(`/api/query`, {
        method: 'POST',
        body: JSON.stringify(`SELECT * FROM ${currentSite.schemaName}.attributes;`)
      });
      const data = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes').mapData(await response.json());
      setSelectableAttributes(data.map(i => i.code).filter((code): code is string => code !== undefined));
      const attrMap = new Map<string, AttributesRDS>();
      data.forEach(attr => {
        if (attr.code) attrMap.set(attr.code, attr);
      });
      setAttributesMap(attrMap);
      setReloadAttrs(false);
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(String(e));
      ailogger.error('Failed to load attributes:', errorObj);
    }
  }, [currentSite?.schemaName]);

  useEffect(() => {
    loadAttributes();
  }, [loadAttributes]);

  const handleSortModelChange = useCallback(
    (newModel: GridSortModel) => {
      // Defer state updates to avoid "Cannot update a component while rendering" error
      // This can happen when DataGrid calls onSortModelChange during its render phase
      queueMicrotask(() => {
        // Guard against state updates before mount or after unmount
        if (!isMountedRef.current) return;
        if (areGridSortModelsEqual(sortModel, newModel)) return;
        setSortModel(newModel);
        setPaginationModel(prev => (prev.page === 0 ? prev : { ...prev, page: 0 }));
      });
    },
    [isMountedRef, sortModel, setPaginationModel]
  );

  const fetchRowsForExport = async (visibility: VisibleFilter[], exportType: 'csv' | 'form') => {
    const tempFilter: ExtendedGridFilterModel = {
      ...filterModel,
      visible: visibility
    };
    if (exportType === 'form') {
      const response = await fetch(
        `/api/formdownload/measurements/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}/${JSON.stringify(tempFilter)}`,
        { method: 'GET' }
      );
      const data = await response.json();
      let csvRows =
        getTableHeaders(FormType.measurements)
          .map(row => row.label)
          .join(',') + '\n';
      data.forEach((row: Record<string, unknown>) => {
        const values = [...getTableHeaders(FormType.measurements), { label: 'stemID' }, { label: 'treeID' }]
          .map(rowHeader => rowHeader.label)
          .map(header => row[header])
          .map(value => {
            if (value === undefined || value === null || value === '') {
              return null;
            }
            // Convert to string to safely call .match() on any value type
            const strValue = String(value);
            const match = strValue.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})|(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);

            if (match) {
              let normalizedDate;
              if (match[1]) {
                normalizedDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
              } else {
                normalizedDate = `${match[6]}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
              }

              const parsedDate = moment(normalizedDate, 'YYYY-MM-DD', true);
              if (parsedDate.isValid()) {
                return parsedDate.format('YYYY-MM-DD');
              }
            }
            if (/^0[0-9]+$/.test(strValue)) {
              return strValue; // Return as a string if it has leading zeroes
            }
            // Attempt to parse as a float
            const parsedValue = parseFloat(strValue);
            if (!isNaN(parsedValue)) {
              return parsedValue;
            }
            // Quote strings with special characters
            let quotedValue = strValue.replace(/"/g, '""');
            quotedValue = `"${quotedValue}"`;

            return quotedValue;
          });
        csvRows += values.join(',') + '\n';
      });
      return csvRows;
    } else {
      const tempQuery = createQFFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        paginationModel.page,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber
      );

      const { finishedQuery } = await (
        await fetch(tempQuery, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filterModel: tempFilter })
        })
      ).json();
      const results: MeasurementsSummaryResult[] = await (
        await fetch(`/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toUnpaginatedExportQuery(finishedQuery))
        })
      ).json();
      const headers = Object.keys(results[0] ?? []).filter(header => !['CoreMeasurementID', 'SpeciesID', 'QuadratID', 'PlotID', 'CensusID'].includes(header));
      let csvRows = headers.join(',') + '\n';
      Object.entries(results).forEach(([_, row]) => {
        const rowValues = headers.map(header => {
          const value =
            header === 'Errors' || header === 'errors'
              ? getMeasurementCsvErrorValue(row as Record<string, unknown>, validationErrors)
              : row[header as keyof MeasurementsSummaryResult];
          if (header === 'StemGUID' || header === 'TreeID') return Number(row[header]);
          if (header === 'IsValidated') return bitToBoolean(row[header]);
          if (header === 'MeasurementDate') return formatMeasurementDateForCsv(value);
          if (Object.prototype.toString.call(value) === '[object Object]') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
          if (typeof value === 'string' && value.includes(',')) return `"${value.replace(/"/g, '""')}"`;
          return value ?? 'NULL';
        });
        csvRows += rowValues.join(',') + '\n';
      });
      return csvRows;
    }
  };

  const createNewRowPost = async (gridType: string, schemaName: string | undefined, newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
    const gridID = getGridID(gridType);
    const fetchProcessQuery = createPostPatchQuery(schemaName ?? '', gridType, gridID);
    newRow.measurementDate = measurementDateToSaveString(newRow.measurementDate);
    newRow.userDefinedFields = JSON.stringify(newRow.userDefinedFields);
    try {
      const response = await fetch(fetchProcessQuery, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
      });
      const responseJSON = await response.json();
      if (!response.ok) {
        setSnackbar({ children: `Error: ${responseJSON.message}`, severity: 'error' });
        return Promise.reject(responseJSON.row);
      }
      setSnackbar({ children: NEW_ROW_ADDED_MESSAGE, severity: 'success' });
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
      await Promise.all([refetch(), fetchValidationErrors()]);
      return newRow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSnackbar({ children: `Error: ${message}`, severity: 'error' });
      return Promise.reject(newRow);
    }
  };

  const applyEditViaPreviewFlow = async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
    const coreMeasurementID = Number(newRow.coreMeasurementID ?? oldRow.coreMeasurementID);
    if (!Number.isFinite(coreMeasurementID) || coreMeasurementID <= 0) {
      setSnackbar({ children: 'Error: missing CoreMeasurementID for edit', severity: 'error' });
      return Promise.reject(new Error('missing CoreMeasurementID'));
    }
    const saveCensusID = activeCensusID ?? 0;
    return runMeasurementEditSave({
      coreMeasurementID,
      newRow,
      oldRow,
      beginEdit: editFlow.beginEdit,
      notify: (message, severity) => setSnackbar({ children: message, severity }),
      onEditOperation: editOperationID => setUndoToastScope({ editOperationID, censusID: saveCensusID })
    });
  };

  const openConfirmationDialog = useCallback(
    (actionType: 'save', actionId: GridRowId) => {
      // A cell editor flagged an invalid value (e.g. negative DBH). MUI refuses to leave edit mode
      // while any cell has an error, so don't open a confirmation that can never complete.
      const editingCells = Object.values(apiRef.current?.state?.editRows?.[actionId] ?? {});
      if (editingCells.some(cell => cell?.error)) {
        setSnackbar({ children: 'Error: fix the highlighted invalid value before saving (DBH must be non-negative).', severity: 'error' });
        return;
      }
      setPendingAction({ actionType, actionId });
      const row = rows.find(row => String(row.id) === String(actionId));
      if (row) {
        setIsDialogOpen(true);
        setRowModesModel(oldModel => ({
          ...oldModel,
          [actionId]: { mode: GridRowModes.View }
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

  const handleConfirmAction = async () => {
    setIsDialogOpen(false);
    // A census change can settle this save while its apply is detached, and the new census can open its own
    // Save Changes confirmation before the await returns: clear only the state this confirmation started with.
    const confirmedAction = pendingAction;
    const confirmedSave = promiseArguments;
    if (confirmedAction.actionType === 'save' && confirmedAction.actionId !== null && confirmedSave) {
      await performSaveAction(confirmedAction.actionId);
    }
    setPendingAction(current => (current === confirmedAction ? { actionType: '', actionId: null } : current));
    setPromiseArguments(current => (current === confirmedSave ? null : current));
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  };

  const notifyEditNotSaved = useCallback(
    (row: GridRowModel) => {
      setSnackbar({
        children: VIEW_DATA_TEXT.editNotSavedCensusChanged(String(row.treeTag ?? EMPTY_CELL_DISPLAY), String(row.stemTag ?? EMPTY_CELL_DISPLAY)),
        severity: 'warning'
      });
    },
    [setSnackbar]
  );

  const performSaveAction = async (id: GridRowId) => {
    if (locked || !promiseArguments) return;
    const saveCensusID = activeCensusID;
    // New-row path uses the blocking overlay; the edit path's own Modal busy
    // state would otherwise be blocked from its Apply/Cancel clicks by it.
    const isLegacyCreate = promiseArguments.oldRow.isNew;
    if (isLegacyCreate) {
      setLoading(true, editPreviewLoadingMessage);
    }
    try {
      const updatedRow = isLegacyCreate
        ? await createNewRowPost(gridType, currentSite?.schemaName, promiseArguments.newRow, promiseArguments.oldRow)
        : await applyEditViaPreviewFlow(promiseArguments.newRow, promiseArguments.oldRow);
      promiseArguments.resolve(updatedRow);
    } catch (error: unknown) {
      promiseArguments.reject(error);
      // A census change settles the pending save itself (see the census effect), so this reject is then a no-op.
      const censusChangedDuringSave = previousCensusIDRef.current !== saveCensusID;
      if (error instanceof EditOperationCancelledError) {
        notifyEditNotSaved(promiseArguments.oldRow);
      } else if (censusChangedDuringSave && !isMuiRowEditCancelled(error)) {
        // A detached apply failed after the census changed; the hook calls no onError for it.
        setSnackbar({ children: `Error: ${error instanceof Error ? error.message : String(error)}`, severity: 'error' });
      }
      const reenterEditMode =
        isMuiRowEditCancelled(error) && !promiseArguments.oldRow.isNew && !censusChangedDuringSave && !(error instanceof EditOperationCancelledError);
      if (reenterEditMode) {
        setRowModesModel(oldModel => ({
          ...oldModel,
          [id]: { mode: GridRowModes.Edit }
        }));
      }
    }
    if (previousCensusIDRef.current !== saveCensusID) {
      // No read of the old scope after a census change (View Errors r4 P2-13); its cache entries are still invalidated.
      if (isLegacyCreate) setLoading(false, editPreviewLoadingMessage);
      await invalidateAfter('save-edit-plan', queryScope);
      return;
    }
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);

    if (reloadAttrs) {
      await loadAttributes();
    }

    try {
      await fetchValidationErrors();
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(String(e));
      ailogger.error('Failed to fetch validation errors:', errorObj);
    } finally {
      if (isLegacyCreate) {
        setLoading(false, editPreviewLoadingMessage);
      }
    }
    await invalidateAfter('save-edit-plan', queryScope);
  };

  const performDeleteAction = async (id: GridRowId) => {
    if (locked) return;
    // Guard: ensure site context is available before attempting delete
    if (!currentSite?.schemaName) {
      setSnackbar({ children: 'Error: Site context not available', severity: 'error' });
      return;
    }
    const deletionRow = (gridRows as GridRowModel[]).find(row => String(row.id) === String(id));
    const deletionID = deletionRow?.id;
    if (!deletionID) {
      setSnackbar({ children: 'Error: The row to delete is no longer available', severity: 'error' });
      return;
    }
    const deleteCensusID = activeCensusID;
    const deleteQuery = createDeleteQuery(currentSite.schemaName, gridType, getGridID(gridType), deletionID);
    let response: Response;
    setLoading(true, 'Deleting...');
    try {
      response = await fetch(deleteQuery, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ oldRow: undefined, newRow: deletionRow })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network request failed';
      setSnackbar({ children: `Error: ${message}`, severity: 'error' });
      return;
    } finally {
      setLoading(false);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === HTTPResponses.FOREIGN_KEY_CONFLICT) {
        setSnackbar({
          children: `Error: Cannot delete row due to foreign key constraint in table ${error.referencingTable}`,
          severity: 'error'
        });
      } else {
        setSnackbar({
          children: `Error: ${error.message || 'Deletion failed'}`,
          severity: 'error'
        });
      }
    } else {
      if (handleSelectQuadrat) handleSelectQuadrat(null);
      setSnackbar({
        children: ROW_DELETED_MESSAGE,
        severity: 'success'
      });
      // The rows, counts and errors this closure holds belong to the census the delete started in.
      const hasCensusChangedSinceDelete = () => previousCensusIDRef.current !== deleteCensusID;
      if (!hasCensusChangedSinceDelete()) {
        setRows(rows.filter(row => String(row.id) !== String(id)));
        infinite.removeRow(deletionID);
      }
      setSheetTarget(null);
      try {
        // destructive mutation — global overlay blocks UI for the duration of the API call
        setLoading(true, 'Refreshing Measurements Summary View...');
        await refreshMeasurementsSummaryView();
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(String(e));
        ailogger.error('Error refreshing measurements summary view:', errorObj);
      } finally {
        setLoading(false);
      }
      if (hasCensusChangedSinceDelete()) {
        await invalidateAfter('delete-measurement', queryScope);
        return;
      }
      await refetch();
      if (!hasCensusChangedSinceDelete()) await refreshCounts();
      await invalidateAfter('delete-measurement', queryScope);
    }
  };

  const handleSaveClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      openConfirmationDialog('save', id);
    },
    [locked, openConfirmationDialog]
  );

  useEffect(() => {
    refreshCounts().catch(ailogger.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlot, currentCensus, currentSite]);

  const processRowUpdate = useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>((resolve, reject) => {
        // destructive mutation — global overlay blocks UI for the duration of the API call
        setLoading(true, 'Processing changes...');
        if (newRow.id === '') {
          setLoading(false);
          return reject(new Error('Primary key id cannot be empty!'));
        }

        setPromiseArguments({ resolve, reject, newRow, oldRow });
        setLoading(false);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const handleRowCountChange = (newRowCountChange: number) => {
    setRowCount(newRowCountChange);
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = useCallback(
    (id: GridRowId) => () => {
      if (locked || isAnyRowEditing) return;
      const row = rows.find(r => r.id === id);
      if (row && handleSelectQuadrat) {
        handleSelectQuadrat(row.quadratID);
      }
      setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
    },
    [locked, isAnyRowEditing, rows, handleSelectQuadrat, rowModesModel, setRowModesModel]
  );

  const handleCancelClick = useCallback(
    (id: GridRowId, event?: React.MouseEvent) => {
      if (locked) return;
      markCancelled(id);
      event?.preventDefault();
      const row = rows.find(r => r.id === id);
      if (row?.isNew) {
        setRows(oldRows => oldRows.filter(row => row.id !== id));
        setIsNewRowAdded(false);
        if (rowCount % paginationModel.pageSize === 1 && isNewRowAdded) {
          const newPage = paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
          setPaginationModel({ ...paginationModel, page: newPage });
        }
      } else {
        setRowModesModel(oldModel => ({
          ...oldModel,
          [id]: { mode: GridRowModes.View, ignoreModifications: true }
        }));
      }
      if (handleSelectQuadrat) handleSelectQuadrat(null);
    },
    [
      locked,
      rows,
      rowCount,
      paginationModel,
      isNewRowAdded,
      handleSelectQuadrat,
      setRows,
      setIsNewRowAdded,
      setPaginationModel,
      setRowModesModel,
      markCancelled
    ]
  );

  const getEnhancedCellAction = useCallback(
    (label: string, tooltip: string, icon: React.ReactElement, onClick: React.MouseEventHandler<HTMLButtonElement>, options: { disabled?: boolean } = {}) => (
      <CellItemContainer>
        <Tooltip disableInteractive title={tooltip} arrow placement="top">
          <GridActionsCellItem icon={icon} label={label} aria-label={tooltip} onClick={onClick} disabled={options.disabled} />
        </Tooltip>
      </CellItemContainer>
    ),
    []
  );

  const openDetailsForRow = useCallback(
    (row: GridRowModel) =>
      setSheetTarget({ coreMeasurementID: Number(row.coreMeasurementID), censusID: Number(row.censusID ?? activeCensusID), gridRow: row, lastKnownRow: row }),
    [activeCensusID]
  );

  const getGridActionsColumn = useCallback((): GridColDef => {
    return {
      field: VIEW_DATA_FIELDS.actions,
      type: 'actions',
      headerName: canEditRows ? VIEW_DATA_TEXT.actionsHeader : VIEW_DATA_TEXT.detailsHeader,
      width: canEditRows ? VIEW_DATA_ACTIONS_COLUMN_WIDTH.editor : VIEW_DATA_ACTIONS_COLUMN_WIDTH.readOnly,
      hideable: false,
      cellClassName: 'actions',
      getActions: ({ id, row }) => {
        const details = getEnhancedCellAction(
          'Details',
          VIEW_DATA_TEXT.detailsFor(String(row.treeTag ?? EMPTY_CELL_DISPLAY), String(row.stemTag ?? EMPTY_CELL_DISPLAY)),
          <InfoOutlinedIcon />,
          () => openDetailsForRow(row)
        );
        if (!canEditRows) return [details];

        if (rowModesModel[id]?.mode === GridRowModes.Edit) {
          return [
            getEnhancedCellAction('Save', VIEW_DATA_TEXT.saveRow, <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', VIEW_DATA_TEXT.cancelRow, <CancelIcon />, (e: React.MouseEvent<HTMLButtonElement>) => handleCancelClick(id, e))
          ];
        }

        const edit = getEnhancedCellAction(
          'Edit',
          isAnyRowEditing ? VIEW_DATA_TEXT.editLockTooltip : VIEW_DATA_TEXT.editRow,
          <EditIcon />,
          handleEditClick(id),
          {
            disabled: isAnyRowEditing
          }
        );
        return [edit, details];
      }
    };
  }, [canEditRows, isAnyRowEditing, rowModesModel, getEnhancedCellAction, handleSaveClick, handleCancelClick, handleEditClick, openDetailsForRow]);

  useEffect(() => {
    setSheetTarget(current => {
      if (!current) return current;
      const fresh = (gridRows as GridRowModel[]).find(row => Number(row.coreMeasurementID) === current.coreMeasurementID) ?? null;
      return fresh === current.gridRow ? current : { ...current, gridRow: fresh, lastKnownRow: fresh ?? current.lastKnownRow ?? current.gridRow };
    });
  }, [gridRows]);

  useEffect(() => {
    if (previousCensusIDRef.current === activeCensusID) return;
    previousCensusIDRef.current = activeCensusID;
    setRowModesModel(current => Object.fromEntries(Object.keys(current).map(id => [id, { mode: GridRowModes.View, ignoreModifications: true }])));
    const pendingSave = promiseArguments;
    if (pendingSave) {
      // Settle with the unchanged row: MUI puts a row whose processRowUpdate promise rejects back into edit mode
      // (useGridRowEditing.js:437-445). A no-op when the save has already settled.
      pendingSave.resolve(pendingSave.oldRow);
      // The "Save Changes" confirmation was open: nothing was sent.
      if (isDialogOpen) notifyEditNotSaved(pendingSave.oldRow);
      setIsDialogOpen(false);
      setPendingAction({ actionType: '', actionId: null });
      setPromiseArguments(null);
    }
    // 'cancelled-before-apply': beginEdit rejects with EditOperationCancelledError and performSaveAction reports it.
    // 'detached-apply': the apply cannot be recalled; performSaveAction reports its result when it arrives (r4 P2-13).
    editFlow.cancelPendingOperation();
    setSheetTarget(null);
    applyFilterChange({ items: [] });
    flushFilterChange();
    // Runs only on a census change and reads the save state of that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCensusID]);

  const findGridRow = useCallback(
    (coreMeasurementID: number) => (gridRows as GridRowModel[]).find(row => Number(row.coreMeasurementID) === coreMeasurementID),
    [gridRows]
  );

  const handleEditFromSheet = useCallback(
    (coreMeasurementID: number) => {
      const row = findGridRow(coreMeasurementID);
      setSheetTarget(null);
      if (!row) return;
      handleEditClick(row.id)();
      const rowIndex = apiRef.current?.getRowIndexRelativeToVisibleRows?.(row.id);
      if (typeof rowIndex === 'number') apiRef.current?.scrollToIndexes({ rowIndex });
    },
    [findGridRow, handleEditClick, apiRef]
  );

  const handleDeleteFromSheet = useCallback(
    async (coreMeasurementID: number) => {
      const row = findGridRow(coreMeasurementID);
      // R2-P2-8: the sheet also blocks Delete while it is stale or clearing; the grid adds the edit lock it owns.
      if (!row || isDeleteGuarded(row.id) || isAnyRowEditing) return;
      await performDeleteAction(row.id);
    },
    // performDeleteAction is redefined each render, as today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findGridRow, isDeleteGuarded, isAnyRowEditing, rows, infinite.removeRow]
  );

  const sheetRefreshKey = sheetTarget ? `${sheetTarget.censusID}:${sheetTarget.coreMeasurementID}` : null;
  const setClearRefreshState = (refreshKey: string, state: ClearRefreshState) =>
    setClearRefreshStates(current => {
      if ((current.get(refreshKey) ?? 'current') === state) return current;
      const next = new Map(current);
      if (state === 'current') next.delete(refreshKey);
      else next.set(refreshKey, state);
      return next;
    });

  const handleCleared = useCallback(async () => {
    // The sheet calls the handler of the render it was clicked in, so a Clear that finishes after a census switch lands here with the old census.
    if (previousCensusIDRef.current !== activeCensusID) return;
    // Strict, like the undo refresh chain: every read finishes, then the first failure is reported.
    const reads = await Promise.allSettled([
      runFetchPaginated({ strict: true }),
      refreshCounts({ strict: true }),
      isInfiniteOn ? infinite.refresh({ strict: true }) : Promise.resolve()
    ]);
    if (previousCensusIDRef.current !== activeCensusID) return;
    const failedRead = reads.find((read): read is PromiseRejectedResult => read.status === 'rejected');
    if (failedRead) throw failedRead.reason;
  }, [runFetchPaginated, refreshCounts, isInfiniteOn, infinite, activeCensusID]);

  const attributeTooltips = useMemo(
    () =>
      new Map(
        Array.from(attributesMap.entries()).map(([code, attribute]) => [
          code,
          [attribute.description && `Description: ${attribute.description}`, attribute.status && `Status: ${attribute.status}`].filter(Boolean).join('\n') ||
            code
        ])
      ),
    [attributesMap]
  );

  const dataColumns = useMemo(
    () =>
      applyFilterToColumns(
        gridColumns.map(column => {
          if (column.field === 'attributes') {
            column = {
              ...column,
              renderEditCell: (params: GridRenderEditCellParams) => <InputChip params={params} selectable={selectableAttributes} reload={setReloadAttrs} />
            };
          }
          if (['measuredDBH', 'measuredHOM', 'stemLocalX', 'stemLocalY'].includes(column.field)) {
            column = {
              ...column,
              renderEditCell: (params: GridRenderEditCellParams) => <EditMeasurements params={params} />
            };
          }
          if (['quadratName', 'speciesCode', 'treeTag', 'stemTag'].includes(column.field)) {
            column = {
              ...column,
              renderEditCell: (params: GridRenderEditCellParams) => (
                <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', width: '100%', height: '100%' }}>
                  <Autocomplete
                    sx={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
                    multiple={column.field === 'attributes'}
                    variant={'soft'}
                    autoSelect
                    autoHighlight
                    freeSolo={['treeTag', 'stemTag'].includes(column.field)}
                    clearOnBlur={false}
                    isOptionEqualToValue={(option, value) => option === value}
                    options={[...getSelectableOptionsForField(selectableOpts, column.field)].sort((a, b) => a.localeCompare(b))}
                    value={
                      column.field === 'attributes'
                        ? params.value
                          ? (params.value ?? '').split(';').filter((s: string | any[]) => s.length > 0)
                          : []
                        : (params.value ?? '')
                    }
                    onChange={(_event, value) => {
                      if (value) {
                        params.api.setEditCellValue({
                          id: params.id,
                          field: params.field,
                          value: column.field === 'attributes' && Array.isArray(value) ? value.join(';') : value
                        });
                      }
                    }}
                  />
                </Box>
              )
            };
          }
          return column;
        })
      ),
    [gridColumns, selectableAttributes, selectableOpts]
  );

  const columns = useMemo(
    () => buildViewDataColumns({ dataColumns, actionsColumn: getGridActionsColumn(), canEditRows, canEditSpeciesCode, faultsForRow, attributeTooltips }),
    [dataColumns, getGridActionsColumn, canEditRows, canEditSpeciesCode, faultsForRow, attributeTooltips]
  );

  const filteredColumns = useMemo(
    () =>
      hidingEmpty
        ? hideEmptyViewDataColumns(
            gridRows,
            columns,
            gridFilterModel.items.map(item => item.field)
          )
        : columns,
    [gridRows, columns, hidingEmpty, gridFilterModel.items]
  );

  const editableFields = useMemo(() => new Set(columns.filter(column => column.editable).map(column => column.field)), [columns]);
  const isViewDataCellEditable = useCallback(
    (field: string) => !locked && editableFields.has(field) && isFieldEditableOnSurface('measurementssummary', field),
    [locked, editableFields]
  );

  const initialColumnVisibility = useMemo(
    () => ({ ...getColumnVisibilityModel(gridType), ...Object.fromEntries(VIEW_DATA_DEFAULT_HIDDEN_COLUMNS.map(field => [field, false])) }),
    [gridType]
  );

  const editingRow = (gridRows as GridRowModel[]).find(row => rowModesModel[row.id]?.mode === GridRowModes.Edit);
  const toolbarCaption = editingRow
    ? VIEW_DATA_TEXT.captionEditing(String(editingRow.treeTag ?? EMPTY_CELL_DISPLAY), String(editingRow.stemTag ?? EMPTY_CELL_DISPLAY))
    : canEditRows
      ? VIEW_DATA_TEXT.captionEditor
      : null;
  const sheetFaultedFields = useMemo(() => new Set(sheetTarget?.gridRow ? faultsForRow(sheetTarget.gridRow).keys() : []), [sheetTarget, faultsForRow]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement;

      if (activeElement && activeElement.classList.contains('MuiSelect-root')) {
        if (event.key === 'Enter') {
          event.stopPropagation();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleEnterKeyNavigation = (params: GridCellParams, event: MuiEvent<React.KeyboardEvent>) => {
    if (rowModesModel[params.id]?.mode !== GridRowModes.Edit) return;
    // Stops MUI's own Enter handler from ending the row edit (useGridRowEditing publishes rowEditStop).
    event.defaultMuiPrevented = true;
    if (isSaveHighlighted) {
      setIsSaveHighlighted(false);
      openConfirmationDialog('save', params.id);
      return;
    }
    const visibleFields = apiRef.current?.getVisibleColumns().map(column => column.field) ?? [];
    const target = resolveEnterNavigationTarget(visibleFields, params.field, isViewDataCellEditable);
    if (target.kind === 'highlightSave') {
      setIsSaveHighlighted(true);
      apiRef.current?.setCellFocus(params.id, VIEW_DATA_FIELDS.actions);
      return;
    }
    apiRef.current?.setCellFocus(params.id, target.field);
    apiRef.current?.getCellElement(params.id, target.field)?.querySelector<HTMLElement>('input')?.focus();
  };

  const handleFilterModelChange = useCallback((newFilterModel: GridFilterModel) => applyFilterChange(newFilterModel), [applyFilterChange]);

  const handleShowOptionChange = useCallback(
    (next: ViewDataShowOption) => {
      setShowOption(next);
      applyFilterChange({ visible: getViewDataShowOption(next).visible });
      flushFilterChange();
    },
    [applyFilterChange, flushFilterChange]
  );

  const handleSearchApply = useCallback(() => {
    setAppliedSearchText(searchText);
    applyFilterChange({ quickFilterValues: searchText.split(SEARCH_WORD_SEPARATOR) });
  }, [applyFilterChange, searchText]);

  const handleSearchClear = useCallback(() => {
    setSearchText('');
    setAppliedSearchText('');
    applyFilterChange({ quickFilterValues: [] });
  }, [applyFilterChange]);

  const clearAllFilters = useCallback(() => {
    setShowOption('all');
    setSearchText('');
    setAppliedSearchText('');
    applyFilterChange({ visible: getViewDataShowOption('all').visible, quickFilterValues: [], items: [] });
    flushFilterChange();
  }, [applyFilterChange, flushFilterChange]);

  async function handleCloseModal(closeModal: Dispatch<SetStateAction<boolean>>, shouldRefresh: boolean = false) {
    closeModal(false);
    if (!shouldRefresh || !currentSite?.schemaName) return;

    try {
      // destructive mutation — global overlay blocks UI for the duration of the API call
      setLoading(true, 'Refreshing Measurements Summary View...');
      await refreshMeasurementsSummaryView();
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(String(e));
      ailogger.error('Error refreshing measurements summary view:', errorObj);
    } finally {
      setLoading(false);
    }
    await Promise.all([runFetchPaginated(), refreshCounts()]);
  }

  async function handleResetValidations() {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !activeCensusID) {
      throw new Error('Active site, plot, or census selection is missing.');
    }

    try {
      // destructive mutation — global overlay blocks UI for the duration of the API call
      setLoading(true, 'Resetting validation states...');

      const resolveErrorsRequest = createResetValidationErrorsQuery(currentSite.schemaName, currentPlot.plotID, activeCensusID);
      const resetStateRequest = createResetValidationStatesQuery(currentSite.schemaName, currentPlot.plotID, activeCensusID);

      const clearCMVResponse = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolveErrorsRequest)
      });
      if (!clearCMVResponse.ok) {
        const errorData = await clearCMVResponse.json().catch(() => ({ error: 'Unknown error', details: '' }));
        ailogger.error('Resolve validation errors query failed:', errorData);
        throw new Error(errorData.details || errorData.error || 'Failed to resolve validation errors');
      }
      const response = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetStateRequest)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error', details: '' }));
        ailogger.error('Validation reset query failed:', errorData);
        throw new Error(errorData.details || errorData.error || 'Failed to reset validation states');
      }

      setSnackbar({
        children: 'Validation states reset. Rows are pending validation.',
        severity: 'success'
      });
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ailogger.error('Error in handleResetValidations:', errorObj);
      throw errorObj;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentSite || !currentPlot || !currentCensus) {
      router.push('/dashboard');
    }
  }, [currentSite, currentPlot, currentCensus, router]);

  const aboveGridControls: ViewDataAboveGridControls = {
    stateCounts,
    showOption,
    onShowOptionChange: handleShowOptionChange,
    searchText,
    appliedSearchText,
    onSearchTextChange: setSearchText,
    onSearchApply: handleSearchApply,
    onSearchClear: handleSearchClear,
    onRunValidations: () => setIsValidationModalOpen(true),
    onOverrideValidations: () => setIsValidationOverrideModalOpen(true),
    onResetValidations: () => setIsResetValidationModalOpen(true),
    onOpenExport: () => setIsExportOpen(true)
  };

  const isCensusEmpty = stateCounts !== null && totalActiveMeasurements(stateCounts) === 0;
  const NoRowsOverlaySlot = useMemo(() => {
    const Slot = () => (
      <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ height: '100%', p: 2 }} data-testid="view-data-empty-state">
        <Typography level="body-md">{isCensusEmpty ? VIEW_DATA_TEXT.emptyCensus : VIEW_DATA_TEXT.emptyFiltered}</Typography>
        {isCensusEmpty ? (
          emptyCensusAction
        ) : (
          <Button size="sm" variant="outlined" onClick={clearAllFilters}>
            {VIEW_DATA_TEXT.clearFilters}
          </Button>
        )}
      </Stack>
    );
    Slot.displayName = 'ViewDataNoRowsOverlay';
    return Slot;
  }, [isCensusEmpty, emptyCensusAction, clearAllFilters]);

  const exportCsvHeaders = isExportOpen
    ? gridColumns.filter(column => !Object.keys(apiRef.current?.state?.columns?.columnVisibilityModel ?? {}).includes(column.field)).map(column => column.field)
    : [];
  const exportFormHeaders = getTableHeaders(FormType.measurements).map(header => header.label);

  if (!currentSite || !currentPlot || !currentCensus) {
    return null;
  } else {
    const showInitialGridSkeleton = isLoading && !hasLoadedGrid;
    const showGridLoading = hasLoadedGrid && (isLoading || isValidating);
    return (
      <Box
        sx={{
          width: '100%',
          '& .actions': {
            color: 'text.secondary'
          },
          '& .textPrimary': {
            color: 'text.primary'
          }
        }}
      >
        {renderAboveGrid?.(aboveGridControls)}
        <Box sx={{ width: '100%', flexDirection: 'column', position: 'relative' }}>
          <LoadingBar active={isValidating && hasLoadedGrid} />
          {showInitialGridSkeleton ? (
            <ContentSkeleton kind="grid-rows" count={paginationModel.pageSize} />
          ) : (
            <>
              <StyledDataGrid
                aria-label={getGridTypeLabel(gridType)}
                apiRef={apiRef}
                sx={{ width: '100%', ...ALWAYS_VISIBLE_COLUMN_MENU_SX }}
                density={density}
                rows={gridRows}
                columns={filteredColumns}
                editMode="row"
                rowModesModel={rowModesModel}
                onRowModesModelChange={handleRowModesModelChange}
                onRowEditStop={handleRowEditStop}
                processRowUpdate={async (newRow, oldRow) => {
                  const saveCensusID = activeCensusID;
                  const result = await processRowUpdate(newRow, oldRow);
                  const censusChangedDuringSave = previousCensusIDRef.current !== saveCensusID;
                  if (isInfiniteOn && !censusChangedDuringSave) {
                    infinite.upsertRow(result);
                    // The saved row keeps the Stem status and Validation it was loaded with, and the edit may have changed other rows too.
                    void infinite.refresh();
                  }
                  return result;
                }}
                loading={showGridLoading}
                paginationMode="server"
                sortingMode="server"
                filterMode="server"
                onPaginationModelChange={newPaginationModel => {
                  if (arePaginationModelsEqual(paginationModel, newPaginationModel)) {
                    return;
                  }
                  setPaginationModel(newPaginationModel);
                }}
                onProcessRowUpdateError={(error: Error) => {
                  if (isMuiRowEditCancelled(error)) return;
                  // Already reported inline with the specific field message; the row stays in edit mode.
                  if (error instanceof MeasurementEditValidationError) return;
                  ailogger.error('Row update error:', error);
                  setSnackbar({
                    children: 'Error updating row',
                    severity: 'error'
                  });
                }}
                onCellKeyDown={(params, event) => {
                  if (event.key === 'Enter') handleEnterKeyNavigation(params, event);
                }}
                paginationModel={paginationModel}
                rowCount={gridRowCount}
                onRowCountChange={handleRowCountChange}
                pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
                sortModel={sortModel}
                onSortModelChange={handleSortModelChange}
                onColumnHeaderClick={preventHeaderClickSort}
                filterModel={gridFilterModel}
                onFilterModelChange={handleFilterModelChange}
                ignoreDiacritics
                initialState={{
                  columns: {
                    columnVisibilityModel: initialColumnVisibility
                  }
                }}
                slots={{
                  toolbar: ViewDataGridToolbar,
                  noRowsOverlay: NoRowsOverlaySlot,
                  ...(PaginationSlot ? { pagination: PaginationSlot } : {})
                }}
                slotProps={{
                  toolbar: {
                    viewDataToolbar: {
                      density,
                      onCycleDensity: () => setDensity(current => nextViewDataDensity(current)),
                      hidingEmpty,
                      onToggleHidingEmpty: () => setHidingEmpty(current => !current),
                      caption: toolbarCaption
                    }
                  }
                }}
                showToolbar
                rowHeight={VIEW_DATA_ROW_HEIGHT}
                isCellEditable={params => isViewDataCellEditable(params.field) && (!isAnyRowEditing || rowModesModel[params.id]?.mode === GridRowModes.Edit)}
              />
              <InfiniteGridScrollBridge
                apiRef={apiRef}
                enabled={isInfiniteOn}
                onLoadMore={infinite.loadMore}
                observeKey={`${infinite.rows.length}:${infinite.totalRows}:${infinite.isLoadingMore}`}
              />
            </>
          )}
        </Box>
        {!!snackbar && (
          <Snackbar
            open
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            onClose={handleCloseSnackbar}
            autoHideDuration={6000}
            sx={{ zIndex: designTokens.zIndex.notificationOverDetailsSheet }}
          >
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && (
          <SkipReEnterDataModal gridType={gridType} row={promiseArguments.newRow} handleClose={handleCancelAction} handleSave={handleConfirmAction} />
        )}
        {editFlow.dialogState.open && editFlow.dialogState.plan && (
          <PreviewDialog
            plan={editFlow.dialogState.plan}
            busy={editFlow.dialogState.busy}
            wasRefreshed={editFlow.dialogState.wasRefreshed}
            onConfirm={editFlow.confirmDialog}
            onCancel={editFlow.cancelDialog}
          />
        )}
        {undoToastScope !== null && (
          <UndoToast
            editOperationID={undoToastScope.editOperationID}
            onUndo={(confirmedPlanHash?: string): Promise<UndoRevertOutcome> =>
              revertMeasurementEdit(
                {
                  schema: currentSite?.schemaName ?? '',
                  plotID: currentPlot?.plotID ?? 0,
                  censusID: undoToastScope.censusID,
                  editOperationID: undoToastScope.editOperationID,
                  confirmedPlanHash
                },
                {
                  invalidateQueries: () => invalidateAfter('save-edit-plan', queryScope),
                  refreshPaginated: () => runFetchPaginated({ strict: true }),
                  refreshCounts: () => refreshCounts({ strict: true }),
                  refreshInfinite: isInfiniteOn ? () => infinite.refresh({ strict: true }) : null,
                  notify: ({ message, severity }) => setSnackbar({ children: message, severity }),
                  logError: (message, error) => ailogger.error(message, error)
                }
              )
            }
            onDismiss={() => setUndoToastScope(null)}
          />
        )}
        {isExportOpen && (
          <MeasurementsExportModal
            open
            onClose={() => setIsExportOpen(false)}
            handleExport={fetchRowsForExport}
            initialVisibility={filterModel.visible}
            csvHeaders={exportCsvHeaders}
            formHeaders={exportFormHeaders}
            fileNameParts={{ schemaName: currentSite.schemaName, plotName: currentPlot.plotName, plotCensusNumber: currentCensus.plotCensusNumber }}
          />
        )}
        {/*{isDialogOpen && promiseArguments && !promiseArguments.oldRow.isNew && (*/}
        {/*  <MSVEditingModal*/}
        {/*    gridType={gridType}*/}
        {/*    oldRow={promiseArguments.oldRow}*/}
        {/*    newRow={promiseArguments.newRow}*/}
        {/*    handleClose={handleCancelAction}*/}
        {/*    handleSave={handleConfirmAction}*/}
        {/*  />*/}
        {/*)}*/}
        {sheetTarget && (
          <ViewDataRowDetails
            key={sheetRefreshKey}
            target={sheetTarget}
            schema={currentSite.schemaName ?? ''}
            plotID={currentPlot.plotID ?? 0}
            plotCensusNumber={currentCensus.plotCensusNumber}
            canEditRows={canEditRows}
            isAnyRowEditing={isAnyRowEditing}
            isDeleteGuarded={sheetTarget.gridRow ? isDeleteGuarded(sheetTarget.gridRow.id as GridRowId) : false}
            faultedFields={sheetFaultedFields}
            priorCensusNumberFor={priorCensusNumberFor}
            onClose={() => setSheetTarget(null)}
            onOpenRelatedRow={coreMeasurementID => {
              const relatedRow = findGridRow(coreMeasurementID) ?? null;
              setSheetTarget(current => ({
                coreMeasurementID,
                censusID: current?.censusID ?? Number(activeCensusID),
                gridRow: relatedRow,
                lastKnownRow: relatedRow
              }));
            }}
            onEditRow={handleEditFromSheet}
            onDeleteRow={handleDeleteFromSheet}
            onCleared={handleCleared}
            refreshState={(sheetRefreshKey !== null && clearRefreshStates.get(sheetRefreshKey)) || 'current'}
            onRefreshStateChange={state => sheetRefreshKey !== null && setClearRefreshState(sheetRefreshKey, state)}
            notify={(message, severity) => setSnackbar({ children: message, severity })}
          />
        )}
        {isValidationModalOpen && (
          <Modal open={isValidationModalOpen} onClose={async () => await handleCloseModal(setIsValidationModalOpen, false)}>
            <ModalDialog
              sx={{
                width: '80%',
                borderRadius: 'md',
                p: 2,
                boxShadow: 'lg',
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                alignItems: 'center'
              }}
            >
              <ValidationCore onValidationComplete={() => handleCloseModal(setIsValidationModalOpen, true)} />
            </ModalDialog>
          </Modal>
        )}
        {isValidationOverrideModalOpen && (
          <ValidationOverrideModal
            isValidationOverrideModalOpen={isValidationOverrideModalOpen}
            handleValidationOverrideModalClose={async (overridePerformed: boolean) =>
              await handleCloseModal(setIsValidationOverrideModalOpen, overridePerformed)
            }
          />
        )}
        {isResetValidationModalOpen && (
          <Modal
            open={isResetValidationModalOpen}
            onClose={async () => {
              if (isResettingValidations) return;
              await handleCloseModal(setIsResetValidationModalOpen, false);
            }}
          >
            <ModalDialog role={'alertdialog'}>
              <DialogTitle>Reset Validation States?</DialogTitle>
              <DialogContent>Are you sure you want to clear current validation failures and set all rows in this census back to pending?</DialogContent>
              <DialogActions>
                <Button
                  onClick={async () => {
                    setIsResettingValidations(true);
                    try {
                      await handleResetValidations();
                      await handleCloseModal(setIsResetValidationModalOpen, true);
                    } catch (error: unknown) {
                      const errorObj = error instanceof Error ? error : new Error(String(error));
                      setSnackbar({
                        children: `Error: ${errorObj.message}`,
                        severity: 'error'
                      });
                    } finally {
                      setIsResettingValidations(false);
                    }
                  }}
                  disabled={isResettingValidations}
                  startDecorator={isResettingValidations ? <CircularProgress size="sm" /> : undefined}
                >
                  {isResettingValidations ? 'Resetting...' : 'Yes'}
                </Button>
                <Button disabled={isResettingValidations} onClick={async () => await handleCloseModal(setIsResetValidationModalOpen, false)}>
                  No
                </Button>
              </DialogActions>
            </ModalDialog>
          </Modal>
        )}
      </Box>
    );
  }
}

// Wrap the component with an ErrorBoundary for graceful error handling
export default function MeasurementsCommons(props: Readonly<ViewDataMeasurementsCommonsProps>) {
  return (
    <ErrorBoundary componentName="MeasurementsCommons">
      <MeasurementsCommonsInner {...props} />
    </ErrorBoundary>
  );
}
