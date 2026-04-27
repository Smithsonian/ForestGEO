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
  GridEventListener,
  GridFilterModel,
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
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import moment from 'moment/moment';
import { EditToolbar } from '@/components/client/datagridelements';
import ResetViewModal from '@/components/client/modals/resetviewmodal';
import ailogger from '@/ailogger';
import { useForestQuery, queryKey, QueryNamespace, QueryScope, defaultFetcher, QueryError } from '@/lib/query';
import { LoadingBar, ContentSkeleton } from '@/components/loading';

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

export type IsolatedDataGridCommonsHandle = {
  updateRow: (newRow: GridRowModel, oldRow: GridRowModel) => Promise<GridRowModel>;
  fetchPaginatedData: () => Promise<void>;
  showSnackbar: (message: string, severity: 'success' | 'error') => void;
};

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
    editFlowOverride
  } = props;

  const [rows, setRows] = useState([initialRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [_isMutating, setIsMutating] = useState(false);
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [_shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [_newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [hidingEmpty, setHidingEmpty] = useState(defaultHideEmpty);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: unknown) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({
    items: [],
    quickFilterValues: []
  });

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { triggerRefresh } = useDataValidityContext();

  useSession();

  // Always call hooks unconditionally - hooks cannot be called conditionally
  const internalApiRef = useGridApiRef();
  const localApiRef = apiRef === undefined ? internalApiRef : apiRef;

  const skipNextProcessRowUpdateRef = useRef(false);

  const hasFilter = (filterModel.items?.length ?? 0) > 0 || (filterModel.quickFilterValues?.length ?? 0) > 0;

  const fetchUrl = React.useMemo(() => {
    if (!currentSite?.schemaName) return null;
    if (adminEmail) return `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`;
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

  const queryScope: QueryScope = {
    siteSchema: currentSite?.schemaName,
    plotID: currentPlot?.plotID,
    censusID: currentCensus?.dateRanges?.[0]?.censusID
  };

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
      return res.json() as Promise<{ output: any[]; totalCount: number; finishedQuery?: string }>;
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
  }>(gridQueryKey, fetchUrl, { fetcher: filterBodyFetcher });

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
      if (onDataLoaded) onDataLoaded(gridData.output);
    }
  }, [gridData, onDataLoaded]);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

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

  // Synchronize rowModesModel with current rows - uses functional update to avoid
  // having rowModesModel in dependencies (which would cause potential infinite loops)
  useEffect(() => {
    setRowModesModel(prevRowModesModel => {
      // Build new model based on current rows, preserving existing modes
      const updatedRowModesModel = rows.reduce((acc, row) => {
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
  }, [rows]); // Only depend on rows - rowModesModel accessed via functional update

  const fetchFullData = useCallback(async () => {
    setIsMutating(true);
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
    } finally {
      setIsMutating(false);
    }
  }, [filterModel, currentPlot, currentCensus, currentSite, gridType, paginationModel.page, paginationModel.pageSize]);

  const exportAllCSV = useCallback(async () => {
    setIsMutating(true);
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
    } finally {
      setIsMutating(false);
    }
  }, [currentPlot, currentCensus, currentSite, gridType, filterModel, fetchFullData, setSnackbar]);

  const openConfirmationDialog = useCallback(
    (actionType: 'save' | 'delete', actionId: GridRowId) => {
      setPendingAction({ actionType, actionId });

      const row = rows.find(row => String(row.id) === String(actionId));
      if (row) {
        if (actionType === 'delete') {
          setIsDeleteDialogOpen(true);
        } else {
          setIsDialogOpen(true);
        }
      }
    },
    [rows]
  );

  const updateRow = useCallback(
    async (
      gridType: string,
      schemaName: string | undefined,
      newRow: GridRowModel,
      oldRow: GridRowModel,
      setSnackbar: (value: { children: string; severity: 'error' | 'success' }) => void,
      setIsNewRowAdded: (value: boolean) => void,
      setShouldAddRowAfterFetch: (value: boolean) => void,
      refetchData: () => Promise<unknown>,
      _paginationModel: { page: number }
    ): Promise<GridRowModel> => {
      const gridID = getGridID(gridType);
      if ('date' in newRow && newRow.date) {
        const parsedDate = moment(newRow.date, 'YYYY-MM-DD', true);
        if (parsedDate.isValid()) {
          newRow.date = parsedDate.format('YYYY-MM-DD');
        }
      }
      let fetchProcessQuery =
        gridType !== 'quadrats'
          ? createPostPatchQuery(schemaName ?? '', gridType, gridID)
          : createPostPatchQuery(schemaName ?? '', gridType, gridID, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID);
      if (adminEmail) fetchProcessQuery = `/api/administrative/fetch/${gridType}?email=${encodeURIComponent(adminEmail)}`;
      try {
        setIsMutating(true);
        const response = await fetch(fetchProcessQuery, {
          method: oldRow.isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
        });
        let responseJSON;
        try {
          responseJSON = await response.json();
        } catch (e: unknown) {
          ailogger.error('Error parsing response JSON:', e instanceof Error ? e : new Error(String(e)));
        }

        if (!response.ok) {
          throw new Error(responseJSON.message || 'An unknown error occurred');
        }

        setSnackbar({
          children: oldRow.isNew ? 'New row added!' : 'Row updated!',
          severity: 'success'
        });

        if (oldRow.isNew) {
          setIsNewRowAdded(false);
          setShouldAddRowAfterFetch(false);
          await refetchData();
        }

        return newRow;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setSnackbar({ children: `Error: ${message}`, severity: 'error' });
        return Promise.reject(newRow);
      } finally {
        setIsMutating(false);
      }
    },
    [currentPlot?.plotID, currentCensus?.dateRanges, adminEmail]
  );

  const performSaveAction = useCallback(
    async (id: GridRowId, confirmedRow: GridRowModel) => {
      if (locked || !promiseArguments) return;

      setIsMutating(true);
      try {
        // Confirmation-driven saves already persist via updateRow below. When the
        // row mode flips back to view, MUI will invoke processRowUpdate; skip the
        // next invocation so the row is not patched a second time.
        skipNextProcessRowUpdateRef.current = true;
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View }
        }));

        const isNewRow = promiseArguments.oldRow.isNew || !confirmedRow.id;
        const updatedRow =
          editFlowOverride && !isNewRow
            ? await editFlowOverride(confirmedRow, promiseArguments.oldRow)
            : await updateRow(
                gridType,
                currentSite?.schemaName,
                confirmedRow,
                promiseArguments.oldRow,
                setSnackbar,
                setIsNewRowAdded,
                setShouldAddRowAfterFetch,
                refetch,
                paginationModel
              );

        promiseArguments.resolve(updatedRow);

        if (onDataUpdate) {
          await onDataUpdate(updatedRow, promiseArguments.oldRow);
        }
      } catch (error) {
        promiseArguments.reject(error);
      } finally {
        setIsMutating(false);
      }

      triggerRefresh([gridType as keyof UnifiedValidityFlags]);
      await refetch();
    },
    [
      locked,
      promiseArguments,
      gridType,
      currentSite,
      setSnackbar,
      setIsNewRowAdded,
      setShouldAddRowAfterFetch,
      paginationModel,
      triggerRefresh,
      refetch,
      updateRow,
      onDataUpdate,
      editFlowOverride
    ]
  );

  const performDeleteAction = useCallback(
    async (id: GridRowId) => {
      if (locked) return;

      setIsMutating(true);

      const rowToDelete = rows.find(row => String(row.id) === String(id));
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
          setSnackbar({
            children: 'Row successfully deleted',
            severity: 'success'
          });
          triggerRefresh([gridType as keyof UnifiedValidityFlags]);
          await refetch();
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Deletion failed';
        setSnackbar({
          children: `Error: ${message}`,
          severity: 'error'
        });
      } finally {
        setIsMutating(false);
      }
    },
    [locked, rows, currentSite, gridType, setSnackbar, triggerRefresh, adminEmail, refetch]
  );

  const handleConfirmAction = useCallback(
    async (confirmedRow?: GridRowModel) => {
      setIsDialogOpen(false);
      setIsDeleteDialogOpen(false);

      if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
        await performDeleteAction(pendingAction.actionId);
      } else if (promiseArguments) {
        try {
          const resolvedRow = confirmedRow || promiseArguments.newRow;
          await performSaveAction(promiseArguments.newRow.id, resolvedRow);
          setSnackbar({ children: 'Row successfully updated!', severity: 'success' });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          setSnackbar({ children: `Error: ${message}`, severity: 'error' });
        }
      }

      setPendingAction({ actionType: '', actionId: null });
      setPromiseArguments(null);
    },
    [pendingAction, promiseArguments, performDeleteAction, performSaveAction, setSnackbar]
  );

  const handleCancelAction = useCallback(() => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null);
  }, [promiseArguments]);

  const handleSaveClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;

      const updatedRowModesModel = { ...rowModesModel };
      if (!updatedRowModesModel[id] || updatedRowModesModel[id].mode === undefined) {
        updatedRowModesModel[id] = { mode: GridRowModes.View };
      }

      const oldRow = rows.find(row => String(row.id) === String(id));

      const updatedRow = localApiRef.current?.getRowWithUpdatedValues(id, 'anyField');

      if (oldRow && updatedRow) {
        setPromiseArguments({
          resolve: (_value: GridRowModel) => {},
          reject: (_reason?: unknown) => {},
          oldRow,
          newRow: updatedRow
        });

        openConfirmationDialog('save', id);
      }
    },
    [locked, rowModesModel, rows, localApiRef, openConfirmationDialog]
  );

  const handleDeleteClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      if (gridType === 'census') {
        const rowToDelete = rows.find(row => String(row.id) === String(id));
        if (currentCensus && rowToDelete && rowToDelete.censusID === currentCensus.dateRanges?.[0]?.censusID) {
          alert('Cannot delete the currently selected census.');
          return;
        }
      }
      openConfirmationDialog('delete', id);
    },
    [locked, gridType, currentCensus, rows, openConfirmationDialog]
  );

  const handleAddNewRow = useCallback(async () => {
    if (locked) return;
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

  useImperativeHandle(ref, () => ({
    updateRow: async (newRow: GridRowModel, oldRow: GridRowModel) => {
      return await updateRow(
        gridType,
        currentSite?.schemaName,
        newRow,
        oldRow,
        setSnackbar,
        setIsNewRowAdded,
        setShouldAddRowAfterFetch,
        refetch,
        paginationModel
      );
    },
    fetchPaginatedData: async () => {
      await refetch();
    },
    showSnackbar: (message: string, severity: 'success' | 'error') => {
      setSnackbar({ children: message, severity });
    }
  }));

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      if (skipNextProcessRowUpdateRef.current) {
        skipNextProcessRowUpdateRef.current = false;
        return newRow;
      }

      if (newRow?.isNew && !newRow?.id) {
        return oldRow;
      }

      setIsMutating(true);

      if (newRow.isNew || !newRow.id) {
        setPromiseArguments({
          resolve: async (confirmedRow: GridRowModel) => {
            try {
              const updatedRow = await updateRow(
                gridType,
                currentSite?.schemaName,
                confirmedRow,
                oldRow,
                setSnackbar,
                setIsNewRowAdded,
                setShouldAddRowAfterFetch,
                refetch,
                paginationModel
              );
              return updatedRow;
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              setSnackbar({ children: `Error: ${message}`, severity: 'error' });
              return Promise.reject(error);
            } finally {
              setIsMutating(false);
            }
          },
          reject: reason => {
            setIsMutating(false);
            return Promise.reject(reason);
          },
          oldRow,
          newRow
        });

        openConfirmationDialog('save', newRow.id);
        return Promise.reject(new Error('Row update interrupted for new row, awaiting confirmation'));
      }

      try {
        const updatedRow = editFlowOverride
          ? await editFlowOverride(newRow, oldRow)
          : await updateRow(
              gridType,
              currentSite?.schemaName,
              newRow,
              oldRow,
              setSnackbar,
              setIsNewRowAdded,
              setShouldAddRowAfterFetch,
              refetch,
              paginationModel
            );
        return updatedRow;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setSnackbar({ children: `Error: ${message}`, severity: 'error' });
        return Promise.reject(error);
      } finally {
        setIsMutating(false);
      }
    },
    [
      gridType,
      currentSite?.schemaName,
      setSnackbar,
      setIsNewRowAdded,
      setShouldAddRowAfterFetch,
      refetch,
      paginationModel,
      openConfirmationDialog,
      updateRow,
      editFlowOverride
    ]
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
      return updatedModel;
    });
  }, []);

  const handleCloseSnackbar = useCallback(() => setSnackbar(null), []);

  const handleRowEditStop = useCallback<GridEventListener<'rowEditStop'>>((params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  }, []);

  const handleEditClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
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
    [locked, localApiRef, gridColumns]
  );

  const handleCancelClick = useCallback(
    (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
      if (locked) return;
      event?.preventDefault();

      const row = rows.find(row => String(row.id) === String(id));

      if (row?.isNew) {
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
    [locked, rows]
  );

  // Debounced filter change to prevent excessive re-renders and API calls
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timers on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (editClickTimerRef.current) {
        clearTimeout(editClickTimerRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const onQuickFilterChange = useCallback((incomingValues: GridFilterModel) => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer to update filter after 500ms of inactivity
    debounceTimerRef.current = setTimeout(() => {
      setFilterModel(prevFilterModel => {
        return {
          ...prevFilterModel,
          items: [...(incomingValues.items || [])],
          quickFilterValues: [...(incomingValues.quickFilterValues || [])]
        };
      });
    }, 500);
  }, []);

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
                    ? 'Delete this row (cannot be undone!)'
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
      flex: 1,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        if (!rowModesModel[id]?.mode) return [];
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;
        if (isInEditMode && !locked) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: React.MouseEvent<HTMLButtonElement>) => handleCancelClick(id, e))
          ];
        }
        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    }),
    [rowModesModel, locked, getEnhancedCellAction, handleSaveClick, handleCancelClick, handleEditClick, handleDeleteClick]
  );

  const columns = useMemo(() => {
    return [...applyFilterToColumns(gridColumns), ...(locked ? [] : [getGridActionsColumn()])];
  }, [gridColumns, locked, getGridActionsColumn]);

  const filteredColumns = useMemo(() => {
    if (hidingEmpty) return filterColumns(rows, columns);
    else return columns;
  }, [rows, columns, hidingEmpty]);

  const handleCellDoubleClick: GridEventListener<'cellDoubleClick'> = params => {
    if (locked) return;
    setRowModesModel(prevModel => ({
      ...prevModel,
      [params.id]: { mode: GridRowModes.Edit }
    }));
  };

  const handleCellKeyDown: GridEventListener<'cellKeyDown'> = (_params, event) => {
    if (event.key === 'Enter' && !locked) {
      event.defaultMuiPrevented = true;
    }
    if (event.key === 'Escape') {
      event.defaultMuiPrevented = true;
    }
  };

  // Grid types under "Stem & Plot Details" that don't require a census selection
  const censusIndependentGridTypes = ['attributes', 'personnel', 'quadrats', 'alltaxonomiesview'];
  const requiresCensus = !censusIndependentGridTypes.includes(gridType);

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
          <LoadingBar active={isValidating && !!gridData} />
          {isLoading && !gridData ? (
            <ContentSkeleton kind="grid-rows" count={paginationModel.pageSize} />
          ) : (
            <StyledDataGrid
              apiRef={localApiRef}
              sx={{ width: '100%' }}
              rows={rows}
              columns={filteredColumns}
              editMode="row"
              rowModesModel={rowModesModel}
              disableColumnSelector
              onRowModesModelChange={handleRowModesModelChange}
              onRowEditStop={handleRowEditStop}
              onCellDoubleClick={handleCellDoubleClick}
              onCellKeyDown={handleCellKeyDown}
              processRowUpdate={async (newRow, oldRow) => {
                const waitForStateUpdates = async () => {
                  return new Promise<void>(resolve => {
                    const checkUpdates = () => {
                      if (rows.length > 0 && Object.keys(rowModesModel).length > 0) {
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
                  ailogger.error('Error processing row update:', error instanceof Error ? error : new Error(String(error)));
                  setSnackbar({ children: 'Error updating row', severity: 'error' });
                  return Promise.reject(error);
                }
              }}
              onProcessRowUpdateError={(error: Error) => {
                ailogger.error('Row update error:', error);
                setSnackbar({
                  children: 'Error updating row',
                  severity: 'error'
                });
              }}
              loading={false}
              paginationMode="server"
              filterMode="server"
              onPaginationModelChange={setPaginationModel}
              paginationModel={paginationModel}
              rowCount={rowCount}
              pageSizeOptions={[paginationModel.pageSize, paginationModel.pageSize * 5, paginationModel.pageSize * 10]}
              onFilterModelChange={newFilterModel => {
                setFilterModel(prevModel => ({
                  ...prevModel,
                  ...newFilterModel
                }));
              }}
              ignoreDiacritics
              initialState={{
                columns: {
                  columnVisibilityModel: getColumnVisibilityModel(gridType)
                }
              }}
              slots={{
                toolbar: EditToolbar
              }}
              slotProps={{
                toolbar: {
                  handleAddNewRow: handleAddNewRow,
                  handleRefresh: handleRefresh,
                  handleExportAll: fetchFullData,
                  handleExportCSV: exportAllCSV,
                  handleQuickFilterChange: onQuickFilterChange,
                  filterModel: filterModel,
                  dynamicButtons: dynamicButtons,
                  gridColumns: gridColumns,
                  gridType: gridType,
                  hidingEmpty: hidingEmpty,
                  setHidingEmpty: setHidingEmpty
                } as GridToolbarProps & Partial<EditToolbarCustomProps>
              }}
              showToolbar
              getRowHeight={() => 'auto'}
            />
          )}
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
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
            content="Are you sure you want to delete this row? This action cannot be undone."
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
