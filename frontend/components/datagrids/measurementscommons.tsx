// measurementcommons datagrid
'use client';
import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/errorboundary';
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
  GridToolbarProps,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertColor, AlertProps, AlertPropsColorOverrides, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
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
  IconButton,
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
  EditToolbarCustomProps,
  ExtendedGridFilterModel,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  MeasurementsCommonsProps,
  PendingAction,
  sortRowsByMeasurementDate,
  TSSFilter,
  VisibleFilter
} from '@/config/datagridhelpers';
import { CMError, CoreMeasurementError, ErrorMap, ValidationPair } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { redirect } from 'next/navigation';
import moment from 'moment';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { bitToBoolean, HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';
import ConfirmationDialog from '../client/modals/confirmationdialog';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';
import { applyFilterToColumns } from '@/components/datagrids/filtrationsystem';
import { formatHeader, InputChip } from '@/components/client/datagridcolumns';
import { OverridableStringUnion } from '@mui/types';
import ValidationOverrideModal from '@/components/client/modals/validationoverridemodal';
import { MeasurementsSummaryResult } from '@/config/sqlrdsdefinitions/views';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS, AttributesResult } from '@/config/sqlrdsdefinitions/core';
import ValidationCore from '@/components/client/validationcore';
import { ArrowRightAlt, CallSplit, Forest, Grass } from '@mui/icons-material';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';
import { debounce, EditToolbar } from '../client/datagridelements';
import { loadSelectableOptions } from '@/components/client/clientmacros';
import Avatar from '@mui/joy/Avatar';
import ailogger from '@/ailogger';
import ValidationActionsMenu from '@/components/client/validationactionsmenu';

export function EditMeasurements({ params }: { params: GridRenderEditCellParams }) {
  const initialValue = params.value ? Number(params.value).toFixed(2) : '0.00';
  const [value, setValue] = useState(initialValue);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;

    if (/^\d*\.?\d{0,2}$/.test(newValue) || newValue === '') {
      setValue(newValue);
    }
  };

  const handleBlur = () => {
    if (!isMountedRef.current) return;
    const formattedValue = parseFloat(value).toFixed(2);
    params.api.setEditCellValue({ id: params.id, field: params.field, value: parseFloat(value) === 0 ? null : parseFloat(formattedValue) });
  };

  return (
    <Input
      aria-label={'edit measurements input'}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      size="sm"
      sx={{ width: '100%', height: '100%' }}
      type="text"
    />
  );
}

function MeasurementsCommonsInner(props: Readonly<MeasurementsCommonsProps>) {
  const {
    addNewRowToGrid,
    gridType,
    gridColumns,
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
    dynamicButtons,
    failedTrigger
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isValidationOverrideModalOpen, setIsValidationOverrideModalOpen] = useState(false);
  const [isResetValidationModalOpen, setIsResetValidationModalOpen] = useState(false);
  const [isSingleCMVErrorOpen, setIsSingleCMVErrorOpen] = useState(false);
  const [cmvSelected, setCMVSelected] = useState(-1);
  const [isClearingErrors, setIsClearingErrors] = useState(false);
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: any) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  // const [usingQuery, setUsingQuery] = useState('');
  const [isSaveHighlighted, setIsSaveHighlighted] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ErrorMap>({});
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true);
  const [showValidRows, setShowValidRows] = useState<boolean>(true);
  const showPendingRows = true;
  const setShowPendingRows = () => {};
  // tree-stem-state
  const [showOT, setShowOT] = useState<boolean>(true);
  const [showMS, setShowMS] = useState<boolean>(true);
  const [showNR, setShowNR] = useState<boolean>(true);

  const [hidingEmpty, setHidingEmpty] = useState(true);
  const [filterModel, setFilterModel] = useState<ExtendedGridFilterModel>({
    items: [],
    quickFilterValues: [],
    visible: [
      ...(showErrorRows ? (['errors'] as VisibleFilter[]) : []),
      ...(showValidRows ? (['valid'] as VisibleFilter[]) : []),
      ...(showPendingRows ? (['pending'] as VisibleFilter[]) : [])
    ],
    tss: [
      ...(showOT ? (['old tree'] as TSSFilter[]) : []),
      ...(showMS ? (['multi stem'] as TSSFilter[]) : []),
      ...(showNR ? (['new recruit'] as TSSFilter[]) : [])
    ]
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);
  const [errorCount, setErrorCount] = useState<number>(0);
  const [validCount, setValidCount] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [otCount, setOTCount] = useState<number>(0);
  const [msCount, setMSCount] = useState<number>(0);
  const [nrCount, setNRCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [selectableAttributes, setSelectableAttributes] = useState<string[]>([]);
  const [attributesMap, setAttributesMap] = useState<Map<string, AttributesRDS>>(new Map());
  const [selectableOpts, setSelectableOpts] = useState<{ [optName: string]: string[] }>({
    tag: [],
    stemTag: [],
    quadrat: [],
    spCode: []
  });
  const [reloadAttrs, setReloadAttrs] = useState(true);

  // const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

  // context pulls and definitions
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { setLoading } = useLoading();
  // use the session
  const { data: session } = useSession();

  const apiRef = useGridApiRef();

  // Define refreshCounts early so it can be used in other hooks
  const refreshCounts = useCallback(async () => {
    if (!currentSite || !currentPlot || !currentCensus) return;

    try {
      const query = `SELECT SUM(CASE WHEN vft.IsValidated = TRUE THEN 1 ELSE 0 END)  AS CountValid,
                            SUM(CASE WHEN vft.IsValidated = FALSE THEN 1 ELSE 0 END) AS CountErrors,
                            SUM(CASE WHEN vft.IsValidated IS NULL THEN 1 ELSE 0 END) AS CountPending,
                            SUM(CASE WHEN JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('old tree'), '$.treestemstate') = 1 THEN 1 ELSE 0 END) AS CountOldTrees,
                            SUM(CASE WHEN JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('new recruit'), '$.treestemstate') = 1 THEN 1 ELSE 0 END) AS CountNewRecruits,
                            SUM(CASE WHEN JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('multi stem'), '$.treestemstate') = 1 THEN 1 ELSE 0 END) AS CountMultiStems
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
      const countsData = data[0];

      setValidCount(countsData.CountValid);
      setErrorCount(countsData.CountErrors);
      setPendingCount(countsData.CountPending);
      setOTCount(countsData.CountOldTrees);
      setMSCount(countsData.CountMultiStems);
      setNRCount(countsData.CountNewRecruits);

      const counts = [
        { count: countsData.CountErrors, message: `${countsData.CountErrors} row(s) with validation errors detected.`, severity: 'warning' },
        { count: countsData.CountPending, message: `${countsData.CountPending} row(s) pending validation.`, severity: 'info' },
        { count: countsData.CountValid, message: `${countsData.CountValid} row(s) passed validation.`, severity: 'success' }
      ];
      const highestCount = counts.reduce((prev, current) => (current.count > prev.count ? current : prev));
      if (highestCount.count !== null) {
        setSnackbar({
          children: highestCount.message,
          severity: highestCount.severity as OverridableStringUnion<AlertColor, AlertPropsColorOverrides> | undefined
        });
      }

      const failedQuery = `SELECT COUNT(*) AS CountFailed FROM ${currentSite.schemaName}.failedmeasurements WHERE PlotID = ${currentPlot.plotID} AND CensusID = ${currentCensus.dateRanges[0].censusID}`;
      const failedResponse = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(failedQuery)
      });
      if (!failedResponse.ok) throw new Error('measurementscommon failure. runquery execution for failedmeasurements count failed');
      const failedData = await failedResponse.json();
      setFailedCount(failedData[0].CountFailed);
    } catch (error: any) {
      ailogger.error('Error refreshing counts:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite, currentPlot, currentCensus, gridType]);

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

  const fetchPaginatedData = useCallback(
    (pageToFetch: number) =>
      debounce(async () => {
        if (!currentSite || !currentPlot || !currentCensus) {
          ailogger.warn('Missing necessary context for fetchPaginatedData');
          return;
        }

        setLoading(true);
        let paginatedQuery = '';

        paginatedQuery = createQFFetchQuery(
          currentSite?.schemaName ?? '',
          gridType,
          pageToFetch,
          paginationModel.pageSize,
          currentPlot?.plotID,
          currentCensus?.plotCensusNumber
        );

        try {
          // Filter to only include valid, complete filter items (Bug #1 fix)
          const validItems =
            filterModel.items?.filter(item => {
              // Field and operator are always required
              if (!item.field || item.field === '' || !item.operator || item.operator === '') {
                return false;
              }
              // isEmpty/isNotEmpty operators don't require a value
              if (item.operator === 'isEmpty' || item.operator === 'isNotEmpty') {
                return true;
              }
              // All other operators require a value
              return item.value !== undefined && item.value !== null && item.value !== '';
            }) ?? [];

          const sanitizedFilterModel = {
            ...filterModel,
            items: validItems
          };

          const response = await fetch(paginatedQuery, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filterModel: sanitizedFilterModel })
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.message || 'Error fetching data');

          setRows(data.output);
          setRowCount(data.totalCount);
          // setUsingQuery(data.finishedQuery);

          if (isNewRowAdded && pageToFetch === newLastPage) {
            addNewRowToGrid();
          }
        } catch (error: any) {
          ailogger.error('Error fetching data:', error);
          setSnackbar({ children: 'Error fetching data', severity: 'error' });
        } finally {
          setLoading(false);
        }
      }, 250)(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filterModel,
      currentSite,
      currentPlot,
      currentCensus,
      paginationModel.page,
      paginationModel.pageSize,
      isNewRowAdded,
      newLastPage,
      gridType,
      addNewRowToGrid
    ]
  );

  const fetchValidationErrors = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}&plotIDParam=${currentPlot?.plotID ?? ''}&censusPCNParam=${currentCensus?.plotCensusNumber ?? ''}`
      );
      if (!response.ok) throw new Error('Failed to fetch validation errors');
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
    } catch (error: any) {
      ailogger.error('Error fetching validation errors:', error);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber]);

  const runFetchPaginated = useCallback(async () => {
    await fetchPaginatedData(paginationModel.page);
    await fetchValidationErrors();
  }, [fetchPaginatedData, paginationModel.page, fetchValidationErrors]);

  useEffect(() => {
    setFilterModel(prevModel => ({
      ...prevModel,
      visible: [
        ...(showErrorRows ? (['errors'] as VisibleFilter[]) : []),
        ...(showValidRows ? (['valid'] as VisibleFilter[]) : []),
        ...(showPendingRows ? (['pending'] as VisibleFilter[]) : [])
      ],
      tss: [
        ...(showOT ? (['old tree'] as TSSFilter[]) : []),
        ...(showMS ? (['multi stem'] as TSSFilter[]) : []),
        ...(showNR ? (['new recruit'] as TSSFilter[]) : [])
      ]
    }));
    setRefresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrorRows, showValidRows, showPendingRows, showOT, showMS, showNR]);

  // Handle refresh signal - use ref to track previous state to avoid infinite rerender
  const previousRefresh = useRef(refresh);
  useEffect(() => {
    // Only refresh when transitioning from false to true
    if (refresh && !previousRefresh.current) {
      Promise.all([runFetchPaginated(), refreshCounts()])
        .then(() => setRefresh(false))
        .catch(ailogger.error);
    }
    previousRefresh.current = refresh;
  }, [refresh, runFetchPaginated, refreshCounts, setRefresh]);

  useEffect(() => {
    loadSelectableOptions(currentSite, currentPlot, currentCensus, setSelectableOpts).catch(ailogger.error);
  }, [currentSite, currentPlot, currentCensus]);
  // helper functions for usage:
  const handleSortModelChange = (newModel: GridSortModel) => {
    setSortModel(newModel);

    if (newModel.length > 0) {
      const { field, sort } = newModel[0];
      if (field === 'measurementDate') {
        const sortedRows = sortRowsByMeasurementDate(rows, sort);
        setRows(sortedRows);
      }
    }
  };

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
        `/api/formdownload/measurements/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}/${JSON.stringify(tempFilter)}`,
        { method: 'GET' }
      );
      const data = await response.json();
      let csvRows =
        getTableHeaders(FormType.measurements)
          .map(row => row.label)
          .join(',') + '\n';
      data.forEach((row: any) => {
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
          if (header === 'StemGUID' || header === 'TreeID') return Number(row[header]);
          if (header === 'IsValidated') return bitToBoolean(row[header]);
          if (header === 'MeasurementDate') return moment(new Date(row[header as keyof MeasurementsSummaryResult])).format('YYYY-MM-DD');
          if (Object.prototype.toString.call(row[header as keyof MeasurementsSummaryResult]) === '[object Object]')
            return `"${JSON.stringify(row[header as keyof MeasurementsSummaryResult]).replace(/"/g, '""')}"`;
          const value = row[header as keyof MeasurementsSummaryResult];
          if (typeof value === 'string' && value.includes(',')) return `"${value.replace(/"/g, '""')}"`;
          return value ?? 'NULL';
        });
        csvRows += rowValues.join(',') + '\n';
      });
      return csvRows;
    }
  };

  const updateRow = async (
    gridType: string,
    schemaName: string | undefined,
    newRow: GridRowModel,
    oldRow: GridRowModel,
    setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, 'children' | 'severity'> | null>>,
    setIsNewRowAdded: (value: boolean) => void,
    setShouldAddRowAfterFetch: (value: boolean) => void,
    fetchPaginatedData: (page: number) => Promise<void>,
    paginationModel: { page: number }
  ): Promise<GridRowModel> => {
    const gridID = getGridID(gridType);
    const fetchProcessQuery = createPostPatchQuery(schemaName ?? '', gridType, gridID);
    newRow.measurementDate = moment(newRow.measurementDate).format('YYYY-MM-DD');
    newRow.userDefinedFields = JSON.stringify(newRow.userDefinedFields);
    try {
      const response = await fetch(fetchProcessQuery, {
        method: oldRow.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
      });

      const responseJSON = await response.json();

      if (!response.ok) {
        setSnackbar({
          children: `Error: ${responseJSON.message}`,
          severity: 'error'
        });
        return Promise.reject(responseJSON.row);
      }

      setSnackbar({
        children: oldRow.isNew ? 'New row added!' : 'Row updated!',
        severity: 'success'
      });

      if (oldRow.isNew) {
        setIsNewRowAdded(false);
        setShouldAddRowAfterFetch(false);
        await fetchPaginatedData(paginationModel.page);
        await fetchValidationErrors();
      }

      return newRow;
    } catch (error: any) {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow);
    }
  };

  const openConfirmationDialog = useCallback(
    (actionType: 'save' | 'delete', actionId: GridRowId) => {
      setPendingAction({ actionType, actionId });
      const row = rows.find(row => String(row.id) === String(actionId));
      if (row) {
        if (actionType === 'delete') {
          setIsDeleteDialogOpen(true);
        } else {
          setIsDialogOpen(true);
          setRowModesModel(oldModel => ({
            ...oldModel,
            [actionId]: { mode: GridRowModes.View }
          }));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

  const handleConfirmAction = async () => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (pendingAction.actionType === 'save' && pendingAction.actionId !== null && promiseArguments) {
      await performSaveAction(pendingAction.actionId);
    } else if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
      await performDeleteAction(pendingAction.actionId);
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  };

  const performSaveAction = async (id: GridRowId) => {
    if (locked || !promiseArguments) return;
    setLoading(true, 'Saving changes...');
    try {
      const updatedRow = await updateRow(
        gridType,
        currentSite?.schemaName,
        promiseArguments.newRow,
        promiseArguments.oldRow,
        setSnackbar,
        setIsNewRowAdded,
        setShouldAddRowAfterFetch,
        fetchPaginatedData,
        paginationModel
      );
      promiseArguments.resolve(updatedRow);
    } catch (error) {
      promiseArguments.reject(error);
    }
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);

    if (reloadAttrs) {
      try {
        const response = await fetch(`/api/query`, {
          method: 'POST',
          body: JSON.stringify(`SELECT * FROM ${currentSite?.schemaName}.attributes;`)
        });
        const data = MapperFactory.getMapper<AttributesRDS, AttributesResult>('attributes').mapData(await response.json());
        setSelectableAttributes(data.map(i => i.code).filter((code): code is string => code !== undefined));
        // Create a map for quick lookup of attribute details by code
        const attrMap = new Map<string, AttributesRDS>();
        data.forEach(attr => {
          if (attr.code) attrMap.set(attr.code, attr);
        });
        setAttributesMap(attrMap);
        setReloadAttrs(false);
      } catch (e: any) {
        ailogger.error('Failed to reload attributes:', e);
      }
    }

    try {
      await fetchValidationErrors();
    } catch (e: any) {
      ailogger.error('Failed to fetch validation errors:', e);
    } finally {
      setLoading(false);
    }
  };

  const performDeleteAction = async (id: GridRowId) => {
    if (locked) return;
    setLoading(true, 'Deleting...');
    const deletionID = rows.find(row => String(row.id) === String(id))?.id;
    if (!deletionID) return;
    const deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', gridType, getGridID(gridType), deletionID);
    const response = await fetch(deleteQuery, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        oldRow: undefined,
        newRow: rows.find(row => String(row.id) === String(id))!
      })
    });
    setLoading(false);
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
        children: 'Row successfully deleted',
        severity: 'success'
      });
      setRows(rows.filter(row => String(row.id) !== String(id)));
      try {
        setLoading(true, 'Refreshing Measurements Summary View...');
        const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
        if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e: any) {
        ailogger.error(e);
      } finally {
        setLoading(false);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // forced delay
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleSaveClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      openConfirmationDialog('save', id);
    },
    [locked, openConfirmationDialog]
  );

  const handleDeleteClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      openConfirmationDialog('delete', id);
    },
    [locked, openConfirmationDialog]
  );

  useEffect(() => {
    if (currentPlot && currentCensus && paginationModel.page >= 0) {
      runFetchPaginated().catch(ailogger.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlot, currentCensus, paginationModel.page, sortModel, filterModel]);

  useEffect(() => {
    refreshCounts().catch(ailogger.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlot, currentCensus, currentSite]);

  const processRowUpdate = useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>((resolve, reject) => {
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
    [locked, rows, rowCount, paginationModel, isNewRowAdded, handleSelectQuadrat, setRows, setIsNewRowAdded, setPaginationModel, setRowModesModel]
  );

  const getEnhancedCellAction = useCallback(
    (type: string, icon: any, onClick: any) => (
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

  const getGridActionsColumn = useCallback((): GridColDef => {
    return {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        const isInEditMode = rowModesModel[id]?.mode === 'edit';

        if (isInEditMode) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e))
          ];
        }

        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    };
  }, [rowModesModel, getEnhancedCellAction, handleSaveClick, handleCancelClick, handleEditClick, handleDeleteClick]);

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
            <Tooltip title={`Click to review errors!`} size="md">
              <IconButton
                onClick={() => {
                  setCMVSelected(params.row.coreMeasurementID ?? -1);
                  setIsSingleCMVErrorOpen(true);
                }}
              >
                <ErrorIcon color="error" />
              </IconButton>
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
      valueFormatter: value => {
        if (!value || !moment(value).utc().isValid()) {
          return '';
        }
        return moment(value).utc().format('YYYY-MM-DD');
      }
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
                options={[...(selectableOpts[column.field] || [])].sort((a, b) => a.localeCompare(b))}
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
                    color: 'error.main',
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

  function onQuickFilterChange(incomingValues: GridFilterModel) {
    setFilterModel(prevFilterModel => {
      return {
        ...prevFilterModel,
        quickFilterValues: [...(incomingValues.quickFilterValues || [])]
      };
    });
  }

  async function handleCloseModal(closeModal: Dispatch<SetStateAction<boolean>>, shouldRefresh: boolean = false) {
    closeModal(false);
    if (!shouldRefresh) return;

    try {
      setLoading(true, 'Refreshing Measurements Summary View...');
      const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
      if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e: any) {
      ailogger.error(e);
    } finally {
      setLoading(false);
    }
    await runFetchPaginated();
  }

  async function handleResetValidations() {
    try {
      const clearCMVQuery = `DELETE cmv
                             FROM ${currentSite?.schemaName}.cmverrors AS cmv
                                    JOIN ${currentSite?.schemaName}.coremeasurements AS cm
                                         ON cmv.CoreMeasurementID = cm.CoreMeasurementID
                                    JOIN ${currentSite?.schemaName}.census AS c
                                         ON c.CensusID = cm.CensusID
                             WHERE c.CensusID IN (SELECT CensusID
                                                  from ${currentSite?.schemaName}.census
                                                  WHERE PlotID = ${currentPlot?.plotID}
                                                    AND PlotCensusNumber = ${currentCensus?.plotCensusNumber})
                               AND c.PlotID = ${currentPlot?.plotID}
                               AND (cm.IsValidated = 0 OR cm.IsValidated IS NULL);`;
      const query = `UPDATE ${currentSite?.schemaName}.coremeasurements AS cm
        JOIN ${currentSite?.schemaName}.census AS c ON c.CensusID = cm.CensusID
                     SET cm.IsValidated = NULL
                     WHERE c.CensusID IN (SELECT CensusID
                                          from ${currentSite?.schemaName}.census
                                          WHERE PlotID = ${currentPlot?.plotID}
                                            AND PlotCensusNumber = ${currentCensus?.plotCensusNumber})
                       AND c.PlotID = ${currentPlot?.plotID}`;
      const clearCMVResponse = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clearCMVQuery)
      });
      if (!clearCMVResponse.ok) {
        const errorData = await clearCMVResponse.json();
        ailogger.error('Clear CMVErrors query failed:', errorData);
        throw new Error(`Clear cmverrors query failed: ${errorData.error || 'Unknown error'}`);
      }
      const response = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
      });
      if (!response.ok) {
        const errorData = await response.json();
        ailogger.error('Validation reset query failed:', errorData);
        throw new Error(`Validation reset failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      ailogger.error('Error in handleResetValidations:', error);
      throw error;
    }
  }

  if (!currentSite || !currentPlot || !currentCensus) {
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
        <Box sx={{ width: '100%', flexDirection: 'column' }}>
          <StyledDataGrid
            apiRef={apiRef}
            sx={{ width: '100%' }}
            rows={rows}
            columns={filteredColumns}
            editMode="row"
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            loading={refresh}
            paginationMode="server"
            onPaginationModelChange={newPaginationModel => {
              setPaginationModel(newPaginationModel);
            }}
            onProcessRowUpdateError={(error: any) => {
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
            rowCount={rowCount}
            onRowCountChange={handleRowCountChange}
            pageSizeOptions={[10, 25, 50, 100]}
            sortModel={sortModel}
            onSortModelChange={handleSortModelChange}
            filterModel={filterModel}
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
                locked: locked,
                handleAddNewRow: handleAddNewRow,
                handleRefresh: async () => setRefresh(true),
                handleExport: fetchRowsForExport,
                handleQuickFilterChange: onQuickFilterChange,
                filterModel: filterModel,
                gridColumns: gridColumns,
                gridType: FormType.measurements,
                dynamicButtons: dynamicButtons,
                validationMenu: (
                  <ValidationActionsMenu
                    onRunValidations={() => setIsValidationModalOpen(true)}
                    onOverrideValidations={() => setIsValidationOverrideModalOpen(true)}
                    onResetValidations={() => setIsResetValidationModalOpen(true)}
                    onRefreshView={async () => {
                      setLoading(true, 'Refreshing Measurements Summary View...');
                      try {
                        const response = await fetch(`/api/refreshviews/measurementssummary/${currentSite?.schemaName ?? ''}`, { method: 'POST' });
                        if (!response.ok) throw new Error('Measurements Summary View Refresh failure');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      } finally {
                        setLoading(false);
                        setRefresh(true);
                      }
                    }}
                    pendingCount={pendingCount}
                    errorCount={errorCount}
                  />
                ),
                errorControls: { show: showErrorRows, toggle: setShowErrorRows, count: errorCount },
                validControls: { show: showValidRows, toggle: setShowValidRows, count: validCount },
                pendingControls: { show: showPendingRows, toggle: setShowPendingRows, count: pendingCount },
                otControls: { show: showOT, toggle: setShowOT, count: otCount },
                msControls: { show: showMS, toggle: setShowMS, count: msCount },
                nrControls: { show: showNR, toggle: setShowNR, count: nrCount },
                hidingEmpty: hidingEmpty,
                setHidingEmpty: setHidingEmpty,
                failedControls: { trigger: failedTrigger, count: failedCount }
              } as GridToolbarProps & Partial<EditToolbarCustomProps>
            }}
            showToolbar
            getRowHeight={() => 'auto'}
            isCellEditable={() => !locked}
          />
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && (
          <SkipReEnterDataModal gridType={gridType} row={promiseArguments.newRow} handleClose={handleCancelAction} handleSave={handleConfirmAction} />
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
        {isDeleteDialogOpen && (
          <ConfirmationDialog
            open={isDeleteDialogOpen}
            onClose={handleCancelAction}
            onConfirm={handleConfirmAction}
            title="Confirm Deletion"
            content="Are you sure you want to delete this row? This action cannot be undone."
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
          <Modal open={isResetValidationModalOpen} onClose={async () => await handleCloseModal(setIsResetValidationModalOpen, false)}>
            <ModalDialog role={'alertdialog'}>
              <DialogTitle>Reset Validation States?</DialogTitle>
              <DialogContent>Are you sure you want to reset all validation states? </DialogContent>
              <DialogActions>
                <Button
                  onClick={async () => {
                    await handleResetValidations();
                    await handleCloseModal(setIsResetValidationModalOpen, true);
                  }}
                >
                  Yes
                </Button>
                <Button onClick={async () => await handleCloseModal(setIsResetValidationModalOpen, false)}>No</Button>
              </DialogActions>
            </ModalDialog>
          </Modal>
        )}
        {isSingleCMVErrorOpen && cmvSelected > 0 && (
          <Modal open={isSingleCMVErrorOpen} onClose={() => {}}>
            <ModalDialog role={'alertdialog'}>
              <DialogTitle>Details</DialogTitle>
              <DialogContent>
                The following validation errors were found in this row:
                <Stack direction={'column'} gap={1.5} sx={{ display: 'flex', flex: 1 }}>
                  {validationErrors[cmvSelected].errors.map((err, index) => (
                    <Stack key={index} direction={'column'} spacing={2} alignItems={'center'}>
                      {err.validationPairs.map((vp, index) => (
                        <Stack key={`${index}-stack`} direction={'row'}>
                          <Chip key={`${index}-cr`}>{vp.criterion}</Chip>
                          <ArrowRightAlt />
                          <Chip key={`${index}-desc`}>{vp.description}</Chip>
                        </Stack>
                      ))}
                    </Stack>
                  ))}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={async () => {
                    await handleCloseModal(setIsSingleCMVErrorOpen, false);
                    setCMVSelected(-1);
                  }}
                >
                  Close
                </Button>
                <Button
                  onClick={async () => {
                    setIsClearingErrors(true);
                    try {
                      const deleteResponse = await fetch(`/api/query`, {
                        method: 'POST',
                        body: JSON.stringify({
                          query: `DELETE FROM ??.cmverrors WHERE CoreMeasurementID = ?`,
                          params: [currentSite?.schemaName, cmvSelected],
                          format: true
                        })
                      });

                      if (!deleteResponse.ok) {
                        throw new Error('Failed to delete validation errors');
                      }

                      const updateResponse = await fetch(`/api/query`, {
                        method: 'POST',
                        body: JSON.stringify({
                          query: `UPDATE ??.coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = ?`,
                          params: [currentSite?.schemaName, cmvSelected],
                          format: true
                        })
                      });

                      if (!updateResponse.ok) {
                        throw new Error('Failed to update validation status');
                      }

                      await fetchValidationErrors();
                      await handleCloseModal(setIsSingleCMVErrorOpen, false);
                      setCMVSelected(-1);

                      setSnackbar({
                        children: 'Validation errors cleared successfully',
                        severity: 'success'
                      });
                    } catch (error: any) {
                      ailogger.error('Clear errors failed:', error);
                      setSnackbar({
                        children: `Failed to clear errors: ${error.message || 'Unknown error'}`,
                        severity: 'error'
                      });
                    } finally {
                      setIsClearingErrors(false);
                    }
                  }}
                  disabled={isClearingErrors}
                  startDecorator={isClearingErrors ? <CircularProgress size="sm" /> : undefined}
                >
                  {isClearingErrors ? 'Clearing...' : 'Clear Errors'}
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
export default function MeasurementsCommons(props: Readonly<MeasurementsCommonsProps>) {
  return (
    <ErrorBoundary componentName="MeasurementsCommons">
      <MeasurementsCommonsInner {...props} />
    </ErrorBoundary>
  );
}
