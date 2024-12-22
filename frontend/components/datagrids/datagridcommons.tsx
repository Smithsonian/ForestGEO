'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, Button, Snackbar } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import Box from '@mui/joy/Box';
import { Tooltip, Typography } from '@mui/joy';
import { StyledDataGrid } from '@/config/styleddatagrid';
import {
  CellItemContainer,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  DataGridCommonProps,
  EditToolbarCustomProps,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  PendingAction
} from '@/config/datagridhelpers';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { redirect } from 'next/navigation';
import { HTTPResponses, UnifiedValidityFlags } from '@/config/macros';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useLoading } from '@/app/contexts/loadingprovider';

import ReEnterDataModal from './reentrydatamodal';
import ConfirmationDialog from './confirmationdialog';

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

const EditToolbar = ({ handleAddNewRow, handleRefresh, handleExportAll, locked, filterModel }: EditToolbarProps) => {
  const handleExportClick = async () => {
    if (!handleExportAll) return;
    const fullData = await handleExportAll();
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
      {/*<Button color="primary" startIcon={<AddIcon />} onClick={handleAddNewRow} disabled={locked}>*/}
      {/*  Add Row*/}
      {/*</Button>*/}
      <Button color="primary" startIcon={<RefreshIcon />} onClick={handleRefresh}>
        Refresh
      </Button>
      <Button color="primary" startIcon={<FileDownloadIcon />} onClick={handleExportClick}>
        Export Full Data
      </Button>
    </GridToolbarContainer>
  );
};

export default function DataGridCommons(props: Readonly<DataGridCommonProps>) {
  const {
    addNewRowToGrid,
    gridColumns,
    gridType,
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
    selectionOptions
  } = props;

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

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { setLoading } = useLoading();
  const { triggerRefresh } = useDataValidityContext();

  useSession();

  const apiRef = useGridApiRef();

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
      acc[row.id] = rowModesModel[row.id] || { mode: GridRowModes.View };
      return acc;
    }, {} as GridRowModesModel);

    // Only update if the rowModesModel has actually changed to avoid infinite re-rendering
    if (JSON.stringify(updatedRowModesModel) !== JSON.stringify(rowModesModel)) {
      setRowModesModel(updatedRowModesModel);
    }
  }, [rows]); // Removed rowModesModel from the dependencies array

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
  };

  const openConfirmationDialog = (actionType: 'save' | 'delete', actionId: GridRowId) => {
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
  };

  const handleConfirmAction = async (confirmedRow?: GridRowModel) => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);

    if (pendingAction.actionType === 'delete' && pendingAction.actionId !== null) {
      // Call performDeleteAction if the confirmed action is delete
      await performDeleteAction(pendingAction.actionId);
    } else if (promiseArguments) {
      try {
        const resolvedRow = confirmedRow || promiseArguments.newRow;
        // Proceed with saving the row after confirmation
        await performSaveAction(promiseArguments.newRow.id, resolvedRow);
        setSnackbar({ children: 'Row successfully updated!', severity: 'success' });
      } catch (error: any) {
        setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      }
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

  const performSaveAction = async (id: GridRowId, confirmedRow: GridRowModel) => {
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
        confirmedRow, // Use the confirmed row
        promiseArguments.oldRow, // Pass the old row for comparison
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
    triggerRefresh();
    setLoading(false);
    await fetchPaginatedData(paginationModel.page);
  };

  const performDeleteAction = async (id: GridRowId) => {
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
  };

  const handleSaveClick = (id: GridRowId) => async () => {
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

    console.log('Old Row:', oldRow);
    console.log('Updated Row:', updatedRow);

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
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    console.log('handle delete click: ', id);
    if (locked) return;
    if (gridType === 'census') {
      const rowToDelete = rows.find(row => String(row.id) === String(id));
      if (currentCensus && rowToDelete && rowToDelete.censusID === currentCensus.dateRanges[0].censusID) {
        alert('Cannot delete the currently selected census.');
        return;
      }
    }
    openConfirmationDialog('delete', id);
  };

  const handleAddNewRow = async () => {
    if (locked) return;
    if (isNewRowAdded) return; // Debounce double adds
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

    console.log('rowModesModel: ', rowModesModel);
  };

  const handleRefresh = async () => {
    await fetchPaginatedData(paginationModel.page);
  };

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
      setRows(data.output);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        addNewRowToGrid();
        setIsNewRowAdded(false);
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

  const processRowUpdate = useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel) => {
      setLoading(true, 'Processing changes...');

      // Check if it's a new row and interrupt the API call
      if (newRow.isNew || !newRow.id) {
        // Set promiseArguments to handle the modal confirmation
        setPromiseArguments({
          resolve: async (confirmedRow: GridRowModel) => {
            try {
              // Proceed with updating the row after confirmation
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
              setSnackbar({
                children: `Error: ${error.message}`,
                severity: 'error'
              });
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

        // Open confirmation dialog to let the user reenter data or confirm
        openConfirmationDialog('save', newRow.id);

        // Interrupt processRowUpdate by throwing a rejection to stop any API call until the modal is confirmed
        return Promise.reject(new Error('Row update interrupted for new row, awaiting confirmation'));
      }

      // For existing rows, proceed with the normal update flow
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
        setSnackbar({
          children: `Error: ${error.message}`,
          severity: 'error'
        });
        return Promise.reject(error);
      }
    },
    [gridType, currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    const updatedRowModesModel = { ...rowModesModel }; // Copy the existing row modes model

    Object.keys(newRowModesModel).forEach(id => {
      if (!updatedRowModesModel[id] || updatedRowModesModel[id].mode === undefined) {
        updatedRowModesModel[id] = { mode: GridRowModes.View }; // Set default mode if it doesn't exist
      }
      updatedRowModesModel[id] = { ...updatedRowModesModel[id], ...newRowModesModel[id] }; // Merge the new modes
    });

    setRowModesModel(updatedRowModesModel); // Update the state with the merged modes
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    if (locked) return;
    const row = rows.find(row => String(row.id) === String(id));
    if (row && handleSelectQuadrat) {
      handleSelectQuadrat(row.quadratID);
    }
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
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
    if (locked) return;
    event?.preventDefault();
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      setRows(oldRows => oldRows.filter(row => row.id !== id));
      setIsNewRowAdded(false);
      if (rowCount % paginationModel.pageSize === 1 && isNewRowAdded) {
        const newPage = paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
        setPaginationModel({ ...paginationModel, page: newPage });
      }
    } else {
      setRowModesModel(prevModel => ({
        ...prevModel,
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
    if (gridType !== 'quadratpersonnel') return filterColumns(rows, columns);
    else return columns;
  }, [rows, columns]);

  const handleCellDoubleClick: GridEventListener<'cellDoubleClick'> = params => {
    if (locked) return;
    console.log('params: ', params);
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
            processRowUpdate={processRowUpdate}
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
        {isDialogOpen && promiseArguments && (
          <ReEnterDataModal
            gridType={gridType}
            row={promiseArguments.oldRow} // Pass oldRow
            reEnterData={promiseArguments.newRow} // Pass newRow
            handleClose={handleCancelAction}
            handleSave={handleConfirmAction}
            columns={gridColumns}
            selectionOptions={selectionOptions}
            hiddenColumns={getColumnVisibilityModel(gridType)}
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
