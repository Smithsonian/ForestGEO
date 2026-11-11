'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Stack } from '@mui/joy';
import {
  GridRowEditStopReasons,
  GridRowModes,
  useGridApiRef,
  type GridColumnVisibilityModel,
  type GridEventListener,
  type GridFilterModel,
  type GridPaginationModel,
  type GridRowModel,
  type GridRowModesModel,
  type GridSortModel
} from '@mui/x-data-grid';
import { ALWAYS_VISIBLE_COLUMN_MENU_SX, StyledDataGrid } from '@/config/styleddatagrid';
import CustomGridPagination, { type CustomGridPaginationProps, type InfiniteScrollPaginationProps } from '@/components/datagrids/customgridpagination';
import InfiniteGridScrollBridge from '@/components/datagrids/infinitegridscrollbridge';
import { useInfiniteGridRows, type RefreshOptions } from '@/components/datagrids/hooks/useinfinitegridrows';
import { buildErrorsExplorerQueryBody, postErrorsExplorerQuery, useErrorsExplorerRows, type ErrorsExplorerRowsQuery } from '@/app/hooks/useerrorsexplorerrows';
import { ErrorsExplorerReadGatedError } from '@/app/hooks/useerrorsexplorerrequest';
import type { ErrorsExplorerRowEdit } from '@/app/hooks/useerrorsexplorerrowedit';
import { toServerColumnFilters, toServerSortModel } from '@/lib/errorsexplorer/columnquery';
import {
  ERROR_GROUP_GRID_MAX_HEIGHT,
  ERROR_TYPE_GROUP_PAGE_SIZE,
  ERROR_TYPE_GROUP_PAGE_SIZE_OPTIONS,
  ERRORS_FLAT_GRID_HEIGHT,
  ERRORS_FLAT_GRID_PAGE_SIZE,
  ERRORS_FLAT_GRID_PAGE_SIZE_OPTIONS,
  ERRORS_GRID_COLUMN_HEADER_HEIGHT,
  ERRORS_GRID_ROW_HEIGHT,
  VIEW_ERRORS_TEXT,
  type ErrorExplorerFilters,
  type ErrorExplorerRow,
  type ErrorsExplorerReadScope,
  type ErrorTypeIdentity
} from '@/config/errorsexplorer';
import type { OrgCensus } from '@/lib/db/definitions/timekeeping';
import { buildErrorsExplorerColumns, FAULTED_CELL_CLASS, resolvePriorDbhHeader } from './errorsexplorercolumns';

// Wide grids column-virtualize off-screen cells out of the DOM, hiding them from Cypress; e2e-only escape hatch.
const E2E_DISABLE_VIRTUALIZATION = process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production';
const EXPOSE_GRID_API_FOR_TESTS = process.env.NODE_ENV === 'test';
const INFINITE_MODE = 'infinite';
const PAGINATED_MODE = 'paginated';

interface GridPaginationExtras {
  disabled: boolean;
  disabledReason?: string;
  infiniteScroll?: InfiniteScrollPaginationProps;
}

const NO_PAGINATION_EXTRAS: GridPaginationExtras = { disabled: false };
const GridPaginationExtrasContext = createContext<GridPaginationExtras>(NO_PAGINATION_EXTRAS);

// MUI 8.9.2 renders a custom pagination slot with {} props (slotProps.pagination never reaches it), so the lock and the
// infinite toggle arrive through context; the slot's identity is fixed so the footer is never remounted mid-interaction.
function ErrorsGridPagination(slotProps: CustomGridPaginationProps) {
  const extras = useContext(GridPaginationExtrasContext);
  return <CustomGridPagination {...slotProps} {...extras} />;
}

const ERRORS_GRID_SLOTS = { pagination: ErrorsGridPagination };

// A save that empties the last page makes MUI clamp the page once the smaller total arrives, possibly while the lock still
// holds for the slower reads; the disabled footer already stops the user paging, so only this correction is let through.
function isClampToLastPage(next: GridPaginationModel, current: GridPaginationModel, totalRows: number): boolean {
  const currentPageIsPastTheEnd = current.page * current.pageSize >= totalRows;
  return currentPageIsPastTheEnd && next.pageSize === current.pageSize && next.page < current.page;
}

export interface ErrorsExplorerGridHandle {
  refresh: (options?: RefreshOptions) => Promise<void>;
  patchRow: (row: ErrorExplorerRow) => void;
  hasRow: (rowID: number) => boolean;
  startRowEdit: (rowID: number) => void;
}

export interface ErrorsExplorerGridModels {
  sortModel: GridSortModel;
  filterModel: GridFilterModel;
  columnVisibilityModel: GridColumnVisibilityModel;
}

export interface ErrorsExplorerGridProps {
  gridKey: string;
  ariaLabel: string;
  variant: 'group' | 'flat';
  readScope: ErrorsExplorerReadScope | null;
  readScopeKey: string;
  filters: ErrorExplorerFilters;
  errorType?: ErrorTypeIdentity;
  models: ErrorsExplorerGridModels;
  onModelsChange: (models: ErrorsExplorerGridModels) => void;
  canEditRows: boolean;
  canEditSpeciesCode: boolean;
  codeOptions: readonly string[];
  faultedFieldsFor: (row: ErrorExplorerRow) => ReadonlySet<string>;
  errorLabelFor: (row: ErrorExplorerRow) => string;
  censusList: OrgCensus[] | undefined;
  rowEdit: ErrorsExplorerRowEdit;
  onOpenDetails: (gridKey: string, row: ErrorExplorerRow) => void;
  registerGrid: (gridKey: string, handle: ErrorsExplorerGridHandle | null) => void;
  /** totalRows is null until a read has answered, so a caller never mistakes loading or a failed read for an empty result. */
  onRowsChange?: (gridKey: string, rows: ErrorExplorerRow[], totalRows: number | null) => void;
}

export default function ErrorsExplorerGrid(props: ErrorsExplorerGridProps) {
  const { gridKey, ariaLabel, variant, readScope, readScopeKey, filters, errorType, models, onModelsChange, canEditRows, canEditSpeciesCode, codeOptions } =
    props;
  const { faultedFieldsFor, errorLabelFor, censusList, rowEdit, onOpenDetails, registerGrid, onRowsChange } = props;
  const isGroup = variant === 'group';
  const apiRef = useGridApiRef();
  const lockReason = rowEdit.reasons.owningGrid(gridKey);
  const locked = lockReason !== null;

  // A page-filter change resets this grid to page 0 in the same render, so only one request goes out.
  const filtersKey = JSON.stringify(filters);
  const [pageState, setPageState] = useState<{ filtersKey: string; model: GridPaginationModel }>({
    filtersKey,
    model: { page: 0, pageSize: isGroup ? ERROR_TYPE_GROUP_PAGE_SIZE : ERRORS_FLAT_GRID_PAGE_SIZE }
  });
  if (pageState.filtersKey !== filtersKey) setPageState({ filtersKey, model: { ...pageState.model, page: 0 } });
  const paginationModel = pageState.filtersKey === filtersKey ? pageState.model : { ...pageState.model, page: 0 };
  const setPaginationModel = useCallback((model: GridPaginationModel) => setPageState(previous => ({ ...previous, model })), []);

  const sortModel = useMemo(() => toServerSortModel(models.sortModel), [models.sortModel]);
  const columnFilters = useMemo(() => toServerColumnFilters(models.filterModel.items), [models.filterModel]);
  const query = useMemo<ErrorsExplorerRowsQuery>(
    () => ({ filters, errorType, page: paginationModel.page, pageSize: paginationModel.pageSize, sortModel, columnFilters }),
    [filters, errorType, paginationModel.page, paginationModel.pageSize, sortModel, columnFilters]
  );
  // The infinite hook only changes mode through onToggle, so this mirrors it and keeps the page read from running beside the chunk read.
  const [infiniteRequested, setInfiniteRequested] = useState(false);
  const rowsResult = useErrorsExplorerRows({ readScope, readScopeKey, query, enabled: !infiniteRequested, gated: rowEdit.isReadScopeGated });

  // The infinite hook fetches on a mode change, a reset key, load-more, retry and refresh; the gate is read at call time
  // and again after the await, so no entry point reads a stale view and a response that lands gated is dropped (P2-2).
  const gatedRef = useRef(rowEdit.isReadScopeGated);
  gatedRef.current = rowEdit.isReadScopeGated;
  const infiniteResetKey = JSON.stringify({ readScopeKey, filters, errorType, sortModel, columnFilters });
  const infinite = useInfiniteGridRows<GridRowModel>({
    fetcher: async ({ page, pageSize, signal }) => {
      if (!readScope) return { rows: [], totalRows: 0 };
      if (gatedRef.current) throw new ErrorsExplorerReadGatedError();
      const response = await postErrorsExplorerQuery(buildErrorsExplorerQueryBody(readScope, { ...query, page, pageSize }), signal);
      if (gatedRef.current) throw new ErrorsExplorerReadGatedError();
      return { rows: response.rows as GridRowModel[], totalRows: response.totalRows };
    },
    initialPageSize: paginationModel.pageSize,
    resetKey: infiniteResetKey,
    rowIdKey: 'coreMeasurementID',
    paginated: { rows: rowsResult.rows as GridRowModel[], totalRows: rowsResult.totalRows, isLoading: rowsResult.status === 'loading' }
  });
  const isInfiniteOn = !isGroup && infinite.mode === INFINITE_MODE;
  const displayedRows = (isInfiniteOn ? infinite.rows : rowsResult.rows) as ErrorExplorerRow[];

  const wasGatedRef = useRef(rowEdit.isReadScopeGated);
  useEffect(() => {
    const wasGated = wasGatedRef.current;
    wasGatedRef.current = rowEdit.isReadScopeGated;
    if (wasGated && !rowEdit.isReadScopeGated && isInfiniteOn) void infinite.refresh();
  }, [infinite, isInfiniteOn, rowEdit.isReadScopeGated]);

  const [rowModesModel, setRowModesModelState] = useState<GridRowModesModel>({});
  const rowModesModelRef = useRef<GridRowModesModel>({});
  const setRowModesModel = useCallback((model: GridRowModesModel) => {
    rowModesModelRef.current = model;
    setRowModesModelState(model);
  }, []);
  const displayedRowsRef = useRef(displayedRows);
  displayedRowsRef.current = displayedRows;
  const findRow = useCallback((rowID: number) => displayedRowsRef.current.find(row => Number(row.id) === rowID), []);

  // MUI's pending processRowUpdate rejection still reports "back to Edit" after this grid is gone; that must take no lock.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyRowModes = useCallback(
    (nextModel: GridRowModesModel) => {
      if (!isMountedRef.current) return;
      setRowModesModel(rowEdit.handleRowModesModelChange(gridKey, nextModel, findRow));
    },
    [findRow, gridKey, rowEdit, setRowModesModel]
  );

  const startRowEdit = useCallback(
    (rowID: number) => {
      applyRowModes({ ...rowModesModelRef.current, [rowID]: { mode: GridRowModes.Edit } });
      const rowIndex = displayedRowsRef.current.findIndex(row => Number(row.id) === rowID);
      if (rowIndex >= 0) apiRef.current?.scrollToIndexes({ rowIndex });
    },
    [apiRef, applyRowModes]
  );

  useEffect(() => {
    if (locked) apiRef.current?.hideFilterPanel();
  }, [apiRef, locked]);

  const handleRef = useRef<ErrorsExplorerGridHandle | null>(null);
  handleRef.current = {
    refresh: async (options?: RefreshOptions) => {
      await Promise.all([rowsResult.reload(options), isInfiniteOn ? infinite.refresh(options) : Promise.resolve()]);
    },
    patchRow: row => {
      rowsResult.patchRow(row);
      if (isInfiniteOn) infinite.upsertRow(row as GridRowModel);
    },
    hasRow: rowID => displayedRowsRef.current.some(row => Number(row.id) === rowID),
    startRowEdit
  };
  useEffect(() => {
    const stableHandle: ErrorsExplorerGridHandle = {
      refresh: options => handleRef.current?.refresh(options) ?? Promise.resolve(),
      patchRow: row => handleRef.current?.patchRow(row),
      hasRow: rowID => handleRef.current?.hasRow(rowID) ?? false,
      startRowEdit: rowID => handleRef.current?.startRowEdit(rowID)
    };
    registerGrid(gridKey, stableHandle);
    if (EXPOSE_GRID_API_FOR_TESTS) {
      const registry = ((window as unknown as { __errorsGridApi?: Record<string, unknown> }).__errorsGridApi ??= {});
      registry[gridKey] = apiRef.current;
    }
    return () => {
      registerGrid(gridKey, null);
      rowEdit.handleGridUnmount(gridKey);
    };
    // rowEdit's callbacks are stable; registering once per grid key is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey, registerGrid]);

  const answeredTotalRows = isInfiniteOn
    ? infinite.isLoadingMore || infinite.error
      ? null
      : infinite.totalRows
    : rowsResult.status === 'ready'
      ? rowsResult.totalRows
      : null;
  useEffect(() => {
    onRowsChange?.(gridKey, displayedRows, answeredTotalRows);
  }, [answeredTotalRows, displayedRows, gridKey, onRowsChange]);

  const priorDbhHeader = useMemo(() => resolvePriorDbhHeader(displayedRows, censusList), [displayedRows, censusList]);
  const columns = useMemo(
    () =>
      buildErrorsExplorerColumns({
        canEditRows,
        canEditSpeciesCode,
        codeOptions,
        rowModesModel,
        lockedHeaderDescription: lockReason,
        faultedFieldsFor,
        errorLabelFor,
        priorDbhHeader,
        actions: {
          onOpenDetails: row => onOpenDetails(gridKey, row),
          onStartEdit: startRowEdit,
          onSave: rowID => setRowModesModel({ ...rowModesModelRef.current, [rowID]: { mode: GridRowModes.View } }),
          onCancel: rowID => setRowModesModel({ ...rowModesModelRef.current, [rowID]: { mode: GridRowModes.View, ignoreModifications: true } }),
          editDisabledReason: rowID => rowEdit.reasons.editEntry(gridKey, rowID),
          detailsDisabledReason: rowID => rowEdit.reasons.details(gridKey, rowID)
        }
      }),
    [
      canEditRows,
      canEditSpeciesCode,
      codeOptions,
      rowModesModel,
      lockReason,
      faultedFieldsFor,
      errorLabelFor,
      priorDbhHeader,
      onOpenDetails,
      gridKey,
      startRowEdit,
      setRowModesModel,
      rowEdit
    ]
  );

  const processRowUpdate = useMemo(() => rowEdit.processRowUpdate(gridKey), [rowEdit, gridKey]);
  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) event.defaultMuiPrevented = true;
  };

  const handleSortModelChange = (model: GridSortModel) => {
    if (locked) return;
    setPaginationModel({ ...paginationModel, page: 0 });
    onModelsChange({ ...models, sortModel: model });
  };
  const handleFilterModelChange = (model: GridFilterModel) => {
    if (locked) return;
    setPaginationModel({ ...paginationModel, page: 0 });
    onModelsChange({ ...models, filterModel: model });
  };

  const infiniteDescriptor = useMemo(
    () => ({
      enabled: isInfiniteOn,
      onToggle: (next: boolean) => {
        setInfiniteRequested(next);
        infinite.setMode(next ? INFINITE_MODE : PAGINATED_MODE);
      },
      loadedCount: infinite.rows.length,
      totalRows: infinite.totalRows,
      isLoadingMore: infinite.isLoadingMore,
      hasMore: infinite.hasMore,
      error: infinite.error instanceof ErrorsExplorerReadGatedError ? null : infinite.error,
      softCapExceeded: infinite.softCapExceeded,
      onRetry: infinite.retry
    }),
    [infinite, isInfiniteOn]
  );
  const paginationExtras = useMemo<GridPaginationExtras>(
    () => ({ disabled: locked, disabledReason: lockReason ?? undefined, infiniteScroll: isGroup ? undefined : infiniteDescriptor }),
    [infiniteDescriptor, isGroup, lockReason, locked]
  );

  // The banners describe the reader that feeds the grid: the infinite hook while infinite is on, the page read otherwise.
  const infiniteReadError = infinite.error instanceof ErrorsExplorerReadGatedError ? null : infinite.error;
  const hasRows = displayedRows.length > 0;
  const firstLoadFailed = isInfiniteOn ? infiniteReadError !== null && !hasRows : rowsResult.status === 'error' && !hasRows && !rowsResult.isStale;
  const infiniteReadFailedWithRows = infiniteReadError !== null && hasRows;
  const infiniteRowsMayBeOld = rowEdit.isReadScopeGated || infiniteReadFailedWithRows;
  // Gate lifts and request starts both clear the signals above before anything newer has landed, so the warning is
  // latched and ends only when a read lands (successfulReadCount moves) or the list is rebuilt for another scope or mode.
  const infiniteStaleScope = `${isInfiniteOn}:${infiniteResetKey}`;
  const [infiniteStaleLatch, setInfiniteStaleLatch] = useState<{ scope: string; successfulReadCount: number } | null>(null);
  const infiniteStaleLatched =
    infiniteStaleLatch !== null && infiniteStaleLatch.scope === infiniteStaleScope && infiniteStaleLatch.successfulReadCount === infinite.successfulReadCount;
  const scopeAtLastLatchCheckRef = useRef(infiniteStaleScope);
  useEffect(() => {
    // On the first render of a new scope the hook has not yet discarded the previous scope's rows and error, so those are not latched.
    const rowsAreFromThisScope = scopeAtLastLatchCheckRef.current === infiniteStaleScope;
    scopeAtLastLatchCheckRef.current = infiniteStaleScope;
    const mayBeOld = rowEdit.isReadScopeGated || (infiniteReadFailedWithRows && rowsAreFromThisScope);
    if (isInfiniteOn && mayBeOld && !infiniteStaleLatched) {
      setInfiniteStaleLatch({ scope: infiniteStaleScope, successfulReadCount: infinite.successfulReadCount });
    }
  }, [infinite.successfulReadCount, infiniteReadFailedWithRows, infiniteStaleLatched, infiniteStaleScope, isInfiniteOn, rowEdit.isReadScopeGated]);
  const rowsAreStale = isInfiniteOn ? infiniteRowsMayBeOld || infiniteStaleLatched : rowsResult.isStale;
  const retry = () => {
    if (rowEdit.isReadScopeGated) void rowEdit.retryRefresh();
    else if (isInfiniteOn) infinite.retry();
    else void rowsResult.reload();
  };

  return (
    <GridPaginationExtrasContext.Provider value={paginationExtras}>
      <Stack spacing={1} data-testid={`errors-grid-${gridKey}`}>
        {firstLoadFailed && (
          <Alert
            color="danger"
            role="alert"
            endDecorator={
              <Button size="sm" variant="soft" onClick={retry}>
                {VIEW_ERRORS_TEXT.retry}
              </Button>
            }
          >
            {VIEW_ERRORS_TEXT.rowsLoadFailed}
          </Alert>
        )}
        {rowsAreStale && (
          <Alert
            color="warning"
            role="alert"
            endDecorator={
              <Button size="sm" variant="soft" onClick={retry}>
                {VIEW_ERRORS_TEXT.retry}
              </Button>
            }
          >
            {VIEW_ERRORS_TEXT.rowsStale}
          </Alert>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', ...(isGroup ? { maxHeight: ERROR_GROUP_GRID_MAX_HEIGHT } : { height: ERRORS_FLAT_GRID_HEIGHT }) }}>
          <StyledDataGrid
            aria-label={ariaLabel}
            apiRef={apiRef}
            disableVirtualization={E2E_DISABLE_VIRTUALIZATION}
            rows={displayedRows}
            columns={columns}
            loading={isInfiniteOn ? infinite.isLoading : rowsResult.status === 'loading'}
            rowCount={isInfiniteOn ? infinite.rows.length : rowsResult.totalRows}
            paginationMode="server"
            sortingMode="server"
            filterMode="server"
            paginationModel={paginationModel}
            onPaginationModelChange={model => {
              if (!locked || isClampToLastPage(model, paginationModel, rowsResult.totalRows)) setPaginationModel(model);
            }}
            pageSizeOptions={[...(isGroup ? ERROR_TYPE_GROUP_PAGE_SIZE_OPTIONS : ERRORS_FLAT_GRID_PAGE_SIZE_OPTIONS)]}
            sortModel={models.sortModel}
            onSortModelChange={handleSortModelChange}
            filterModel={models.filterModel}
            onFilterModelChange={handleFilterModelChange}
            disableColumnSorting={locked}
            disableColumnFilter={locked}
            columnVisibilityModel={models.columnVisibilityModel}
            onColumnVisibilityModelChange={model => onModelsChange({ ...models, columnVisibilityModel: model })}
            editMode="row"
            rowModesModel={rowModesModel}
            onRowModesModelChange={applyRowModes}
            isCellEditable={params => rowEdit.isCellEditable(gridKey, Number(params.id))}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={rowEdit.handleProcessRowUpdateError}
            onRowEditStop={handleRowEditStop}
            slots={ERRORS_GRID_SLOTS}
            rowHeight={ERRORS_GRID_ROW_HEIGHT}
            columnHeaderHeight={ERRORS_GRID_COLUMN_HEADER_HEIGHT}
            sx={{
              ...ALWAYS_VISIBLE_COLUMN_MENU_SX,
              '& .MuiDataGrid-cell': { alignItems: 'center', py: 0.75, whiteSpace: 'nowrap', overflow: 'hidden' },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700 },
              [`& .${FAULTED_CELL_CLASS}`]: { color: 'var(--joy-palette-warning-plainColor)', fontWeight: 600 },
              '& .MuiDataGrid-row.Mui-selected': {
                outline: '1px solid',
                outlineColor: 'var(--joy-palette-primary-outlinedBorder)',
                backgroundColor: 'rgba(59, 130, 246, 0.08)'
              }
            }}
          />
        </Box>
        {!isGroup && (
          <InfiniteGridScrollBridge
            apiRef={apiRef}
            enabled={isInfiniteOn}
            onLoadMore={infinite.loadMore}
            observeKey={`${infinite.rows.length}:${infinite.totalRows}:${infinite.isLoadingMore}`}
          />
        )}
      </Stack>
    </GridPaginationExtrasContext.Provider>
  );
}
