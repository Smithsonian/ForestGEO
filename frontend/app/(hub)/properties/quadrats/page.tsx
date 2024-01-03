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
import {usePlotsLoadContext, useQuadratsLoadContext} from "@/app/contexts/fixeddatacontext";
import {StyledDataGrid} from "@/config/sqlmacros";
import {usePlotContext} from "@/app/contexts/userselectioncontext";

interface EditToolbarProps {
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
  setRefresh: (newState: boolean) => void;
}

function EditToolbar(props: EditToolbarProps) {
  const {setRows, setRowModesModel, setRefresh} = props;
  
  const handleClick = async () => {
    const id = randomId();
    setRows((oldRows) => [...oldRows, {
      id,
      quadratID: 0,
      plotID: null,
      quadratName: null,
      quadratX: null,
      quadratY: null,
      quadratZ: null,
      dimensionX: null,
      dimensionY: null,
      area: null,
      quadratShape: null
    }]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'quadratID'},
    }));
  };
  
  const handleRefresh = async () => {
    setRefresh(true);
    const response = await fetch(`/api/fixeddata/quadrats`, {
      method: 'GET'
    });
    setRows(await response.json());
    setRefresh(false);
  }
  
  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleClick}>
        Add quadrat
      </Button>
      <Button color={"primary"} startIcon={<RefreshIcon/>} onClick={handleRefresh}>
        Refresh
      </Button>
    </GridToolbarContainer>
  );
}

function computeMutation(newRow: GridRowModel, oldRow: GridRowModel) {
  return newRow.quadratID !== oldRow.quadratID ||
    newRow.plotID !== oldRow.plotID ||
    newRow.quadratName !== oldRow.quadratName ||
    newRow.quadratX !== oldRow.quadratX ||
    newRow.quadratY !== oldRow.quadratY ||
    newRow.quadratZ !== oldRow.quadratZ ||
    newRow.dimensionX !== oldRow.dimensionX ||
    newRow.dimensionY !== oldRow.dimensionY ||
    newRow.area !== oldRow.area ||
    newRow.quadratShape !== oldRow.quadratShape;
}

export default function Page() {
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
  const initialPlots: GridRowsProp = [
    {
      id: 0,
      plotID: 0,
      plotName: '',
      locationName: '',
      countryName: '',
      area: 0.0,
      plotX: 0.0,
      plotY: 0.0,
      plotZ: 0.0,
      plotShape: '',
      plotDescription: ''
    }
  ]
  const [rows, setRows] = React.useState(initialRows);
  const [plotRows, setPlotRows] = React.useState(initialPlots);
  let quadratsLoad = useQuadratsLoadContext();
  let plotsLoad = usePlotsLoadContext();
  let currentPlot = usePlotContext();
  useEffect(() => {
    if (quadratsLoad) {
      setRows(quadratsLoad);
    }
    if (plotsLoad) {
      setPlotRows(plotsLoad);
    }
  }, [quadratsLoad, setRows, plotsLoad]);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const refreshData = async () => {
    setRefresh(true);
    const response = await fetch(`/api/fixeddata/quadrats`, {
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
    const response = await fetch(`/api/fixeddata/quadrats?quadratID=${rows.find((row) => row.id == id)!.quadratID}`, {method: 'DELETE'});
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
  /**
   *   quadratID: number;
   *   plotID: number | null;
   *   quadratName: string | null;
   *   quadratX: number | null;
   *   quadratY: number | null;
   *   quadratZ: number | null;
   *   dimensionX: number | null;
   *   dimensionY: number | null;
   *   area: number | null;
   *   quadratShape: string | null;
   */
  const processRowUpdate = React.useCallback(
    (newRow: GridRowModel, oldRow: GridRowModel) =>
      new Promise<GridRowModel>(async (resolve, reject) => {
        if (newRow.quadratID == '') {
          reject(new Error("Primary key QuadratID cannot be empty!"));
        } else if (oldRow.code == '') {
          // inserting a row
          const response = await fetch(`/api/fixeddata/quadrats?quadratID=${newRow.quadratID}&plotID=${newRow.plotID}
          &quadratName=${newRow.quadratName}&quadratX=${newRow.quadratX}&quadratY=${newRow.quadratY}&quadratZ=${newRow.quadratZ}
          &dimensionX=${newRow.dimensionX}&dimensionY=${newRow.dimensionY}&area=${newRow.area}&quadratShape=${newRow.quadratShape}`, {
            method: 'POST'
          });
          const responseJSON = await response.json();
          if (!response.ok && responseJSON.message == ErrorMessages.ICF) reject(new Error(ErrorMessages.ICF));
          setSnackbar({children: `New row added!`, severity: 'success'});
          resolve(newRow);
        } else {
          const mutation = computeMutation(newRow, oldRow);
          if (mutation) {
            const response = await fetch(`/api/fixeddata/quadrats?oldQuadratID=${oldRow.quadratID}&quadratID=${newRow.quadratID}
            &plotID=${newRow.plotID}&quadratName=${newRow.quadratName}&quadratX=${newRow.quadratX}&quadratY=${newRow.quadratY}
            &quadratZ=${newRow.quadratZ}&dimensionX=${newRow.dimensionX}&dimensionY=${newRow.dimensionY}
            &area=${newRow.area}&quadratShape=${newRow.quadratShape}`, {
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
  
  // const plotIDs = plotRows.map((plotRow) => plotRow.plotID);
  const columns: GridColDef[] = [
    {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left',},
    {
      field: 'plotID',
      headerName: 'PlotID',
      headerClassName: 'header',
      flex: 1,
      align: 'left',
      editable: true
    },
    {field: 'quadratName', headerName: 'QuadratName', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'quadratX', headerName: 'QuadratX', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'quadratY', headerName: 'QuadratY', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'quadratZ', headerName: 'QuadratZ', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'dimensionX', headerName: 'DimensionX', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'dimensionY', headerName: 'DimensionY', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left',},
    {field: 'quadratShape', headerName: 'QuadratShape', headerClassName: 'header', flex: 1, align: 'left',},
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
              sx={{
                color: 'primary.main',
              }}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon/>}
              label="Cancel"
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
            className="textPrimary"
            onClick={handleEditClick(id)}
            color="inherit"
          />,
          <GridActionsCellItem
            icon={<DeleteIcon/>}
            label="Delete"
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
                                items: [{field: 'plotID', operator: 'equals', value: `${currentPlot!.id.toString()}`}],
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