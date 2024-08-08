'use client';
import React, { useEffect, useState } from 'react';
import {
  DataGrid,
  GridActionsCellItem,
  GridColDef,
  GridRenderCellParams,
  GridRowId,
  GridRowModel,
  GridRowModes,
  GridRowModesModel,
  GridRowParams,
  GridRowsProp,
  GridToolbarContainer,
  GridToolbarProps,
  GridValidRowModel
} from '@mui/x-data-grid';
import { randomId } from '@mui/x-data-grid-generator';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Button } from '@mui/material';
import Divider from '@mui/joy/Divider';
import Typography from '@mui/joy/Typography';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import { unitSelectionOptions } from '@/config/macros';

type EditToolbarProps = GridToolbarProps;

function EditToolbar(props: EditToolbarProps) {
  const { setRows, setRowModesModel } = props;
  const handleClick = () => {
    const id = randomId();
    setRows((oldRows: GridValidRowModel[]) => [
      ...oldRows,
      {
        id,
        stemTag: '',
        treeTag: '',
        speciesCode: '',
        subquadratName: '',
        personnel: '',
        stemX: 0,
        stemY: 0,
        date: new Date(),
        dbh: 0,
        dbhUnit: '',
        hom: 0,
        homUnit: '',
        codes: [], // Initialize codes as an empty array
        comments: '',
        isNew: true
      }
    ]);
    setRowModesModel((oldModel: GridRowModesModel) => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'quadratName' }
    }));
  };

  return (
    <GridToolbarContainer>
      <Button color="primary" startIcon={<AddIcon />} onClick={handleClick}>
        Add record
      </Button>
    </GridToolbarContainer>
  );
}

const CensusAutocompleteInputForm = () => {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      stemTag: '',
      treeTag: '',
      speciesCode: '',
      subquadratName: '',
      stemX: 0,
      stemY: 0,
      date: new Date(),
      dbh: 0,
      dbhUnit: '',
      hom: 0,
      homUnit: '',
      codes: '', // Initialize codes as an empty array
      personnel: '',
      comments: ''
    }
  ];

  // Custom render function to show errors
  const renderValidationCell = (params: GridRenderCellParams, fieldName: string) => {
    const cellValue = params.value !== undefined ? params.value.toString() : '';
    const cellError = cellHasError(fieldName, params.id) ? getCellErrorMessages(fieldName, params.id) : '';
    console.log(`Rendering cell - Field: ${fieldName}, Error: ${cellError}`);
    return (
      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', marginY: 1.5 }}>
        {cellError ? (
          <>
            <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{cellValue}</Typography>
            <Typography
              color="danger"
              sx={{
                fontSize: '0.75rem',
                mt: 1,
                whiteSpace: 'normal',
                lineHeight: 'normal'
              }}
            >
              {cellError}
            </Typography>
          </>
        ) : (
          <Typography sx={{ whiteSpace: 'normal', lineHeight: 'normal' }}>{cellValue}</Typography>
        )}
      </Box>
    );
  };

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
        return new Date(params.value) ?? new Date();
      }
    },
    {
      field: 'personnel',
      headerName: 'Personnel',
      flex: 1,
      align: 'right',
      editable: true,
      renderCell: (params: GridRenderCellParams) => renderValidationCell(params, 'personnel')
    },
    {
      field: 'subquadratName',
      headerName: 'Subquadrat',
      flex: 1,
      align: 'right',
      editable: true,
      renderCell: (params: GridRenderCellParams) => renderValidationCell(params, 'subquadratName')
    },
    {
      field: 'treeTag',
      headerName: 'Tree Tag',
      flex: 1,
      align: 'right',
      editable: true,
      renderCell: (params: GridRenderCellParams) => renderValidationCell(params, 'treeTag')
    },
    {
      field: 'stemTag',
      headerName: 'Stem Tag',
      flex: 1,
      align: 'right',
      editable: true,
      renderCell: (params: GridRenderCellParams) => renderValidationCell(params, 'stemTag')
    },
    {
      field: 'speciesCode',
      headerName: 'SP Code',
      flex: 1,
      align: 'right',
      editable: true,
      renderCell: (params: GridRenderCellParams) => renderValidationCell(params, 'speciesCode')
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
      field: 'dbhUnit',
      headerName: '<- Unit',
      headerClassName: 'header',
      flex: 1,
      align: 'left',
      editable: true,
      type: 'singleSelect',
      valueOptions: unitSelectionOptions
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
      field: 'homUnit',
      headerName: '<- Unit',
      headerClassName: 'header',
      flex: 1,
      align: 'left',
      editable: true,
      type: 'singleSelect',
      valueOptions: unitSelectionOptions
    },
    {
      field: 'codes',
      headerName: 'Codes',
      width: 200,
      flex: 1,
      align: 'left',
      editable: true
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      maxWidth: 100,
      cellClassName: 'actions',
      flex: 1,
      align: 'center',
      getActions: ({ id }) => {
        const isInEditMode = rowModesModel[id]?.mode === GridRowModes.Edit;

        if (isInEditMode) {
          return [
            <GridActionsCellItem
              icon={<SaveIcon />}
              label="Save"
              key="Save"
              sx={{
                color: 'primary.main'
              }}
              onClick={handleSaveClick(id)}
            />,
            <GridActionsCellItem icon={<CancelIcon />} label="Cancel" key="Cancel" className="textPrimary" onClick={handleCancelClick(id)} color="inherit" />
          ];
        }

        return [
          <GridActionsCellItem icon={<EditIcon />} label="Edit" key="Edit" className="textPrimary" onClick={handleEditClick(id)} color="inherit" />,
          <GridActionsCellItem icon={<DeleteIcon />} label="Delete" key="Delete" onClick={handleDeleteClick(id)} color="inherit" />
        ];
      }
    }
  ];

  const [rows, setRows] = useState(initialRows);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [validationErrors, setValidationErrors] = useState<{
    [key: string]: string | null;
  }>({});
  const [isFormComplete, setIsFormComplete] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();

  const { data: session } = useSession();

  const validateField = async (tableName: string, fieldName: string, value: string, rowId: GridRowId) => {
    try {
      const response = await fetch(`/api/formvalidation/${currentSite?.schemaName}/${tableName}/${fieldName}/${value}`, {
        method: 'GET'
      });
      if (!response.ok) {
        const errorText = `${value}: Invalid ${fieldName}, not found in ${tableName}.`;
        setValidationErrors(prev => ({
          ...prev,
          [`${rowId}-${fieldName}`]: errorText
        }));
        return false;
      }
      setValidationErrors(prev => ({
        ...prev,
        [`${rowId}-${fieldName}`]: null
      }));
      return true;
    } catch (error) {
      console.error(`Error validating ${fieldName}:`, error);
      setValidationErrors(prev => ({
        ...prev,
        [`${rowId}-${fieldName}`]: `Validation error for ${fieldName}.`
      }));
      return false;
    }
  };

  const validateAllFields = async (row: GridValidRowModel) => {
    const [firstName = '', lastName = ''] = row.personnel.split(' ');
    const validations = [
      validateField('stems', 'StemTag', row.stemTag, row.id),
      validateField('trees', 'TreeTag', row.treeTag, row.id),
      validateField('species', 'SpeciesCode', row.speciesCode, row.id),
      validateField('subquadrats', 'SubquadratName', row.quadratName, row.id),
      validateField('personnel', 'FirstName', firstName, row.id),
      validateField('personnel', 'LastName', lastName, row.id)
    ];

    const results = await Promise.all(validations);
    const allValid = results.every(result => result);
    if (!allValid) {
      console.error('One or more fields are invalid.');
    }
    return allValid;
  };

  const handleEditClick = (id: GridRowId) => () => {
    setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } });
  };

  const handleSaveClick = (id: GridRowId) => async () => {
    const row = rows.find(row => row.id === id);
    if (row) {
      const isValid = await validateAllFields(row);
      if (isValid) {
        setRowModesModel({
          ...rowModesModel,
          [id]: { mode: GridRowModes.View }
        });
      } else {
        console.error('Validation failed for row:', id);
      }
    }
  };

  const handleDeleteClick = (id: GridRowId) => () => {
    setRows(rows.filter(row => row.id !== id));
  };

  const handleCancelClick = (id: GridRowId) => () => {
    setRowModesModel({
      ...rowModesModel,
      [id]: { mode: GridRowModes.View, ignoreModifications: true }
    });

    const editedRow = rows.find(row => row.id === id);
    if (editedRow!.isNew) {
      setRows(rows.filter(row => row.id !== id));
    }
  };

  const processRowUpdate = (newRow: GridRowModel) => {
    const updatedRow = { ...newRow, isNew: false };
    setRows(rows.map(row => (row.id === newRow.id ? updatedRow : row)));
    return updatedRow;
  };

  const handleRowModesModelChange = (newRowModesModel: GridRowModesModel) => {
    setRowModesModel(newRowModesModel);
  };

  const checkFormCompletion = () => {
    const allRowsComplete = rows.every(row => {
      return row.date && row.personnel && row.quadratName && row.treeTag && row.stemTag && row.speciesCode && row.dbh && row.hom;
    });
    setIsFormComplete(allRowsComplete);
  };

  useEffect(() => {
    checkFormCompletion();
  }, [rows]);

  // Prevent saving row on Enter key press or any other shortcut
  const handleCellKeyDown = (params: any, event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  };

  const rowHasError = (rowId: GridRowId) => {
    return Object.keys(validationErrors).some(key => key.startsWith(rowId + '-') && validationErrors[key] != null);
  };

  const getRowClassName = (params: GridRowParams) => {
    if (rowHasError(params.id)) return 'error-row';
    return '';
  };

  const cellHasError = (fieldName: string, rowId: GridRowId) => {
    return validationErrors[`${rowId}-${fieldName}`] != null;
  };

  const getCellErrorMessages = (fieldName: string, rowId: GridRowId) => {
    return validationErrors[`${rowId}-${fieldName}`];
  };

  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        height: '100%',
        flexDirection: 'column'
      }}
    >
      <Typography level={'title-md'} color={'primary'}>
        Plot Name: {currentPlot?.plotName ?? 'None'}, Census ID: {currentCensus?.dateRanges[0].censusID ?? '0'}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        {/* <Button
          variant="contained"
          disabled={!isFormComplete || Object.values(validationErrors).some(error => error !== null)}
          onClick={handleSubmit}
        >
          Submit
        </Button> */}
      </Box>
      <Divider orientation={'horizontal'} />
      <DataGrid
        getRowClassName={getRowClassName}
        getCellClassName={() => 'dataGridCell'}
        rows={rows}
        columns={columns}
        getRowHeight={() => 'auto'}
        autoHeight
        checkboxSelection
        disableRowSelectionOnClick
        editMode="row"
        rowModesModel={rowModesModel}
        onRowModesModelChange={handleRowModesModelChange}
        processRowUpdate={processRowUpdate}
        onCellKeyDown={handleCellKeyDown}
        slots={{
          toolbar: EditToolbar
        }}
        slotProps={{
          toolbar: { setRows, setRowModesModel } // Ensure these methods are passed correctly
        }}
      />
    </Box>
  );
};

export default CensusAutocompleteInputForm;
