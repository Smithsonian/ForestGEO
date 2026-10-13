'use client';

import { ErrorBoundary } from '@/components/errorboundary';
import {
  CellItemContainer,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  createQFFetchQuery,
  EditToolbarCustomProps,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  IsolatedDataGridCommonProps,
  PendingAction
} from '@/config/datagridhelpers';
import {
  GridActionsCellItem,
  GridColDef,
  GridColumnResizeParams,
  GridColumnVisibilityModel,
  GridEditInputCell,
  GridEventListener,
  GridFilterModel,
  GridPaginationModel,
  GridRenderEditCellParams,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarProps,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertProps, Snackbar } from '@mui/material';
import React, { ForwardedRef, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useSession } from 'next-auth/react';
import { HTTPResponses, UnifiedValidityFlags } from '@/config/macros';
import { Tooltip } from '@mui/joy';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { redirect } from 'next/navigation';
import Box from '@mui/joy/Box';
import { StyledDataGrid } from '@/config/styleddatagrid';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';
import { randomId } from '@mui/x-data-grid-generator';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { getGridTypeLabel } from '@/config/macros/siteconfigs';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import moment from 'moment/moment';
import { EditToolbar } from '@/components/client/datagridelements';
import ResetViewModal from '@/components/client/modals/resetviewmodal';
import ailogger from '@/ailogger';
import { useForestQuery, queryKey, QueryNamespace, QueryScope, defaultFetcher, QueryError, invalidateAfter, MutationKind } from '@/lib/query';
import { LoadingBar, ContentSkeleton } from '@/components/loading';
import { areGridFilterModelsEqual, hasServerFilter, toServerFilterModel } from '@/lib/datagrid/filterModel';
import { useDebouncedFilterModel } from '@/lib/datagrid/useDebouncedFilterModel';
import { useInfiniteGridRows } from '@/components/datagrids/hooks/useinfinitegridrows';
import CustomGridPagination, { DEFAULT_PAGE_SIZE_OPTIONS, getPersistedGridPageSize } from '@/components/datagrids/customgridpagination';
import InfiniteGridScrollBridge from '@/components/datagrids/infinitegridscrollbridge';
import { RowSaveFinalizationError } from '@/components/datagrids/rowsaveerror';

const sanitizeCsvValue = (value: unknown, options?: { isDate?: boolean }) => {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return value;
  }
  let strValue = String(value);
  if (options?.isDate) {
    const parsedDate = moment(strValue);
    if (parsedDate.isValid()) {
      strValue = parsedDate.format('YYYY-MM-DD');
    }
  }
  const needsFormulaEscape =
    strValue.startsWith('=') || strValue.startsWith('+') || strValue.startsWith('-') || strValue.startsWith('@') || strValue.startsWith('\t');
  const safeValue = needsFormulaEscape ? `'${strValue}` : strValue;
  if (safeValue.includes(',') || safeValue.includes('"') || safeValue.includes('\n')) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
};

function describeFixedDataRow(row: GridRowModel | null): string {
  if (!row) return 'this row';
  const labelKeys = [
    'siteName',
    'plotName',
    'quadratName',
    'speciesName',
    'personName',
    'attributeName',
    'name',
    'code',
    'SiteName',
    'PlotName',
    'Name',
    'Code'
  ];
  const label = labelKeys.map(key => row[key]).find(value => value !== undefined && value !== null && String(value).trim() !== '');
  return label === undefined ? 'this row' : `“${String(label)}”`;
}

type PendingSave = {
  resolve: (value: GridRowModel) => void;
  reject: (reason?: unknown) => void;
  newRow: GridRowModel;
  oldRow: GridRowModel;
  settled?: boolean;
  promise?: Promise<GridRowModel>;
};

type PersistedGridRow = GridRowModel & { creationNeedsRefresh?: boolean };

// `changed` is undefined when the persistence path cannot report whether the server
// made a change (an endpoint that omits the flag, e.g. /api/administrative/fetch).
// An editFlowOverride reports `changed` explicitly (see EditFlowPersistResult).
// `infoMessage` carries override-supplied context (e.g. a rounded-no-op explanation)
// through to describeSaveOutcome.
type PersistResult = { row: GridRowModel; changed?: boolean; infoMessage?: string };

type SaveOutcome = {
  row: GridRowModel;
  changed?: boolean;
  partialError?: Error;
  followUpError?: Error;
  infoMessage?: string;
};

function isExplicitNewRow(row: GridRowModel | null | undefined): boolean {
  return row?.isNew === true;
}

function rowKey(id: GridRowId | null | undefined): string {
  return id === null || id === undefined ? '' : String(id);
}

function assertStableExistingRowIdentity(newRow: GridRowModel, oldRow: GridRowModel): void {
  if (isExplicitNewRow(oldRow)) return;
  if (oldRow.id === null || oldRow.id === undefined || oldRow.id === '') {
    throw new Error('Cannot save this existing row because its original ID is missing. Refresh and retry.');
  }
  if (newRow.id === null || newRow.id === undefined || newRow.id === '') {
    throw new Error(`Cannot save row ${String(oldRow.id)} because its edited ID is missing. Refresh and retry.`);
  }
  if (String(newRow.id) !== String(oldRow.id)) {
    throw new Error(`Cannot save row ${String(oldRow.id)} because its ID changed to ${String(newRow.id)}. Refresh and retry.`);
  }
}

// A response body is a single-use stream: json() consumes it even when parsing throws,
// so a text() retry afterwards fails with "body used already" and the server's message
// is lost — exactly the non-JSON error bodies (App Service HTML 502, text/plain 500)
// this helper exists to surface. Read the body once, then decide how to interpret it.
async function readResponsePayload(response: Response): Promise<unknown> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return null;
  }
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function responseErrorMessage(payload: unknown, response: Response): string {
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error.trim();
  }
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  const statusText = typeof response.statusText === 'string' ? response.statusText.trim() : '';
  return `HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`;
}

// An auto-increment identifier of 0 means the insert produced no usable key, so it must
// not be stamped onto the row as if it addressed a real record.
function normalizeCreatedID(value: unknown): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export type IsolatedDataGridCommonsHandle = {
  updateRow: (newRow: GridRowModel, oldRow: GridRowModel) => Promise<GridRowModel>;
  fetchPaginatedData: () => Promise<void>;
  showSnackbar: (message: string, severity: 'success' | 'error') => void;
};

// Wide grids (the 53-column viewfulltable archive) column-virtualize off-screen cells
// out of the DOM, so Cypress assertions against unscrolled columns can never observe
// them. Rendering the full column set under the e2e harness (per MUI's own testing
// guidance) keeps assertions deterministic; production behavior is unchanged, and the
// build guard refuses production builds with this flag set.
const E2E_DISABLE_VIRTUALIZATION = process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production';

// The Save icon (handleSaveClick, below) reads `getRowWithUpdatedValues` synchronously
// on click. MUI's own flush of a keystroke into its editing state is a PRIVATE api
// (`runPendingEditCellValueMutation`, registered with 'private' visibility and not
// exposed by useGridApiRef()) that only otherwise runs on Enter/blur/stopRowEditMode - paths this
// grid deliberately suppresses (see handleCellKeyDown/handleRowEditStop) so a fast
// Save click can land inside GridEditInputCell's 200ms debounce window and read the
// pre-keystroke value. Passing debounceMs=0 makes MUI write the edited value into its
// editing state on every keystroke instead of waiting out a timer, so the synchronous
// read is always current.
const EDIT_CELL_DEBOUNCE_MS = 0;

// Only string/number columns default to GridEditInputCell (gridStringColDef.js /
// gridNumericColDef.js); date/dateTime/singleSelect/boolean/actions columns render a
// different edit cell and must be left untouched. A column with a custom
// renderEditCell already controls its own commit behavior and is skipped too.
function withImmediateEditCellCommit(columns: GridColDef[]): GridColDef[] {
  return columns.map(column => {
    const usesDefaultEditInputCell =
      column.editable && !column.renderEditCell && (column.type === undefined || column.type === 'string' || column.type === 'number');
    if (!usesDefaultEditInputCell) return column;
    return {
      ...column,
      renderEditCell: (params: GridRenderEditCellParams) => <GridEditInputCell {...params} debounceMs={EDIT_CELL_DEBOUNCE_MS} />
    };
  });
}

export const ROW_UPDATED_MESSAGE = 'Row successfully updated!';
export const NEW_ROW_ADDED_MESSAGE = 'New row added!';
export const NO_CHANGES_SAVED_MESSAGE = 'No changes were saved: the server recorded no update for this row.';
export const GRID_REFRESH_FAILED_MESSAGE = 'The grid could not refresh';

// Single source of truth for how a SaveOutcome becomes a snackbar. Shared by the confirm-dialog
// save path (handleConfirmAction) and the direct row-edit path (processRowUpdate) so both report
// the same outcome the same way.
function describeSaveOutcome(outcome: SaveOutcome, isNewRow: boolean): Pick<AlertProps, 'children' | 'severity'> {
  if (outcome.partialError) {
    return { children: outcome.partialError.message, severity: 'error' };
  }
  if (outcome.changed === false) {
    // A no-op save is not itself an error, but a refresh failure on top of it is -
    // outrank the plain follow-up-refresh-failed branch below so this never reports
    // "Changes were saved" (outcome.changed === false says the opposite happened).
    return {
      children: outcome.followUpError
        ? `${NO_CHANGES_SAVED_MESSAGE} ${GRID_REFRESH_FAILED_MESSAGE}: ${outcome.followUpError.message}`
        : (outcome.infoMessage ?? NO_CHANGES_SAVED_MESSAGE),
      severity: outcome.followUpError ? 'error' : 'info'
    };
  }
  if (outcome.followUpError) {
    return {
      children: `Changes were saved, but ${GRID_REFRESH_FAILED_MESSAGE.toLowerCase()}: ${outcome.followUpError.message}`,
      severity: 'error'
    };
  }
  const successMessage = isNewRow ? NEW_ROW_ADDED_MESSAGE : ROW_UPDATED_MESSAGE;
  return {
    children: outcome.infoMessage ? `${successMessage} ${outcome.infoMessage}` : successMessage,
    severity: 'success'
  };
}

const QUADRAT_GRID_TYPES = new Set(['quadrats', 'quadratpersonnel']);
const TAXONOMY_GRID_TYPES = new Set(['taxonomies', 'alltaxonomiesview', 'stemtaxonomiesview']);
export const FILTER_APPLY_DEBOUNCE_MS = 500;

// Column layout (visibility + resized widths) is persisted per grid type so a user's
// arrangement survives reloads. Keyed by gridType because each grid exposes a different
// column set; sharing one key would cross-contaminate unrelated grids.
export const GRID_LAYOUT_STORAGE_PREFIX = 'forestgeo-grid-layout';

// The 53-column archive grid must expose the Columns panel: with layout persistence,
// hiding a column via the column menu would otherwise become a one-way trap with no UI
// to restore it. Other grid types keep the selector disabled, as before.
const COLUMN_SELECTOR_ENABLED_GRID_TYPES = new Set(['viewfulltable']);

type PersistedGridLayout = {
  visibility: GridColumnVisibilityModel;
  widths: Record<string, number>;
};

const EMPTY_GRID_LAYOUT: PersistedGridLayout = { visibility: {}, widths: {} };

export function gridLayoutStorageKey(gridType: string): string {
  return `${GRID_LAYOUT_STORAGE_PREFIX}:${gridType}`;
}

export function readPersistedGridLayout(gridType: string): PersistedGridLayout | null {
  if (typeof window === 'undefined') return null;
  const key = gridLayoutStorageKey(gridType);
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedGridLayout> | null;
    return {
      visibility: parsed?.visibility ?? {},
      widths: parsed?.widths ?? {}
    };
  } catch (error: unknown) {
    // Corrupt/unparseable layout: discard the poisoned key and fall back to defaults.
    // Only swallow JSON parse failures; anything else propagates.
    if (error instanceof SyntaxError) {
      window.localStorage.removeItem(key);
      return null;
    }
    throw error;
  }
}

export function writePersistedGridLayout(gridType: string, layout: PersistedGridLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(gridLayoutStorageKey(gridType), JSON.stringify(layout));
  } catch (error: unknown) {
    // Storage write failures (Safari private mode, QuotaExceededError) surface as
    // DOMExceptions. Losing layout persistence is acceptable; letting the failure
    // propagate out of the resize handler and break resizing is not. Anything that
    // is not a storage DOMException still propagates.
    if (error instanceof DOMException) {
      ailogger.warn(`Failed to persist grid layout for "${gridType}": ${error.message}`);
      return;
    }
    throw error;
  }
}

const INITIAL_FILTER_MODEL: GridFilterModel = { items: [], quickFilterValues: [] };
const AUTO_ROW_HEIGHT = () => 'auto' as const;
// Pairing getRowHeight='auto' with an estimated height stops the virtualizer's
// dimensions ResizeObserver loop (sub-pixel measurement feedback) on flex parents.
const ESTIMATED_AUTO_ROW_HEIGHT = () => 112;
const GRID_ROOT_SX = { width: '100%' } as const;

function arePaginationModelsEqual(left: GridPaginationModel, right: GridPaginationModel): boolean {
  return left.page === right.page && left.pageSize === right.pageSize;
}

function resolveDeleteMutationKind(gridType: string): MutationKind | null {
  if (QUADRAT_GRID_TYPES.has(gridType)) return 'delete-quadrat';
  if (gridType === 'attributes') return 'delete-attribute';
  if (TAXONOMY_GRID_TYPES.has(gridType)) return 'delete-taxonomy';
  return null;
}

const IsolatedDataGridCommonsInner = forwardRef(function IsolatedDataGridCommonsInner(
  props: Readonly<IsolatedDataGridCommonProps>,
  ref: ForwardedRef<IsolatedDataGridCommonsHandle>
) {
  const {
    gridColumns,
    gridType,
    refresh,
    setRefresh,
    locked = false,
    initialRow,
    fieldToFocus,
    dynamicButtons = [],
    defaultHideEmpty = false,
    apiRef = undefined,
    adminEmail = undefined,
    onDataUpdate,
    onDataLoaded,
    editFlowOverride,
    enablePageJump = false,
    enableInfiniteScroll = false
  } = props;

  // A template is only a template for the Add action; showing it before a fetch makes an
  // empty catalog look like it has a real, editable record.
  const [rows, setRows] = useState([] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [paginationModel, setPaginationModel] = useState(() => ({
    page: 0,
    pageSize: getPersistedGridPageSize(gridType)
  }));
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [_shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [_newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<GridRowModel | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hidingEmpty, setHidingEmpty] = useState(defaultHideEmpty);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [promiseArguments, setPromiseArguments] = useState<PendingSave | null>(null);
  const [hasLoadedGrid, setHasLoadedGrid] = useState(false);

  const resetPageOnFilterCommit = useCallback(() => {
    setPaginationModel(prev => (prev.page === 0 ? prev : { ...prev, page: 0 }));
  }, []);

  const {
    uiModel: gridFilterModel,
    serverModel: filterModel,
    applyChange: applyFilterChange
  } = useDebouncedFilterModel<GridFilterModel>(
    INITIAL_FILTER_MODEL,
    FILTER_APPLY_DEBOUNCE_MS,
    areGridFilterModelsEqual,
    toServerFilterModel,
    resetPageOnFilterCommit
  );

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { triggerRefresh } = useDataValidityContext();

  useSession();

  // Always call hooks unconditionally - hooks cannot be called conditionally
  const internalApiRef = useGridApiRef();
  const localApiRef = apiRef === undefined ? internalApiRef : apiRef;

  const saveInFlightRef = useRef(new Set<string>());
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<PendingSave | null>(null);

  // Persisted per-gridType column layout, read once per gridType. Held in a ref so the
  // change handlers can merge partial updates (visibility vs. widths) without re-reading
  // localStorage, and re-initialised when the grid switches to a different type.
  const persistedLayoutGridTypeRef = useRef<string | null>(null);
  const persistedLayoutRef = useRef<PersistedGridLayout>(EMPTY_GRID_LAYOUT);
  if (persistedLayoutGridTypeRef.current !== gridType) {
    persistedLayoutGridTypeRef.current = gridType;
    persistedLayoutRef.current = readPersistedGridLayout(gridType) ?? { visibility: {}, widths: {} };
  }

  const handleColumnVisibilityModelChange = useCallback(
    (model: GridColumnVisibilityModel) => {
      persistedLayoutRef.current = { ...persistedLayoutRef.current, visibility: model };
      writePersistedGridLayout(gridType, persistedLayoutRef.current);
    },
    [gridType]
  );

  const handleColumnWidthChange = useCallback(
    (params: GridColumnResizeParams) => {
      persistedLayoutRef.current = {
        ...persistedLayoutRef.current,
        widths: { ...persistedLayoutRef.current.widths, [params.colDef.field]: params.width }
      };
      writePersistedGridLayout(gridType, persistedLayoutRef.current);
    },
    [gridType]
  );

  const hasFilter = hasServerFilter(filterModel);

  const fetchUrl = React.useMemo(() => {
    if (adminEmail) return `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`;
    if (!currentSite?.schemaName) return null;
    const buildQuery = hasFilter ? createQFFetchQuery : createFetchQuery;
    return buildQuery(
      currentSite.schemaName,
      gridType,
      paginationModel.page,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      currentQuadrat?.quadratID
    );
  }, [
    currentSite?.schemaName,
    gridType,
    paginationModel.page,
    paginationModel.pageSize,
    currentPlot?.plotID,
    currentCensus?.plotCensusNumber,
    currentQuadrat?.quadratID,
    adminEmail,
    hasFilter
  ]);

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
        filterModel
      })
    : null;

  const filterBodyFetcher = React.useCallback(
    async (u: string): Promise<{ output: any[]; totalCount: number; finishedQuery?: string }> => {
      if (!hasFilter) {
        return defaultFetcher<{ output: any[]; totalCount: number; finishedQuery?: string }>(u);
      }
      const res = await fetch(u, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterModel })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => undefined);
        throw new QueryError(res.status, body, `POST ${u} ${res.status}`);
      }
      return (await res.json()) as { output: any[]; totalCount: number; finishedQuery?: string };
    },
    [hasFilter, filterModel]
  );

  const {
    data: gridData,
    isLoading,
    isValidating,
    error: gridError,
    refetch
  } = useForestQuery<{
    output: any[];
    totalCount: number;
    finishedQuery?: string;
  }>(
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
    if (gridError) {
      ailogger.error('Error fetching data:', gridError);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    }
  }, [gridError]);

  useEffect(() => {
    if (gridData) {
      setRows(gridData.output);
      setRowCount(gridData.totalCount);
      setHasLoadedGrid(true);
      if (onDataLoaded) onDataLoaded(gridData.output);
    }
  }, [gridData, onDataLoaded]);

  const infiniteFetcher = useCallback(
    async ({ page: p, pageSize: ps, signal }: { page: number; pageSize: number; signal: AbortSignal }) => {
      if (!currentSite?.schemaName) return { rows: [], totalRows: 0 };
      const useFilter = hasFilter;
      const url = adminEmail
        ? `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`
        : (useFilter ? createQFFetchQuery : createFetchQuery)(
            currentSite.schemaName,
            gridType,
            p,
            ps,
            currentPlot?.plotID,
            currentCensus?.plotCensusNumber,
            currentQuadrat?.quadratID
          );
      const res = useFilter
        ? await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filterModel }),
            signal
          })
        : await fetch(url, { credentials: 'include', signal });
      if (!res.ok) throw new QueryError(res.status, undefined, `${useFilter ? 'POST' : 'GET'} ${url} ${res.status}`);
      const json = (await res.json()) as { output?: any[]; totalCount?: number };
      return { rows: json.output ?? [], totalRows: json.totalCount ?? 0 };
    },
    [adminEmail, currentSite?.schemaName, gridType, currentPlot?.plotID, currentCensus?.plotCensusNumber, currentQuadrat?.quadratID, hasFilter, filterModel]
  );

  const infiniteResetKey = useMemo(
    () =>
      JSON.stringify({
        filter: filterModel,
        site: currentSite?.schemaName,
        plot: currentPlot?.plotID,
        census: currentCensus?.plotCensusNumber,
        quadrat: currentQuadrat?.quadratID,
        gridType,
        adminEmail
      }),
    [filterModel, currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, currentQuadrat?.quadratID, gridType, adminEmail]
  );

  const infinite = useInfiniteGridRows<GridRowModel>({
    fetcher: infiniteFetcher,
    initialPageSize: paginationModel.pageSize,
    resetKey: infiniteResetKey,
    rowIdKey: 'id',
    paginated: { rows: rows as GridRowModel[], totalRows: rowCount, isLoading: isValidating }
  });

  const isInfiniteOn = enableInfiniteScroll && infinite.mode === 'infinite';
  const gridRows = isInfiniteOn ? infinite.rows : rows;
  const gridRowCount = isInfiniteOn ? infinite.rows.length : rowCount;

  const handleRefresh = useCallback(async () => {
    if (isInfiniteOn) {
      await infinite.refresh();
      void refetch().catch(ailogger.error);
      return;
    }
    await refetch();
  }, [refetch, isInfiniteOn, infinite]);

  // Handle refresh signal from parent - use ref to track previous state
  const previousRefresh = useRef(refresh);

  // Timer ref for edit click focus delay - cleaned up on unmount
  const editClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only refresh when transitioning from false to true
    if (refresh && !previousRefresh.current && currentSite) {
      handleRefresh()
        .then(() => setRefresh(false))
        .catch(ailogger.error);
    }
    previousRefresh.current = refresh;
  }, [refresh, currentSite, handleRefresh, setRefresh]);

  // Synchronize rowModesModel with current visible rows - uses functional update to avoid
  // having rowModesModel in dependencies (which would cause potential infinite loops)
  useEffect(() => {
    setRowModesModel(prevRowModesModel => {
      // Build new model based on current rows, preserving existing modes
      const updatedRowModesModel = gridRows.reduce((acc, row) => {
        if (row.id) {
          acc[row.id] = prevRowModesModel[row.id] || { mode: GridRowModes.View };
        }
        return acc;
      }, {} as GridRowModesModel);

      // Remove any entries with key '0' (invalid row IDs)
      const cleanedRowModesModel = Object.fromEntries(Object.entries(updatedRowModesModel).filter(([key]) => key !== '0'));

      // Only update if there's an actual change (prevents unnecessary re-renders)
      if (JSON.stringify(cleanedRowModesModel) !== JSON.stringify(prevRowModesModel)) {
        return cleanedRowModesModel;
      }
      return prevRowModesModel;
    });
  }, [gridRows]); // Only depend on visible rows - rowModesModel accessed via functional update

  const fetchFullData = useCallback(async () => {
    try {
      const tempQuery = createQFFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        paginationModel.page,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber
      );
      const tempResponse = await fetch(tempQuery, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterModel })
      });
      if (!tempResponse.ok) {
        throw new Error(`Failed to fetch query: ${tempResponse.status}`);
      }
      const tempBody = await tempResponse.json();
      const tempFQuery = tempBody.finishedQuery
        .replace(/\bSQL_CALC_FOUND_ROWS\b\s*/i, '')
        .replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, '')
        .trim();
      const resultsResponse = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempFQuery)
      });
      if (!resultsResponse.ok) {
        throw new Error(`Failed to execute query: ${resultsResponse.status}`);
      }
      const results = await resultsResponse.json();
      const jsonData = JSON.stringify(results, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = 'results.json';
      link.click();

      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      ailogger.error('Error fetching full data:', error instanceof Error ? error : new Error(String(error)));
      setSnackbar({ children: 'Error fetching full data', severity: 'error' });
    }
  }, [filterModel, currentPlot, currentCensus, currentSite, gridType, paginationModel.page, paginationModel.pageSize]);

  const exportAllCSV = useCallback(async () => {
    try {
      switch (gridType) {
        case 'attributes':
          const aResponse = await fetch(
            `/api/formdownload/attributes/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}/${JSON.stringify(filterModel)}`,
            { method: 'GET' }
          );
          if (!aResponse.ok) throw new Error(`Failed to download attributes: ${aResponse.status}`);
          const aData = await aResponse.json();
          let aCSVRows =
            getTableHeaders(FormType.attributes)
              .map(row => row.label)
              .join(',') + '\n';
          aData.forEach((row: Record<string, unknown>) => {
            const values = getTableHeaders(FormType.attributes)
              .map(rowHeader => rowHeader.label)
              .map(header => row[header])
              .map(value => sanitizeCsvValue(value));
            aCSVRows += values.join(',') + '\n';
          });
          const aBlob = new Blob([aCSVRows], {
            type: 'text/csv;charset=utf-8;'
          });
          const aURL = URL.createObjectURL(aBlob);
          const aLink = document.createElement('a');
          aLink.href = aURL;
          aLink.download = `attributesform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
          document.body.appendChild(aLink);
          aLink.click();
          document.body.removeChild(aLink);
          break;
        case 'quadrats':
          const qResponse = await fetch(
            `/api/formdownload/quadrats/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}`,
            { method: 'GET' }
          );
          if (!qResponse.ok) throw new Error(`Failed to download quadrats: ${qResponse.status}`);
          const qData = await qResponse.json();
          let qCSVRows =
            getTableHeaders(FormType.quadrats)
              .map(row => row.label)
              .join(',') + '\n';
          qData.forEach((row: Record<string, unknown>) => {
            const values = getTableHeaders(FormType.quadrats)
              .map(rowHeader => rowHeader.label)
              .map(header => row[header])
              .map(value => sanitizeCsvValue(value));
            qCSVRows += values.join(',') + '\n';
          });
          const qBlob = new Blob([qCSVRows], {
            type: 'text/csv;charset=utf-8;'
          });
          const qURL = URL.createObjectURL(qBlob);
          const qLink = document.createElement('a');
          qLink.href = qURL;
          qLink.download = `quadratsform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
          document.body.appendChild(qLink);
          qLink.click();
          document.body.removeChild(qLink);
          break;
        case 'personnel':
          const pResponse = await fetch(
            `/api/formdownload/personnel/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}`,
            { method: 'GET' }
          );
          if (!pResponse.ok) throw new Error(`Failed to download personnel: ${pResponse.status}`);
          const pData = await pResponse.json();
          let pCSVRows =
            getTableHeaders(FormType.personnel)
              .map(row => row.label)
              .join(',') + '\n';
          pData.forEach((row: Record<string, unknown>) => {
            const values = getTableHeaders(FormType.personnel)
              .map(rowHeader => rowHeader.label)
              .map(header => row[header])
              .map(value => sanitizeCsvValue(value));
            pCSVRows += values.join(',') + '\n';
          });
          const pBlob = new Blob([pCSVRows], {
            type: 'text/csv;charset=utf-8;'
          });
          const pURL = URL.createObjectURL(pBlob);
          const pLink = document.createElement('a');
          pLink.href = pURL;
          pLink.download = `personnelform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
          document.body.appendChild(pLink);
          pLink.click();
          document.body.removeChild(pLink);
          break;
        case 'species':
        case 'alltaxonomiesview':
          const sResponse = await fetch(
            `/api/formdownload/species/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}`,
            { method: 'GET' }
          );
          if (!sResponse.ok) throw new Error(`Failed to download species: ${sResponse.status}`);
          const sData = await sResponse.json();
          let sCSVRows =
            getTableHeaders(FormType.species)
              .map(row => row.label)
              .join(',') + '\n';
          sData.forEach((row: Record<string, unknown>) => {
            const values = getTableHeaders(FormType.species)
              .map(rowHeader => rowHeader.label)
              .map(header => row[header])
              .map(value => sanitizeCsvValue(value));
            sCSVRows += values.join(',') + '\n';
          });
          const sBlob = new Blob([sCSVRows], {
            type: 'text/csv;charset=utf-8;'
          });
          const sURL = URL.createObjectURL(sBlob);
          const sLink = document.createElement('a');
          sLink.href = sURL;
          sLink.download = `speciesform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
          document.body.appendChild(sLink);
          sLink.click();
          document.body.removeChild(sLink);
          break;
        case 'viewfulltable':
          await fetchFullData();
          break;
        case 'failedmeasurements':
          const fmResponse = await fetch(
            `/api/formdownload/failedmeasurements/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges?.[0]?.censusID ?? 0}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filterModel })
            }
          );
          if (!fmResponse.ok) throw new Error(`Failed to download failed measurements: ${fmResponse.status}`);
          const fmData = await fmResponse.json();
          const fmHeaders = [
            'failedmeasurementid',
            'fileid',
            'batchid',
            'tag',
            'stemtag',
            'spcode',
            'quadrat',
            'lx',
            'ly',
            'dbh',
            'hom',
            'date',
            'codes',
            'currentFailureReasons',
            'originalFailureReasons',
            'failureReasons',
            'lastValidatedAt'
          ];
          let fmCSVRows = fmHeaders.join(',') + '\n';
          fmData.forEach((row: Record<string, unknown>) => {
            const values = fmHeaders.map(header => {
              return sanitizeCsvValue(row[header], { isDate: header === 'date' });
            });
            fmCSVRows += values.join(',') + '\n';
          });
          const fmBlob = new Blob([fmCSVRows], {
            type: 'text/csv;charset=utf-8;'
          });
          const fmURL = URL.createObjectURL(fmBlob);
          const fmLink = document.createElement('a');
          fmLink.href = fmURL;
          fmLink.download = `failedmeasurements_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
          document.body.appendChild(fmLink);
          fmLink.click();
          document.body.removeChild(fmLink);
          break;
      }
    } catch (error: any) {
      ailogger.error('Error exporting CSV:', error);
      setSnackbar({ children: 'Error exporting data', severity: 'error' });
    }
  }, [currentPlot, currentCensus, currentSite, gridType, filterModel, fetchFullData, setSnackbar]);

  // Returns whether a dialog actually opened. Callers that arm pendingSaveRef before
  // calling this MUST disarm it on false: the ref is only cleared from the dialog's
  // confirm/cancel handlers, so a silent no-op here would leave every save, delete,
  // add and edit entry point permanently short-circuited on the stale ref.
  const openConfirmationDialog = useCallback(
    (actionType: 'save' | 'delete', actionId: GridRowId): boolean => {
      const row = gridRows.find(row => String(row.id) === String(actionId));
      if (!row) return false;

      setPendingAction({ actionType, actionId });
      if (actionType === 'delete') {
        setPendingDeleteRow(row);
        setIsDeleteDialogOpen(true);
      } else {
        setIsDialogOpen(true);
      }
      return true;
    },
    [gridRows]
  );

  const updateRow = useCallback(
    async (gridType: string, schemaName: string | undefined, newRow: GridRowModel, oldRow: GridRowModel): Promise<PersistResult> => {
      assertStableExistingRowIdentity(newRow, oldRow);
      const gridID = getGridID(gridType);
      const requestRow = { ...newRow };
      if ('date' in requestRow && requestRow.date) {
        const parsedDate = moment(requestRow.date, 'YYYY-MM-DD', true);
        if (parsedDate.isValid()) {
          requestRow.date = parsedDate.format('YYYY-MM-DD');
        }
      }
      let fetchProcessQuery =
        gridType !== 'quadrats'
          ? createPostPatchQuery(schemaName ?? '', gridType, gridID)
          : createPostPatchQuery(schemaName ?? '', gridType, gridID, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID);
      if (adminEmail) fetchProcessQuery = `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`;
      const response = await fetch(fetchProcessQuery, {
        method: isExplicitNewRow(oldRow) ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow, newRow: requestRow })
      });
      const responseJSON = await readResponsePayload(response);
      if (!response.ok) {
        throw new Error(responseErrorMessage(responseJSON, response));
      }
      if (isExplicitNewRow(oldRow)) {
        setIsNewRowAdded(false);
        setShouldAddRowAfterFetch(false);
        const createdID = normalizeCreatedID(
          responseJSON && typeof responseJSON === 'object' ? (responseJSON as { createdIDs?: Record<string, unknown> }).createdIDs?.[gridType] : undefined
        );
        const hasCreatedID = createdID !== undefined;
        // `changed` is intentionally omitted (undefined) on the POST/insert branch: the
        // fixeddata handler's `changed` flag describes whether a PATCH's UPDATE altered a
        // row, which has no POST/insert equivalent - a future POST response that happened
        // to include `changed: false` must never be read as "no rows were inserted".
        return {
          row: {
            ...requestRow,
            ...(hasCreatedID ? { [gridID]: createdID, ...(gridID === 'id' ? { id: createdID } : {}) } : {}),
            isNew: false,
            ...(hasCreatedID ? {} : { creationNeedsRefresh: true })
          }
        };
      }
      // `changed` is reported by the fixeddata PATCH handler in config/macros/coreapifunctions.ts.
      // An absent flag (e.g. /api/administrative/fetch/[type], which doesn't report it) yields
      // `undefined` here, and handleConfirmAction's toast decision defers to success for that case.
      const changed =
        responseJSON && typeof responseJSON === 'object' && typeof (responseJSON as { changed?: unknown }).changed === 'boolean'
          ? (responseJSON as { changed: boolean }).changed
          : undefined;
      return { row: requestRow, changed };
    },
    [currentPlot?.plotID, currentCensus?.dateRanges, adminEmail, setIsNewRowAdded, setShouldAddRowAfterFetch]
  );

  const persistRow = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<PersistResult> => {
      assertStableExistingRowIdentity(newRow, oldRow);
      const isNewRow = isExplicitNewRow(oldRow);
      if (!isNewRow && editFlowOverride) {
        try {
          const overrideResult = await editFlowOverride(newRow, oldRow);
          return { row: overrideResult.row, changed: overrideResult.changed, infoMessage: overrideResult.infoMessage };
        } catch (error: unknown) {
          const err = asError(error);
          throw err;
        }
      }
      if (!isNewRow && gridType === 'failedmeasurements') {
        throw new Error('Failed measurement edits require the preview/apply flow; no edit override is configured.');
      }
      if ((oldRow as PersistedGridRow).creationNeedsRefresh === true) {
        throw new Error('This row was created, but its server ID is unavailable until refresh completes. Refresh and retry.');
      }
      return updateRow(gridType, currentSite?.schemaName, newRow, oldRow);
    },
    [editFlowOverride, gridType, currentSite?.schemaName, updateRow]
  );

  const finishPersistedSave = useCallback(
    async (updatedRow: GridRowModel, oldRow: GridRowModel): Promise<Error | undefined> => {
      // Commit the authoritative saved row locally before any refresh can fail.
      // This keeps a partial-success edit visible and gives a retry the right old row.
      if (isInfiniteOn) {
        infinite.upsertRow(updatedRow);
      } else {
        setRows(prevRows => {
          const index = prevRows.findIndex(row => String(row.id) === String(updatedRow.id) || String(row.id) === String(oldRow.id));
          if (index < 0) return [...prevRows, updatedRow];
          const nextRows = [...prevRows];
          nextRows[index] = updatedRow;
          return nextRows;
        });
      }
      try {
        if (isInfiniteOn) await infinite.refresh();
        if (onDataUpdate) await onDataUpdate(updatedRow, oldRow);
        triggerRefresh([gridType as keyof UnifiedValidityFlags]);
        await refetch();
      } catch (error: unknown) {
        return asError(error);
      }
      return undefined;
    },
    [isInfiniteOn, infinite, setRows, onDataUpdate, triggerRefresh, gridType, refetch]
  );

  const performSaveAction = useCallback(
    async (id: GridRowId, confirmedRow: GridRowModel): Promise<SaveOutcome | null> => {
      if (!promiseArguments) return null;
      const pending = promiseArguments;
      const key = rowKey(pending.oldRow.id ?? id);

      // MUI is awaiting pending.promise for a new row. Bailing out without settling it
      // strands the row in edit mode with no feedback, so refuse loudly instead: the
      // rejection both frees the grid and reaches the caller's snackbar.
      const refuse = (message: string): Error => {
        const error = new Error(message);
        if (!pending.settled) {
          pending.settled = true;
          pending.reject(error);
        }
        return error;
      };
      if (locked) throw refuse('This grid is locked, so the row could not be saved.');
      if (isSavingRef.current || saveInFlightRef.current.has(key)) throw refuse('Another row save is already in progress.');

      saveInFlightRef.current.add(key);
      isSavingRef.current = true;
      setIsSaving(true);

      try {
        let updatedRow: GridRowModel;
        let changed: boolean | undefined;
        let partialError: Error | undefined;
        let infoMessage: string | undefined;
        try {
          const persisted = await persistRow(confirmedRow, pending.oldRow);
          updatedRow = persisted.row;
          changed = persisted.changed;
          infoMessage = persisted.infoMessage;
        } catch (error: unknown) {
          if (!(error instanceof RowSaveFinalizationError)) throw asError(error);
          updatedRow = error.persistedRow as GridRowModel;
          partialError = error;
        }

        // Persistence is complete before leaving edit mode. MUI's supported
        // ignoreModifications transition prevents a second processRowUpdate call.
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View, ignoreModifications: true }
        }));

        if (!pending.settled) {
          pending.settled = true;
          pending.resolve(updatedRow);
        }
        const followUpError = await finishPersistedSave(updatedRow, pending.oldRow);
        return { row: updatedRow, changed, partialError, followUpError, infoMessage };
      } catch (error: unknown) {
        if (!pending.settled) {
          pending.settled = true;
          pending.reject(error);
        }
        throw asError(error);
      } finally {
        saveInFlightRef.current.delete(key);
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [locked, promiseArguments, persistRow, finishPersistedSave, setRowModesModel]
  );

  const performDeleteAction = useCallback(
    async (id: GridRowId) => {
      if (locked) return;

      const rowToDelete = gridRows.find(row => String(row.id) === String(id));
      if (!rowToDelete) return;

      let deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', gridType, getGridID(gridType), rowToDelete.id);
      if (adminEmail) deleteQuery = `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`;

      try {
        const response = await fetch(deleteQuery, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ newRow: rowToDelete })
        });

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
          setRows(prevRows => prevRows.filter(row => row.id !== id));
          infinite.removeRow(id);
          setSnackbar({
            children: 'Row successfully deleted',
            severity: 'success'
          });
          triggerRefresh([gridType as keyof UnifiedValidityFlags]);
          await refetch();
          const deleteMutationKind = resolveDeleteMutationKind(gridType);
          if (deleteMutationKind) {
            await invalidateAfter(deleteMutationKind, queryScope);
          } else {
            ailogger.info(`no fan-out wired for gridType ${gridType}`);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Deletion failed';
        setSnackbar({
          children: `Error: ${message}`,
          severity: 'error'
        });
      }
    },
    [locked, gridRows, currentSite, gridType, setSnackbar, triggerRefresh, adminEmail, refetch, queryScope, infinite]
  );

  const handleConfirmAction = useCallback(
    async (confirmedRow?: GridRowModel) => {
      setIsDialogOpen(false);
      setIsDeleteDialogOpen(false);
      setPendingDeleteRow(null);

      if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
        await performDeleteAction(pendingAction.actionId);
      } else if (promiseArguments) {
        try {
          const resolvedRow = confirmedRow || promiseArguments.newRow;
          const outcome = await performSaveAction(promiseArguments.oldRow.id, resolvedRow);
          if (outcome) {
            setSnackbar(describeSaveOutcome(outcome, isExplicitNewRow(promiseArguments.oldRow)));
          }
        } catch (error: unknown) {
          const message = asError(error).message;
          setSnackbar({ children: `Error: ${message}`, severity: 'error' });
        }
      }

      setPendingAction({ actionType: '', actionId: null });
      if (pendingSaveRef.current === promiseArguments) pendingSaveRef.current = null;
      setPromiseArguments(null);
    },
    [pendingAction, promiseArguments, performDeleteAction, performSaveAction, setSnackbar]
  );

  const handleCancelAction = useCallback(() => {
    if (isSavingRef.current) return;
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    setPendingDeleteRow(null);
    if (promiseArguments) {
      if (!promiseArguments.settled) {
        promiseArguments.settled = true;
        promiseArguments.reject(new Error('Action cancelled by user'));
      }
    }
    setPendingAction({ actionType: '', actionId: null });
    if (pendingSaveRef.current === promiseArguments) pendingSaveRef.current = null;
    setPromiseArguments(null);
  }, [promiseArguments]);

  const handleSaveClick = useCallback(
    (id: GridRowId) => () => {
      if (locked || isSavingRef.current || pendingSaveRef.current || saveInFlightRef.current.has(rowKey(id))) return;

      const updatedRowModesModel = { ...rowModesModel };
      if (!updatedRowModesModel[id] || updatedRowModesModel[id].mode === undefined) {
        updatedRowModesModel[id] = { mode: GridRowModes.View };
      }

      const oldRow = gridRows.find(row => String(row.id) === String(id));

      const updatedRow = localApiRef.current?.getRowWithUpdatedValues(id, 'anyField');

      if (oldRow && updatedRow && !pendingSaveRef.current) {
        const pending: PendingSave = {
          resolve: (_value: GridRowModel) => {},
          reject: (_reason?: unknown) => {},
          oldRow,
          newRow: updatedRow
        };
        pendingSaveRef.current = pending;
        setPromiseArguments(pending);

        if (!openConfirmationDialog('save', id)) {
          pendingSaveRef.current = null;
          setPromiseArguments(null);
          setSnackbar({ children: `Cannot save row ${String(id)} because it is no longer present in the grid. Refresh and retry.`, severity: 'error' });
        }
      }
    },
    [locked, rowModesModel, gridRows, localApiRef, openConfirmationDialog, setSnackbar]
  );

  const handleDeleteClick = useCallback(
    (id: GridRowId) => () => {
      if (locked || isSavingRef.current || pendingSaveRef.current) return;
      if (gridType === 'census') {
        const rowToDelete = gridRows.find(row => String(row.id) === String(id));
        if (currentCensus && rowToDelete && rowToDelete.censusID === currentCensus.dateRanges?.[0]?.censusID) {
          alert('Cannot delete the currently selected census.');
          return;
        }
      }
      openConfirmationDialog('delete', id);
    },
    [locked, gridType, currentCensus, gridRows, openConfirmationDialog]
  );

  const handleAddNewRow = useCallback(async () => {
    if (locked || isSavingRef.current || pendingSaveRef.current) return;
    if (isNewRowAdded) return;
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;
    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
    } else {
      setPaginationModel({ ...paginationModel, page: existingLastPage });
    }
    const id = randomId();
    const newRow = { ...initialRow, id, isNew: true };
    setRows(prevRows => {
      return [...prevRows, newRow];
    });
    setRowModesModel(prevModel => {
      return {
        ...prevModel,
        [id]: { mode: GridRowModes.Edit, fieldToFocus }
      };
    });

    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);
    setIsNewRowAdded(true);
  }, [locked, isNewRowAdded, rowCount, paginationModel, initialRow, setRows, setRowModesModel, fieldToFocus]);

  useImperativeHandle(
    ref,
    () => ({
      updateRow: async (newRow: GridRowModel, oldRow: GridRowModel) => {
        const persisted = await persistRow(newRow, oldRow);
        return persisted.row;
      },
      fetchPaginatedData: async () => {
        await refetch();
      },
      showSnackbar: (message: string, severity: 'success' | 'error') => {
        setSnackbar({ children: message, severity });
      }
    }),
    [persistRow, refetch]
  );

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      assertStableExistingRowIdentity(newRow, oldRow);
      if (isSavingRef.current) throw new Error('Another row save is already in progress.');

      if (isExplicitNewRow(oldRow)) {
        const existingPending = pendingSaveRef.current;
        if (existingPending?.promise && rowKey(existingPending.oldRow.id) === rowKey(oldRow.id)) return existingPending.promise;
        if (existingPending) throw new Error('A row save is already awaiting confirmation.');
        let resolvePending!: (value: GridRowModel) => void;
        let rejectPending!: (reason?: unknown) => void;
        const pendingPromise = new Promise<GridRowModel>((resolve, reject) => {
          resolvePending = resolve;
          rejectPending = reject;
        });
        const pending: PendingSave = { resolve: resolvePending, reject: rejectPending, oldRow, newRow, promise: pendingPromise };
        pendingSaveRef.current = pending;
        setPromiseArguments(pending);
        if (!openConfirmationDialog('save', oldRow.id)) {
          pendingSaveRef.current = null;
          setPromiseArguments(null);
          throw new Error(`Cannot save row ${String(oldRow.id)} because it is no longer present in the grid. Refresh and retry.`);
        }
        return pendingPromise;
      }

      isSavingRef.current = true;
      setIsSaving(true);
      try {
        const persisted = await persistRow(newRow, oldRow);
        const updatedRow = persisted.row;
        const followUpError = await finishPersistedSave(updatedRow, oldRow);
        const outcome: SaveOutcome = { row: updatedRow, changed: persisted.changed, followUpError, infoMessage: persisted.infoMessage };
        // The isExplicitNewRow(oldRow) branch above already returns early, so an explicit new
        // row never reaches this point - isNewRow is always false here.
        setSnackbar(describeSaveOutcome(outcome, false));
        return updatedRow;
      } catch (error: unknown) {
        if (error instanceof RowSaveFinalizationError) {
          const persistedRow = error.persistedRow as GridRowModel;
          const followUpError = await finishPersistedSave(persistedRow, oldRow);
          setSnackbar({
            children: followUpError ? `Changes were saved, but ${GRID_REFRESH_FAILED_MESSAGE.toLowerCase()}: ${followUpError.message}` : error.message,
            severity: 'error'
          });
          return persistedRow;
        }
        const err = asError(error);
        throw err;
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [setSnackbar, openConfirmationDialog, persistRow, finishPersistedSave]
  );

  const handleRowModesModelChange = useCallback((newRowModesModel: GridRowModesModel) => {
    setRowModesModel(prevModel => {
      const updatedModel = { ...prevModel };
      Object.keys(newRowModesModel).forEach(id => {
        if (updatedModel[id]) {
          updatedModel[id] = {
            ...updatedModel[id],
            ...newRowModesModel[id],
            mode: newRowModesModel[id]?.mode || updatedModel[id]?.mode || GridRowModes.View
          };
        } else {
          ailogger.warn(`Row ID ${id} does not exist in rowModesModel. Skipping.`);
        }
      });
      if (JSON.stringify(updatedModel) === JSON.stringify(prevModel)) {
        return prevModel;
      }
      return updatedModel;
    });
  }, []);

  const handlePaginationModelChange = useCallback((newPaginationModel: GridPaginationModel) => {
    setPaginationModel(prevModel => (arePaginationModelsEqual(prevModel, newPaginationModel) ? prevModel : newPaginationModel));
  }, []);

  const handleCloseSnackbar = useCallback(() => setSnackbar(null), []);

  const handleRowEditStop = useCallback<GridEventListener<'rowEditStop'>>((params, event) => {
    if (isSavingRef.current) {
      event.defaultMuiPrevented = true;
      return;
    }
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  }, []);

  const handleEditClick = useCallback(
    (id: GridRowId, actionRow?: GridRowModel) => () => {
      if (locked || isSavingRef.current || pendingSaveRef.current) return;
      const row = (actionRow ?? gridRows.find(candidate => String(candidate.id) === String(id))) as PersistedGridRow | undefined;
      if (row?.creationNeedsRefresh) {
        setSnackbar({ children: 'Refresh the grid before editing this newly created row.', severity: 'error' });
        return;
      }
      setRowModesModel(prevModel => ({
        ...prevModel,
        [id]: { mode: GridRowModes.Edit }
      }));
      // Store timer in ref for cleanup on unmount
      editClickTimerRef.current = setTimeout(() => {
        const firstEditableColumn = gridColumns.find(col => col.editable);
        if (firstEditableColumn) {
          localApiRef.current?.setCellFocus(id, firstEditableColumn.field);
        }
      });
    },
    [locked, localApiRef, gridColumns, gridRows, setSnackbar]
  );

  const handleCancelClick = useCallback(
    (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
      if (locked || isSavingRef.current || saveInFlightRef.current.has(rowKey(id))) return;
      event?.preventDefault();

      const row = gridRows.find(row => String(row.id) === String(id));

      if (row?.isNew === true) {
        setRows(oldRows => oldRows.filter(row => row.id !== id));

        setRowModesModel(prevModel => {
          const updatedModel = { ...prevModel };
          delete updatedModel[id];
          return updatedModel;
        });

        setIsNewRowAdded(false);
      } else {
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View, ignoreModifications: true }
        }));
      }
    },
    [locked, gridRows]
  );

  // Cleanup timers on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (editClickTimerRef.current) {
        clearTimeout(editClickTimerRef.current);
      }
    };
  }, []);

  const onQuickFilterChange = useCallback((incomingValues: GridFilterModel) => applyFilterChange(incomingValues), [applyFilterChange]);

  const handleFilterModelChange = useCallback((newFilterModel: GridFilterModel) => applyFilterChange(newFilterModel), [applyFilterChange]);

  const handleCellDoubleClick = useCallback<GridEventListener<'cellDoubleClick'>>(
    params => {
      if (locked || isSavingRef.current || pendingSaveRef.current) return;
      setRowModesModel(prevModel => ({
        ...prevModel,
        [params.id]: { mode: GridRowModes.Edit }
      }));
    },
    [locked]
  );

  const handleCellKeyDown = useCallback<GridEventListener<'cellKeyDown'>>(
    (_params, event) => {
      if (isSavingRef.current) {
        event.defaultMuiPrevented = true;
        return;
      }
      if (event.key === 'Enter' && !locked) {
        event.defaultMuiPrevented = true;
      }
      if (event.key === 'Escape') {
        event.defaultMuiPrevented = true;
      }
    },
    [locked]
  );

  const handleProcessRowUpdateError = useCallback((error: Error) => {
    const err = asError(error);
    ailogger.error('Row update error:', err);
    setSnackbar({ children: `Error: ${err.message}`, severity: 'error' });
  }, []);

  const rowsRef = useRef(gridRows);
  const rowModesModelRef = useRef(rowModesModel);
  useEffect(() => {
    rowsRef.current = gridRows;
  }, [gridRows]);
  useEffect(() => {
    rowModesModelRef.current = rowModesModel;
  }, [rowModesModel]);

  const handleProcessRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      const waitForStateUpdates = async () => {
        return new Promise<void>(resolve => {
          const checkUpdates = () => {
            if (rowsRef.current.length > 0 && Object.keys(rowModesModelRef.current).length > 0) {
              resolve();
            } else {
              setTimeout(checkUpdates, 50);
            }
          };
          checkUpdates();
        });
      };
      await waitForStateUpdates();
      try {
        return await processRowUpdate(newRow, oldRow);
      } catch (error: unknown) {
        const err = asError(error);
        ailogger.error('Error processing row update:', err);
        throw err;
      }
    },
    [processRowUpdate]
  );

  const showInitialGridSkeleton = isLoading && !hasLoadedGrid;
  const showGridLoading = hasLoadedGrid && (isLoading || isValidating);
  const gridLoading = isInfiniteOn ? infinite.isLoading : showGridLoading;

  const getEnhancedCellAction = useCallback(
    (type: string, icon: React.ReactElement, onClick: React.MouseEventHandler<HTMLButtonElement>) => (
      <CellItemContainer>
        <Tooltip
          disableInteractive
          title={
            type === 'Save'
              ? `Save your changes`
              : type === 'Cancel'
                ? `Cancel your changes`
                : type === 'Edit'
                  ? `Edit this row`
                  : type === 'Delete'
                    ? 'Delete this row'
                    : type === 'Limits'
                      ? 'View limits for this row'
                      : undefined
          }
          arrow
          placement="top"
        >
          <GridActionsCellItem icon={icon} label={type} onClick={onClick} />
        </Tooltip>
      </CellItemContainer>
    ),
    []
  );

  const getGridActionsColumn = useCallback(
    (): GridColDef => ({
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 112,
      minWidth: 112,
      cellClassName: 'actions',
      getActions: ({ id, row }) => {
        if (!rowModesModel[id]?.mode) return [];
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;
        if (isInEditMode && !locked) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: React.MouseEvent<HTMLButtonElement>) => handleCancelClick(id, e))
          ];
        }
        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id, row)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    }),
    [rowModesModel, locked, getEnhancedCellAction, handleSaveClick, handleCancelClick, handleEditClick, handleDeleteClick]
  );

  const columns = useMemo(() => {
    return [...withImmediateEditCellCommit(applyFilterToColumns(gridColumns)), ...(locked ? [] : [getGridActionsColumn()])];
  }, [gridColumns, locked, getGridActionsColumn]);

  const filteredColumns = useMemo(() => {
    if (hidingEmpty) return filterColumns(gridRows, columns);
    else return columns;
  }, [gridRows, columns, hidingEmpty]);

  // Grid types under "Stem & Plot Details" that don't require a census selection
  const censusIndependentGridTypes = ['attributes', 'personnel', 'quadrats', 'alltaxonomiesview', 'stemtaxonomiesview'];
  const requiresCensus = !censusIndependentGridTypes.includes(gridType);

  const pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS;

  const gridInitialState = useMemo(() => {
    const savedLayout = persistedLayoutRef.current;
    const savedWidthEntries = Object.entries(savedLayout.widths);
    const dimensions = savedWidthEntries.reduce<Record<string, { width: number }>>((acc, [field, width]) => {
      acc[field] = { width };
      return acc;
    }, {});
    return {
      columns: {
        // Saved visibility overrides the default hidden-ID model; defaults fill any
        // column the user never touched.
        columnVisibilityModel: { ...getColumnVisibilityModel(gridType), ...savedLayout.visibility },
        ...(savedWidthEntries.length > 0 ? { dimensions } : {})
      }
    };
  }, [gridType]);

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
    // Test seam: expose the closure-bound descriptor so unit tests can inspect / drive the toggle.
    (Slot as unknown as { infiniteScroll?: typeof infiniteScrollDescriptor }).infiniteScroll = infiniteScrollDescriptor;
    return Slot;
  }, [enablePageJump, enableInfiniteScroll, gridType, infiniteScrollDescriptor]);

  const slotProps = useMemo(
    () => ({
      toolbar: {
        handleAddNewRow,
        handleRefresh,
        // stemtaxonomiesview has no formdownload endpoint, so exportAllCSV would fall through and no-op.
        // Omit the export handlers for it so the toolbar hides the button instead of showing a dead one.
        handleExportAll: gridType === 'stemtaxonomiesview' ? undefined : fetchFullData,
        handleExportCSV: gridType === 'stemtaxonomiesview' ? undefined : exportAllCSV,
        handleQuickFilterChange: onQuickFilterChange,
        filterModel: gridFilterModel,
        dynamicButtons,
        gridColumns,
        gridType,
        hidingEmpty,
        setHidingEmpty
      } as GridToolbarProps & Partial<EditToolbarCustomProps>
    }),
    [handleAddNewRow, handleRefresh, fetchFullData, exportAllCSV, onQuickFilterChange, gridFilterModel, dynamicButtons, gridColumns, gridType, hidingEmpty]
  );

  const gridSlots = useMemo(
    () => ({
      toolbar: EditToolbar,
      ...(PaginationSlot ? { pagination: PaginationSlot } : {})
    }),
    [PaginationSlot]
  );

  // Skip redirect for admin/catalog pages (when adminEmail is provided)
  // Census-independent grids only need site + plot; others need all three
  if (!adminEmail && (!currentSite || !currentPlot || (requiresCensus && !currentCensus))) {
    redirect('/dashboard');
  } else {
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
        <Box sx={{ width: '100%', flexDirection: 'column', position: 'relative' }}>
          <LoadingBar active={!isInfiniteOn && isValidating && hasLoadedGrid} />
          {showInitialGridSkeleton ? (
            <ContentSkeleton kind="grid-rows" count={paginationModel.pageSize} />
          ) : (
            <>
              <StyledDataGrid
                aria-label={getGridTypeLabel(gridType)}
                aria-busy={isSaving}
                apiRef={localApiRef}
                sx={{ ...GRID_ROOT_SX, ...(isSaving ? { pointerEvents: 'none' } : {}) }}
                rows={gridRows}
                columns={filteredColumns}
                editMode="row"
                rowModesModel={rowModesModel}
                disableColumnSelector={!COLUMN_SELECTOR_ENABLED_GRID_TYPES.has(gridType)}
                disableVirtualization={E2E_DISABLE_VIRTUALIZATION}
                onRowModesModelChange={handleRowModesModelChange}
                onRowEditStop={handleRowEditStop}
                onCellDoubleClick={handleCellDoubleClick}
                onCellKeyDown={handleCellKeyDown}
                processRowUpdate={handleProcessRowUpdate}
                onProcessRowUpdateError={handleProcessRowUpdateError}
                loading={gridLoading || isSaving}
                paginationMode="server"
                filterMode="server"
                onPaginationModelChange={handlePaginationModelChange}
                paginationModel={paginationModel}
                rowCount={gridRowCount}
                pageSizeOptions={pageSizeOptions}
                filterModel={gridFilterModel}
                onFilterModelChange={handleFilterModelChange}
                onColumnVisibilityModelChange={handleColumnVisibilityModelChange}
                onColumnWidthChange={handleColumnWidthChange}
                ignoreDiacritics
                initialState={gridInitialState}
                slots={gridSlots}
                slotProps={slotProps}
                showToolbar
              />
              <InfiniteGridScrollBridge
                apiRef={localApiRef}
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
        {isDeleteDialogOpen && (
          <ConfirmationDialog
            open={isDeleteDialogOpen}
            onClose={handleCancelAction}
            onConfirm={handleConfirmAction}
            title="Confirm Deletion"
            content={`Delete ${describeFixedDataRow(pendingDeleteRow)}? This action cannot be undone.`}
          />
        )}
        {isResetDialogOpen && <ResetViewModal open={isResetDialogOpen} setOpen={setIsResetDialogOpen} triggerResetView={async () => {}} />}
      </Box>
    );
  }
});

// Wrap the forwardRef component with ErrorBoundary
const IsolatedDataGridCommons = forwardRef(function IsolatedDataGridCommons(
  props: Readonly<IsolatedDataGridCommonProps>,
  ref: ForwardedRef<IsolatedDataGridCommonsHandle>
) {
  return (
    <ErrorBoundary componentName="IsolatedDataGridCommons">
      <IsolatedDataGridCommonsInner {...props} ref={ref} />
    </ErrorBoundary>
  );
});

export default IsolatedDataGridCommons;
