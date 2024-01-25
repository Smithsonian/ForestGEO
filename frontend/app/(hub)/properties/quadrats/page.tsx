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
import {EditToolbarProps, ErrorMessages} from "@/config/macros";
import {QuadratsGridColumns, QuadratsRDS, StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {Typography} from "@mui/joy";

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {
    rows, setRows, setRowModesModel, setRefresh, currentPlot,
    rowCount, setRowCount, paginationModel, onPaginationModelChange
  } = props;

  const handleAddNewRow = async () => {
    const nextQuadratID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.quadratID, max), 0)
      : 0) + 1;
    const newRow = {
      id: nextQuadratID,
      quadratID: nextQuadratID,
      plotID: currentPlot.id,
      quadratName: '',
      quadratX: 0,
      quadratY: 0,
      quadratZ: 0,
      dimensionX: 0,
      dimensionY: 0,
      area: 0,
      quadratShape: ''
    };
    setRows((oldRows) => [...oldRows, newRow]);
    // Update the pagination model for the last page
    const lastPage = Math.ceil((rowCount + 1) / paginationModel.pageSize) - 1;
    onPaginationModelChange({...paginationModel, page: lastPage});

    // Set new row to edit mode
    // Note: The state update for setRowModesModel might not immediately reflect
    setRowModesModel(oldModel => ({
      ...oldModel,
      [newRow.id]: {mode: GridRowModes.Edit}
    }));
  };
  const handleRefresh = async () => {
    setRefresh(true);
    try {
      const response = await fetch(`/api/fixeddata/quadrats?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}`, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      // Setting the fetched rows and total row count
      setRows(data.census);
      setRowCount(data.totalCount);
    } catch (error) {
      console.error('Error fetching data:', error);
      // Handle errors as appropriate for your application
    }
    setRefresh(false);
  }

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
        Add quadrat
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  const fields: Array<keyof QuadratsRDS> = [
    'quadratID', 'plotID', 'quadratName', 'quadratX', 'quadratY', 'quadratZ',
    'dimensionX', 'dimensionY', 'area', 'quadratShape'
  ]
  return fields.some(field => newRow[field] !== oldRow[field]);
}

export default function QuadratsPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      quadratID: 0,
      plotID: 0,
      quadratName: '',
      quadratX: 0,
      quadratY: 0,
      quadratZ: 0,
      dimensionX: 0,
      dimensionY: 0,
      area: 0,
      quadratShape: ''
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
  let currentPlot = usePlotContext();
  // Function to fetch paginated data
  const fetchPaginatedData = async () => {
    setRefresh(true);
    try {
      const response = await fetch(`/api/fixeddata/quadrats?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}&plotID=${currentPlot ? currentPlot.id : undefined}`, {
        method: 'GET',
      });
      console.log(`response status: ${response.status}`);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      setRows(data.quadrats); // assuming the API returns an object with census and totalCount
      console.log(rows);
      setRowCount(data.totalCount);
      console.log(rowCount);
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({children: 'Error fetching data', severity: 'error'});
    }
    setRefresh(false);
  };

  useEffect(() => {
    fetchPaginatedData().catch(console.error);
  }, [paginationModel]);

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

  const handleSaveClick = (id: GridRowId) => () => {
    setRowModesModel({...rowModesModel, [id]: {mode: GridRowModes.View}});
  };

  const handleDeleteClick = (id: GridRowId) => async () => {
    const response = await fetch(`/api/fixeddata/quadrats?quadratID=${rows.find((row) => row.id == id)!.quadratID}`, {
      method: 'DELETE'
    });
    if (!response.ok) setSnackbar({children: "Error: Deletion failed", severity: 'error'});
    else {
      setSnackbar({children: "Row successfully deleted", severity: 'success'});
      setRows(rows.filter((row) => row.id !== id));
      await fetchPaginatedData();
    }
  };

  const handleCancelClick = (id: GridRowId) => () => {
    setRowModesModel({
      ...rowModesModel,
      [id]: {mode: GridRowModes.View, ignoreModifications: true},
    });

    const editedRow = rows.find((row) => row.id === id);
    if (editedRow!.isNew) {
      setRows(rows.filter((row) => row.id !== id));
      setSnackbar({children: "Changes cancelled", severity: 'success'});
    }
  };
  const processRowUpdate = React.useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>(async (resolve, reject) => {
        if (newRow.quadratID == '') {
          reject(new Error("Primary key QuadratID cannot be empty!"));
        } else if (oldRow.quadratID == '') {
          // inserting a row
          const response = await fetch(`/api/fixeddata/quadrats`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(newRow)
          });
          const responseJSON = await response.json();
          if (!response.ok && responseJSON.message == ErrorMessages.ICF) reject(new Error(ErrorMessages.ICF));
          else if (!response.ok && responseJSON.message == ErrorMessages.UKAE) reject(new Error(ErrorMessages.UKAE));
          else if (!response.ok) reject(new Error(responseJSON.message));
          else {
            setSnackbar({children: `New row added!`, severity: 'success'});
            resolve(newRow);
          }
        } else {
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            const response = await fetch(`/api/fixeddata/quadrats`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(newRow)
            });
            const responseJSON = await response.json();
            if (!response.ok && responseJSON.message == ErrorMessages.ICF) reject(new Error(ErrorMessages.ICF));
            else if (!response.ok && responseJSON.message == ErrorMessages.UKAE) reject(new Error(ErrorMessages.UKAE));
            else if (!response.ok) reject(new Error(responseJSON.message));
            else {
              setSnackbar({children: `New row added!`, severity: 'success'});
              resolve(newRow);
            }
          }
        }
        await fetchPaginatedData();
      }),
    [],
  );
  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const columns: GridColDef[] = [
    ...QuadratsGridColumns,
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      flex: 1,
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
              onClick={handleCancelClick(id)}
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