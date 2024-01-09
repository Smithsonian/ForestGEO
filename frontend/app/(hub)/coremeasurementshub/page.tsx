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
import {Alert, AlertProps, Button, Dialog, Snackbar} from "@mui/material";
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import React, {useCallback, useEffect, useState} from "react";
import Box from "@mui/joy/Box";
import {ErrorMessages, FileErrors} from "@/config/macros";
import {useCoreMeasurementLoadContext} from "@/app/contexts/fixeddatacontext";
import {CoreMeasurementGridColumns, StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectioncontext";
import {DialogActions, DialogContent, DialogTitle} from "@mui/joy";
import {UploadAndReviewProcess} from "@/components/fileupload/uploadreviewcycle";
import {useSession} from "next-auth/react";
import {FileWithPath} from "react-dropzone";

interface EditToolbarProps {
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
  setRefresh: (newState: boolean) => void;
}

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {setRows, setRowModesModel, setRefresh} = props;
  const [dialogOpen, setDialogOpen] = useState(false);
  const {data: session} = useSession();
  const currentPlot = usePlotContext();
  const [acceptedFiles, setAcceptedFiles] = useState<FileWithPath[]>([]);
  const [errorsData, setErrorsData] = useState<FileErrors>({});

  const handleDialogOpen = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const handleUpload = useCallback(async () => {
    if (acceptedFiles.length == 0) {
      console.log("accepted files is empty for some reason??");
    }
    const fileToFormData = new FormData();
    let i = 0;
    for (const file of acceptedFiles) {
      fileToFormData.append(`file_${i}`, file);
      i++;
    }
    const response = await fetch('/api/upload?plot=' + currentPlot!.key + '&user=' + session!.user!.name! + '&table=CoreMeasurements', {
      method: 'POST',
      body: fileToFormData,
    });
    const data = await response.json();
    setErrorsData(await data.errors);
    setDialogOpen(false);
  }, [acceptedFiles, currentPlot, session]);

  const handleClick = async () => {
    const id = randomId();
    setRows((oldRows) => [...oldRows, {
      id,
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
      isNew: true
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
    setRefresh(false);
  }

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleClick}>
        Add CoreMeasurement
      </Button>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleDialogOpen}>
        Upload CoreMeasurement File
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
      <Dialog open={dialogOpen} onClose={handleCloseDialog}>
        <DialogTitle>File Upload</DialogTitle>
        <DialogContent>
          <UploadAndReviewProcess/>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleUpload} color="primary">
            Upload
          </Button>
        </DialogActions>
      </Dialog>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  return newRow.coreMeasurementID !== oldRow.coreMeasurementID ||
    newRow.censusID !== oldRow.censusID ||
    newRow.plotID !== oldRow.plotID ||
    newRow.quadratID !== oldRow.quadratID ||
    newRow.treeID !== oldRow.treeID ||
    newRow.stemID !== oldRow.stemID ||
    newRow.personnelID !== oldRow.personnelID ||
    newRow.measurementTypeID !== oldRow.measurementTypeID ||
    newRow.measurementDate !== oldRow.measurementDate ||
    newRow.measurement !== oldRow.measurement ||
    newRow.isRemeasurement !== oldRow.isRemeasurement ||
    newRow.isCurrent !== oldRow.isCurrent ||
    newRow.userDefinedFields !== oldRow.userDefinedFields;
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
    },
  ]
  const [rows, setRows] = React.useState(initialRows);
  const coreMeasurementLoad = useCoreMeasurementLoadContext();
  let currentPlot = usePlotContext();
  useEffect(() => {
    if (coreMeasurementLoad) {
      setRows(coreMeasurementLoad);
    }
  }, [coreMeasurementLoad, setRows]);
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
    const response = await fetch(`/api/coremeasurements?coreMeasurementID=${rows.find((row) => row.id == id)!.coreMeasurementID}`, {method: 'DELETE'});
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
          const response = await fetch(`/api/coremeasurements?
          coreMeasurementID=${newRow.coreMeasurementID}
          &censusID=${newRow.censusID}
          &plotID=${newRow.plotID}
          &quadratID=${newRow.quadratID}
          &treeID=${newRow.treeID}
          &stemID=${newRow.stemID}
          &personnelID=${newRow.personnelID}
          &measurementTypeID=${newRow.measurementTypeID}
          &measurementDate=${newRow.measurementDate}
          &measurement=${newRow.measurement}
          &isRemeasurement=${newRow.isRemeasurement}
          &isCurrent=${newRow.isCurrent}
          &userDefinedFields=${newRow.userDefinedFields}`, {
            method: 'POST'
          });
          const responseJSON = await response.json();
          if (!response.ok && responseJSON.message == ErrorMessages.ICF) reject(new Error(ErrorMessages.ICF));
          setSnackbar({children: `New row added!`, severity: 'success'});
          resolve(newRow);
        } else {
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            const response = await fetch(`/api/coremeasurements?
            coreMeasurementID=${newRow.coreMeasurementID}
            &censusID=${newRow.censusID}
            &plotID=${newRow.plotID}
            &quadratID=${newRow.quadratID}
            &treeID=${newRow.treeID}
            &stemID=${newRow.stemID}
            &personnelID=${newRow.personnelID}
            &measurementTypeID=${newRow.measurementTypeID}
            &measurementDate=${newRow.measurementDate}
            &measurement=${newRow.measurement}
            &isRemeasurement=${newRow.isRemeasurement}
            &isCurrent=${newRow.isCurrent}
            &userDefinedFields=${newRow.userDefinedFields}`, {
              method: 'PATCH'
            })
            const responseJSON = await response.json();
            if (!response.ok && responseJSON.message == ErrorMessages.UKAE) reject(new Error(ErrorMessages.UKAE));
            setSnackbar({children: `Row edits saved!`, severity: 'success'});
            resolve(newRow);
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
    ...CoreMeasurementGridColumns,
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
                            toolbar: {setRows, setRowModesModel, setRefresh},
                          }}
                          initialState={{
                            filter: {
                              filterModel: {
                                items: [{field: 'plotID', operator: 'equals', value: `${currentPlot.id.toString()}`}],
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