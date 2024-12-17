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
  GridRowsProp,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides,
  useGridApiRef
} from '@mui/x-data-grid';
import { Alert, AlertProps, Button, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
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
  EditToolbarCustomProps,
  filterColumns,
  getColumnVisibilityModel,
  getGridID,
  PendingAction
} from '@/config/datagridhelpers';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useQuadratContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { HTTPResponses } from '@/config/macros';
import { useLoading } from '@/app/contexts/loadingprovider';
import ReEnterDataModal from '@/components/datagrids/reentrydatamodal';
import ConfirmationDialog from '@/components/datagrids/confirmationdialog';
import { randomId } from '@mui/x-data-grid-generator';
import { SpeciesLimitsRDS } from '@/config/sqlrdsdefinitions/taxonomies';
import { SpeciesLimitsGridColumns } from '@/components/client/datagridcolumns';

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
      <Button color="primary" startIcon={<AddIcon />} onClick={handleAddNewRow} disabled={locked}>
        Add Row
      </Button>
      <Button color="primary" startIcon={<RefreshIcon />} onClick={handleRefresh}>
        Refresh
      </Button>
      <Button color="primary" startIcon={<FileDownloadIcon />} onClick={handleExportClick}>
        Export Full Data
      </Button>
    </GridToolbarContainer>
  );
};

export default function SpeciesLimitsDataGrid({ speciesID }: { speciesID: number }) {
  const initialSpeciesLimitsRDSRow: SpeciesLimitsRDS = {
    id: 0,
    speciesLimitID: 0,
    speciesID: 0,
    limitType: '',
    upperBound: 0,
    lowerBound: 0,
    unit: ''
  };
  const [rows, setRows] = useState([initialSpeciesLimitsRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
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

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialSpeciesLimitsRDSRow,
      id,
      isNew: true
    };

    setRows(oldRows => [...(oldRows ?? []), newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'limitType' }
    }));
  };

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { setLoading } = useLoading();

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
        setRefresh(false);
      });
    }
  }, [refresh, setRefresh]);

  useEffect(() => {
    const initialRowModesModel = rows.reduce((acc, row) => {
      acc[row.id] = { mode: GridRowModes.View };
      return acc;
    }, {} as GridRowModesModel);
    setRowModesModel(initialRowModesModel);
  }, [rows]);

  const fetchFullData = async () => {
    setLoading(true, 'Fetching full dataset...');
    const fullDataQuery = `/api/specieslimits/${speciesID}?schema=${currentSite?.schemaName}`;

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
        setIsDialogOpen(true);
        setRowModesModel(oldModel => ({
          ...oldModel,
          [actionId]: { mode: GridRowModes.View }
        }));
      }
    }
  };

  const handleConfirmAction = async (selectedRow?: GridRowModel) => {
    setIsDialogOpen(false);
    setIsDeleteDialogOpen(false);
    if (pendingAction.actionType === 'save' && pendingAction.actionId !== null) {
      await performSaveAction(pendingAction.actionId, selectedRow);
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

  const performSaveAction = async (id: GridRowId, selectedRow?: GridRowModel) => {
    if (!promiseArguments) return;
    setLoading(true, 'Saving changes...');
    try {
      const updatedRow = await updateRow(
        'specieslimits',
        currentSite?.schemaName,
        selectedRow ?? promiseArguments.newRow,
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
    setLoading(false);
    await fetchPaginatedData(paginationModel.page);
  };

  const performDeleteAction = async (id: GridRowId) => {
    setLoading(true, 'Deleting...');
    const deletionID = rows.find(row => String(row.id) === String(id))?.id;
    if (!deletionID) return;
    const deleteQuery = createDeleteQuery(currentSite?.schemaName ?? '', 'specieslimits', getGridID('specieslimits'), deletionID);
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
      setSnackbar({
        children: 'Row successfully deleted',
        severity: 'success'
      });
      setRows(rows.filter(row => String(row.id) !== String(id)));
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleSaveClick = (id: GridRowId) => () => {
    openConfirmationDialog('save', id);
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    openConfirmationDialog('delete', id);
  };

  const handleAddNewRow = async () => {
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
  };

  const handleRefresh = async () => {
    await fetchPaginatedData(paginationModel.page);
  };

  const fetchPaginatedData = async (pageToFetch: number) => {
    setLoading(true, 'Loading data...');
    const paginatedQuery = createFetchQuery(
      currentSite?.schemaName ?? '',
      'specieslimits',
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
    const gridID = getGridID('specieslimits');
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
      // call refreshmeasurementssummary or viewfulltable if needed: await fetch(`/api/refresh/${gridType}`);
      return newRow;
    } catch (error: any) {
      setSnackbar({ children: `Error: ${error.message}`, severity: 'error' });
      return Promise.reject(newRow);
    }
  };

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
    ['specieslimits', currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    console.log('new row modes model: ', newRowModesModel);
    setRowModesModel(newRowModesModel);
  };

  const handleCloseSnackbar = () => setSnackbar(null);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    setRowModesModel(prevModel => ({
      ...prevModel,
      [id]: { mode: GridRowModes.Edit }
    }));
    // Auto-focus on the first editable cell when entering edit mode
    setTimeout(() => {
      const firstEditableColumn = columns.find(col => col.editable);
      if (firstEditableColumn) {
        apiRef.current.setCellFocus(id, firstEditableColumn.field);
      }
    });
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent | React.KeyboardEvent) => {
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

  const getGridActionsColumn = useCallback((): GridColDef => {
    return {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      flex: 1,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        // Ensure that the mode is being accessed correctly
        const mode = rowModesModel[id]?.mode;

        if (mode === GridRowModes.Edit) {
          return [
            getEnhancedCellAction('Save', <SaveIcon />, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon />, (e: any) => handleCancelClick(id, e))
          ];
        }
        return [getEnhancedCellAction('Edit', <EditIcon />, handleEditClick(id)), getEnhancedCellAction('Delete', <DeleteIcon />, handleDeleteClick(id))];
      }
    };
  }, [rowModesModel]);

  const columns = useMemo(() => {
    return filterColumns(rows, [...SpeciesLimitsGridColumns, getGridActionsColumn()]);
  }, [SpeciesLimitsGridColumns, rowModesModel, getGridActionsColumn]);

  const handleCellDoubleClick: GridEventListener<'cellDoubleClick'> = params => {
    console.log('params: ', params);
    setRowModesModel(prevModel => ({
      ...prevModel,
      [params.id]: { mode: GridRowModes.Edit }
    }));
  };

  const handleCellKeyDown: GridEventListener<'cellKeyDown'> = (params, event) => {
    if (event.key === 'Enter') {
      console.log('params: ', params);
      setRowModesModel(prevModel => ({
        ...prevModel,
        [params.id]: { mode: GridRowModes.Edit }
      }));
    }
    if (event.key === 'Escape') {
      console.log('params: ', params);
      setRowModesModel(prevModel => ({
        ...prevModel,
        [params.id]: { mode: GridRowModes.View, ignoreModifications: true }
      }));
      handleCancelClick(params.id, event);
    }
  };

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
          columns={columns}
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
              columnVisibilityModel: getColumnVisibilityModel('specieslimits')
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
              filterModel: filterModel
            }
          }}
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
          gridType={'specieslimits'}
          row={promiseArguments.oldRow}
          reEnterData={promiseArguments.newRow}
          handleClose={handleCancelAction}
          handleSave={handleConfirmAction}
          columns={SpeciesLimitsGridColumns}
          clusters={{
            SpeciesLimits: ['limitType', 'upperBound', 'lowerBound', 'unit']
          }}
          selectionOptions={['DBH', 'HOM'].map(limit => ({
            value: limit,
            label: limit
          }))}
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
