"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GridActionsCellItem,
  GridCellParams,
  GridColDef,
  GridEventListener,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridSortModel,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  GridValidRowModel,
  ToolbarPropsOverrides
} from '@mui/x-data-grid';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Snackbar
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from "@mui/joy/Box";
import { Stack, Tooltip, Typography } from "@mui/joy";
import { StyledDataGrid } from "@/config/styleddatagrid";
import {
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  getGridID,
} from "@/config/datagridhelpers";
import { CMError } from "@/config/macros/uploadsystemmacros";
import {
  useOrgCensusContext,
  usePlotContext,
  useQuadratContext,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import { saveAs } from 'file-saver';
import { redirect } from 'next/navigation';
import { CoreMeasurementsRDS } from '@/config/sqlrdsdefinitions/tables/coremeasurementsrds';
import moment from 'moment';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import BlockIcon from '@mui/icons-material/Block';
import { CensusDateRange, OrgCensusRDS } from '@/config/sqlrdsdefinitions/orgcensusrds';
import { HTTPResponses, unitSelectionOptions } from '@/config/macros';
import { gridColumnsArrayMSVRDS } from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import { MeasurementSummaryGridProps, sortRowsByMeasurementDate, PendingAction, CellItemContainer, errorMapping, filterColumns, EditToolbarCustomProps } from './datagridmacros';
import ConfirmationDialog from './confirmationdialog';
import ReEnterDataModal from './reentrydatamodal';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useSession } from 'next-auth/react';

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

const EditToolbar = ({ handleAddNewRow, handleRefresh, locked }: EditToolbarProps) => (
  <GridToolbarContainer>
    <GridToolbar />
    <Button color="primary" startIcon={<AddIcon />} onClick={handleAddNewRow} disabled={locked}>
      Add Row
    </Button>
    <Button color="primary" startIcon={<RefreshIcon />} onClick={handleRefresh}>
      Refresh
    </Button>
  </GridToolbarContainer>
);
/**
 * Renders custom UI components for measurement summary view.
 *
 * Handles state and logic for editing, saving, deleting rows, pagination,
 * validation errors, printing, exporting, and more.
 */
export default function MeasurementSummaryGrid(props: Readonly<MeasurementSummaryGridProps>) {
  const {
    addNewRowToGrid,
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
  } = props;

  // states from datagridcommons:
  const [newLastPage, setNewLastPage] = useState<number | null>(null); // new state to track the new last page
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({ actionType: '', actionId: null });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [promiseArguments, setPromiseArguments] = useState<{ resolve: (value: GridRowModel) => void, reject: (reason?: any) => void, newRow: GridRowModel, oldRow: GridRowModel } | null>(null);

  // custom states -- msvdatagrid
  const [deprecatedRows, setDeprecatedRows] = useState<GridValidRowModel[]>([]); // new state to track deprecated rows
  const [validationErrors, setValidationErrors] = useState<{ [key: number]: CMError }>({});
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true);
  const [showValidRows, setShowValidRows] = useState<boolean>(true);
  const [showDeprecatedRows, setShowDeprecatedRows] = useState<boolean>(true);
  const [errorRowsForExport, setErrorRowsForExport] = useState<GridRowModel[]>([]);
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);
  const [selectedDateRanges, setSelectedDateRanges] = useState<number[]>([]);

  // context pulls and definitions
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const { setLoading } = useLoading();
  const { triggerPulse } = useLockAnimation();
  const handleLockedClick = () => triggerPulse();

  // column destructuring -- applying custom formats to columns
  const [a, b, c, d] = gridColumnsArrayMSVRDS;

  // use the session
  useSession();

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
  const getDateRangesForCensus = (census: OrgCensusRDS | undefined) => {
    return census?.dateRanges ?? [];
  };
  const handleDateRangeChange = (censusID: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedDateRanges(prev => [...prev, censusID]);
    } else {
      setSelectedDateRanges(prev => prev.filter(id => id !== censusID));
    }
  };
  const renderDateRangeFilters = (dateRanges: CensusDateRange[]) => (
    <FormGroup sx={{ ml: 1.5 }}>
      {dateRanges.map(range => (
        <FormControlLabel
          key={range.censusID}
          control={<Checkbox checked={selectedDateRanges.includes(range.censusID)} onChange={handleDateRangeChange(range.censusID)} />}
          label={
            <Stack direction={'column'} alignItems='flex-start' sx={{ my: 2 }}>
              <Typography level='body-sm' sx={{ mb: -0.5 }}>ID: {range.censusID}</Typography>
              <Typography level='body-md'>
                {moment(range.startDate).format('ddd, MMM D, YYYY')} - {moment(range.endDate).format('ddd, MMM D, YYYY')}
              </Typography>
            </Stack>
          }
        />
      ))}
    </FormGroup>
  );
  const handleShowDeprecatedRowsChange = (event: any) => {
    setShowDeprecatedRows(event.target.checked);
  };
  const rowIsDeprecated = (rowId: GridRowId) => {
    return deprecatedRows.some(depRow => depRow.id === rowId);
  };
  const extractErrorRows = () => {
    if (errorRowsForExport.length > 0) return;

    fetchErrorRows().then(fetchedRows => {
      setErrorRowsForExport(fetchedRows);
    });
  };
  const cellHasError = (colField: string, rowId: GridRowId) => {
    const error = validationErrors[Number(rowId)];
    if (!error) return false;
    const errorFields = error.ValidationErrorIDs.flatMap(
      id => errorMapping[id.toString()] || []
    );
    return errorFields.includes(colField);
  };
  const rowHasError = (rowId: GridRowId) => {
    if (!rows || rows.length === 0) return false;
    return gridColumns.some(column => cellHasError(column.field, rowId));
  };
  const fetchErrorRows = async () => {
    if (!rows || rows.length === 0) return [];
    const errorRows = rows.filter(row => rowHasError(row.id));
    return errorRows;
  };
  const getRowErrorDescriptions = (rowId: GridRowId): string[] => {
    const error = validationErrors[Number(rowId)];
    if (!error) return [];
    return error.ValidationErrorIDs.map(id => {
      const index = error.ValidationErrorIDs.indexOf(id);
      return error.Descriptions[index]; // Assumes that descriptions are stored in the CMError object
    });
  };

  const errorRowCount = useMemo(() => {
    return rows.filter(row => rowHasError(row.id)).length;
  }, [rows, gridColumns]);

  // use effect loops, pulled from datagridcommons:
  useEffect(() => {
    if (currentCensus !== undefined) {
      setLocked(currentCensus.dateRanges[0].endDate !== undefined);
    }
  }, [currentCensus]);

  useEffect(() => {
    if (!isNewRowAdded) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [paginationModel.page, sortModel]);

  useEffect(() => {
    if (currentPlot?.plotID || currentCensus?.plotCensusNumber) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [currentPlot, currentCensus, paginationModel.page]);

  useEffect(() => {
    if (refresh && currentSite) {
      handleRefresh().then(() => {
        setRefresh(false);
      });
    }
  }, [refresh, setRefresh]);

  // custom useEffect loops for msvdatagrid --> setting date range filters
  useEffect(() => {
    if (currentCensus) {
      const allDateRangeIDs = currentCensus.dateRanges.map(range => range.censusID);
      setSelectedDateRanges(allDateRangeIDs);
    }
  }, [currentCensus]);

  useEffect(() => {
    fetchValidationErrors()
      .catch(console.error)
      .then(() => setRefresh(false));
  }, [refresh]);

  useEffect(() => {
    if (errorRowCount > 0) {
      setSnackbar({
        children: `${errorRowCount} row(s) with validation errors detected.`,
        severity: 'warning'
      });
    }
  }, [errorRowCount]);

  // main system begins here:

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
        setSnackbar({ children: `Error: ${responseJSON.message}`, severity: 'error' });
        return Promise.reject(responseJSON.row);
      }

      setSnackbar({ children: oldRow.isNew ? 'New row added!' : 'Row updated!', severity: 'success' });

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

  const openConfirmationDialog = (
    actionType: 'save' | 'delete',
    actionId: GridRowId
  ) => {
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
    setPromiseArguments(null);  // Clear promise arguments after handling
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null);  // Clear promise arguments after handling
  };

  const performSaveAction = async (id: GridRowId) => {
    if (locked || !promiseArguments) return;
    setLoading(true, "Saving changes...");
    try {
      const updatedRow = await updateRow(
        'measurementssummaryview',
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
    setLoading(true, "Deleting...");
    const deletionID = rows.find(row => String(row.id) === String(id))?.id;
    if (!deletionID) return;
    const deleteQuery = createDeleteQuery(
      currentSite?.schemaName ?? '',
      'measurementssummaryview',
      getGridID('measurementssummaryview'),
      deletionID
    );
    const response = await fetch(deleteQuery, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldRow: undefined, newRow: rows.find(row => String(row.id) === String(id))! })
    });
    setLoading(false);
    if (!response.ok) {
      const error = await response.json();
      if (response.status === HTTPResponses.FOREIGN_KEY_CONFLICT) {
        setSnackbar({ children: `Error: Cannot delete row due to foreign key constraint in table ${error.referencingTable}`, severity: 'error' });
      } else {
        setSnackbar({ children: `Error: ${error.message || 'Deletion failed'}`, severity: 'error' });
      }
    } else {
      if (handleSelectQuadrat) handleSelectQuadrat(null);
      setSnackbar({ children: 'Row successfully deleted', severity: 'success' });
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

  const handleShowErrorRowsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setShowErrorRows(event.target.checked);
  };

  const handleShowValidRowsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
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

  const handleRefresh = async () => {
    await fetchPaginatedData(paginationModel.page);
  };

  const fetchPaginatedData = async (pageToFetch: number) => {
    setRefresh(true);
    console.log('fetchPaginatedData triggered');
    const paginatedQuery = createFetchQuery(
      currentSite?.schemaName ?? '',
      'measurementssummaryview',
      pageToFetch,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      currentQuadrat?.quadratID
    );
    try {
      const response = await fetch(paginatedQuery, { method: 'GET' });
      const data = await response.json();
      console.log('fetchPaginatedData data (json-converted): ', data);
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      console.log('output: ', data.output);
      if (data.deprecated) setDeprecatedRows(data.deprecated);

      // Apply date range filtering with UTC handling
      const filteredRows = data.output.filter((row: any) => {
        if (selectedDateRanges.length === 0) {
          // If no date ranges are selected, show no rows
          return false;
        }
        return selectedDateRanges.some(id => {
          const range = currentCensus?.dateRanges.find(r => r.censusID === id);
          const measurementDate = moment.utc(row.measurementDate);
          if (range) {
            const startDate = moment.utc(range.startDate);
            const endDate = moment.utc(range.endDate);
            console.log('measurementDate:', measurementDate.toISOString());
            console.log('range startDate:', startDate.toISOString(), 'endDate:', endDate.toISOString());
            return measurementDate.isBetween(startDate, endDate, undefined, '[]');
          }
          return false;
        });
      });
      console.log('filtered rows: ', filteredRows);

      // Sort rows by measurementDate before setting them
      const sortedRows = sortRowsByMeasurementDate(filteredRows, sortModel[0]?.sort || 'asc');

      setRows(sortedRows.length > 0 ? sortedRows : []);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        console.log('isNewRowAdded true, on new last page');
        addNewRowToGrid();
        setIsNewRowAdded(false);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    } finally {
      setRefresh(false);
    }
  };

  const processRowUpdate = useCallback((newRow: GridRowModel, oldRow: GridRowModel) => new Promise<GridRowModel>((resolve, reject) => {
    setLoading(true, "Processing changes...");
    if (newRow.id === '') {
      setLoading(false);
      return reject(new Error('Primary key id cannot be empty!'));
    }

    setPromiseArguments({ resolve, reject, newRow, oldRow });
    setLoading(false);
  }), [currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]);

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);

    const rowInEditMode = Object.entries(newRowModesModel).find(([id, mode]) => mode.mode === GridRowModes.Edit);
    if (rowInEditMode) {
      const [id] = rowInEditMode;
      const row = rows.find(row => String(row.id) === String(id));
      console.log('handleRowModesModelChange triggered on row: ', row);
    }
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (
    params,
    event
  ) => {
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
        const newPage =
          paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
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

  const getEnhancedCellAction = (type: string, icon: any, onClick: any) => {
    return (
      <CellItemContainer>
        <Tooltip title={locked ? 'Actions disabled while census closed!' : ''} arrow placement="top">
          <span
            onClick={(e) => {
              if (locked) {
                handleLockedClick();
                const iconElement = e.currentTarget.querySelector('svg');
                if (iconElement) {
                  iconElement.classList.add('animate-shake');
                  setTimeout(() => {
                    iconElement.classList.remove('animate-shake');
                  }, 500);
                }
              } else {
                onClick();
              }
            }}
          >
            <GridActionsCellItem icon={icon} label={type} />
          </span>
        </Tooltip>
      </CellItemContainer>
    );
  };

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
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e)),
          ];
        }

        return [
          getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)),
          getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id)),
        ];
      },
    };
  }

  const fetchValidationErrors = async () => {
    try {
      const response = await fetch(`/api/validations/validationerrordisplay?schema=${currentSite?.schemaName ?? ''}`);
      const data = await response.json();

      // Provide default values if data.failed or data.pending is undefined
      const errors: CMError[] = data?.failed ?? [];
      const pending: CoreMeasurementsRDS[] = data?.pending ?? [];

      // Only proceed with reduce if errors is an array
      const errorMap = Array.isArray(errors)
        ? errors.reduce<Record<number, CMError>>((acc, error) => {
          acc[error?.CoreMeasurementID] = error;
          return acc;
        }, {})
        : {};
        
      setValidationErrors(errorMap);
    } catch (error) {
      console.error('Error fetching validation errors:', error);
    }
  };

  const getCellErrorMessages = (colField: string, rowId: GridRowId) => {
    const error = validationErrors[Number(rowId)];
    if (!error) return '';

    return error.ValidationErrorIDs.filter(id =>
      errorMapping[id.toString()]?.includes(colField)
    )
      .map(id => {
        const index = error.ValidationErrorIDs.indexOf(id);
        return error.Descriptions[index];
      })
      .join('; ');
  };

  const modifiedColumns = gridColumns.map(column => {
    if (column.field !== 'measurementssummaryview') {
      return column;
    }
    return {
      ...column,
      renderCell: (params: GridCellParams) => {
        const cellValue =
          params.value !== undefined ? params.value?.toString() : '';
        const cellError = cellHasError(column.field, params.id)
          ? getCellErrorMessages(column.field, params.id)
          : '';
        return (
          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              marginY: 1.5
            }}
          >
            {cellError ? (
              <>
                <Typography
                  sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}
                >
                  {cellValue}
                </Typography>
                <Typography
                  color={'danger'}
                  variant={'solid'}
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
              </>
            ) : (
              <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>
                {cellValue}
              </Typography>
            )}
          </Box>
        );
      }
    };
  });

  // custom column formatting: 
  const validationStatusColumn: GridColDef = {
    field: 'isValidated',
    headerName: '',
    headerAlign: 'center',
    align: 'center',
    width: 50,
    renderCell: (params: GridCellParams) => {
      const rowId = params.row.id;
      const isDeprecated = deprecatedRows.some(row => row.id === rowId);
      const validationError = validationErrors[Number(rowId)];
      const isPendingValidation = !params.row.isValidated && !validationError;
      const isValidated = params.row.isValidated;

      if (isDeprecated) {
        return (
          <Tooltip title="Deprecated" size="md">
            <BlockIcon color="action" />
          </Tooltip>
        );
      } else if (validationError) {
        return (
          <Tooltip title="Failed Validation" size="md">
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
    },
  };
  const measurementDateColumn: GridColDef = {
    field: 'measurementDate',
    headerName: 'Date',
    headerClassName: 'header',
    flex: 0.8,
    sortable: true,
    editable: true,
    type: 'date',
    renderHeader: () => <Box flexDirection={'column'}>
      <Typography level='title-lg'>Date</Typography>
      <Typography level='body-xs'>YYYY-MM-DD</Typography>
    </Box>,
    valueFormatter: (value) => {
      console.log('params: ', value);
      // Check if the date is present and valid
      if (!value || !moment(value).utc().isValid()) {
        console.log('value: ', value);
        console.log('moment-converted: ', moment(value).utc().format('YYYY-MM-DD'));
        return '';
      }
      // Format the date as a dash-separated set of numbers
      return moment(value).utc().format('YYYY-MM-DD');
    },
  };
  const stemUnitsColumn: GridColDef = {
    field: 'stemUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };
  const dbhUnitsColumn: GridColDef = {
    field: 'dbhUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };
  const homUnitsColumn: GridColDef = {
    field: 'homUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };

  const columns = useMemo(() => {
    const commonColumns = modifiedColumns;
    if (locked) {
      return [validationStatusColumn, measurementDateColumn, ...commonColumns, ...b, dbhUnitsColumn, ...c, homUnitsColumn, ...d];
    }
    return [validationStatusColumn,
      measurementDateColumn, ...commonColumns, stemUnitsColumn, ...b, dbhUnitsColumn, ...c, homUnitsColumn, ...d, getGridActionsColumn()];
  }, [modifiedColumns, locked]);

  const filteredColumns = useMemo(() => filterColumns(rows, columns), [rows, columns]);

  const visibleRows = useMemo(() => {
    let filteredRows = rows;
    if (!showValidRows) {
      filteredRows = filteredRows.filter(row => rowHasError(row.id));
    }
    if (!showErrorRows) {
      filteredRows = filteredRows.filter(row => !rowHasError(row.id));
    }
    if (!showDeprecatedRows) {
      filteredRows = filteredRows.filter(row => !rowIsDeprecated(row.id));
    }
    return filteredRows;
  }, [rows, showErrorRows, showValidRows, showDeprecatedRows]);

  const getRowClassName = (params: any) => {
    const rowId = params.id;
    if (rowIsDeprecated(rowId)) {
      return 'deprecated';
    } else if (rowHasError(rowId)) {
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
            <Stack direction='row' spacing={2}>
              <Typography>
                <Checkbox
                  checked={showErrorRows}
                  onChange={handleShowErrorRowsChange}
                />
                Show rows with errors: ({errorRowCount})
              </Typography>
              <Typography>
                <Checkbox
                  checked={showValidRows}
                  onChange={handleShowValidRowsChange}
                />
                Show rows without errors: ({rows.length - errorRowCount})
              </Typography>
              <Typography>
                <Checkbox
                  checked={showDeprecatedRows}
                  onChange={handleShowDeprecatedRowsChange}
                />
                Show deprecated rows: ({deprecatedRows.length})
              </Typography>
            </Stack>
          </Stack>
          <Stack direction={'column'} marginTop={2}>
            <Typography level='title-lg'>Filtering &mdash;</Typography>
            <Typography level="body-xs">Select or deselect filters to filter by date ranges within a census</Typography>
          </Stack>
          {renderDateRangeFilters(getDateRangesForCensus(currentCensus))}
          <StyledDataGrid
            sx={{ width: '100%' }}
            rows={visibleRows}
            columns={filteredColumns}
            editMode='row'
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            loading={refresh}
            paginationMode='server'
            onPaginationModelChange={setPaginationModel}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
            sortModel={sortModel}
            onSortModelChange={handleSortModelChange}
            initialState={{
              columns: {
                columnVisibilityModel: {
                  id: false,
                  coreMeasurementID: false,
                  plotID: false,
                  plotName: false,
                  censusID: false,
                  quadratID: false,
                  subquadratID: false,
                  speciesID: false,
                  treeID: false,
                  stemID: false,
                  personnelID: false,
                }
              },
            }}
            slots={{
              toolbar: EditToolbar,
            }}
            slotProps={{
              toolbar: {
                locked: locked,
                handleAddNewRow: handleAddNewRow,
                handleRefresh: handleRefresh
              }
            }}
            autoHeight
            getRowHeight={() => 'auto'}
            getRowClassName={getRowClassName}
            isCellEditable={() => !locked}
          />
        </Box>
        {!!snackbar && (
          <Snackbar
            open
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            onClose={handleCloseSnackbar}
            autoHideDuration={6000}
          >
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {isDialogOpen && promiseArguments && (
          <ReEnterDataModal
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