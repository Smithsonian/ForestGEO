"use client";
import React from 'react';
import {
  DataGrid,
  GridActionsCellItem,
  GridColDef,
  GridEventListener,
  GridRenderCellParams,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowsProp,
  GridToolbarContainer
} from '@mui/x-data-grid';
import {randomId} from "@mui/x-data-grid-generator";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import {DeleteIcon} from "@/components/icons";
import {Box, Button} from "@mui/material";
import AutocompleteFixedData from "@/components/forms/autocompletefixeddata";
import {AutocompleteMultiSelect} from "@/components/forms/autocompletemultiselect";
import Divider from "@mui/joy/Divider";
import Typography from "@mui/joy/Typography";
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";

interface EditToolbarProps {
  setRows: (newRows: (oldRows: GridRowsProp) => GridRowsProp) => void;
  setRowModesModel: (
    newModel: (oldModel: GridRowModesModel) => GridRowModesModel,
  ) => void;
}

function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {setRows, setRowModesModel} = props;
  const handleClick = () => {
    const id = randomId();
    setRows((oldRows) => [...oldRows,
      {
        id,
        date: new Date(),
        personnel: '',
        quadratName: '',
        treeTag: '',
        stemTag: '',
        stemX: 0,
        stemY: 0,
        speciesCode: '',
        dbh: 0,
        hom: 0,
        codes: [], // Initialize codes as an empty array
        comments: '',
        isNew: true
      }]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'quadratName'},
    }));
  };

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon/>} onClick={handleClick}>
        Add record
      </Button>
    </GridToolbarContainer>
  );
}

const CensusInputForm = () => {
  /**
   * "tag": "Trees.TreeTag",
   *       "stemtag": "Stems.StemTag",
   *       "spcode": "Species.SpeciesCode",
   *       "quadrat": "Quadrats.QuadratName",
   *       "lx": "Stems.StemQuadX",
   *       "ly": "Stems.StemQuadY",
   *       "dbh": "CoreMeasurements.MeasuredDBH",
   *       "codes": "Attributes.Code",
   *       "hom": "CoreMeasurement.MeasuredHOM",
   *       "date": "CoreMeasurement.MeasurementDate",
   */
  const initialRows: GridRowsProp = [{
    id: 0,
    date: new Date(),
    personnel: '',
    quadratName: '',
    treeTag: '',
    stemTag: '',
    stemX: 0,
    stemY: 0,
    speciesCode: '',
    dbh: 0,
    hom: 0,
    codes: [], // Initialize codes as an empty array
    comments: ''
  }];
  const columns: GridColDef[] = [
    {
      field: 'date',
      headerName: 'Date',
      type: 'date',
      headerClassName: 'header',
      maxWidth: 100,
      flex: 1,
      align: 'left',
      editable: true,
      valueGetter: (params) => {
        if (!params.value) return null;
        return new Date(params.value);
      }
    },
    {
      field: 'personnel', headerName: 'Personnel', flex: 1, align: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteFixedData
          dataType={"personnel"}
          value={params.value || ''}
          onChange={(newValue) => handlePersonnelChange(params.id, newValue)}
        />
      ),
    },
    {
      field: 'quadrat', headerName: 'Quadrat', flex: 1, align: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteFixedData
          dataType={"quadrats"}
          value={params.value || ''}
          onChange={(newValue) => handleQuadratChange(params.id, newValue)}
        />
      ),
    },
    {
      field: 'treeTag', headerName: 'Tree Tag', flex: 1, align: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteFixedData
          dataType={"trees"}
          value={params.value || ''}
          onChange={(newValue) => handleTreeTagChange(params.id, newValue)}
        />
      ),
    },
    {
      field: 'stemTag', headerName: 'Stem Tag', flex: 1, align: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteFixedData
          dataType={"stems"}
          value={params.value || ''}
          onChange={(newValue) => handleStemTagChange(params.id, newValue)}
        />
      ),
    },
    {
      field: 'speciesCode', headerName: 'Species Code', flex: 1, align: 'right',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteFixedData
          dataType={"species"}
          value={params.value || ''}
          onChange={(newValue) => handleSpeciesCodeChange(params.id, newValue)}
        />
      ),
    },
    {
      field: 'dbh',
      headerName: 'DBH',
      headerClassName: 'header',
      type: 'number',
      editable: true,
      maxWidth: 75,
      flex: 1,
      align: 'right'
    },
    {
      field: 'hom',
      headerName: 'HOM',
      headerClassName: 'header',
      type: 'number',
      editable: true,
      maxWidth: 75,
      flex: 1,
      align: 'right'
    },
    {
      field: 'codes',
      headerName: 'Codes',
      width: 200,
      flex: 1,
      align: 'left',
      renderCell: (params: GridRenderCellParams) => (
        <AutocompleteMultiSelect
          initialValue={params.value || []}
          onChange={(newCodes: string[]) => handleCodesChange(params.id, newCodes)}
        />
      ),
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      maxWidth: 100,
      cellClassName: 'actions',
      flex: 1, align: 'center',
      getActions: ({id}) => {
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;

        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon/>}
              label="Save"
              key="Save"
              sx={{
                color: 'primary.main',
              }}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem
              icon={<CancelIcon/>}
              label="Cancel"
              key="Cancel"
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
            key="Edit"
            className="textPrimary"
            onClick={handleEditClick(id)}
            color="inherit"
          />,
          <GridActionsCellItem
            icon={<DeleteIcon/>}
            label="Delete"
            key="Delete"
            onClick={handleDeleteClick(id)}
            color="inherit"
          />,
        ];
      },
    },
  ];
  const [rows, setRows] = React.useState(initialRows);
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  const handleQuadratChange = (id: number | string, newValue: string) => {
    setRows(rows.map((row) => (row.id === id ? {...row, quadratName: newValue} : row)));
  };
  const handlePersonnelChange = (id: number | string, newValue: string) => {
    setRows(rows.map((row) => (row.id === id ? {...row, personnel: newValue} : row)));
  }
  const handleTreeTagChange = (id: number | string, newValue: string) => {
    setRows(rows.map((row) => (row.id === id ? {...row, treeTag: newValue} : row)));
  }
  const handleStemTagChange = (id: number | string, newValue: string) => {
    setRows(rows.map((row) => (row.id === id ? {...row, stemTag: newValue} : row)));
  }
  const handleSpeciesCodeChange = (id: number | string, newValue: string) => {
    setRows(rows.map((row) => (row.id === id ? {...row, speciesCode: newValue} : row)));
  }
  const handleCodesChange = (id: GridRowId, newCodes: string[]) => {
    setRows(rows.map((row) => (row.id === id ? {...row, codes: newCodes} : row)));
  };
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

  const handleDeleteClick = (id: GridRowId) => () => {
    setRows(rows.filter((row) => row.id !== id));
  };

  const handleCancelClick = (id: GridRowId) => () => {
    setRowModesModel({
      ...rowModesModel,
      [id]: {mode: GridRowModes.View, ignoreModifications: true},
    });

    const editedRow = rows.find((row) => row.id === id);
    if (editedRow!.isNew) {
      setRows(rows.filter((row) => row.id !== id));
    }
  };

  const processRowUpdate = (newRow: GridRowModel) => {
    const updatedRow = {...newRow, isNew: false};
    setRows(rows.map((row) => (row.id === newRow.id ? updatedRow : row)));
    return updatedRow;
  };

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  return (
    <Box sx={{display: 'flex', width: '100%', height: '100%', flexDirection: 'column'}}>
      <Typography level={"title-md"} color={"primary"}>Plot Name: {currentPlot?.key ?? 'None'}, Census
        ID: {currentCensus?.censusID ?? '0'}</Typography>
      <Divider orientation={"horizontal"}/>
      <DataGrid
        getCellClassName={() => "dataGridCell"}
        rowHeight={75}
        rows={rows}
        columns={columns}
        autoHeight
        checkboxSelection
        disableRowSelectionOnClick
        editMode="row"
        rowModesModel={rowModesModel}
        onRowModesModelChange={handleRowModesModelChange}
        onRowEditStop={handleRowEditStop}
        processRowUpdate={processRowUpdate}
        slots={{
          toolbar: EditToolbar,
        }}
        slotProps={{
          toolbar: {setRows, setRowModesModel},
        }}
      />
    </Box>
  );
};

export default CensusInputForm;
