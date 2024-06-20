'use client';

import {Box, Paper, Typography} from '@mui/material';
import React, {Dispatch, SetStateAction, useState, useEffect} from 'react';
import {FileWithPath} from 'react-dropzone';
import '@/styles/validationtable.css';
import moment from 'moment';
import { GridCellParams, GridColDef, GridRowModel, GridRowsProp} from '@mui/x-data-grid';
import {StyledDataGrid} from '@/config/styleddatagrid';
import {
  FileErrors,
  FileRow,
  FileCollectionRowSet,
  RowValidationErrors,
  ValidationFunction,
  getTableHeaders
} from '@/config/macros/formdetails';
import {validateAttributesRow} from '@/config/sqlrdsdefinitions/tables/attributerds';
import {validatePersonnelRow} from '@/config/sqlrdsdefinitions/tables/personnelrds';
import {validateQuadratsRow} from '@/config/sqlrdsdefinitions/tables/quadratrds';
import {validateSpeciesFormRow} from '@/config/sqlrdsdefinitions/tables/speciesrds';
import {validateSubquadratsRow} from '@/config/sqlrdsdefinitions/tables/subquadratrds';
import {validateMeasurementsRow} from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import {usePlotContext} from '@/app/contexts/userselectionprovider';

export interface ValidationTableProps {
  uploadedData: FileWithPath[];
  errorMessage: { [fileName: string]: { [currentRow: string]: string } };
  headers: { label: string }[];
  formType: string;
}

export interface DisplayErrorTableProps {
  fileName: string;
  fileData: { fileName: string; data: DataStructure[] };
  errorMessage: FileErrors;
  formType: string;
}

export interface DataStructure {
  [key: string]: string;
}

const validationFunctions: Record<string, ValidationFunction> = {
  "attributes": validateAttributesRow,
  "personnel": validatePersonnelRow,
  "species": validateSpeciesFormRow,
  "quadrats": validateQuadratsRow,
  "subquadrats": validateSubquadratsRow,
  "measurements": validateMeasurementsRow,
};

export const validateRowByFormType = (formType: string, row: FileRow): RowValidationErrors | null => {
  const validationFunction = validationFunctions[formType];
  if (validationFunction) {
    return validationFunction(row);
  }
  return null;
};

export interface DisplayParsedDataProps {
  parsedData: FileCollectionRowSet;
  setParsedData: Dispatch<SetStateAction<FileCollectionRowSet>>;
  errors: FileCollectionRowSet;
  setErrors: Dispatch<SetStateAction<FileCollectionRowSet>>;
  errorRows: FileCollectionRowSet;
  setErrorRows: Dispatch<SetStateAction<FileCollectionRowSet>>;
  fileName: string;
  formType: string;
}

export const DisplayParsedDataGridInline: React.FC<DisplayParsedDataProps> = (
  props: Readonly<DisplayParsedDataProps>
) => {
  const {
    parsedData,
    setParsedData,
    errors,
    setErrors,
    errorRows,
    setErrorRows,
    fileName,
    formType
  } = props;
  const singleFileData = parsedData[fileName] || {};

  const currentPlot = usePlotContext();

  const tableHeaders = getTableHeaders(formType, currentPlot?.usesSubquadrats ?? false) || [];
  const [validRows, setValidRows] = useState<GridRowsProp>([]);
  const [invalidRows, setInvalidRows] = useState<GridRowsProp>([]);

  const columns: GridColDef[] = tableHeaders.map(header => ({
    field: header.label,
    headerName: header.label,
    flex: 1,
    getCellClassName: (params: GridCellParams) => {
      const rowIndex = params.id.toString().split('-')[1];
      const errorKey = `row-${rowIndex}`;
      const cellError = errors[fileName]?.[errorKey]?.[header.label];
      return cellError ? 'error-cell' : '';
    },
    renderCell: (params: GridCellParams) => {
      if (header.label === 'date') {
        const formattedDate = params.value ? moment(params.value).format('YYYY-MM-DD') : '';
        return (
          <Typography sx={{whiteSpace: 'normal', lineHeight: 'normal'}}>
            {formattedDate}
          </Typography>
        );
      }

      const rowIndex = params.id.toString().split('-')[1];
      const errorKey = `row-${rowIndex}`;
      const cellError = errors[fileName]?.[errorKey]?.[header.label];

      // Extract the display value
      const displayValue = params.value;
      const isAutoFillCorrection = cellError && (cellError === 'Genus was auto-filled based on species field.' || cellError === 'Species field was split into genus and species.');

      return (
        <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', marginY: 1.5}}>
          {cellError ? (
            <>
              {isAutoFillCorrection ? (
                <Typography className="auto-fill-correction">
                  {displayValue !== undefined && displayValue !== null ? displayValue.toString() : ''}
                </Typography>
              ) : (
                <>
                  <Typography className="error-cell">
                    {displayValue !== undefined && displayValue !== null ? displayValue.toString() : ''}
                  </Typography>
                  <Typography className="null-cell">
                    NULL
                  </Typography>
                </>
              )}
            </>
          ) : (
            <Typography sx={{whiteSpace: 'normal', lineHeight: 'normal'}}>
              {displayValue !== undefined && displayValue !== null ? displayValue.toString() : ''}
            </Typography>
          )}
        </Box>
      );
    },
    editable: false
  }));

  useEffect(() => {
    const tempValidRows: GridRowModel[] = [];
    const tempInvalidRows: GridRowModel[] = [];
    const tempErrors: FileErrors = {};

    Object.entries(singleFileData).forEach(([rowKey, rowData], index) => {
      if (typeof rowData === 'object' && rowData !== null) {
        const row = {id: `${fileName}-${index}`, ...rowData} as FileRow;
        let rowErrors = validateRowByFormType(formType, row);

        // Check species/genus condition independently
        if (formType === "species") {
          const speciesField = row["species"];
          const genusField = row["genus"];
          if (speciesField && !genusField) {
            const speciesWords = speciesField.trim().split(/\s+/);
            if (speciesWords.length === 2) {
              const [genus, species] = speciesWords;
              row["genus"] = genus;
              row["species"] = species;
              rowErrors = rowErrors || {};
              rowErrors["genus"] = "Genus was auto-filled based on species field.";
              rowErrors["species"] = "Species field was split into genus and species.";
            }
          }
        }

        if (rowErrors) {
          tempInvalidRows.push(row);
          const errorKey = `row-${index}`;
          tempErrors[errorKey] = rowErrors;
        } else {
          tempValidRows.push(row);
        }
      }
    });

    setValidRows(tempValidRows as GridRowsProp);
    setInvalidRows(tempInvalidRows as GridRowsProp);

    // Set errors in the state
    setErrors((prevErrors: FileCollectionRowSet) => ({
      ...prevErrors,
      [fileName]: tempErrors
    }));
  }, [singleFileData, fileName, formType, setErrors]);

  const processRowUpdate = React.useCallback(
    async (
      newRow: GridRowModel,
      oldRow: GridRowModel
    ): Promise<GridRowModel> => {
      const updatedRow = {...newRow};
      const rowId = `row-${newRow.id}`;
      if (!errorRows[fileName]?.[rowId]) {
        return oldRow;
      }

      const rowErrors = validateRowByFormType(formType, updatedRow);
      if (rowErrors) {
        setErrorRows(prevErrors => ({
          ...prevErrors,
          [fileName]: {...prevErrors[fileName], [updatedRow.id]: rowErrors}
        }));
        Object.keys(rowErrors).forEach(key => {
          updatedRow[key] = null; // Set invalid values to null
        });
      } else {
        setErrorRows(prevErrors => {
          const newErrors = {...prevErrors};
          if (newErrors[fileName]?.[updatedRow.id]) {
            delete newErrors[fileName][updatedRow.id];
          }
          return newErrors;
        });
      }

      setParsedData(prevData => ({
        ...prevData,
        [fileName]: {...prevData[fileName], [updatedRow.id]: updatedRow}
      }));

      return updatedRow;
    },
    [setErrorRows, setParsedData, fileName, formType, validateRowByFormType]
  );

  return (
    <Paper style={{height: '100%', width: '100%'}}>
      {validRows.length > 0 && (
        <StyledDataGrid
          sx={{display: 'flex', flex: 1, width: '100%'}}
          rows={validRows}
          columns={columns}
          processRowUpdate={processRowUpdate}
          pageSizeOptions={[5]}
          initialState={{
            pagination: {
              paginationModel: {
                pageSize: 5,
              },
            },
          }}
          autoHeight
          getRowHeight={() => 'auto'}
        />
      )}
      {invalidRows.length > 0 && (
        <Box sx={{mt: 2}}>
          <Typography color="gold">
            The following rows have been autocorrected to fit the schema.
            Please review the corrected rows and make sure they are correct.
            <br/>
            <span style={{color: 'red'}}>Red-highlighted text indicates invalid values that were detected and will be replaced with NULL.</span>
            <br/>
            <span style={{color: 'lightblue'}}>Light blue text indicates values that were auto-filled or auto-corrected based on other fields.</span>
          </Typography>
          <StyledDataGrid
            sx={{display: 'flex', flex: 1, width: '100%'}}
            rows={invalidRows}
            columns={columns}
            pageSizeOptions={[5]}
            initialState={{
              pagination: {
                paginationModel: {
                  pageSize: 5,
                },
              },
            }}
            autoHeight
            getRowHeight={() => 'auto'}
          />
        </Box>
      )}
    </Paper>
  );
};