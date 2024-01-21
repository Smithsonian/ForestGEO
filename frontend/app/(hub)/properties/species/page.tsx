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
import {ErrorMessages} from "@/config/macros";
import {useSpeciesLoadContext, useSpeciesLoadDispatch} from "@/app/contexts/fixeddatacontext";
import {CoreMeasurementsRDS, SpeciesGridColumns, SpeciesRDS, StyledDataGrid} from "@/config/sqlmacros";

interface EditToolbarProps {
  rows: GridRowsProp;
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
  setRefresh: (newState: boolean) => void;
  speciesLoadDispatch: React.Dispatch<{speciesLoad: SpeciesRDS[] | null}> | null;
}

function EditToolbar(props: EditToolbarProps) {
  const {rows, setRows, setRowModesModel, setRefresh, speciesLoadDispatch} = props;

  const handleClick = async () => {
    const id = randomId();
    const highestSpeciesID = Math.max(
      ...rows.map((row) => row.speciesID),
      0
    );
    setRows((oldRows) => [...oldRows, {
      id,
      speciesID: highestSpeciesID + 1,
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
    }]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'speciesID'},
    }));
  };

  const handleRefresh = async () => {
    setRefresh(true);
    const response = await fetch(`/api/fixeddata/species`, {
      method: 'GET'
    });
    setRows(await response.json());
    if (speciesLoadDispatch) speciesLoadDispatch({speciesLoad: rows as SpeciesRDS[]})
    setRefresh(false);
  }

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleClick}>
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

export default function Page() {
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
  const speciesLoad = useSpeciesLoadContext();
  const speciesLoadDispatch = useSpeciesLoadDispatch();
  useEffect(() => {
    if (speciesLoad) {
      setRows(speciesLoad);
    }
  }, [speciesLoad, setRows]);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const refreshData = async () => {
    setRefresh(true);
    const response = await fetch(`/api/fixeddata/species`, {
      method: 'GET'
    });
    setRows(await response.json());
    if (speciesLoadDispatch) speciesLoadDispatch({speciesLoad: rows as SpeciesRDS[]})
    setRefresh(false);
  }
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
    const response = await fetch(
      `/api/fixeddata/species?speciesID=${rows.find((row) => row.id == id)!.speciesID}`, {method: 'DELETE'});
    if (!response.ok) setSnackbar({children: "Error: Deletion failed", severity: 'error'});
    else {
      setSnackbar({children: "Row successfully deleted", severity: 'success'});
      setRows(rows.filter((row) => row.id !== id));
      await refreshData();
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
        if (newRow.speciesID == '') {
          reject(new Error("Primary key SpeciesID cannot be empty!"));
        } else if (oldRow.speciesID == '') {
          // inserting a row
          const response = await fetch(`/api/fixeddata/species`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(newRow),
          })
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
            const response = await fetch(`/api/fixeddata/species`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(newRow)
            })
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
        await refreshData();
      }),
    [],
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
                        slots={{
                          toolbar: EditToolbar,
                        }}
                        slotProps={{
                          toolbar: {rows, setRows, setRowModesModel, setRefresh, speciesLoadDispatch},
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