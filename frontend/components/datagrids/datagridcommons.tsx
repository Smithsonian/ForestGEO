"use client";
import React, {Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState} from 'react';
import {
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides
} from '@mui/x-data-grid';
import {
  Alert,
  AlertProps,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockIcon from '@mui/icons-material/Lock';
import Box from "@mui/joy/Box";
import {Stack, styled, Tooltip, Typography} from "@mui/joy";
import {StyledDataGrid} from "@/config/styleddatagrid";
import {
  computeMutation,
  createDeleteQuery,
  createFetchQuery,
  createPostPatchQuery,
  getColumnVisibilityModel,
  getGridID,
} from "@/config/datagridhelpers";
import {useSession} from "next-auth/react";
import {
  useOrgCensusContext,
  usePlotContext,
  useQuadratContext,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import {redirect} from 'next/navigation';
import {UnifiedValidityFlags} from '@/config/macros';
import {useDataValidityContext} from '@/app/contexts/datavalidityprovider';
import {useLockAnimation} from '@/app/contexts/lockanimationcontext';
import {useLoading} from '@/app/contexts/loadingprovider';

interface EditToolbarCustomProps {
  handleAddNewRow?: () => void;
  handleRefresh?: () => Promise<void>;
  locked?: boolean;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;

export function EditToolbar(props: EditToolbarProps) {
  const {handleAddNewRow, handleRefresh, locked = false} = props;

  return (
    <GridToolbarContainer>
      <GridToolbar/>
      {!locked && (
        <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
          Add Row
        </Button>
      )}
      <Button color="primary" startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

export interface DataGridCommonProps {
  gridType: string;
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
  paginationModel: { pageSize: number, page: number };
  setPaginationModel: Dispatch<SetStateAction<{ pageSize: number, page: number }>>;
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

export const CellItemContainer = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
});

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
  return columns.filter(col => col.field === 'actions' || !allValuesAreNull(rows, col.field));
}

/**
 * Renders common UI components for data grids.
 *
 * Handles state and logic for editing, saving, deleting rows, pagination,
 * validation errors and more. Renders a DataGrid component with customized
 * columns and cell renderers.
 */
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
    locked = false,
    handleSelectQuadrat,
  } = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null); // new state to track the new last page
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();

  const {setLoading} = useLoading();

  const {triggerRefresh} = useDataValidityContext();
  const {triggerPulse} = useLockAnimation();

  const handleLockedClick = () => {
    triggerPulse();
  };

  const [pendingAction, setPendingAction] = useState<PendingAction>({
    actionType: '',
    actionId: null
  });

  useSession();
  const currentSite = useSiteContext();

  const openConfirmationDialog = (
    actionType: 'save' | 'delete',
    actionId: GridRowId
  ) => {
    setPendingAction({actionType, actionId});
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
    setPendingAction({actionType: '', actionId: null});
  };

  const handleCancelAction = () => {
    setIsDialogOpen(false);
    setPendingAction({actionType: '', actionId: null});
  };

  const performSaveAction = async (id: GridRowId) => {
    if (locked) return;
    setLoading(true, "Saving changes...");
    // console.log('save confirmed');
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.View}
    }));
    // console.log('Updated rowModesModel:', rowModesModel);
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      setIsNewRowAdded(false);
      setShouldAddRowAfterFetch(false);
    }
    if (handleSelectQuadrat) handleSelectQuadrat(null);
    switch (gridType) {
      case 'stemtaxonomiesview':
      case 'alltaxonomiesview':
        triggerRefresh(["species" as keyof UnifiedValidityFlags]);
      case 'stemdimensionsview':
        triggerRefresh(["quadrats" as keyof UnifiedValidityFlags]);
      default:
        triggerRefresh([gridType as keyof UnifiedValidityFlags]);
        break;
    }
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
      body: JSON.stringify({oldRow: undefined, newRow: rows.find(row => String(row.id) === String(id))!})
    });
    setLoading(false);
    if (!response.ok) {
      setSnackbar({children: 'Error: Deletion failed', severity: 'error'});
    } else {
      if (handleSelectQuadrat) handleSelectQuadrat(null);
      setSnackbar({children: 'Row successfully deleted', severity: 'success'});
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
      // console.log('rowCount: ', rowCount);
      return;
    }
    // console.log('handleAddNewRow triggered');

    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage);

    // console.log('newRowCount:', newRowCount, 'calculatedNewLastPage:', calculatedNewLastPage, 'isNewPageNeeded:', isNewPageNeeded);

    if (isNewPageNeeded) {
      setPaginationModel({...paginationModel, page: calculatedNewLastPage});
      addNewRowToGrid();
    } else {
      setPaginationModel({...paginationModel, page: existingLastPage});
      addNewRowToGrid();
    }
  };

  const handleRefresh = async () => {
    await fetchPaginatedData(paginationModel.page);
  };

  const fetchPaginatedData = async (pageToFetch: number) => {
    // console.log('fetchPaginatedData triggered');
    setLoading(true, "Loading data...");
    let paginatedQuery = createFetchQuery(
      currentSite?.schemaName ?? '',
      gridType,
      pageToFetch,
      paginationModel.pageSize,
      currentPlot?.plotID,
      currentCensus?.plotCensusNumber,
      currentQuadrat?.quadratID
    );
    try {
      const response = await fetch(paginatedQuery, {method: 'GET'});
      const data = await response.json();
      // console.log('fetchPaginatedData data (json-converted): ', data);
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      setRows(data.output);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        console.log('isNewRowAdded true, on new last page');
        addNewRowToGrid();
        setIsNewRowAdded(false);
      }
      // console.log('Data validity refresh triggered for gridType:', gridType);
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({children: 'Error fetching data', severity: 'error'});
    } finally {
      setLoading(false);
    }
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
        setRefresh(false);
      });
    }
  }, [refresh, setRefresh]);

  const processRowUpdate = useCallback(async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
    setLoading(true, "Processing changes...");
    const gridID = getGridID(gridType);
    const fetchProcessQuery = createPostPatchQuery(currentSite?.schemaName ?? '', gridType, gridID);

    if (newRow.id === '') {
      setLoading(false);
      throw new Error(`Primary key id cannot be empty!`);
    }

    try {
      let response, responseJSON;
      response = await fetch(fetchProcessQuery, {
        method: oldRow.isNew ? 'POST' : 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({oldRow: oldRow, newRow: newRow})
      });
      responseJSON = await response.json();
      if (!response.ok) {
        setSnackbar({children: `Error: ${responseJSON.message}`, severity: 'error'});
        return Promise.reject(responseJSON.row); // Return the problematic row
      }
      setSnackbar({children: oldRow.isNew ? 'New row added!' : 'Row updated!', severity: 'success'});
      if (oldRow.isNew) {
        setIsNewRowAdded(false);
        setShouldAddRowAfterFetch(false);
        await fetchPaginatedData(paginationModel.page);
      }
      return newRow;
    } catch (error: any) {
      setSnackbar({children: `Error: ${error.message}`, severity: 'error'});
      return Promise.reject(newRow);
    } finally {
      setLoading(false);
    }
  }, [setSnackbar, setIsNewRowAdded, fetchPaginatedData, paginationModel.page, gridType]);

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    // console.log('New Row Modes Model:', newRowModesModel);
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
    const row = rows.find(row => String(row.id) === String(id));
    if (row && handleSelectQuadrat) {
      handleSelectQuadrat(row.quadratID);
    }
    // console.log('Edit Click - Before Set:', rowModesModel);
    setRowModesModel((prevModel) => ({
      ...prevModel,
      [id]: {mode: GridRowModes.Edit},
    }));
    // console.log('Edit Click - After Set:', rowModesModel);
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
    if (locked) return;
    event?.preventDefault();
    // console.log('Cancel clicked for row ID:', id);
    const row = rows.find(row => String(row.id) === String(id));
    if (row?.isNew) {
      // console.log('New row cancelled, removing from rows');
      setRows(oldRows => oldRows.filter(row => row.id !== id));
      setIsNewRowAdded(false);
      if (rowCount % paginationModel.pageSize === 1 && isNewRowAdded) {
        const newPage = paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
        setPaginationModel({...paginationModel, page: newPage});
      }
    } else {
      setRowModesModel((prevModel) => ({
        ...prevModel,
        [id]: {mode: GridRowModes.View, ignoreModifications: true},
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
            <GridActionsCellItem icon={icon} label={type} disabled={locked}/>
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
      getActions: ({id}) => {
        const isInEditMode = rowModesModel[id]?.mode === 'edit';

        if (isInEditMode && !locked) {
          return [
            getEnhancedCellAction('Save', <SaveIcon/>, handleSaveClick(id)),
            getEnhancedCellAction('Cancel', <CancelIcon/>, (e: any) => handleCancelClick(id, e)),
          ];
        }

        return [
          getEnhancedCellAction('Edit', <EditIcon/>, handleEditClick(id)),
          getEnhancedCellAction('Delete', <DeleteIcon/>, handleDeleteClick(id)),
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
        <Box sx={{width: '100%', flexDirection: 'column'}}>
          <Typography level={'title-lg'}>
            Note: The Grid is filtered by your selected Plot and Plot ID
          </Typography>
          <StyledDataGrid
            sx={{width: '100%'}}
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
              setSnackbar({children: 'Error updating row', severity: 'error'});
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
            anchorOrigin={{vertical: 'bottom', horizontal: 'center'}}
            onClose={handleCloseSnackbar}
            autoHideDuration={6000}
          >
            <Alert {...snackbar} onClose={handleCloseSnackbar}/>
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
  const {isOpen, onConfirm, onCancel, message} = props;
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
