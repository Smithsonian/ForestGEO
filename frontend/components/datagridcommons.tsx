// DataGridCommons.tsx
"use client";
import React, {Dispatch, SetStateAction, useEffect} from 'react';
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
import {EditToolbarProps, Plot, FetchQueryFunction, ProcessQueryFunction} from "@/config/macros";
import Box from "@mui/joy/Box";
import {Typography} from "@mui/joy";
import {StyledDataGrid} from "@/config/sqlmacros";


export function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {
    gridType, createRefreshQuery, setIsNewRowAdded,
    setShouldAddRowAfterFetch, setRows,
    setRefresh, currentPlot, rowCount, setRowCount,
    paginationModel, onPaginationModelChange
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
      const query = createRefreshQuery(gridType, paginationModel.page, paginationModel.pageSize, currentPlot?.id);
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
function isObject(obj: any) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) {
    return true;
  }
  if (isObject(obj1) && isObject(obj2)) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) {
      return false;
    }
    for (const key of keys1) {
      if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function computeMutation<T extends GridRowModel>(newRow: T, oldRow: T) {
  const fields: Array<keyof T> = Object.keys(newRow) as Array<keyof T>;

  return fields.some(field => !deepEqual(newRow[field], oldRow[field]));
}



export const createFetchQuery: FetchQueryFunction = (gridType, page, pageSize, plotID) => {
  let baseQuery = `/api/`;
  switch(gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}?page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'census':
    case 'quadrats':
      baseQuery += `fixeddata/${gridType}?page=${page}&pageSize=${pageSize}`;
      baseQuery += plotID ? `&plotID=${plotID}` : ``;
      break;
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}?page=${page}&pageSize=${pageSize}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
};

export const createProcessQuery: ProcessQueryFunction = (gridType: string) => {
  let baseQuery = `/api/`;
  switch(gridType) {
    case 'coreMeasurements':
      baseQuery += `${gridType.toLowerCase()}`
      break;
    case 'census':
    case 'quadrats':
    case 'attributes':
    case 'personnel':
    case 'species':
    case 'subSpecies':
      baseQuery += `fixeddata/${gridType.toLowerCase()}`;
      break;
    default:
      throw new Error('invalid gridtype selected');
  }
  return baseQuery;
}

export const createDeleteQuery: ProcessQueryFunction = (gridType: string, deletionID?: number) => {
  let gridID = getGridID(gridType);
  let baseQuery = createProcessQuery(gridType);
  baseQuery += `/${gridID}=${deletionID!.toString()}`;
  return baseQuery;
}

function getGridID(gridType: string) {
  switch(gridType) {
    case 'coreMeasurements': return 'coreMeasurementID';
    case 'attributes': return 'code';
    case 'census': return 'censusID';
    case 'quadrats': return 'quadratID';
    case 'species': return 'speciesID';
    case 'subSpecies': return 'subSpeciesID';
    default: throw new Error('Invalid grid type submitted');
  }
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

  const fetchPaginatedData = async (pageToFetch: number) => {
    setRefresh(true);
    let paginatedQuery = createFetchQuery(gridType, pageToFetch, paginationModel.pageSize, currentPlot?.id);
    try {
      const response = await fetch(paginatedQuery, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error fetching data');
      }
      setRows(data[gridType]); // assuming the API returns an object with coreMeasurements and totalCount
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

  const processRowUpdate = React.useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
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
          if (!response.ok) throw new Error(responseJSON.message || "Insertion failed");
          setSnackbar({ children: `New row added!`, severity: 'success' });
        } else {
          // If code is not empty, it's an update
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            response = await fetch(fetchProcessQuery, {
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
    [setSnackbar, setIsNewRowAdded, fetchPaginatedData, paginationModel.page, gridType]
  );

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };
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

  const columns: GridColDef[] = [
    ...gridColumns,
    getGridActionsColumn(rowModesModel, handleSaveClick, handleCancelClick, handleEditClick, handleDeleteClick)
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
                              createRefreshQuery: createFetchQuery,
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

export function getGridActionsColumn(
  rowModesModel: GridRowModesModel,
  handleSaveClick: (id: GridRowId) => void,
  handleCancelClick: (id: GridRowId, event?: React.MouseEvent) => void,
  handleEditClick: (id: GridRowId) => void,
  handleDeleteClick: (id: GridRowId) => void,
): GridColDef {
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
            onClick={() => handleSaveClick(id)}
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
          onClick={() => handleEditClick(id)}
        />,
        <GridActionsCellItem
          icon={<DeleteIcon/>}
          label="Delete"
          key={"delete"}
          onClick={() => handleDeleteClick(id)}
        />,
      ];
    },
  };
}
