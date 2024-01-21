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
  GridToolbarContainer, GridValidRowModel
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
import {ErrorMessages, Plot} from "@/config/macros";
import {useCoreMeasurementLoadContext, useCoreMeasurementLoadDispatch} from "@/app/contexts/fixeddatacontext";
import {CoreMeasurementsGridColumns, CoreMeasurementsRDS, StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectioncontext";

interface EditToolbarProps {
  rows: GridRowsProp;
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
  setRefresh: (newState: boolean) => void;
  currentPlot: Plot;
  coreMeasurementLoadDispatch:  React.Dispatch<{coreMeasurementLoad: CoreMeasurementsRDS[] | null}> | null;
}

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {rows, setRows, setRowModesModel, setRefresh, currentPlot, coreMeasurementLoadDispatch} = props;

  const handleClick = async () => {
    const id = randomId();

    const highestCoreMeasurementID = Math.max(
      ...rows.map((row) => row.coreMeasurementID),
      0
    );

    setRows((oldRows) => [...oldRows, {
      id,
      coreMeasurementID: highestCoreMeasurementID + 1,
      censusID: 0,
      plotID: currentPlot.id,
      quadratID: 0,
      treeID: 0,
      stemID: 0,
      personnelID: 0,
      measurementTypeID: 0,
      measurementDate: new Date(),
      measurement: '',
      isRemeasurement: false,
      isCurrent: false,
      userDefinedFields: '',
      masterMeasurementID: 0,
      isNew: true,
    }]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'coreMeasurementID'},
    }));
  };

  const handleRefresh = async () => {
    setRefresh(true);
    const response = await fetch(`/api/coremeasurements`, {
      method: 'GET'
    });
    setRows(await response.json());
    if (coreMeasurementLoadDispatch) {
      coreMeasurementLoadDispatch({coreMeasurementLoad: rows as CoreMeasurementsRDS[]})
    }
    setRefresh(false);
  }

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleClick}>
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
    'measurementTypeID', 'measurementDate', 'measurement', 'isRemeasurement',
    'isCurrent', 'userDefinedFields', 'masterMeasurementID'
  ];

  return fields.some(field => newRow[field] !== oldRow[field]);
}

export default function Page() {
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
      measurementTypeID: 0,
      measurementDate: new Date(),
      measurement: '',
      isRemeasurement: false,
      isCurrent: false,
      userDefinedFields: '',
      masterMeasurementID: 0,
    },
  ]
  const [rows, setRows] = React.useState(initialRows);
  const coreMeasurementLoadContext = useCoreMeasurementLoadContext();
  const coreMeasurementLoadDispatch = useCoreMeasurementLoadDispatch();
  let currentPlot = usePlotContext();
  useEffect(() => {
    if (coreMeasurementLoadContext) {
      setRows(coreMeasurementLoadContext);
    }
  }, [coreMeasurementLoadContext, setRows]);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const refreshData = async () => {
    setRefresh(true);
    const response = await fetch(`/api/coremeasurements`, {
      method: 'GET'
    });
    setRows(await response.json());
    if (coreMeasurementLoadDispatch) {
      coreMeasurementLoadDispatch({coreMeasurementLoad: rows as CoreMeasurementsRDS[]});
    }
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
    const response = await fetch(`/api/coremeasurements?coreMeasurementID=${rows.find((row) => row.id == id)!.coreMeasurementID}`, {
      method: 'DELETE'
    });
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
        if (newRow.coreMeasurementID == '') {
          reject(new Error("Primary key CoreMeasurementID cannot be empty!"));
        } else if (oldRow.coreMeasurementID == '') {
          // inserting a row
          const response = await fetch('/api/coremeasurements', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(newRow),
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
            const response = await fetch(`/api/coremeasurements`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
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
                            toolbar: {rows, setRows, setRowModesModel, setRefresh, currentPlot, coreMeasurementLoadDispatch},
                          }}
                          initialState={{
                            filter: {
                              filterModel: {
                                items: [{field: 'plotID', operator: 'equals', value: `${currentPlot.id}`}],
                              },
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