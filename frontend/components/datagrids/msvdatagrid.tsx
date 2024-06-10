"use client";
import React, { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
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
  GridRowsProp,
  GridSortDirection,
  GridSortModel,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  GridValidRowModel,
  ToolbarPropsOverrides
} from '@mui/x-data-grid';
import {
  Alert,
  AlertProps,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
  computeMutation,
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
import { CellItemContainer } from './datagridcommons';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import BlockIcon from '@mui/icons-material/Block';
import { CensusDateRange, OrgCensusRDS } from '@/config/sqlrdsdefinitions/orgcensusrds';

const errorMapping: { [key: string]: string[] } = {
  '1': ["attributes"],
  '2': ["measuredDBH"],
  '3': ["measuredHOM"],
  '4': ["treeTag", "stemTag"],
  '5': ["treeTag", "stemTag", "quadratName"],
  '6': ["stemQuadX", "stemQuadY"],
  '7': ["speciesName"],
  '8': ["measurementDate"],
  '9': ["treeTag", "stemTag", "plotCensusNumber"],
  '10': ["treeTag", "stemTag", "plotCensusNumber"],
  '11': ["quadratName"],
  '12': ["speciesName"],
  '13': ["measuredDBH"],
  '14': ["measuredDBH"],
  '15': ["treeTag"],
  '16': ["quadratName"],
};

interface EditToolbarCustomProps {
  handleAddNewRow?: () => void;
  handleRefresh?: () => Promise<void>;
  locked?: boolean;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

export function EditToolbar(props: EditToolbarProps) {
  const { handleAddNewRow, handleRefresh, locked = false } = props;

  return (
    <GridToolbarContainer>
      <GridToolbar />
      {!locked && (
        <Button color="primary" startIcon={<AddIcon />} onClick={handleAddNewRow}>
          Add Row
        </Button>
      )}
      <Button color="primary" startIcon={<RefreshIcon />} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

export interface MeasurementSummaryGridProps {
  gridColumns: GridColDef[];
  rows: GridRowsProp;
  setRows: Dispatch<SetStateAction<GridRowsProp>>;
  rowCount: number;
  setRowCount: Dispatch<SetStateAction<number>>;
  rowModesModel: GridRowModesModel;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  snackbar: Pick<AlertProps, "children" | "severity"> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, "children" | "severity"> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: { pageSize: number; page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number; page: number }>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  addNewRowToGrid: () => void;
  locked?: boolean;
  handleSelectQuadrat?: (quadratID: number | null) => void;
}

// Define types for the new states and props
type PendingAction = {
  actionType: 'save' | 'delete' | '';
  actionId: GridRowId | null;
};

interface ConfirmationDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  message: string;
}

/**
 * Function to determine if all entries in a column are null
 */
function allValuesAreNull(rows: GridRowsProp, field: string): boolean {
  return rows.length > 0 && rows.every(row => row[field] === null || row[field] === undefined);
}

/**
 * Function to filter out columns where all entries are null, except the actions column.
 */
function filterColumns(rows: GridRowsProp, columns: GridColDef[]): GridColDef[] {
  return columns.filter(col => col.field === 'actions' || col.field === 'subquadrats' || col.field === "isValidated" || !allValuesAreNull(rows, col.field));
}

const sortRowsByMeasurementDate = (rows: GridRowsProp, direction: GridSortDirection): GridRowsProp => {
  return rows.slice().sort((a, b) => {
    const dateA = new Date(a.measurementDate).getTime();
    const dateB = new Date(b.measurementDate).getTime();
    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });
};

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
    locked = false,
    handleSelectQuadrat,
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null); // new state to track the new last page
  const [deprecatedRows, setDeprecatedRows] = useState<GridValidRowModel[]>([]); // new state to track deprecated rows
  const [validationErrors, setValidationErrors] = useState<{ [key: number]: CMError }>({});
  const [showErrorRows, setShowErrorRows] = useState<boolean>(true);
  const [showValidRows, setShowValidRows] = useState<boolean>(true);
  const [showDeprecatedRows, setShowDeprecatedRows] = useState<boolean>(true);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [errorRowsForExport, setErrorRowsForExport] = useState<GridRowModel[]>([]);
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: 'measurementDate', sort: 'asc' }]);
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

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();

  const [pendingAction, setPendingAction] = useState<PendingAction>({ actionType: '', actionId: null });

  const currentSite = useSiteContext();
  const { triggerPulse } = useLockAnimation();

  const [selectedDateRanges, setSelectedDateRanges] = useState<number[]>([]);

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
    <FormGroup>
      {dateRanges.map(range => (
        <FormControlLabel
          key={range.censusID}
          control={<Checkbox checked={selectedDateRanges.includes(range.censusID)} onChange={handleDateRangeChange(range.censusID)} />}
          label={`${range.startDate?.toLocaleDateString()} - ${range.endDate?.toLocaleDateString()}`}
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

  const validationStatusColumn: GridColDef = {
    field: 'isValidated',
    headerName: '?',
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
        return <BlockIcon color="action" />;
      } else if (validationError) {
        return <ErrorIcon color="error" />;
      } else if (isPendingValidation) {
        return <HourglassEmptyIcon color="disabled" />;
      } else if (isValidated) {
        return <CheckIcon color="success" />;
      } else {
        return null;
      }
    },
  };

  const handleLockedClick = () => {
    triggerPulse();
  };

  const extractErrorRows = () => {
    if (errorRowsForExport.length > 0) return;

    fetchErrorRows().then(fetchedRows => {
      setErrorRowsForExport(fetchedRows);
    });
  };

  const fetchErrorRows = async () => {
    if (!rows || rows.length === 0) return [];
    const errorRows = rows.filter(row => rowHasError(row.id));
    return errorRows;
  };

  useEffect(() => {
    if (errorRowsForExport && errorRowsForExport.length > 0) {
      printErrorRows();
    }
  }, [errorRowsForExport]);

  const getRowErrorDescriptions = (rowId: GridRowId): string[] => {
    const error = validationErrors[Number(rowId)];
    if (!error) return [];
    return error.ValidationErrorIDs.map(id => {
      const index = error.ValidationErrorIDs.indexOf(id);
      return error.Descriptions[index]; // Assumes that descriptions are stored in the CMError object
    });
  };

  const saveErrorRowsAsCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += gridColumns.map(col => col.headerName).concat("Validation Errors").join(",") + "\r\n"; // Add "Validation Errors" column header

    errorRowsForExport.forEach(row => {
      const rowValues = gridColumns.map(col => row[col.field] ?? '').join(",");
      const errorDescriptions = getRowErrorDescriptions(row.id).join("; "); // Function to retrieve error descriptions for a row
      csvContent += `${rowValues},"${errorDescriptions}"\r\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `validation_errors_${currentPlot?.plotName}.csv`);
  };

  const printErrorRows = () => {
    if (!errorRowsForExport || errorRowsForExport.length === 0) {
      extractErrorRows();
      return;
    }

    let printContent = "<html><head><style>";
    printContent += "table {width: 100%; border-collapse: collapse;}";
    printContent += "th, td {border: 1px solid black; padding: 8px; text-align: left;}";
    printContent += "</style></head><body>";
    printContent += `<h5>Site: ${currentSite?.schemaName} | Plot: ${currentPlot?.plotName} | Census: ${currentCensus?.plotCensusNumber}</h5>`;
    printContent += "<table><thead><tr>";

    gridColumns.forEach(col => {
      printContent += `<th>${col.headerName}</th>`;
    });
    printContent += "<th>Validation Errors</th>"; // Add error header
    printContent += "</tr></thead><tbody>";

    errorRowsForExport.forEach(row => {
      printContent += "<tr>";
      gridColumns.forEach(col => {
        console.log('column fields: ', col.field);
        if (col.field === "measurementDate") {
          printContent += `<td>${moment(new Date(row[col.field])).utc().toDate().toDateString() ?? ''}</td>`;
        } else {
          printContent += `<td>${row[col.field] ?? ''}</td>`;
        }
      });
      const errorDescriptions = getRowErrorDescriptions(row.id).join("; ");
      printContent += `<td>${errorDescriptions}</td>`; // Print error descriptions
      printContent += "</tr>";
    });

    printContent += "</tbody></table></body></html>";

    const printWindow = window.open('', '', 'height=600,width=800');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const openConfirmationDialog = (
    actionType: 'save' | 'delete',
    actionId: GridRowId
  ) => {
    setPendingAction({ actionType, actionId });
    setIsDialogOpen(true);
  };

  const handleConfirmAction = async () => {
    setIsDialogOpen(false);
    if (
      pendingAction.actionType === 'save' &&
      pendingAction.actionId !== null
    ) {
      await performSaveAction(pendingAction.actionId);
    } else if (
      pendingAction.actionType === 'delete' &&
      pendingAction.actionId !== null
    ) {
      await performDeleteAction(pendingAction.actionId);
    }
    setPendingAction({ actionType: '', actionId: null });
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    setPendingAction({ actionType: '', actionId: null });
  };

  const performSaveAction = async (id: GridRowId) => {
    if (locked) return;
    console.log('save confirmed');
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.View }
    }));
    const row = rows.find(row => row.id === id);
    if (row?.isNew) {
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);
    await fetchPaginatedData(paginationModel.page);
  };

  const performDeleteAction = async (id: GridRowId) => {
    if (locked) return;
    const gridID = getGridID('measurementssummaryview');
    const deletionID = rows.find(row => row.id == id)?.[gridID];
    const deleteQuery = createDeleteQuery(
      currentSite?.schemaName ?? '',
      'measurementssummaryview',
      gridID,
      deletionID,
    );
    const response = await fetch(deleteQuery, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldRow: undefined, newRow: rows.find(row => row.id === id)! })
    });
    if (!response.ok)
      setSnackbar({ children: 'Error: Deletion failed', severity: 'error' });
    else {
      if (handleSelectQuadrat) handleSelectQuadrat(null);
      setSnackbar({ children: 'Row successfully deleted', severity: 'success' });
      setRows(rows.filter(row => row.id !== id));
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
      console.log('rowCount: ', rowCount);
      return;
    }
    console.log('handleAddNewRow triggered');

    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);

    if (isNewPageNeeded) {
      await setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
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

      // Apply date range filtering
      const filteredRows = data.output.filter((row: any) => {
        return selectedDateRanges.length === 0 || selectedDateRanges.some(id => {
          const range = currentCensus?.dateRanges.find(r => r.censusID === id);
          const measurementDate = new Date(row.measurementDate);
          return range && range.startDate && range.endDate && measurementDate >= range.startDate && measurementDate <= range.endDate;
        });
      });

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

  useEffect(() => {
    if (currentCensus) {
      const allDateRangeIDs = currentCensus.dateRanges.map(range => range.censusID);
      setSelectedDateRanges(allDateRangeIDs);
    }
  }, [currentCensus]);

  const processRowUpdate = React.useCallback(
    async (
      newRow: GridRowModel,
      oldRow: GridRowModel
    ): Promise<GridRowModel> => {
      console.log(
        'Processing row update. Old row:',
        oldRow,
        '; New row:',
        newRow
      );

      const gridID = getGridID('measurementssummaryview');
      const fetchProcessQuery = createPostPatchQuery(
        currentSite?.schemaName ?? '',
        'measurementssummaryview',
        gridID
      );

      if (newRow[gridID] === '') {
        throw new Error(`Primary key ${gridID} cannot be empty!`);
      }

      try {
        let response, responseJSON;
        if (oldRow.isNew) {
          response = await fetch(fetchProcessQuery, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
          });
          responseJSON = await response.json();
          if (response.status > 299 || response.status < 200)
            throw new Error(responseJSON.message || 'Insertion failed');
          setSnackbar({ children: `New row added!`, severity: 'success' });
        } else {
          const mutation = computeMutation('measurementssummaryview', newRow, oldRow);
          if (mutation) {
            response = await fetch(fetchProcessQuery, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
            });
            responseJSON = await response.json();
            if (response.status > 299 || response.status < 200)
              throw new Error(responseJSON.message || 'Update failed');
            setSnackbar({ children: `Row updated!`, severity: 'success' });
          }
        }
        if (oldRow.isNew) {
          setIsNewRowAdded(false);
          setShouldAddRowAfterFetch(false);
          await fetchPaginatedData(paginationModel.page);
        }

        return newRow;
      } catch (error: any) {
        setSnackbar({ children: error.message, severity: 'error' });
        throw error;
      }
    },
    [
      setSnackbar,
      setIsNewRowAdded,
      fetchPaginatedData,
      paginationModel.page
    ]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
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

  useEffect(() => {
    fetchValidationErrors()
      .catch(console.error)
      .then(() => setRefresh(false));
  }, [refresh]);

  const cellHasError = (colField: string, rowId: GridRowId) => {
    const error = validationErrors[Number(rowId)];
    if (!error) return false;
    const errorFields = error.ValidationErrorIDs.flatMap(
      id => errorMapping[id.toString()] || []
    );
    return errorFields.includes(colField);
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

  const columns = useMemo(() => {
    const commonColumns = modifiedColumns;
    if (locked) {
      return [validationStatusColumn, ...commonColumns];
    }
    return [validationStatusColumn, ...commonColumns, getGridActionsColumn()];
  }, [modifiedColumns, locked]);

  const filteredColumns = useMemo(() => filterColumns(rows, columns), [rows, columns]);

  const rowHasError = (rowId: GridRowId) => {
    if (!rows || rows.length === 0) return false;
    return gridColumns.some(column => cellHasError(column.field, rowId));
  };

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

  const errorRowCount = useMemo(() => {
    return rows.filter(row => rowHasError(row.id)).length;
  }, [rows, gridColumns]);

  useEffect(() => {
    if (errorRowCount > 0) {
      setSnackbar({
        children: `${errorRowCount} row(s) with validation errors detected.`,
        severity: 'warning'
      });
    }
  }, [errorRowCount]);

  const getRowClassName = (params: any) => {
    const rowId = params.id;
    if (rowIsDeprecated(rowId)) {
      return 'deprecated';
    } else if (rowHasError(rowId)) {
      return 'error-row';
    } else if (!params.row.isValidated) {
      return 'pending-validation';
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
            <Stack direction='row'>
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

            <Box>
              <Button color="primary" onClick={saveErrorRowsAsCSV}>
                Save Errors as CSV
              </Button>
              <Button color="primary" onClick={printErrorRows}>
                Print Errors
              </Button>
            </Box>
          </Stack>
          <Typography level={'title-lg'}>
            Note: The Grid is filtered by your selected Plot and Plot ID
          </Typography>
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
              toolbar: EditToolbar
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
        <ConfirmationDialog
          isOpen={isDialogOpen}
          onConfirm={handleConfirmAction}
          onCancel={handleCancelAction}
          message={
            pendingAction.actionType === 'save'
              ? 'Are you sure you want to save changes?'
              : 'Are you sure you want to delete this row?'
          }
        />
      </Box>
    );
  }
}

// ConfirmationDialog component with TypeScript types
const ConfirmationDialog: React.FC<ConfirmationDialogProps> = (props) => {
  const { isOpen, onConfirm, onCancel, message } = props;
  return (
    <Dialog open={isOpen} onClose={onCancel}>
      <DialogTitle>Confirm Action</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} color="primary">
          Cancel
        </Button>
        <Button onClick={onConfirm} color="primary">
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};
