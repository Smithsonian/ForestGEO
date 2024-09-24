'use client';

import {
  CellItemContainer,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
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
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertProps, Button, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useLoading } from '@/app/contexts/loadingprovider';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useSession } from 'next-auth/react';
import { HTTPResponses, UnifiedValidityFlags } from '@/config/macros';
import { Tooltip, Typography } from '@mui/joy';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { redirect } from 'next/navigation';
import Box from '@mui/joy/Box';
import { StyledDataGrid } from '@/config/styleddatagrid';
import ConfirmationDialog from '@/components/datagrids/confirmationdialog';
import { randomId } from '@mui/x-data-grid-generator';
import SkipReEnterDataModal from '@/components/datagrids/skipreentrydatamodal';

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

const EditToolbar = ({ handleAddNewRow, handleRefresh, handleExportAll, locked, filterModel }: EditToolbarProps) => {
  if (!handleAddNewRow || !handleRefresh) return <></>;
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

  return (
    <GridToolbarContainer>
      <GridToolbar />
      <Button color="primary" startIcon={<AddIcon />} onClick={async () => await handleAddNewRow()} disabled={locked}>
        Add Row
      </Button>
      <Button color="primary" startIcon={<RefreshIcon />} onClick={async () => await handleRefresh()}>
        Refresh
      </Button>
      <Button color="primary" startIcon={<FileDownloadIcon />} onClick={handleExportClick}>
        Export Full Data
      </Button>
    </GridToolbarContainer>
  );
};

export default function IsolatedDataGridCommons(props: Readonly<IsolatedDataGridCommonProps>) {
  const { gridColumns, gridType, refresh, setRefresh, locked = false, selectionOptions, initialRow, fieldToFocus, clusters } = props;

  const [rows, setRows] = useState([initialRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });
  const [promiseArguments, setPromiseArguments] = useState<{
    resolve: (value: GridRowModel) => void;
    reject: (reason?: any) => void;
    newRow: GridRowModel;
    oldRow: GridRowModel;
  } | null>(null);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({
    items: []
  });
  const [rowsUpdated, setRowsUpdated] = useState(false);
  const [rowModesModelUpdated, setRowModesModelUpdated] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { setLoading } = useLoading();
  const { triggerRefresh } = useDataValidityContext();

  useSession();

  const apiRef = useGridApiRef();

  // Track when rows and rowModesModel are updated using useEffect
  useEffect(() => {
    if (rows.length > 0) {
      setRowsUpdated(true);
    }
  }, [rows]);

  useEffect(() => {
    if (Object.keys(rowModesModel).length > 0) {
      setRowModesModelUpdated(true);
    }
  }, [rowModesModel]);

  // Function to wait for rows and rowModesModel to update
  const waitForStateUpdates = async () => {
    return new Promise<void>(resolve => {
      const checkUpdates = () => {
        if (rowsUpdated && rowModesModelUpdated) {
          resolve();
        } else {
          setTimeout(checkUpdates, 50); // Check every 50ms until both are updated
        }
      };
      checkUpdates();
    });
  };

  useEffect(() => {
    if (!isNewRowAdded) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [paginationModel.page]);

  useEffect(() => {
    if (currentPlot?.plotID || currentCensus?.plotCensusNumber) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [currentPlot, currentCensus, paginationModel.page]);

  useEffect(() => {
    if (refresh && currentSite) {
      handleRefresh().then(() => {
        if (refresh) {
          setRefresh(false); // Only update state if it hasn't already been reset
        }
      });
    }
  }, [refresh, currentSite]); // No need for setRefresh in dependencies

  useEffect(() => {
    const updatedRowModesModel = rows.reduce((acc, row) => {
      if (row.id) {
        acc[row.id] = rowModesModel[row.id] || { mode: GridRowModes.View }; // Ensure valid row ID is used
      }
      return acc;
    }, {} as GridRowModesModel);

    // Clean invalid rowModesModel entries like '0'
    const cleanedRowModesModel = Object.fromEntries(Object.entries(updatedRowModesModel).filter(([key]) => key !== '0'));

    if (JSON.stringify(cleanedRowModesModel) !== JSON.stringify(rowModesModel)) {
      setRowModesModel(cleanedRowModesModel);
    }
  }, [rows]);

  const fetchFullData = useCallback(async () => {
    setLoading(true, 'Fetching full dataset...');
    let partialQuery = ``;
    if (currentPlot?.plotID) partialQuery += `/${currentPlot.plotID}`;
    if (currentCensus?.plotCensusNumber) partialQuery += `/${currentCensus.plotCensusNumber}`;
    if (currentQuadrat?.quadratID) partialQuery += `/${currentQuadrat.quadratID}`;
    const fullDataQuery = `/api/fetchall/${gridType}` + partialQuery + `?schema=${currentSite?.schemaName}`;

    try {
      const response = await fetch(fullDataQuery, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filterModel)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error fetching full data');
      return data.output;
    } catch (error) {
      console.error('Error fetching full data:', error);
      setSnackbar({ children: 'Error fetching full data', severity: 'error' });
      return [];
    } finally {
      setLoading(false);
    }
  }, [filterModel, currentPlot, currentCensus, currentQuadrat, currentSite, gridType, setLoading]);

  const openConfirmationDialog = useCallback(
    (actionType: 'save' | 'delete', actionId: GridRowId) => {
      setPendingAction({ actionType, actionId });

      const row = rows.find(row => String(row.id) === String(actionId));
      if (row) {
        if (actionType === 'delete') {
          setIsDeleteDialogOpen(true);
        } else {
          // Open the reentry modal after setting promiseArguments
          setIsDialogOpen(true);
        }
      }
    },
    [rows]
  );

  const handleConfirmAction = useCallback(
    async (confirmedRow?: GridRowModel) => {
      setIsDialogOpen(false);
      setIsDeleteDialogOpen(false);

      if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
        // Call performDeleteAction if the confirmed action is delete
        await performDeleteAction(pendingAction.actionId);
      } else if (promiseArguments) {
        try {
          console.log('handleconfirmaction: confirmedRow: ', confirmedRow);
          console.log('handleconfirmaction: promiseArguments.newRow: ', promiseArguments.newRow);
          const resolvedRow = confirmedRow || promiseArguments.newRow;
          console.log('handleconfirmaction: resolvedRow: ', resolvedRow);
          // Proceed with saving the row after confirmation
          await performSaveAction(promiseArguments.newRow.id, resolvedRow);
          setSnackbar({ children: 'Row successfully updated!', severity: 'success' });
        } catch (error: any) {
          setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
        }
      }

      setPendingAction({ actionType: '', actionId: null });
      setPromiseArguments(null); // Clear promise arguments after handling
    },
    [pendingAction, promiseArguments]
  );

  const handleCancelAction = useCallback(() => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (promiseArguments) {
      promiseArguments.reject(new Error('Action cancelled by user'));
    }
    setPendingAction({ actionType: '', actionId: null });
    setPromiseArguments(null); // Clear promise arguments after handling
  }, [promiseArguments]);

  const performSaveAction = useCallback(
    async (id: GridRowId, confirmedRow: GridRowModel) => {
      if (locked || !promiseArguments) return;

      setLoading(true, 'Saving changes...');
      try {
        // Set the row to view mode after confirmation
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View }
        }));

        const updatedRow = await updateRow(
          gridType,
          currentSite?.schemaName,
          confirmedRow,
          promiseArguments.oldRow,
          setSnackbar,
          setIsNewRowAdded,
          setShouldAddRowAfterFetch,
          fetchPaginatedData,
          paginationModel
        );

        promiseArguments.resolve(updatedRow);

        // Trigger onDataUpdate after successfully saving
        if (props.onDataUpdate) {
          props.onDataUpdate();
        }
      } catch (error) {
        promiseArguments.reject(error);
      }

      triggerRefresh();
      setLoading(false);
      await fetchPaginatedData(paginationModel.page);
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
      rows,
      triggerRefresh,
      setLoading
    ]
  );

  const performDeleteAction = useCallback(
    async (id: GridRowId) => {
      if (locked) return;

      setLoading(true, 'Deleting...');

      const rowToDelete = rows.find(row => String(row.id) === String(id));
      if (!rowToDelete) return; // Ensure row exists

      const deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', gridType, getGridID(gridType), rowToDelete.id);

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
          setRows(prevRows => prevRows.filter(row => row.id !== id)); // Update rows by removing the deleted row
          setSnackbar({
            children: 'Row successfully deleted',
            severity: 'success'
          });
          triggerRefresh([gridType as keyof UnifiedValidityFlags]);
          await fetchPaginatedData(paginationModel.page);
        }
      } catch (error: any) {
        setSnackbar({
          children: `Error: ${error.message || 'Deletion failed'}`,
          severity: 'error'
        });
      } finally {
        setLoading(false);
      }
    },
    [locked, rows, currentSite, gridType, setSnackbar, paginationModel, triggerRefresh, setLoading]
  );

  const handleSaveClick = useCallback(
    (id: GridRowId) => async () => {
      if (locked) return;

      const updatedRowModesModel = { ...rowModesModel };
      if (!updatedRowModesModel[id] || updatedRowModesModel[id].mode === undefined) {
        updatedRowModesModel[id] = { mode: GridRowModes.View }; // Set default mode if it doesn't exist
      }

      // Stop edit mode and apply changes locally without committing to the server yet
      apiRef.current.stopRowEditMode({ id, ignoreModifications: true });

      // Get the original row data (before edits)
      const oldRow = rows.find(row => String(row.id) === String(id));

      // Use getRowWithUpdatedValues to fetch all updated field values (the field is ignored in row editing mode)
      const updatedRow = apiRef.current.getRowWithUpdatedValues(id, 'anyField'); // 'anyField' is a dummy value, ignored in row editing

      if (oldRow && updatedRow) {
        // Set promise arguments before opening the modal
        setPromiseArguments({
          resolve: (value: GridRowModel) => {}, // Define resolve
          reject: (reason?: any) => {}, // Define reject
          oldRow, // Pass the old (original) row
          newRow: updatedRow // Pass the updated (edited) row
        });

        // Open the confirmation dialog for reentry data
        openConfirmationDialog('save', id);
      }
    },
    [locked, rowModesModel, rows, apiRef, openConfirmationDialog]
  );

  const handleDeleteClick = useCallback(
    (id: GridRowId) => () => {
      if (locked) return;
      if (gridType === 'census') {
        const rowToDelete = rows.find(row => String(row.id) === String(id));
        if (currentCensus && rowToDelete && rowToDelete.censusID === currentCensus.dateRanges[0].censusID) {
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
    if (isNewRowAdded) return; // Debounce double adds
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;
    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
    } else {
      setPaginationModel({ ...paginationModel, page: existingLastPage });
    }
    const id = randomId(); // Generate a unique string ID
    const newRow = { ...initialRow, id, isNew: true };
    setRows(prevRows => {
      return [...prevRows, newRow];
    });
    setRowModesModel(prevModel => {
      return {
        ...prevModel,
        [id]: { mode: GridRowModes.Edit, fieldToFocus } // Add the new row with 'Edit' mode
      };
    });

    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);
    setIsNewRowAdded(true);
  }, [locked, isNewRowAdded, rowCount, paginationModel, initialRow, setRows, setRowModesModel, fieldToFocus]);

  const handleRefresh = useCallback(async () => {
    await fetchPaginatedData(paginationModel.page);
  }, [paginationModel.page]);

  const fetchPaginatedData = async (pageToFetch: number) => {
    setLoading(true, 'Loading data...');
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      console.log('rows: ', data.output);
      setRows(data.output);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        await handleAddNewRow();
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

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
        method: oldRow.isNew ? 'POST' : 'PATCH', // Ensure POST for new row, PATCH for existing
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: oldRow, newRow: newRow })
      });

      const responseJSON = await response.json();

      if (!response.ok) {
        // If the response isn't okay, throw an error to be caught
        throw new Error(responseJSON.message || 'An unknown error occurred');
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
      // Handle error, display the error in snackbar
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow); // Ensure the promise is rejected so processRowUpdate can handle it
    }
  };

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      // If the row is newly added and is being canceled, skip the update
      if (newRow?.isNew && !newRow?.id) {
        return oldRow; // Return the old row without making changes
      }

      setLoading(true, 'Processing changes...');

      // Handle new rows by confirming the save action with the user
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
                fetchPaginatedData,
                paginationModel
              );
              setLoading(false);
              return updatedRow;
            } catch (error: any) {
              setLoading(false);
              setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
              return Promise.reject(error);
            }
          },
          reject: reason => {
            setLoading(false);
            return Promise.reject(reason);
          },
          oldRow,
          newRow
        });

        openConfirmationDialog('save', newRow.id);
        return Promise.reject(new Error('Row update interrupted for new row, awaiting confirmation'));
      }

      // Proceed with updating existing rows
      try {
        const updatedRow = await updateRow(
          gridType,
          currentSite?.schemaName,
          newRow,
          oldRow,
          setSnackbar,
          setIsNewRowAdded,
          setShouldAddRowAfterFetch,
          fetchPaginatedData,
          paginationModel
        );
        setLoading(false);
        return updatedRow;
      } catch (error: any) {
        setLoading(false);
        setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
        return Promise.reject(error);
      }
    },
    [gridType, currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
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
          // Prevent setting mode for rows that don't exist in the model
          console.warn(`Row ID ${id} does not exist in rowModesModel. Skipping.`);
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
      // Auto-focus on the first editable cell when entering edit mode
      setTimeout(() => {
        const firstEditableColumn = filteredColumns.find(col => col.editable);
        if (firstEditableColumn) {
          apiRef.current.setCellFocus(id, firstEditableColumn.field);
        }
      });
    },
    [locked, apiRef]
  );

  const handleCancelClick = useCallback(
    (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
      if (locked) return;
      event?.preventDefault();

      const row = rows.find(row => String(row.id) === String(id));

      if (row?.isNew) {
        // Remove the new row from the rows state
        setRows(oldRows => oldRows.filter(row => row.id !== id));

        // Safely remove the row from rowModesModel
        setRowModesModel(prevModel => {
          const updatedModel = { ...prevModel };
          delete updatedModel[id]; // Remove the newly added row from rowModesModel
          return updatedModel;
        });

        setIsNewRowAdded(false); // Reset the flag indicating a new row was added
      } else {
        // Revert the row to view mode if it's an existing row
        setRowModesModel(prevModel => ({
          ...prevModel,
          [id]: { mode: GridRowModes.View, ignoreModifications: true }
        }));
      }
    },
    [locked, rows]
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
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e))
          ];
        }
        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    }),
    [rowModesModel, locked]
  );

  const columns = useMemo(() => {
    return [...gridColumns, getGridActionsColumn()];
  }, [gridColumns, rowModesModel, getGridActionsColumn]);

  const filteredColumns = useMemo(() => {
    console.log('columns unfiltered: ', columns);
    console.log('rows: ', rows);
    console.log('filtered: ', filterColumns(rows, columns));
    if (gridType !== 'quadratpersonnel') return filterColumns(rows, columns);
    else return columns;
  }, [rows, columns]);

  const handleCellDoubleClick: GridEventListener<'cellDoubleClick'> = params => {
    if (locked) return;
    setRowModesModel(prevModel => ({
      ...prevModel,
      [params.id]: { mode: GridRowModes.Edit }
    }));
  };

  const handleCellKeyDown: GridEventListener<'cellKeyDown'> = (params, event) => {
    if (event.key === 'Enter' && !locked) {
      event.defaultMuiPrevented = true;
      // console.log('params: ', params);
      // setRowModesModel(prevModel => ({
      //   ...prevModel,
      //   [params.id]: { mode: GridRowModes.Edit }
      // }));
    }
    if (event.key === 'Escape') {
      event.defaultMuiPrevented = true;
      // console.log('params: ', params);
      // setRowModesModel(prevModel => ({
      //   ...prevModel,
      //   [params.id]: { mode: GridRowModes.View, ignoreModifications: true }
      // }));
      // handleCancelClick(params.id, event);
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
          <Typography level={'title-lg'}>Note: The Grid is filtered by your selected Plot and Plot ID</Typography>
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
            onCellDoubleClick={handleCellDoubleClick}
            onCellKeyDown={handleCellKeyDown}
            processRowUpdate={async (newRow, oldRow) => {
              // Create a promise to wait for state updates
              const waitForStateUpdates = async () => {
                return new Promise<void>(resolve => {
                  const checkUpdates = () => {
                    if (rows.length > 0 && Object.keys(rowModesModel).length > 0) {
                      resolve(); // Resolve when states are updated
                    } else {
                      setTimeout(checkUpdates, 50); // Retry every 50ms
                    }
                  };
                  checkUpdates();
                });
              };

              // Wait for rows and rowModesModel to update
              await waitForStateUpdates();

              // Now call the actual processRowUpdate logic after the state has settled
              try {
                return await processRowUpdate(newRow, oldRow);
              } catch (error) {
                console.error('Error processing row update:', error);
                setSnackbar({ children: 'Error updating row', severity: 'error' });
                return Promise.reject(error); // Handle error if needed
              }
            }}
            onProcessRowUpdateError={error => {
              console.error('Row update error:', error);
              setSnackbar({
                children: 'Error updating row',
                severity: 'error'
              });
            }}
            loading={refresh}
            paginationMode="server"
            onPaginationModelChange={setPaginationModel}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
            filterModel={filterModel}
            onFilterModelChange={newFilterModel => setFilterModel(newFilterModel)}
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
                filterModel: filterModel
              }
            }}
            autoHeight
            getRowHeight={() => 'auto'}
          />
        </Box>
        {!!snackbar && (
          <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} onClose={handleCloseSnackbar} autoHideDuration={6000}>
            <Alert {...snackbar} onClose={handleCloseSnackbar} />
          </Snackbar>
        )}
        {/*{isDialogOpen && promiseArguments && (*/}
        {/*  <ReEnterDataModal*/}
        {/*    gridType={gridType}*/}
        {/*    row={promiseArguments.oldRow} // Pass oldRow*/}
        {/*    reEnterData={promiseArguments.newRow} // Pass newRow*/}
        {/*    handleClose={handleCancelAction}*/}
        {/*    handleSave={handleConfirmAction}*/}
        {/*    columns={gridColumns}*/}
        {/*    selectionOptions={selectionOptions}*/}
        {/*    clusters={clusters}*/}
        {/*    hiddenColumns={getColumnVisibilityModel(gridType)}*/}
        {/*  />*/}
        {/*)}*/}
        {isDialogOpen && promiseArguments && (
          <SkipReEnterDataModal
            gridType={gridType}
            row={promiseArguments.newRow} // Pass the newRow directly
            handleClose={handleCancelAction}
            handleSave={handleConfirmAction}
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
