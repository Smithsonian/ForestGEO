"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides
} from '@mui/x-data-grid';
import {
  Alert,
  Button,
  Snackbar
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from "@mui/joy/Box";
import { Tooltip, Typography } from "@mui/joy";
import { StyledDataGrid } from "@/config/styleddatagrid";
import {
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  getColumnVisibilityModel,
  getGridID,
} from "@/config/datagridhelpers";
import { useSession } from "next-auth/react";
import {
  useOrgCensusContext,
  usePlotContext,
  useQuadratContext,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import { redirect } from 'next/navigation';
import { HTTPResponses, UnifiedValidityFlags } from '@/config/macros';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import { useLoading } from '@/app/contexts/loadingprovider';
import { EditToolbarCustomProps, DataGridCommonProps, PendingAction, CellItemContainer, filterColumns } from './datagridmacros';
import ReEnterDataModal from './reentrydatamodal';
import ConfirmationDialog from './confirmationdialog';

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
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({ actionType: '', actionId: null });
  const [promiseArguments, setPromiseArguments] = useState<{ resolve: (value: GridRowModel) => void, reject: (reason?: any) => void, newRow: GridRowModel, oldRow: GridRowModel } | null>(null);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const currentSite = useSiteContext();

  const { setLoading } = useLoading();
  const { triggerRefresh } = useDataValidityContext();
  const { triggerPulse } = useLockAnimation();
  const handleLockedClick = () => triggerPulse();

  useSession();

  useEffect(() => {
    if (currentCensus !== undefined) {
      setLocked(currentCensus.dateRanges[0].endDate !== undefined);
    }
  }, [currentCensus]);

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
    triggerRefresh();
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
      gridType,
      getGridID(gridType),
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
      triggerRefresh([gridType as keyof UnifiedValidityFlags]);
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleSaveClick = (id: GridRowId) => () => {
    if (locked) return;
    openConfirmationDialog('save', id);
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    if (locked) return;
    if (gridType === 'census') {
      const rowToDelete = rows.find(row => String(row.id) === String(id));
      if (
        currentCensus &&
        rowToDelete &&
        rowToDelete.censusID === currentCensus.dateRanges[0].censusID
      ) {
        alert('Cannot delete the currently selected census.');
        return;
      }
    }
    openConfirmationDialog('delete', id);
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
    setLoading(true, "Loading data...");
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
        console.log('isNewRowAdded true, on new last page');
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

  const processRowUpdate = useCallback((newRow: GridRowModel, oldRow: GridRowModel) => new Promise<GridRowModel>((resolve, reject) => {
    setLoading(true, "Processing changes...");
    if (newRow.id === '') {
      setLoading(false);
      return reject(new Error('Primary key id cannot be empty!'));
    }

    setPromiseArguments({ resolve, reject, newRow, oldRow });
    setLoading(false);
  }), [gridType, currentSite?.schemaName, setSnackbar, setIsNewRowAdded, setShouldAddRowAfterFetch, fetchPaginatedData, paginationModel]);

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
    const row = rows.find(row => String(row.id) === String(id));
    console.log('handleEditClick row: ', row);
    if (row && handleSelectQuadrat) {
      handleSelectQuadrat(row.quadratID);
    }
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: { mode: GridRowModes.Edit },
    }));
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
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
      setRowModesModel((prevModel) => ({
        ...prevModel,
        [id]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);
  };

  const getEnhancedCellAction = (type: string, icon: any, onClick: any) => (
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
          <GridActionsCellItem icon={icon} label={type} disabled={locked} />
        </span>
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

        if (isInEditMode && !locked) {
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

  const columns = useMemo(() => {
    const commonColumns = gridColumns;
    return [...commonColumns, getGridActionsColumn()];
  }, [gridColumns, rowModesModel]);

  const filteredColumns = useMemo(() => {
    if (gridType !== 'quadratpersonnel') return filterColumns(rows, columns);
    else return columns;
  }, [rows, columns]);

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
          <Typography level={'title-lg'}>
            Note: The Grid is filtered by your selected Plot and Plot ID
          </Typography>
          <StyledDataGrid
            sx={{ width: '100%' }}
            rows={rows}
            columns={filteredColumns}
            editMode='row'
            rowModesModel={rowModesModel}
            disableColumnSelector
            onRowModesModelChange={handleRowModesModelChange}
            onRowEditStop={handleRowEditStop}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={(error) => {
              console.error('Row update error:', error);
              setSnackbar({ children: 'Error updating row', severity: 'error' });
            }}
            onCellKeyDown={(params, event) => {
              if (event.key === 'Enter') {
                event.defaultMuiPrevented = true;
                openConfirmationDialog('save', params.id);
              }
            }}
            loading={refresh}
            paginationMode='server'
            onPaginationModelChange={setPaginationModel}
            paginationModel={paginationModel}
            rowCount={rowCount}
            pageSizeOptions={[paginationModel.pageSize]}
            initialState={{
              columns: {
                columnVisibilityModel: getColumnVisibilityModel(gridType),
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
