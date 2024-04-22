"use client";
import React, {useState} from 'react';
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
  GridToolbarContainer,
  GridToolbarProps,
  ToolbarPropsOverrides
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
import {useCensusContext, usePlotContext, useSiteContext} from "@/app/contexts/userselectionprovider";
import {useSession} from 'next-auth/react';
import UploadValidation from "@/components/uploadsystem/segments/uploadvalidation";
import UploadUpdateValidations from "@/components/uploadsystem/segments/uploadupdatevalidations";
import {ReviewStates} from "@/config/macros/uploadsystemmacros";
import {DialogContent, DialogTitle, Modal, ModalDialog} from '@mui/joy';

interface EditToolbarCustomProps {
  handleAddNewRow?: () => void;
  handleRefresh?: () => Promise<void>;
  locked?: boolean;
}

type EditToolbarProps = EditToolbarCustomProps & GridToolbarProps & ToolbarPropsOverrides;


function EditToolbar(props: Readonly<EditToolbarProps>) {
  const {setRows, setRowModesModel} = props;
  const handleClick = () => {
    const id = randomId();
    setRows((oldRows: any) => [...oldRows,
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
    setRowModesModel((oldModel: any) => ({
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

/**
 * CensusInputForm component for inputting census data.
 *
 * This component provides a form for users to input census data for a specific plot and census.
 * It uses the DataGrid component from MUI to display and edit the data in a tabular format.
 *
 * The form includes fields for:
 * - Date
 * - Personnel
 * - Quadrat
 * - Tree Tag
 * - Stem Tag
 * - Species Code
 * - DBH (Diameter at Breast Height)
 * - HOM (Height of Measurement)
 * - Codes (multiple selection)
 *
 * The component also includes validation and update stages, which are displayed in a modal dialog.
 *
 * When the form is complete (all required fields are filled), the user can submit the data.
 * The submitted data is formatted and sent to the server via a POST request to the `/api/sqlload` endpoint.
 *
 * The component uses the following contexts:
 * - PlotContext: to access the current plot information
 * - CensusContext: to access the current census information
 * - SiteContext: to access the current site information
 *
 * @component
 * @returns {JSX.Element} The rendered CensusInputForm component.
 */
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
      valueGetter: (params: any) => {
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
  // New state to track if the form is ready for submission
  const [isFormComplete, setIsFormComplete] = useState(false);

  const [activeStep, setActiveStep] = useState('validation'); // 'validation', 'update', or 'summary'
  const [validationResults, setValidationResults] = useState(null);
  const [updateResults, setUpdateResults] = useState(null);

  const [reviewState, setReviewState] = useState<ReviewStates>(ReviewStates.UPLOAD_SQL); // placeholder


  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  let currentSite = useSiteContext();

  const {data: session} = useSession();
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

  // Function to check if all required fields in a row are filled
  const checkFormCompletion = () => {
    const allRowsComplete = rows.every(row => {
      // Add checks for all required fields here
      return row.date && row.personnel && row.quadratName && row.treeTag && row.stemTag && row.speciesCode && row.dbh && row.hom;
    });
    setIsFormComplete(allRowsComplete);
  };

  // Update the form completion status whenever rows change
  React.useEffect(() => {
    checkFormCompletion();
  }, [rows]);

  // Function to format and submit data
  const handleSubmit = async () => {
    const formattedData = rows.reduce((acc, row) => {
      // Map the row data to the FileRow structure
      acc[row.id] = {
        date: row.date.toISOString(),
        personnel: row.personnel,
        quadratName: row.quadratName,
        treeTag: row.treeTag,
        stemTag: row.stemTag,
        speciesCode: row.speciesCode,
        dbh: row.dbh.toString(),
        hom: row.hom.toString(),
        codes: row.codes.join(';')
      };
      return acc;
    }, {});

    const fileRowSet = {"censusData": formattedData}; // Assuming 'censusData' as the file name

    try {
      // Add code to retrieve additional required parameters like schema, fileName, etc.
      const response = await fetch(`/api/sqlload?schema=${currentSite?.schemaName ?? ''}&fileName=censusData&plot=${currentPlot?.id}&census=${currentCensus?.id}&user=${session?.user?.name}&formType=measurements&uom=metric`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fileRowSet),
      });

      const responseData = await response.json(); // not gonna do anything with this, this output is intended for upload system.
      // Handle the response
      if (response.ok) {
        setReviewState(ReviewStates.VALIDATE);
      } else {
        console.error('Error submitting form:', responseData);
        // Handle submission error
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    }

  };
  // Render different components based on activeStep
  let content;
  switch (activeStep) {
    case 'validation':
      content = (
        <UploadValidation
          schema={currentSite?.schemaName ?? ''}
          setReviewState={setReviewState}/>
      );
      break;
    case 'update':
      content = (
        <UploadUpdateValidations
          schema={currentSite?.schemaName ?? ''}
          setReviewState={setReviewState}
        />
      );
      break;
    default:
      content = null;
  }
  return (
    <Box sx={{display: 'flex', width: '100%', height: '100%', flexDirection: 'column'}}>
      <Typography level={"title-md"} color={"primary"}>Plot Name: {currentPlot?.key ?? 'None'}, Census
        ID: {currentCensus?.censusID ?? '0'}</Typography>
      <Box sx={{display: 'flex', justifyContent: 'flex-end', marginTop: 2}}>
        <Button
          variant="contained"
          disabled={!isFormComplete}
          onClick={handleSubmit}
        >
          Submit
        </Button>
      </Box>
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
      <Modal open={reviewState === ReviewStates.VALIDATE || reviewState === ReviewStates.UPDATE}>
        <ModalDialog variant="outlined" role="alertdialog">
          <DialogTitle>
            Validation and Update Stages
          </DialogTitle>
          <DialogContent>
            {reviewState === ReviewStates.VALIDATE && (
              <UploadValidation
                schema={currentSite?.schemaName ?? ''}
                setReviewState={setReviewState}/>
            )}
            {reviewState === ReviewStates.UPDATE && (
              <UploadUpdateValidations
                schema={currentSite?.schemaName ?? ''}
                setReviewState={setReviewState}/>
            )}
          </DialogContent>
        </ModalDialog>
      </Modal>
    </Box>
  );
};

export default CensusInputForm;
