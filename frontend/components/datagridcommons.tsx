// DataGridCommons.tsx
"use client";
import React, {Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState} from 'react';
import {
  GridActionsCellItem,
  GridColDef, GridEventListener, GridRowEditStopReasons,
  GridRowId,
  GridRowModel, GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer,
} from '@mui/x-data-grid';
import {Alert, AlertProps, Button, Snackbar} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from "@mui/joy/Box";
import {Typography} from "@mui/joy";
import {StyledDataGrid} from "@/config/sqlmacros";
import {
  computeMutation,
  createDeleteQuery,
  createFetchQuery,
  createProcessQuery, EditToolbarProps,
  getGridID
} from "@/config/datagridhelpers";
import {Plot} from "@/config/macros";


export function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {handleAddNewRow, handleRefresh} = props;

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
        Add Row
      </Button>
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
  snackbar:  Pick<AlertProps, "children" | "severity"> | null;
  setSnackbar: Dispatch<SetStateAction<Pick<AlertProps, "children" | "severity"> | null>>;
  refresh: boolean;
  setRefresh: Dispatch<SetStateAction<boolean>>;
  paginationModel: {pageSize: number, page: number};
  setPaginationModel: Dispatch<SetStateAction<{pageSize: number, page: number}>>;
  isNewRowAdded: boolean;
  setIsNewRowAdded: Dispatch<SetStateAction<boolean>>;
  shouldAddRowAfterFetch: boolean;
  setShouldAddRowAfterFetch: Dispatch<SetStateAction<boolean>>;
  currentPlot: Plot | null;
  addNewRowToGrid: () => void;
}

export default function DataGridCommons(props: Readonly<DataGridCommonProps>) {
  const {addNewRowToGrid, gridColumns, gridType, rows, setRows, rowCount, setRowCount, rowModesModel,
    setRowModesModel,snackbar, setSnackbar, refresh, setRefresh,
    paginationModel, setPaginationModel, isNewRowAdded, setIsNewRowAdded,
    shouldAddRowAfterFetch, setShouldAddRowAfterFetch, currentPlot} = props;

  const [newLastPage, setNewLastPage] = useState<number | null>(null); // new state to track the new last page

  const handleAddNewRow = () => {
    console.log('handleAddNewRow triggered');
    const newRowCount = rowCount + 1;
    const calculatedNewLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const existingLastPage = Math.ceil(rowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);
    setNewLastPage(calculatedNewLastPage); // update newLastPage state

    if (isNewPageNeeded) {
      setPaginationModel({ ...paginationModel, page: calculatedNewLastPage });
    } else {
      // If no new page is needed, add the row immediately
      setPaginationModel({...paginationModel, page: existingLastPage});
      addNewRowToGrid();
    }
  };

  const handleRefresh = async () => {
    setRefresh(true);
    try {
      const query = createFetchQuery(gridType, paginationModel.page, paginationModel.pageSize, currentPlot?.id);
      const response = await fetch(query, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      // Setting the fetched rows and total row count
      setRows(data[gridType]);
      setRowCount(data.totalCount);
    } catch (error) {
      console.error('Error fetching data:', error);
      // Handle errors as appropriate for your application
    }
    setRefresh(false);
  }


  const fetchPaginatedData = async (pageToFetch: number) => {
    console.log('fetchPaginatedData triggered');
    setRefresh(true);
    let paginatedQuery = createFetchQuery(gridType, pageToFetch, paginationModel.pageSize, currentPlot?.id);
    try {
      const response = await fetch(paginatedQuery, { method: 'GET' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error fetching data');
      setRows(data[gridType]);
      setRowCount(data.totalCount);

      if (isNewRowAdded && pageToFetch === newLastPage) {
        console.log('isNewRowAdded true, on new last page');
        addNewRowToGrid();
        setIsNewRowAdded(false);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    }
    setRefresh(false);
  };

  // ... useEffect for handling row addition logic
  useEffect(() => {
    if (isNewRowAdded) {
      console.log('useEffect --> isNewRowAdded true');
      const pageToFetch = shouldAddRowAfterFetch
        ? Math.ceil((rowCount + 1) / paginationModel.pageSize) - 1
        : paginationModel.page;
      fetchPaginatedData(pageToFetch).catch(console.error);
      console.log('useEffect --> isNewRowAdded true, fetch completed');
    }
  }, [isNewRowAdded, rowCount, paginationModel, shouldAddRowAfterFetch]);

  // ... useEffect for handling page changes
  useEffect(() => {
    if (!isNewRowAdded) {
      console.log('useEffect --> isNewRowAdded false');
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [paginationModel.page]);

  // ... useEffect to listen for changed plot
  useEffect(() => {
    if (currentPlot?.id) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [currentPlot, paginationModel.page]);

  const processRowUpdate = React.useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
      console.log('processRowUpdate triggered');
      const gridID = getGridID(gridType);
      const fetchProcessQuery = createProcessQuery(gridType);
      // Validate the primary key
      if (newRow[gridID] === '') {
        throw new Error(`Primary key ${gridID} cannot be empty!`);
      }
      try {
        let response, responseJSON;
        // If oldRow code is empty, it's a new row insertion
        if (oldRow[gridID] === '') {
          response = await fetch(fetchProcessQuery, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRow),
          });
          responseJSON = await response.json();
          if (response.status > 299 || response.status < 200) throw new Error(responseJSON.message || "Insertion failed");
          setSnackbar({ children: `New row added!`, severity: 'success' });
        } else {
          // If code is not empty, it's an update
          const mutation = computeMutation(gridType, newRow, oldRow);
          if (mutation) {
            response = await fetch(fetchProcessQuery, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newRow),
            });
            responseJSON = await response.json();
            if (response.status > 299 || response.status < 200) throw new Error(responseJSON.message || "Update failed");
            setSnackbar({ children: `Row updated!`, severity: 'success' });
          }
        }

        // After save or update, reset isNewRowAdded if necessary and refresh data
        if (oldRow.isNew) {
          setIsNewRowAdded(false); // We are done adding a new row
          // Now we can refetch data for the current page without adding a new row
          setShouldAddRowAfterFetch(false); // Ensure we do not add a row during fetch
          await fetchPaginatedData(paginationModel.page);
        }

        return newRow;
      } catch (error: any) {
        setSnackbar({ children: error.message, severity: 'error' });
        throw error;
      }
    },
    [setSnackbar, setIsNewRowAdded, fetchPaginatedData, paginationModel.page, gridType]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };
  const handleCloseSnackbar = () => setSnackbar(null);
  // const handleProcessRowUpdateError = React.useCallback((error: Error) => {
  //   setSnackbar({children: String(error), severity: 'error'});
  // }, []);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    console.log('edit button');
    setRowModesModel({...rowModesModel, [id]: {mode: GridRowModes.Edit}});
  };

  const handleSaveClick = (id: GridRowId) => async () => {
    console.log('save button');
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: { mode: GridRowModes.View },
    }));

    // If the row was newly added, reset isNewRowAdded
    const row = rows.find((row) => row.id === id);
    if (row?.isNew) {
      setIsNewRowAdded(false); // We are done adding a new row
      // Now we can refetch data for the current page without adding a new row
      setShouldAddRowAfterFetch(false); // Ensure we do not add a row during fetch
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleDeleteClick = (id: GridRowId) => async () => {
    console.log('delete button');
    let gridID = getGridID(gridType);
    const deletionID = rows.find((row) => row.id == id)![gridID];
    const deleteQuery = createDeleteQuery(gridType, deletionID);
    const response = await fetch(deleteQuery, {
      method: 'DELETE'
    });
    if (!response.ok) setSnackbar({children: "Error: Deletion failed", severity: 'error'});
    else {
      setSnackbar({children: "Row successfully deleted", severity: 'success'});
      setRows(rows.filter((row) => row.id !== id));
      await fetchPaginatedData(paginationModel.page);
    }
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
    console.log('cancel button');
    // Prevent default action for the event if it exists
    event?.preventDefault();

    const isOnlyRowOnNewPage = rowCount % paginationModel.pageSize === 1 && isNewRowAdded;

    // Remove the new row and reset the isNewRowAdded flag
    setRows((oldRows) => oldRows.filter((row) => row.id !== id));
    setIsNewRowAdded(false);

    if (isOnlyRowOnNewPage) {
      // Move back to the previous page if it was the only row on a new page
      const newPage = paginationModel.page - 1 >= 0 ? paginationModel.page - 1 : 0;
      setPaginationModel({ ...paginationModel, page: newPage });
    } else {
      // For existing rows, just switch the mode to view
      setRowModesModel({
        ...rowModesModel,
        [id]: { mode: GridRowModes.View, ignoreModifications: true },
      });
    }
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

        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon/>}
              label="Save"
              key={"save"}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon/>}
              label="Cancel"
              key={"cancel"}
              onClick={(event) => handleCancelClick(id, event)}
            />,
          ];
        }

        return [
          <GridActionsCellItem
            icon={<EditIcon/>}
            label="Edit"
            key={"edit"}
            onClick={handleEditClick(id)}
          />,
          <GridActionsCellItem
            icon={<DeleteIcon/>}
            label="Delete"
            key={"delete"}
            onClick={handleDeleteClick(id)}
          />,
        ];
      },
    };
  }


  // Memoize columns to avoid unnecessary re-renders
  const columns = useMemo(() => [
    ...gridColumns,
    getGridActionsColumn(),
  ], [gridColumns, rowModesModel, handleSaveClick, handleCancelClick, handleEditClick, handleDeleteClick]);

  if (!currentPlot) {
    return <>You must select a plot to continue!</>;
  } else {
    return (
      <Box
        sx={{
          width: '100%',
          '& .actions': {
            color: 'text.secondary',
          },
          '& .textPrimary': {
            color: 'text.primary',
          },
        }}
      >
        <Box sx={{width: '100%', flexDirection: 'column'}}>
          <Typography level={"title-lg"}>Note: The Grid is filtered by your selected Plot and Plot ID</Typography>
          <StyledDataGrid sx={{width: '100%'}}
                          rows={rows}
                          columns={columns}
                          editMode="row"
                          rowModesModel={rowModesModel}
                          onRowModesModelChange={handleRowModesModelChange}
                          onRowEditStop={handleRowEditStop}
                          processRowUpdate={processRowUpdate}
                          // onProcessRowUpdateError={handleProcessRowUpdateError}
                          loading={refresh}
                          paginationMode="server"
                          onPaginationModelChange={setPaginationModel}
                          paginationModel={paginationModel}
                          rowCount={rowCount}
                          pageSizeOptions={[paginationModel.pageSize]}
                          slots={{
                            toolbar: EditToolbar,
                          }}
                          slotProps={{
                            toolbar: {
                              handleAddNewRow: handleAddNewRow,
                              handleRefresh: handleRefresh,
                            },
                          }}
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
      </Box>
    );
  }
}