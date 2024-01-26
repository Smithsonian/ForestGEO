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
import {SpeciesGridColumns, SpeciesRDS, StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {
    setIsNewRowAdded, setShouldAddRowAfterFetch,
    setRows, setRefresh, rowCount,
    setRowCount, paginationModel, onPaginationModelChange
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
    try {
      const response = await fetch(`/api/fixeddata/species?page=${paginationModel.page}&pageSize=${paginationModel.pageSize}`, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      // Setting the fetched rows and total row count
      setRows(data.species);
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
        Add Species
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  const fields: Array<keyof SpeciesRDS> = [
    'speciesID', 'genusID', 'currentTaxonFlag', 'obsoleteTaxonFlag', 'speciesName', 'speciesCode',
    'idLevel', 'authority', 'fieldFamily', 'description', 'referenceID'
  ]
  return fields.some(field => newRow[field] !== oldRow[field]);
}

export default function SpeciesPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      speciesID: 0,
      genusID: 0,
      currentTaxonFlag: false,
      obsoleteTaxonFlag: false,
      speciesName: '',
      speciesCode: '',
      idLevel: '',
      authority: '',
      fieldFamily: '',
      description: '',
      referenceID: 0,
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
  // Function to fetch paginated data
  const fetchPaginatedData = async (pageToFetch: number) => {
    setRefresh(true);
    try {
      const response = await fetch(`/api/fixeddata/species?page=${pageToFetch}&pageSize=${paginationModel.pageSize}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error fetching data');
      }

      setRows(data.species);
      setRowCount(data.totalCount); // Update rowCount here from the fetched data

      if (shouldAddRowAfterFetch && isNewRowAdded) {
        addNewRowToGrid();
        setShouldAddRowAfterFetch(false); // Reset flag after operation
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setSnackbar({ children: 'Error fetching data', severity: 'error' });
    }
    setRefresh(false);
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    // New row object
    const nextSpeciesID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.speciesID, max), 0)
      : 0) + 1;

    const newRow = {
      id: nextSpeciesID,
      speciesID: nextSpeciesID,
      genusID: 0,
      currentTaxonFlag: false,
      obsoleteTaxonFlag: false,
      speciesName: '',
      speciesCode: '',
      idLevel: '',
      authority: '',
      fieldFamily: '',
      description: '',
      referenceID: 0,
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'speciesID' },
    }));
    // Reset the new row addition flag
    setIsNewRowAdded(false);
  };

  // ... useEffect for handling row addition logic
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
    const response = await fetch(`/api/fixeddata/species?speciesID=${rows.find((row) => row.id == id)!.speciesID}`, {
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
      if (newRow.speciesID === '') {
        throw new Error("Primary key 'SpeciesID' cannot be empty!");
      }

      try {
        let response, responseJSON;
        // If oldRow speciesID is empty, it's a new row insertion
        if (oldRow.speciesID === '') {
          response = await fetch('/api/fixeddata/species', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRow),
          });
          responseJSON = await response.json();
          if (!response.ok) throw new Error(responseJSON.message || "Insertion failed");
          setSnackbar({ children: `New row added!`, severity: 'success' });
        } else {
          // If speciesID is not empty, it's an update
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            response = await fetch(`/api/fixeddata/species?speciesID=${oldRow.speciesID}`, {
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
    ...SpeciesGridColumns,
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
      <Box sx={{width: '100%'}}>
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