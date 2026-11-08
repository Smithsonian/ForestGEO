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
  Chip,
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
import { StyledDataGrid } from '@/config/styleddatagrid';
import {
  CellItemContainer,
  createDeleteQuery,
  createPostPatchQuery,
  createQFFetchQuery,
  ExtendedGridFilterModel,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  MeasurementsCommonsProps,
  PendingAction,
  sortRowsByMeasurementDate,
  VisibleFilter
} from '@/config/datagridhelpers';
import { useForestQuery, queryKey, QueryNamespace, QueryScope, invalidateAfter } from '@/lib/query';
import { QueryError } from '@/lib/query/fetcher';
import { LoadingBar, ContentSkeleton } from '@/components/loading';
import { CMError, CoreMeasurementError, ErrorMap, ValidationPair } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, useOrgCensusListContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useRouter } from 'next/navigation';
import moment from 'moment';
import {
  formatMeasurementDateCell,
  formatMeasurementDateForCsv,
  measurementDateToSaveString,
  measurementDateValueGetter,
  measurementDateValueSetter
} from '@/components/datagrids/measurementdatecolumn';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { bitToBoolean, HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';
import { useBackgroundValidationState } from '@/config/store/appstore';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { getGridTypeLabel } from '@/config/macros/siteconfigs';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import { formatHeader, InputChip } from '@/components/client/datagridcolumns';
import ValidationOverrideModal from '@/components/client/modals/validationoverridemodal';
import { MeasurementsSummaryResult } from '@/lib/db/definitions/views';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/lib/db/definitions/core';
import ValidationCore from '@/components/client/validationcore';
import { CallSplit, Forest, Grass } from '@mui/icons-material';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';
import CustomGridPagination, { DEFAULT_PAGE_SIZE_OPTIONS } from '@/components/datagrids/customgridpagination';
import InfiniteGridScrollBridge from '@/components/datagrids/infinitegridscrollbridge';
import { useInfiniteGridRows } from '@/components/datagrids/hooks/useinfinitegridrows';
import { useReloadOnFinishedUploadJob } from '@/components/datagrids/hooks/usereloadonfinisheduploadjob';
import { useDeleteAfterCancelGuard } from '@/components/datagrids/hooks/usedeleteaftercancelguard';
import { getSelectableOptionsForField, loadSelectableOptions } from '@/components/client/clientmacros';
import Avatar from '@mui/joy/Avatar';
import ailogger from '@/ailogger';
import { EditOperationCancelledError, useEditPreviewFlow } from '@/app/hooks/useEditPreviewFlow';
import PreviewDialog from '@/components/editplan/previewdialog';
import UndoToast, { UndoRevertOutcome } from '@/components/editplan/undotoast';
import { isFieldEditableOnSurface } from '@/config/editplan/fieldpolicy';
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
  selectMeasurementStateSnackbar,
  shouldRefreshMeasurementsAfterValidationTransition,
  shouldUseAutoMeasurementRowHeight,
  toServerMeasurementFilterModel
} from './measurementscommonsutils';
import { buildMeasurementStateCountsSql, getMeasurementRowStatus } from '@/config/measurementstatefilters';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { GridDensity } from '@mui/x-data-grid';
import MeasurementsExportModal from '@/components/client/modals/measurementsexportmodal';
import ViewDataGridToolbar, { nextViewDataDensity } from '@/components/viewdata/viewdatagridtoolbar';
import type { ViewDataAboveGridControls } from '@/components/viewdata/viewdatacontrols';
import ViewDataRowDetails, { type ViewDataSheetTarget } from '@/components/viewdata/viewdatarowdetails';
import {
  ALL_TREE_STEM_STATES,
  canEditMeasurementRows,
  EMPTY_CELL_DISPLAY,
  getViewDataShowOption,
  parseViewDataStateCounts,
  resolveInitialShowOption,
  totalActiveMeasurements,
  VIEW_DATA_TEXT,
  type ViewDataShowOption,
  type ViewDataStateCounts
} from '@/config/viewdata';

// Stable reference to prevent infinite resize observer loop in MUI DataGrid
const AUTO_ROW_HEIGHT = () => 'auto' as const;
const ESTIMATED_AUTO_ROW_HEIGHT = () => 112;
const FIREFOX_FIXED_ROW_HEIGHT = 112;
export const FILTER_APPLY_DEBOUNCE_MS = 500;
const SEARCH_WORD_SEPARATOR = ' ';

const NEGATIVE_DBH_INPUT_MESSAGE = 'DBH must be non-negative';
const EMPTY_FAULTED_FIELDS: ReadonlySet<string> = new Set();

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
    addNewRowToGrid,
    gridType,
    gridColumns,
    initialVisibleFilters,
    showToolbarActions = true,
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

  const [_newLastPage, setNewLastPage] = useState<number | null>(null);
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
  const useAutoMeasurementRowHeight = useMemo(() => shouldUseAutoMeasurementRowHeight(typeof navigator === 'undefined' ? undefined : navigator.userAgent), []);

  const [undoToastScope, setUndoToastScope] = useState<{ editOperationID: number; censusID: number } | null>(null);
  const [sheetTarget, setSheetTarget] = useState<ViewDataSheetTarget | null>(null);
  /** The census the page last settled on; a save compares it with the census it started in (A25). */
  const previousCensusIDRef = useRef(activeCensusID);
  // The counts message must not replace this warning: the user would never learn the edit was dropped.
  const editNotSavedSnackbarRef = useRef<typeof snackbar>(null);
  const orgCensusList = useOrgCensusListContext();
  const priorCensusNumberFor = useCallback((censusID: number) => findPlotCensusNumberForCensusID(orgCensusList, censusID), [orgCensusList]);
  const canEditRows = !locked && canEditMeasurementRows(session?.user?.userStatus);
  const isAnyRowEditing = Object.values(rowModesModel).some(mode => mode?.mode === GridRowModes.Edit);
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
        const counts = parseViewDataStateCounts(data[0]);
        setStateCounts(counts);

        const snackbarByState = selectMeasurementStateSnackbar({
          unresolvedLogged: counts.unresolvedLogged,
          failedNoLog: counts.failedNoLog,
          pending: counts.pending,
          valid: counts.valid
        });
        if (snackbarByState) {
          const countsSnackbar = { children: snackbarByState.message, severity: snackbarByState.severity };
          setSnackbar(shown => (shown === editNotSavedSnackbarRef.current ? shown : countsSnackbar));
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

  const handleAddNewRow = useCallback(async () => {
    if (locked) {
      return;
    }
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);

    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
      addNewRowToGrid();
    } else {
      setPaginationModel({ ...paginationModel, page: existingLastPage });
      addNewRowToGrid();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, rowCount, paginationModel, addNewRowToGrid]);

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
      try {
        const response = await fetch(
          `/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}&plotIDParam=${currentPlot?.plotID ?? ''}&censusPCNParam=${currentCensus?.plotCensusNumber ?? ''}`
        );
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Failed to fetch validation errors (${response.status}): ${errorBody}`);
        }
        const data = await response.json();
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
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ailogger.error('Error fetching validation errors:', errorObj);
        if (options?.strict) throw errorObj;
      }
    },
    [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber]
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

  // helper functions for usage:
  const handleSortModelChange = useCallback(
    (newModel: GridSortModel) => {
      // Defer state updates to avoid "Cannot update a component while rendering" error
      // This can happen when DataGrid calls onSortModelChange during its render phase
      queueMicrotask(() => {
        // Guard against state updates before mount or after unmount
        if (!isMountedRef.current) return;
        if (areGridSortModelsEqual(sortModel, newModel)) return;

        setSortModel(newModel);

        if (newModel.length > 0) {
          const { field, sort } = newModel[0];
          if (field === 'measurementDate') {
            const sortedRows = sortRowsByMeasurementDate(rows, sort);
            setRows(sortedRows);
          }
        }
      });
    },
    [rows, isMountedRef, setRows, sortModel]
  );

  const cellHasError = useCallback(
    (colField: string, rowId: GridRowId) => {
      const row = rows.find(row => rowId === row.id);
      if (!row || !row.coreMeasurementID || !validationErrors[row.coreMeasurementID]) {
        return false;
      }
      return validationErrors[Number(row.coreMeasurementID)].errors.find(error => error.validationPairs.find(vp => vp.criterion === colField));
    },
    [rows, validationErrors]
  );

  const rowHasError = useCallback(
    (rowId: GridRowId) => {
      const row = rows.find(row => rowId === row.id);
      if (!row || !row.coreMeasurementID || !validationErrors[row.coreMeasurementID]) {
        return false; // No errors for this row
      }
      return gridColumns.some(column => cellHasError(column.field, rowId));
    },
    [rows, validationErrors, gridColumns, cellHasError]
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

      const results: MeasurementsSummaryResult[] = await (
        await fetch(`/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            (
              await (
                await fetch(tempQuery, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filterModel: tempFilter })
                })
              ).json()
            ).finishedQuery
              .replace(/\bSQL_CALC_FOUND_ROWS\b\s*/i, '')
              .replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, '')
              .trim()
          )
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
      const editNotSavedSnackbar = {
        children: VIEW_DATA_TEXT.editNotSavedCensusChanged(String(row.treeTag ?? EMPTY_CELL_DISPLAY), String(row.stemTag ?? EMPTY_CELL_DISPLAY)),
        severity: 'warning' as const
      };
      editNotSavedSnackbarRef.current = editNotSavedSnackbar;
      setSnackbar(editNotSavedSnackbar);
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
    const deletionRow = rows.find(row => String(row.id) === String(id));
    const deletionID = deletionRow?.id;
    if (!deletionID) {
      setSnackbar({ children: 'Error: The row to delete is no longer available', severity: 'error' });
      return;
    }
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
      const error = await response.json();
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
      setRows(rows.filter(row => String(row.id) !== String(id)));
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
      await refetch();
      await refreshCounts();
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
      if (locked) return;
      const row = rows.find(r => r.id === id);
      if (row && handleSelectQuadrat) {
        handleSelectQuadrat(row.quadratID);
      }
      setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
    },
    [locked, rows, handleSelectQuadrat, rowModesModel, setRowModesModel]
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
    (
      label: string,
      tooltip: string,
      icon: React.ReactElement,
      onClick: React.MouseEventHandler<HTMLButtonElement>,
      options: { disabled?: boolean; pressed?: boolean } = {}
    ) => (
      <CellItemContainer>
        <Tooltip disableInteractive title={tooltip} arrow placement="top">
          <GridActionsCellItem icon={icon} label={label} aria-label={tooltip} aria-pressed={options.pressed} onClick={onClick} disabled={options.disabled} />
        </Tooltip>
      </CellItemContainer>
    ),
    []
  );

  const openDetailsForRow = useCallback(
    (row: GridRowModel) => setSheetTarget({ coreMeasurementID: Number(row.coreMeasurementID), censusID: Number(row.censusID ?? activeCensusID), gridRow: row }),
    [activeCensusID]
  );

  const getGridActionsColumn = useCallback((): GridColDef => {
    return {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({ id, row }) => {
        const isInEditMode = rowModesModel[id]?.mode === 'edit';

        if (isInEditMode) {
          return [
            getEnhancedCellAction('Save', VIEW_DATA_TEXT.saveRow, <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', VIEW_DATA_TEXT.cancelRow, <CancelIcon />, (e: React.MouseEvent<HTMLButtonElement>) => handleCancelClick(id, e))
          ];
        }

        return [
          getEnhancedCellAction('Edit', VIEW_DATA_TEXT.editRow, <EditIcon />, handleEditClick(id)),
          getEnhancedCellAction(
            'Details',
            VIEW_DATA_TEXT.detailsFor(String(row.treeTag ?? EMPTY_CELL_DISPLAY), String(row.stemTag ?? EMPTY_CELL_DISPLAY)),
            <InfoOutlinedIcon />,
            () => openDetailsForRow(row),
            { pressed: sheetTarget?.coreMeasurementID === Number(row.coreMeasurementID) }
          )
        ];
      }
    };
  }, [rowModesModel, getEnhancedCellAction, handleSaveClick, handleCancelClick, handleEditClick, openDetailsForRow, sheetTarget]);

  useEffect(() => {
    setSheetTarget(current => {
      if (!current) return current;
      const fresh = (gridRows as GridRowModel[]).find(row => Number(row.coreMeasurementID) === current.coreMeasurementID) ?? null;
      return fresh === current.gridRow ? current : { ...current, gridRow: fresh };
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
    [findGridRow, isDeleteGuarded, isAnyRowEditing, rows]
  );

  const handleCleared = useCallback(async () => {
    // Strict, like the undo refresh chain: every read finishes, then the first failure is reported.
    const reads = await Promise.allSettled([
      runFetchPaginated({ strict: true }),
      refreshCounts({ strict: true }),
      isInfiniteOn ? infinite.refresh({ strict: true }) : Promise.resolve()
    ]);
    const failedRead = reads.find((read): read is PromiseRejectedResult => read.status === 'rejected');
    if (failedRead) throw failedRead.reason;
  }, [runFetchPaginated, refreshCounts, isInfiniteOn, infinite]);

  const validationStatusColumn: GridColDef = useMemo(
    () => ({
      field: 'isValidated',
      headerName: '',
      headerAlign: 'center',
      renderHeader: () => formatHeader('Stem', 'States'),
      align: 'center',
      width: 80,
      filterable: false,
      renderCell: (params: GridCellParams) => {
        let validationIcon, treeState;
        if (validationErrors[Number(params.row.coreMeasurementID)]) {
          validationIcon = (
            <Tooltip title="Validation errors" size="md">
              <ErrorIcon color="error" />
            </Tooltip>
          );
        } else if (getMeasurementRowStatus(params.row) === 'ingestion-unresolved') {
          // StemGUID NULL = ingestion failure. Takes precedence over IsValidated so a stale
          // IsValidated = 1 (e.g. from an earlier override) can never render as passed.
          validationIcon = (
            <Tooltip title="Ingestion failed - unresolved" size="md">
              <WarningAmberIcon color="warning" />
            </Tooltip>
          );
        } else if (params.row.isValidated === null) {
          validationIcon = (
            <Tooltip title="Pending Validation" size="md">
              <HourglassEmptyIcon color="primary" />
            </Tooltip>
          );
        } else if (params.row.isValidated) {
          validationIcon = (
            <Tooltip title="Passed Validation" size="md">
              <CheckIcon color="success" />
            </Tooltip>
          );
        }
        switch (params.row.userDefinedFields) {
          case 'new recruit':
            treeState = (
              <Tooltip title={'New Recruit'} arrow>
                <Avatar size="sm" variant="soft" color="primary" alt={'new recruit avatar'}>
                  <Grass />
                </Avatar>
              </Tooltip>
            );
            break;
          case 'multi stem':
            treeState = (
              <Tooltip title={'Multi Stem'} arrow>
                <Avatar size="sm" variant="soft" color="warning" alt={'multi stem avatar'}>
                  <CallSplit />
                </Avatar>
              </Tooltip>
            );
            break;
          case 'old tree':
            treeState = (
              <Tooltip title={'Old Tree'} arrow>
                <Avatar size={'sm'} variant={'soft'} color={'neutral'} alt={'old tree avatar'}>
                  <Forest />
                </Avatar>
              </Tooltip>
            );
            break;
        }
        return (
          <Stack direction="row" spacing={1} alignItems="center">
            {validationIcon}
            {treeState}
          </Stack>
        );
      }
    }),
    [validationErrors]
  );

  const measurementDateColumn: GridColDef = useMemo(
    () => ({
      field: 'measurementDate',
      headerName: 'Date',
      headerClassName: 'header',
      headerAlign: 'center',
      flex: 0.7,
      sortable: true,
      editable: true,
      type: 'date',
      renderHeader: () => (
        <Box flexDirection={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
          <Typography level="title-lg">Date</Typography>
          <Typography level="body-xs">YYYY-MM-DD</Typography>
        </Box>
      ),
      // Rows carry the database DATE (UTC-midnight Date / ISO string); the editor works on a
      // local-midnight picker Date. The getter/setter pair is the only crossing, so the picked
      // day is the day shown, diffed, previewed and saved in every browser zone.
      valueGetter: value => measurementDateValueGetter(value),
      valueSetter: (value, row) => measurementDateValueSetter(value, row),
      valueFormatter: value => formatMeasurementDateCell(value)
    }),
    []
  );

  const getCellErrorMessages = useCallback(
    (colField: string, coreMeasurementID: number) => {
      const error = validationErrors[coreMeasurementID].errors;
      if (!error || !Array.isArray(error)) {
        return '';
      }
      return error.flatMap(errorDetail => errorDetail.validationPairs).find(vp => vp.criterion === colField)?.description || null;
    },
    [validationErrors]
  );

  const columns = useMemo(() => {
    const commonColumns = gridColumns.map(column => {
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
      return {
        ...column,
        renderCell: (params: GridCellParams) => {
          const value = typeof params.value === 'string' ? params.value : (params.value?.toString() ?? '');
          const formattedValue = !isNaN(Number(value)) && value.includes('.') && value.split('.')[1].length > 2 ? Number(value).toFixed(2) : value;
          const rowError = rowHasError(params.id);
          const cellError = cellHasError(column.field, params.id) ? getCellErrorMessages(column.field, Number(params.row.coreMeasurementID)) : '';

          const isMeasurementField =
            column.field === 'measuredDBH' || column.field === 'measuredHOM' || column.field.includes('X') || column.field.includes('Y');
          const isAttributeField = column.field === 'attributes';
          const attributeValues = column.field === 'attributes' && typeof params.value === 'string' ? params.value.replace(/\s+/g, '').split(';') : [];

          function renderMeasurementDetails() {
            return (
              <Typography level="body-sm">{isMeasurementField && params.row[column.field] ? Number(params.row[column.field]).toFixed(2) : 'null'}</Typography>
            );
          }

          function renderAttributeDetails() {
            return attributeValues.map((value: string, index: number) => {
              const attributeDetails = attributesMap.get(value);
              const tooltipContent = attributeDetails
                ? [
                    attributeDetails.description && `Description: ${attributeDetails.description}`,
                    attributeDetails.status && `Status: ${attributeDetails.status}`
                  ]
                    .filter(Boolean)
                    .join('\n') || value
                : value;

              return (
                <Tooltip key={index} title={tooltipContent} placement="top" variant="soft" size="sm">
                  <Chip size={'sm'}>{value}</Chip>
                </Tooltip>
              );
            });
          }

          return (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                marginY: 1.5,
                width: '100%',
                bgcolor: rowError ? 'warning.main' : undefined
              }}
            >
              {isMeasurementField ? (
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>{renderMeasurementDetails()}</Box>
              ) : isAttributeField ? (
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center' }}>{renderAttributeDetails()}</Box>
              ) : (
                <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{formattedValue}</Typography>
              )}
              {cellError !== '' && (
                <Typography
                  color="danger"
                  variant="solid"
                  sx={{
                    fontSize: '0.75rem',
                    mt: 1,
                    whiteSpace: 'normal',
                    lineHeight: 'normal'
                  }}
                >
                  {cellError}
                </Typography>
              )}
            </Box>
          );
        }
      };
    });
    if (locked || (session?.user.userStatus !== 'global' && session?.user.userStatus !== 'db admin')) {
      // permissions locking measurements view actions
      return [validationStatusColumn, measurementDateColumn, ...applyFilterToColumns(commonColumns)];
    }
    return [validationStatusColumn, measurementDateColumn, ...applyFilterToColumns(commonColumns), getGridActionsColumn()];
  }, [
    gridColumns,
    validationStatusColumn,
    measurementDateColumn,
    locked,
    selectableAttributes,
    selectableOpts,
    cellHasError,
    getCellErrorMessages,
    rowHasError,
    getGridActionsColumn,
    session?.user.userStatus,
    attributesMap
  ]);

  const filteredColumns = useMemo(() => {
    if (hidingEmpty) return filterColumns(rows, columns);
    return columns;
  }, [rows, columns, hidingEmpty]);

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

  const handleEnterKeyNavigation = async (params: GridCellParams, event: React.KeyboardEvent) => {
    event.defaultPrevented = true;
    const columnIndex = filteredColumns.findIndex(col => col.field === params.field);
    const isLastColumn = columnIndex === filteredColumns.length - 2;
    const currentColumn = filteredColumns[columnIndex];

    if (isSaveHighlighted) {
      openConfirmationDialog('save', params.id);
      setIsSaveHighlighted(false);
    } else if (currentColumn.type === 'singleSelect') {
      const cell = apiRef?.current?.getCellElement(params.id, params.field);
      if (cell) {
        const select = cell.querySelector('select');
        if (select) {
          select.focus();
        }
      }
    } else if (isLastColumn) {
      setIsSaveHighlighted(true);
      apiRef?.current?.setCellFocus(params.id, 'actions');
    } else {
      apiRef?.current?.setCellFocus(params.id, filteredColumns[columnIndex + 1].field);
    }
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
                sx={{ width: '100%' }}
                density={density}
                rows={gridRows}
                columns={filteredColumns}
                editMode="row"
                rowModesModel={rowModesModel}
                disableColumnSelector
                onRowModesModelChange={handleRowModesModelChange}
                onRowEditStop={handleRowEditStop}
                processRowUpdate={async (newRow, oldRow) => {
                  const result = await processRowUpdate(newRow, oldRow);
                  if (isInfiniteOn) infinite.upsertRow(result);
                  return result;
                }}
                loading={showGridLoading}
                paginationMode="server"
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
                  if (event.key === 'Enter') {
                    handleEnterKeyNavigation(params, event).then(() => {});
                  }
                }}
                paginationModel={paginationModel}
                rowCount={gridRowCount}
                onRowCountChange={handleRowCountChange}
                pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
                sortModel={sortModel}
                onSortModelChange={handleSortModelChange}
                filterModel={gridFilterModel}
                onFilterModelChange={handleFilterModelChange}
                ignoreDiacritics
                initialState={{
                  columns: {
                    columnVisibilityModel: getColumnVisibilityModel(gridType)
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
                      caption: !locked && canEditMeasurementRows(session?.user?.userStatus) ? VIEW_DATA_TEXT.captionEditor : null
                    }
                  }
                }}
                showToolbar
                getEstimatedRowHeight={useAutoMeasurementRowHeight ? ESTIMATED_AUTO_ROW_HEIGHT : undefined}
                getRowHeight={useAutoMeasurementRowHeight ? AUTO_ROW_HEIGHT : undefined}
                rowHeight={useAutoMeasurementRowHeight ? undefined : FIREFOX_FIXED_ROW_HEIGHT}
                isCellEditable={params => {
                  if (locked) return false;
                  // Server allowlist is authoritative; keeps the grid in lockstep
                  // with the server's rejectDisallowedFields check.
                  return isFieldEditableOnSurface('measurementssummary', params.field);
                }}
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
          <Snackbar open anchorOrigin={{ vertical: 'top', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
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
            target={sheetTarget}
            schema={currentSite.schemaName ?? ''}
            plotID={currentPlot.plotID ?? 0}
            plotCensusNumber={currentCensus.plotCensusNumber}
            canEditRows={canEditRows}
            isAnyRowEditing={isAnyRowEditing}
            isDeleteGuarded={sheetTarget.gridRow ? isDeleteGuarded(sheetTarget.gridRow.id as GridRowId) : false}
            faultedFields={EMPTY_FAULTED_FIELDS}
            priorCensusNumberFor={priorCensusNumberFor}
            onClose={() => setSheetTarget(null)}
            onOpenRelatedRow={coreMeasurementID =>
              setSheetTarget(current => ({
                coreMeasurementID,
                censusID: current?.censusID ?? Number(activeCensusID),
                gridRow: findGridRow(coreMeasurementID) ?? null
              }))
            }
            onEditRow={handleEditFromSheet}
            onDeleteRow={handleDeleteFromSheet}
            onCleared={handleCleared}
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
