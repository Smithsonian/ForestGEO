"use client";
import {
  DataGrid,
  GridActionsCellItem, GridColDef, GridEventListener, GridRowEditStopReasons, GridRowId, GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer
} from "@mui/x-data-grid";
import {randomId} from "@mui/x-data-grid-generator";
import {Alert, AlertProps, Button, Snackbar} from "@mui/material";
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import React, {useEffect, useState} from "react";
import Box from "@mui/joy/Box";
import {useAttributeLoadContext, useAttributeLoadDispatch} from "@/app/plotcontext";
import {AttributeRDS, AttributeStatusOptions} from "@/config/sqlmacros";
import {ErrorMessages} from "@/config/macros";
import {styled} from "@mui/system";
const StyledDataGrid = styled(DataGrid)(({theme}) => ({
  border: 0,
  color:
    theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.85)',
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
  ].join(','),
  WebkitFontSmoothing: 'auto',
  letterSpacing: 'normal',
  '& .MuiDataGrid-columnsContainer': {
    backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : '#1d1d1d',
  },
  '& .MuiDataGrid-iconSeparator': {
    display: 'none',
  },
  '& .MuiDataGrid-columnHeader, .MuiDataGrid-cell': {
    borderRight: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-columnsContainer, .MuiDataGrid-cell': {
    borderBottom: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-cell': {
    color:
      theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.65)',
  },
  '& .MuiPaginationItem-root': {
    borderRadius: 0,
  },
}));

interface EditToolbarProps {
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
  setRefresh: (newState: boolean) => void;
}

function EditToolbar(props: EditToolbarProps) {
  const {setRows, setRowModesModel, setRefresh} = props;
  
  const handleClick = () => {
    const id = randomId();
    setRows((oldRows) => [...oldRows, { id, code: '', description: '', status: '', isNew: true }]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
    }));
  };
  
  const handleRefresh = async() => {
    setRefresh(true);
    const response = await fetch('/api/census', {method: 'GET'});
    setRows(await response.json());
    setRefresh(false);
  }
  
  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon />} onClick={handleClick}>
        Add census
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon />} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  if (newRow.code !== oldRow.code) {
    return `Code from '${oldRow.code}' to '${newRow.code}'`;
  }
  if (newRow.description !== oldRow.description) {
    return `Description from '${oldRow.description || ''}' to '${newRow.description || ''}'`;
  }
  if (newRow.status !== oldRow.status) {
    return `Status from '${oldRow.status || ''}' to '${newRow.status || ''}'`;
  }
  return null;
}
export default function Page() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      code: '',
      description: '',
      status: '',
    },
  ]
  const [rows, setRows] = React.useState(initialRows);
  const attributeLoad = useAttributeLoadContext();
  useEffect(() => {
    if (attributeLoad) {
      setRows(attributeLoad);
    }
  }, [attributeLoad, setRows]);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const handleCloseSnackbar = () => setSnackbar(null);
  const handleProcessRowUpdateError = React.useCallback((error: Error) => {
    setSnackbar({ children: String(error), severity: 'error' });
  }, []);
  
  const handleRowEditStop: GridEventListener<'rowEditStop'> = (params, event) => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      event.defaultMuiPrevented = true;
    }
  };
  
  const handleEditClick = (id: GridRowId) => () => {
    setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
  };
  
  const handleSaveClick = (id: GridRowId) => () => {
    setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.View } });
  };
  
  const handleDeleteClick = (id: GridRowId) => async () => {
    const response = await fetch(`/api/census?code=${rows.find((row) => row.id == id)!.code}`, {method: 'DELETE'});
    if (!response.ok) setSnackbar({ children: "Error: Deletion failed", severity: 'error' });
    else {
      setSnackbar({ children: "Row successfully deleted", severity: 'success' });
      setRows(rows.filter((row) => row.id !== id));
    }
  };
  
  const handleCancelClick = (id: GridRowId) => () => {
    setRowModesModel({
      ...rowModesModel,
      [id]: { mode: GridRowModes.View, ignoreModifications: true },
    });
    
    const editedRow = rows.find((row) => row.id === id);
    if (editedRow!.isNew) {
      setRows(rows.filter((row) => row.id !== id));
      setSnackbar({ children: "Changes cancelled", severity: 'success' });
    }
  };
  
  const processRowUpdate = React.useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>(async (resolve, reject) => {
        if (newRow.code == '') {
          reject(new Error("Primary key Code cannot be empty!"));
        }
        const mutation = computeMutation(newRow, oldRow);
        switch (mutation) {
          case `Code from '${oldRow.code}' to '${newRow.code}'`:
            // Make the HTTP request to save in the backend
            const codeResponse = await fetch(
              `/api/census?oldCode=${String(oldRow.code)}&newCode=${String(newRow.code)}`, {
                method: 'PATCH',
              });
            if (!codeResponse.ok) reject(new Error(ErrorMessages.UKAE));
            setSnackbar({children: `Code change from ${oldRow.code} to ${newRow.code} saved successfully`, severity: 'success'});
            resolve(newRow);
            break;
          case `Description from '${oldRow.description || ''}' to '${newRow.description || ''}'`:
            // Make the HTTP request to save in the backend
            const descResponse = await fetch(
              `/api/census?oldCode=${String(oldRow.code)}&newDesc=${String(newRow.description)}`, {
                method: 'PATCH',
              });
            if (!descResponse.ok) reject(new Error(ErrorMessages.UKAE));
            setSnackbar({children: `Description change from ${oldRow.description} to ${newRow.description} on row ${oldRow.code} saved successfully`, severity: 'success'});
            resolve(newRow);
            break;
          case `Status from '${oldRow.status || ''}' to '${newRow.status || ''}'`:
            // Make the HTTP request to save in the backend
            const statResponse = await fetch(
              `/api/census?oldCode=${String(oldRow.code)}&newStat=${String(newRow.status)}`, {
                method: 'PATCH',
              });
            if (!statResponse.ok) reject(new Error(ErrorMessages.UKAE));
            setSnackbar({children: `Status change from ${oldRow.status} to ${newRow.status} on row ${oldRow.code} saved successfully`, severity: 'success'});
            resolve(newRow);
            break;
          default:
            reject(new Error("Unknown error!"));
        }
      }),
    [],
  );
  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };
  
  const columns: GridColDef[] = [
    {field: 'code', headerName: 'Code', headerClassName: 'header', flex: 1, editable: true}, // all unique ID columns need to be tagged 'id'
    {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: true},
    {field: 'status', headerName: 'Status', headerClassName: 'header', flex: 1, editable: true, type: 'singleSelect', valueOptions: AttributeStatusOptions,},
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      cellClassName: 'actions',
      getActions: ({ id }) => {
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;
        
        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon />}
              label="Save"
              sx={{
                color: 'primary.main',
              }}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon />}
              label="Cancel"
              className="textPrimary"
              onClick={handleCancelClick(id)}
              color="inherit"
            />,
          ];
        }
        
        return [
          <GridActionsCellItem
            icon={<EditIcon />}
            label="Edit"
            className="textPrimary"
            onClick={handleEditClick(id)}
            color="inherit"
          />,
          <GridActionsCellItem
            icon={<DeleteIcon />}
            label="Delete"
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
                      slots={{
                        toolbar: EditToolbar,
                      }}
                      slotProps={{
                        toolbar: { setRows, setRowModesModel, setRefresh},
                      }}
      />
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
    </Box>
  );
}