// measurementcommons datagrid
'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GridActionsCellItem,
  GridCellParams,
  GridColDef,
  GridEventListener,
  GridFilterModel,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridSortModel,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, Button, Checkbox, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import Box from '@mui/joy/Box';
import { Stack, Tooltip, Typography } from '@mui/joy';
import { StyledDataGrid } from '@/config/styleddatagrid';
import {
  CellItemContainer,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  EditToolbarCustomProps,
  errorMapping,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  MeasurementsCommonsProps,
  PendingAction,
  sortRowsByMeasurementDate
} from '@/config/datagridhelpers';
import { CMError } from '@/config/macros/uploadsystemmacros';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { redirect } from 'next/navigation';
import moment from 'moment';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';

import ConfirmationDialog from './confirmationdialog';
import ReEnterDataModal from './reentrydatamodal';
import { FileDownloadSharp, FileDownloadTwoTone } from '@mui/icons-material';
import { FormType, getTableHeaders } from '@/config/macros/formdetails';

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

const EditToolbar = ({
  handleAddNewRow,
  handleRefresh,
  handleExportAll,
  handleExportErrors,
  handleExportCSV,
  handleRunValidations,
  locked,
  filterModel
}: EditToolbarProps) => {
  const handleExportClick = async () => {
    if (!handleExportAll) return;
    const fullData = await handleExportAll(filterModel);
    const blob = new Blob([JSON.stringify(fullData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'data.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportErrorsClick = async () => {
    if (!handleExportErrors) return;
    const errorData = await handleExportErrors(filterModel);
    const blob = new Blob([JSON.stringify(errorData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'error_data.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <GridToolbarContainer>
      <GridToolbar />
      <Button color="primary" startIcon={<AddIcon />} onClick={handleAddNewRow} disabled={locked}>
        Add Row
      </Button>
      <Button color="primary" startIcon={<RefreshIcon />} onClick={handleRefresh}>
        Refresh
      </Button>
      <Button color="primary" startIcon={<FileDownloadIcon />} onClick={handleExportClick}>
        Export Full Data
      </Button>
      <Button color="primary" startIcon={<FileDownloadSharp />} onClick={handleExportErrorsClick}>
        Export Errors
      </Button>
      <Button color={'primary'} startIcon={<FileDownloadTwoTone />} onClick={handleExportCSV}>
        Export Form CSV
      </Button>
      {/*<Button color={'primary'} startIcon={<Quiz />} onClick={handleRunValidations}>*/}
      {/*  Run Validations*/}
      {/*</Button>*/}
    </GridToolbarContainer>
  );
};

/**
 * Renders custom UI components for measurement summary view.
 *
 * Handles state and logic for editing, saving, deleting rows, pagination,
 * validation errors, printing, exporting, and more.
 */
export default function MeasurementsCommons(props: Readonly<MeasurementsCommonsProps>) {
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
    shouldAddRowAfterFetch,
    setShouldAddRowAfterFetch,
    handleSelectQuadrat,
    locked = false
  } = props;

  // states from datagridcommons:
  const [newLastPage, setNewLastPage] = useState<number | null>(null); // new state to track the new last page
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: any) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({
    items: []
  });
  const [isSaveHighlighted, setIsSaveHighlighted] = useState(false);

  // custom states -- msvdatagrid
  const [validationErrors, setValidationErrors] = useState<{
    [key: number]: CMError;
  }>({});
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true);
  const [showValidRows, setShowValidRows] = useState<boolean>(true);
  const [errorRowsForExport, setErrorRowsForExport] = useState<GridRowModel[]>([]);
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);

  // context pulls and definitions
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const { setLoading } = useLoading();
  const { triggerPulse } = useLockAnimation();

  // use the session
  useSession();

  const apiRef = useGridApiRef();

  const exportAllCSV = useCallback(async () => {
    const response = await fetch(
      `/api/formdownload/measurements/${currentSite?.schemaName ?? ''}/${currentPlot?.plotID ?? 0}/${currentCensus?.dateRanges[0].censusID ?? 0}`,
      { method: 'GET' }
    );
    const data = await response.json();
    let csvRows =
      getTableHeaders(FormType.measurements)
        .map(row => row.label)
        .join(',') + '\n';
    data.forEach((row: any) => {
      const values = getTableHeaders(FormType.measurements)
        .map(rowHeader => rowHeader.label)
        .map(header => row[header])
        .map(value => {
          if (value === undefined || value === null || value === '') {
            return null;
          }
          if (typeof value === 'number') {
            return value;
          }
          const parsedValue = parseFloat(value);
          if (!isNaN(parsedValue)) {
            return parsedValue;
          }
          if (typeof value === 'string') {
            value = value.replace(/"/g, '""');
            value = `"${value}"`;
          }

          return value;
        });
      csvRows += values.join(',') + '\n';
    });
    const blob = new Blob([csvRows], {
      type: 'text/csv;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `measurementsform_${currentSite?.schemaName ?? ''}_${currentPlot?.plotName ?? ''}_${currentCensus?.plotCensusNumber ?? 0}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [currentPlot, currentCensus, currentSite, gridType]);

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
  const cellHasError = (colField: string, rowId: GridRowId) => {
    const row = rows.find(row => rowId === row.id);
    const error = validationErrors[row?.coreMeasurementID];
    if (!error) return false;
    const errorFields = error.validationErrorIDs.flatMap(id => errorMapping[id.toString()] || []);
    return errorFields.includes(colField);
  };

  const rowHasError = (rowId: GridRowId) => {
    if (!rows || rows.length === 0) return false;
    return gridColumns.some(column => cellHasError(column.field, rowId));
  };

  const fetchErrorRows = async () => {
    if (!rows || rows.length === 0) return [];
    return rows.filter(row => rowHasError(row.id));
  };

  const getRowErrorDescriptions = (rowId: GridRowId): string[] => {
    const row = rows.find(row => rowId === row.id);
    const error = validationErrors[row?.coreMeasurementID];
    return error.validationErrorIDs.map(id => {
      const index = error.validationErrorIDs.indexOf(id);
      return error.descriptions[index]; // Assumes that descriptions are stored in the CMError object
    });
  };

  const errorRowCount = useMemo(() => {
    return rows.filter(row => rowHasError(row.id)).length;
  }, [rows, gridColumns]);

  const updateRow = async (
    gridType: string,
    schemaName: string | undefined,
    newRow: GridRowModel,
    oldRow: GridRowModel,
    setSnackbar: (value: { children: string; severity: 'error' | 'success' }) => void,
    setIsNewRowAdded: (value: boolean) => void,
    setShouldAddRowAfterFetch: (value: boolean) => void,
    fetchPaginatedData: (page: number) => Promise<void>,
    paginationModel: { page: number }
  ): Promise<GridRowModel> => {
    const gridID = getGridID(gridType);
    const fetchProcessQuery = createPostPatchQuery(schemaName ?? '', gridType, gridID);

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
      }

      return newRow;
    } catch (error: any) {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow);
    }
  };

  const openConfirmationDialog = (actionType: 'save' | 'delete', actionId: GridRowId) => {
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
  };

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
    setLoading(false);
    await fetchPaginatedData(paginationModel.page);
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
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleSaveClick = (id: GridRowId) => () => {
    if (locked) return;
    openConfirmationDialog('save', id);
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    if (locked) return;
    openConfirmationDialog('delete', id);
  };

  const handleShowErrorRowsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setShowErrorRows(event.target.checked);
  };

  const handleShowValidRowsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setShowValidRows(event.target.checked);
  };

  const handleAddNewRow = async () => {
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
  };

  const handleError = (error: any, message: string) => {
    console.error(message, error);
    setSnackbar({ children: `Error: ${message}`, severity: 'error' });
  };

  const fetchPaginatedData = useCallback(
    debounce(async (pageToFetch: number) => {
      if (!currentSite || !currentPlot || !currentCensus) {
        console.warn('Missing necessary context for fetchPaginatedData');
        return;
      }

      setRefresh(true);
      const paginatedQuery = createFetchQuery(
        currentSite?.schemaName ?? '',
        gridType,
        pageToFetch,
        paginationModel.pageSize,
        currentPlot?.plotID,
        currentCensus?.plotCensusNumber,
        currentQuadrat?.quadratID
      );
      try {
        const response = await fetch(paginatedQuery, { method: 'GET' });
        if (!response.ok) throw new Error(response.statusText || 'Error fetching data');
        const data = await response.json();
        console.log('data: ', data);
        setRows(data.output);
        setRowCount(data.totalCount);

        if (isNewRowAdded && pageToFetch === newLastPage) {
          addNewRowToGrid();
          setIsNewRowAdded(false);
        }
      } catch (error) {
        handleError(error, 'Error fetching data');
      } finally {
        try {
          await fetchValidationErrors();
        } catch (error: any) {
          handleError(error, 'Error fetching validation errors');
        } finally {
          setRefresh(false);
        }
      }
    }, 500),
    [
      currentSite?.schemaName,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      currentQuadrat?.quadratID,
      isNewRowAdded,
      newLastPage,
      setRows,
      setRowCount,
      setRefresh
    ]
  );

  useEffect(() => {
    if (currentPlot && currentCensus && paginationModel.page >= 0) {
      fetchPaginatedData(paginationModel.page);
    }
  }, [currentPlot, currentCensus, paginationModel.page, sortModel, isNewRowAdded, fetchPaginatedData]);

  useEffect(() => {
    if (errorRowCount > 0) {
      setSnackbar({
        children: `${errorRowCount} row(s) with validation errors detected.`,
        severity: 'warning'
      });
    }
  }, [errorRowCount]);

  const handleRefresh = useCallback(async () => {
    setRefresh(true);
    await fetchPaginatedData(paginationModel.page);
    setRefresh(false);
  }, [fetchPaginatedData, paginationModel.page, refresh]);

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
    [currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    if (locked) return;
    const row = rows.find(r => r.id === id);
    if (row && handleSelectQuadrat) {
      handleSelectQuadrat(row.quadratID);
    }
    setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
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
  };

  const getEnhancedCellAction = (type: string, icon: any, onClick: any) => (
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
  );

  function getGridActionsColumn(): GridColDef {
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
  }

  const fetchValidationErrors = useCallback(async () => {
    try {
      const response = await fetch(`/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}`);

      if (!response.ok) {
        throw new Error('Failed to fetch validation errors');
      }

      const data = await response.json();
      const errors: CMError[] = data?.failed ?? [];
      const errorMap = Array.isArray(errors)
        ? errors.reduce<Record<number, CMError>>((acc, error) => {
            acc[error?.coreMeasurementID] = error;
            return acc;
          }, {})
        : {};

      // Only update state if there is a difference
      if (JSON.stringify(validationErrors) !== JSON.stringify(errorMap)) {
        setValidationErrors(errorMap);
      }
      return errorMap; // Return the errorMap if you need to log it outside
    } catch (error) {
      console.error('Error fetching validation errors:', error);
    }
  }, [currentSite?.schemaName, fetchPaginatedData]);

  const fetchFullData = async () => {
    setLoading(true, 'Fetching full dataset...');
    let partialQuery = ``;
    if (currentPlot?.plotID) partialQuery += `/${currentPlot.plotID}`;
    if (currentCensus?.plotCensusNumber) partialQuery += `/${currentCensus.plotCensusNumber}`;
    if (currentQuadrat?.quadratID) partialQuery += `/${currentQuadrat.quadratID}`;
    const fullDataQuery = `/api/fetchall/${gridType}` + partialQuery + `?schema=${currentSite?.schemaName}`;

    try {
      const response = await fetch(fullDataQuery, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
        // body: JSON.stringify(filterModel)
      });
      if (!response.ok) throw new Error(response.statusText || 'Error fetching full data');
      return await response.json();
    } catch (error) {
      console.error('Error fetching full data:', error);
      setSnackbar({ children: 'Error fetching full data', severity: 'error' });
      return [];
    } finally {
      setLoading(false);
    }
  };

  const handleExportErrors = async () => {
    const errorRows = await fetchErrorRows();
    return errorRows.map(row => {
      const errors = getRowErrorDescriptions(row.id);
      return { ...row, errors };
    });
  };

  // custom column formatting:
  const validationStatusColumn: GridColDef = {
    field: 'isValidated',
    headerName: '',
    headerAlign: 'center',
    align: 'center',
    width: 50,
    renderCell: (params: GridCellParams) => {
      console.log('val stat rendercell');
      console.log('val stat params: ', params);
      const rowId = params.row.coreMeasurementID;
      console.log('rowId located: ', rowId);
      const validationError = validationErrors[Number(rowId)];
      console.log('searched for val error: ', validationError);
      const isPendingValidation = rows.find(row => row.coreMeasurementID === rowId)?.isValidated && !validationError;
      console.log('pending validation? ', isPendingValidation);
      const isValidated = params.row.isValidated;
      console.log('is validated?', isValidated);

      if (validationError) {
        return (
          <Tooltip title={validationError.descriptions.join(', ')} size="md">
            <ErrorIcon color="error" />
          </Tooltip>
        );
      } else if (isPendingValidation) {
        return (
          <Tooltip title="Pending" size="md">
            <HourglassEmptyIcon color="disabled" />
          </Tooltip>
        );
      } else if (isValidated) {
        return (
          <Tooltip title="Passed Validation" size="md">
            <CheckIcon color="success" />
          </Tooltip>
        );
      } else {
        return null;
      }
    }
  };
  const measurementDateColumn: GridColDef = {
    field: 'measurementDate',
    headerName: 'Date',
    headerClassName: 'header',
    flex: 0.8,
    sortable: true,
    editable: true,
    type: 'date',
    renderHeader: () => (
      <Box flexDirection={'column'}>
        <Typography level="title-lg">Date</Typography>
        <Typography level="body-xs">YYYY-MM-DD</Typography>
      </Box>
    ),
    valueFormatter: value => {
      // Check if the date is present and valid
      if (!value || !moment(value).utc().isValid()) {
        return '';
      }
      // Format the date as a dash-separated set of numbers
      return moment(value).utc().format('YYYY-MM-DD');
    }
  };
  const columns = useMemo(() => {
    console.log('test: ');
    const commonColumns = gridColumns.map(column => {
      Object.keys(validationErrors).forEach(validationError => {
        console.log('validationerror: ', validationError);
      });
      return column;
      // return {
      //   ...column,
      //   renderCell: (params: GridCellParams) => {
      //     const cellValue = params.value !== undefined ? params.value?.toString() : '';
      //     console.log('cellValue', cellValue);
      //     const cellError = cellHasError(column.field, params.id) ? getCellErrorMessages(column.field, params.id) : '';
      //     console.log('cellERror', cellError);
      //     return (
      //       <Box
      //         sx={{
      //           display: 'flex',
      //           flex: 1,
      //           flexDirection: 'column',
      //           marginY: 1.5
      //         }}
      //       >
      //         {cellError ? (
      //           <>
      //             <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{cellValue}</Typography>
      //             <Typography
      //               color={'danger'}
      //               variant={'solid'}
      //               sx={{
      //                 color: 'error.main',
      //                 fontSize: '0.75rem',
      //                 mt: 1,
      //                 whiteSpace: 'normal',
      //                 lineHeight: 'normal'
      //               }}
      //             >
      //               {cellError}
      //             </Typography>
      //           </>
      //         ) : (
      //           <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{cellValue}</Typography>
      //         )}
      //       </Box>
      //     );
      //   }
      // };
    });
    if (locked) {
      return [validationStatusColumn, measurementDateColumn, ...commonColumns];
    }
    return [validationStatusColumn, measurementDateColumn, ...commonColumns, getGridActionsColumn()];
  }, [gridColumns, locked]);

  const filteredColumns = useMemo(() => filterColumns(rows, columns), [rows, columns]);

  const visibleRows = useMemo(() => {
    let filteredRows = rows;
    if (!showValidRows) {
      filteredRows = filteredRows.filter(row => rowHasError(row.id));
    }
    if (!showErrorRows) {
      filteredRows = filteredRows.filter(row => !rowHasError(row.id));
    }
    return filteredRows;
  }, [rows, showErrorRows, showValidRows]);

  const getRowClassName = (params: any) => {
    const rowId = params.id;
    if (rowHasError(rowId)) {
      return 'error-row';
    } else {
      return 'validated';
    }
  };

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
      const cell = apiRef.current.getCellElement(params.id, params.field);
      if (cell) {
        const select = cell.querySelector('select');
        if (select) {
          select.focus();
        }
      }
    } else if (isLastColumn) {
      setIsSaveHighlighted(true);
      apiRef.current.setCellFocus(params.id, 'actions');
    } else {
      apiRef.current.setCellFocus(params.id, filteredColumns[columnIndex + 1].field);
    }
  };

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
          <Stack direction={'row'} justifyContent="space-between">
            <Stack direction="row" spacing={2}>
              <Typography>
                <Checkbox checked={showErrorRows} onChange={handleShowErrorRowsChange} />
                Show rows with errors: ({errorRowCount})
              </Typography>
              <Typography>
                <Checkbox checked={showValidRows} onChange={handleShowValidRowsChange} />
                Show rows without errors: ({rows.length - errorRowCount})
              </Typography>
            </Stack>
          </Stack>
          <StyledDataGrid
            sx={{ width: '100%' }}
            rows={visibleRows}
            columns={filteredColumns}
            editMode="row"
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            loading={refresh}
            paginationMode="server"
            onPaginationModelChange={setPaginationModel}
            onProcessRowUpdateError={error => {
              console.error('Row update error:', error);
              setSnackbar({
                children: 'Error updating row',
                severity: 'error'
              });
            }}
            onCellKeyDown={(params, event) => {
              if (event.key === 'Enter') {
                handleEnterKeyNavigation(params, event).then(r => {
                  console.log(r);
                });
              }
            }}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
            sortModel={sortModel}
            onSortModelChange={handleSortModelChange}
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
                handleRefresh: handleRefresh,
                handleExportAll: fetchFullData,
                handleExportErrors: handleExportErrors,
                handleExportCSV: exportAllCSV
              }
            }}
            getRowHeight={() => 'auto'}
            getRowClassName={getRowClassName}
            isCellEditable={() => !locked}
          />
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && (
          <ReEnterDataModal
            gridType={gridType}
            row={promiseArguments.oldRow}
            reEnterData={promiseArguments.newRow}
            handleClose={handleCancelAction}
            handleSave={handleConfirmAction}
            columns={gridColumns}
          />
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
      </Box>
    );
  }
}
