"use client";
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
  GridToolbarContainer
} from "@mui/x-data-grid";
import {Alert, AlertProps, Button, Snackbar} from "@mui/material";
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import React, {useEffect, useState} from "react";
import Box from "@mui/joy/Box";
import {AttributeGridColumns, AttributesRDS, StyledDataGrid} from "@/config/sqlmacros";
import {EditToolbarProps, ErrorMessages} from "@/config/macros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {
    setIsNewRowAdded, rows, setRows, setRowModesModel, setRefresh,
    rowCount, setRowCount, paginationModel, onPaginationModelChange
  } = props;

  const handleAddNewRow = async () => {
    const newRowCount = rowCount + 1;
    const lastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const isNewRowFirstOnNewPage = newRowCount % paginationModel.pageSize === 1;

    if (isNewRowFirstOnNewPage) {
      // If the new row is the first on a new page, set pagination to the new last page
      onPaginationModelChange({ ...paginationModel, page: lastPage });
    }

    // Add the new row at the end
    const id = randomId();
    const newRow = { id, code: '', description: '', status: '', isNew: true };
    setRows((oldRows) => [...oldRows, newRow]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'code' }
    }));

    // Update rowCount since a new row has been added
    setRowCount(newRowCount);

    // Set isNewRowAdded flag to true
    setIsNewRowAdded(true);
  };

  const handleRefresh = async () => {
    setRefresh(true);
    try {
      const response = await fetch(`/api/fixeddata/attributes?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}`, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      setRows(data.attributes);
      setRowCount(data.totalCount);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setRefresh(false);
  }

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
        Add attribute
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  const fields: Array<keyof AttributesRDS> = [
    'code', 'description', 'status'
  ];

  return fields.some(field => newRow[field] !== oldRow[field]);
}

export default function AttributesPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      code: '',
      description: '',
      status: '',
    },
  ]
  const [rows, setRows] = React.useState(initialRows);
  const [rowCount, setRowCount] = useState(0);  // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  let currentPlot = usePlotContext();
  // Function to fetch paginated data
  const fetchPaginatedData = async () => {
    if (!isNewRowAdded) { // Only fetch data if no new row has been added
      setRefresh(true);
      try {
        const response = await fetch(`/api/fixeddata/attributes?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}`, {
          method: 'GET',
        });
        const data = await response.json();
        setRows(data.attributes);
        setRowCount(data.totalCount);
      } catch (error) {
        console.error('Error fetching data:', error);
        setSnackbar({children: 'Error fetching data', severity: 'error'});
      }
      setRefresh(false);
    }
  };

  useEffect(() => {
    const lastPage = Math.ceil((rowCount + 1) / paginationModel.pageSize) - 1;
    if (isNewRowAdded && paginationModel.page === lastPage) {
      // When we're ready to add the new row and we're on the last page,
      // we can safely add the new row to the grid.
      const id = randomId();
      const newRow = { id, code: '', description: '', status: '', isNew: true };
      setRows((oldRows) => [...oldRows, newRow]);
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [id]: { mode: GridRowModes.Edit, fieldToFocus: 'code' }
      }));
      setIsNewRowAdded(false); // Reset the flag after adding the row
    } else if (!isNewRowAdded) {
      fetchPaginatedData().catch(console.error);
    }
  }, [paginationModel.page, paginationModel.pageSize, isNewRowAdded]);

  const handleCloseSnackbar = () => setSnackbar(null);
  const handleProcessRowUpdateError = React.useCallback((error: Error) => {
    setSnackbar({children: String(error), severity: 'error'});
  }, []);

  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };

  const handleEditClick = (id: GridRowId) => () => {
    setRowModesModel({...rowModesModel, [id]: {mode: GridRowModes.Edit}});
  };

  const handleSaveClick = (id: GridRowId) => async () => {
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: { mode: GridRowModes.View }
    }));

    // If the row was newly added, reset isNewRowAdded and refetch data
    const row = rows.find((row) => row.id === id);
    if (row?.isNew) {
      setIsNewRowAdded(false);
      await fetchPaginatedData();
    }
  };

  const handleDeleteClick = (id: GridRowId) => async () => {
    const response = await fetch(`/api/fixeddata/attributes?code=${rows.find((row) => row.id == id)!.code}`, {
      method: 'DELETE'
    });
    if (!response.ok) setSnackbar({children: "Error: Deletion failed", severity: 'error'});
    else {
      setSnackbar({children: "Row successfully deleted", severity: 'success'});
      setRows(rows.filter((row) => row.id !== id));
    }
  };

  const handleCancelClick = (id: GridRowId, event?: React.MouseEvent) => {
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

  const processRowUpdate = React.useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
      // Validate the primary key
      if (newRow.code === '') {
        throw new Error("Primary key Code cannot be empty!");
      }

      // Attempt to save or update the row
      try {
        let response, responseJSON;
        if (oldRow.code === '') {
          // If code is empty, it's a new row insertion
          response = await fetch('/api/fixeddata/attributes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRow),
          });
          responseJSON = await response.json();
          if (!response.ok) throw new Error(responseJSON.message || "Insertion failed");
          setSnackbar({ children: `New row added!`, severity: 'success' });
        } else {
          // If code is not empty, it's an update
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            response = await fetch(`/api/fixeddata/attributes?code=${oldRow.code}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newRow),
            });
            responseJSON = await response.json();
            if (!response.ok) throw new Error(responseJSON.message || "Update failed");
            setSnackbar({ children: `Row updated!`, severity: 'success' });
          }
        }

        // After save or update, reset isNewRowAdded if necessary and refresh data
        if (oldRow.isNew) {
          setIsNewRowAdded(false);
          await fetchPaginatedData();
        }

        return newRow;
      } catch (error: any) {
        setSnackbar({ children: error.message, severity: 'error' });
        throw error;
      }
    },
      [setSnackbar, setIsNewRowAdded, fetchPaginatedData]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const columns: GridColDef[] = [
    ...AttributeGridColumns,
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({id}) => {
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;

        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon/>}
              label="Save"
              key={"save"}
              sx={{
                color: 'primary.main',
              }}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon/>}
              label="Cancel"
              key={"cancel"}
              className="textPrimary"
              onClick={(event) => handleCancelClick(id, event)}
              color="inherit"
            />,
          ];
        }

        return [
          <GridActionsCellItem
            icon={<EditIcon/>}
            label="Edit"
            key={"edit"}
            className="textPrimary"
            onClick={handleEditClick(id)}
            color="inherit"
          />,
          <GridActionsCellItem
            icon={<DeleteIcon/>}
            label="Delete"
            key={"delete"}
            onClick={handleDeleteClick(id)}
            color="inherit"
          />,
        ];
      },
    },
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        '& .actions': {
          color: 'text.secondary',
        },
        '& .textPrimary': {
          color: 'text.primary',
        },
      }}
    >
      <StyledDataGrid sx={{width: 1000}}
                      rows={rows}
                      columns={columns}
                      editMode="row"
                      rowModesModel={rowModesModel}
                      onRowModesModelChange={handleRowModesModelChange}
                      onRowEditStop={handleRowEditStop}
                      processRowUpdate={processRowUpdate}
                      onProcessRowUpdateError={handleProcessRowUpdateError}
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
                          setIsNewRowAdded,
                          rows,
                          setRows,
                          setRowModesModel,
                          setRefresh,
                          currentPlot,
                          rowCount,
                          setRowCount,
                          paginationModel,
                          onPaginationModelChange: setPaginationModel,
                        },
                      }}
      />
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