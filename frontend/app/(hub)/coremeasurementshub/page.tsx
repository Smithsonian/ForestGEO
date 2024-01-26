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
import {CoreMeasurementsGridColumns, CoreMeasurementsRDS, StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {Typography} from "@mui/joy";
import {randomId} from "@mui/x-data-grid-generator";

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {
    setIsNewRowAdded, setShouldAddRowAfterFetch, rows, setRows, setRowModesModel, setRefresh, currentPlot,
    rowCount, setRowCount, paginationModel, onPaginationModelChange
  } = props;
  const handleAddNewRow = () => {
    // Determine if a new page is needed
    const newRowCount = rowCount + 1;
    const newLastPage = Math.ceil(newRowCount / paginationModel.pageSize) - 1;
    const isNewPageNeeded = newRowCount % paginationModel.pageSize === 1;

    // Set flags and update pagination if a new page is needed
    setIsNewRowAdded(true);
    setShouldAddRowAfterFetch(isNewPageNeeded);

    if (isNewPageNeeded) {
      onPaginationModelChange({ ...paginationModel, page: newLastPage });
    }
  };

  const handleRefresh = async () => {
    setRefresh(true);

    try {
      // Assuming 'page' is the current page index managed in the parent component
      const response = await fetch(`/api/coremeasurements?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}&plotID=${currentPlot ? currentPlot.id : undefined}`);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      // Setting the fetched rows and total row count
      setRows(data.coreMeasurements);
      setRowCount(data.totalCount);
    } catch (error) {
      console.error('Error fetching data:', error);
      // Handle errors as appropriate for your application
    }
    setRefresh(false);
  };

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleAddNewRow}>
        Add CoreMeasurement
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  const fields: Array<keyof CoreMeasurementsRDS> = [
    'censusID', 'plotID', 'quadratID', 'treeID', 'stemID', 'personnelID',
    'isRemeasurement', 'isCurrent', 'measurementDate', 'measuredDBH',
    'measuredHOM', 'description', 'userDefinedFields'
  ];

  return fields.some(field => newRow[field] !== oldRow[field]);
}

export default function CoreMeasurementsPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      coreMeasurementID: 0,
      censusID: 0,
      plotID: 0,
      quadratID: 0,
      treeID: 0,
      stemID: 0,
      personnelID: 0,
      isRemeasurement: false,
      isCurrent: false,
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      userDefinedFields: '',
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
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  let currentPlot = usePlotContext();
  if (currentPlot) console.log(`current plot ID: ${currentPlot.key}`);
  // Function to fetch paginated data
  const fetchPaginatedData = async (pageToFetch: number) => {
    setRefresh(true);
    try {
      const response = await fetch(`/api/coremeasurements?page=${pageToFetch}&pageSize=${paginationModel.pageSize}&plotID=${currentPlot ? currentPlot.id : undefined}`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error fetching data');
      }
      setRows(data.coreMeasurements); // assuming the API returns an object with coreMeasurements and totalCount
      setRowCount(data.totalCount);

      if (shouldAddRowAfterFetch && isNewRowAdded) {
        addNewRowToGrid();
        setShouldAddRowAfterFetch(false); // Reset flag after operation
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({children: 'Error fetching data', severity: 'error'});
    }
    setRefresh(false);
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextCoreMeasurementID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.coreMeasurementID, max), 0)
      : 0) + 1;
    // New row object
    const newRow = {
      id: nextCoreMeasurementID,
      coreMeasurementID: nextCoreMeasurementID,  // Assuming id and coreMeasurementID are the same
      censusID: 0,
      plotID: currentPlot ? currentPlot.id : 0,  // Make sure currentPlot is defined and has an id
      quadratID: 0,
      treeID: 0,
      stemID: 0,
      personnelID: 0,
      isRemeasurement: false,
      isCurrent: false,
      measurementDate: new Date(),
      measuredDBH: 0.0,
      measuredHOM: 0.0,
      description: '',
      userDefinedFields: '',
      isNew: true,
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'coreMeasurementID' },
    }));
    // Reset the new row addition flag
    setIsNewRowAdded(false);
  };

  useEffect(() => {
    if (isNewRowAdded) {
      const pageToFetch = shouldAddRowAfterFetch
        ? Math.ceil((rowCount + 1) / paginationModel.pageSize) - 1
        : paginationModel.page;
      fetchPaginatedData(pageToFetch).catch(console.error);
    }
  }, [isNewRowAdded, rowCount, paginationModel, shouldAddRowAfterFetch]);

  // ... useEffect for handling page changes
  useEffect(() => {
    if (!isNewRowAdded) {
      fetchPaginatedData(paginationModel.page).catch(console.error);
    }
  }, [paginationModel.page]);

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
    const response = await fetch(`/api/coremeasurements?coreMeasurementID=${rows.find((row) => row.id == id)!.coreMeasurementID}`, {
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
      if (newRow.coreMeasurementID === '') {
        throw new Error("Primary key 'CoreMeasurementID' cannot be empty!");
      }

      try {
        let response, responseJSON;
        // If oldRow code is empty, it's a new row insertion
        if (oldRow.coreMeasurementID === '') {
          response = await fetch('/api/coremeasurements', {
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
            response = await fetch(`/api/coremeasurements`, {
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
    [setSnackbar, setIsNewRowAdded, fetchPaginatedData, paginationModel.page]
  );
  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const columns: GridColDef[] = [
    ...CoreMeasurementsGridColumns,
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
  if (!currentPlot?.key) {
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
                              setIsNewRowAdded,
                              setShouldAddRowAfterFetch,
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