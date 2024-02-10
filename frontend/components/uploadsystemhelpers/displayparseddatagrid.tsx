"use client";
import {Box, Paper, Tooltip, Typography,} from '@mui/material';
import React, {Dispatch, SetStateAction} from 'react';
import {FileWithPath} from 'react-dropzone';
import '@/styles/validationtable.css';
import {
  FileCollectionRowSet,
  FileErrors,
  FileRow,
  RequiredTableHeadersByFormType,
  TableHeadersByFormType
} from "@/config/macros";
import {GridCellParams, GridColDef, GridRowModel, GridRowsProp} from "@mui/x-data-grid";
import {StyledDataGrid} from '@/config/sqlmacros';

export interface ValidationTableProps {
  /** An array of uploaded data. */
  uploadedData: FileWithPath[];
  /** If there are errors, these errors are indexed into the uploadedData field. */
  errorMessage: { [fileName: string]: { [currentRow: string]: string } };
  /** The headers for the table. */
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

type RowValidationErrors = {
  [key: string]: string;
};

const validateRow = (row: FileRow, formType: string): RowValidationErrors | null => {
  const errors: RowValidationErrors = {};
  const requiredHeaders = RequiredTableHeadersByFormType[formType];

  // Check for required headers
  requiredHeaders.forEach(header => {
    const value = row[header.label];
    if (value === null || value === undefined || value === "") {
      errors[header.label] = "This field is required.";
    }
  });

  // Additional validation for DBH if present
  if ("DBH" in row) {
    const dbhValue = parseFloat(row["DBH"]);
    if (isNaN(dbhValue) || dbhValue <= 1.0) {
      errors["DBH"] = "DBH must be a decimal value greater than 1.0";
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
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

export const DisplayParsedDataGridTooltip: React.FC<DisplayParsedDataProps> = (props: Readonly<DisplayParsedDataProps>) => {
  const {
    parsedData, setParsedData, errors,
    errorRows, setErrorRows, fileName, formType
  } = props;
  const singleFileData = parsedData[fileName] || {};

  const tableHeaders = TableHeadersByFormType[formType] || [];
  // Update the GridColDef to match your actual DataGrid library import
  const columns: GridColDef[] = tableHeaders.map((header) => ({
    field: header.label,
    headerName: header.label,
    flex: 1,
    renderCell: (params: GridCellParams) => {
      // Extract the numeric index from the id and construct the error key
      const rowIndex = params.id.toString().split('-')[1];
      const errorKey = `row-${rowIndex}`;
      const cellError = errors[fileName]?.[errorKey]?.[header.label];

      // Debugging log
      // console.log('params: ', params);
      // console.log(`Rendering cell - row: ${errorKey}, field: ${header.label}, error: ${cellError}`);

      // Render the cell value and error message
      return (
        <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
          {cellError ? (
            <Tooltip title={cellError} enterDelay={300} leaveDelay={200} componentsProps={{
              tooltip: {
                sx: {
                  fontSize: '1.25rem', // Custom size
                  color: 'error.main',
                  mt: 0.5,
                  flex: 1,
                  width: 'fit-content',
                },
              },
            }}>
              <Typography sx={{color: 'error.main', fontSize: '1rem', mt: 0.5}}>
                {params.value !== undefined ? params.value?.toString() : ''}
              </Typography>
            </Tooltip>
          ) : (
            <Typography>{params.value !== undefined ? params.value?.toString() : ''}</Typography>
          )}
        </Box>
      );
    },
    editable: false,
  }));

  let tempRows: any[] = [];

  Object.entries(singleFileData).forEach(([rowKey, rowData], index) => {
    if (typeof rowData === 'object' && rowData !== null) {
      const row = {id: `${fileName}-${index}`, ...rowData};
      tempRows.push(row);
    }
  });

  const processRowUpdate = React.useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
      const updatedRow = {...newRow};
      const rowId = `row-${newRow.id}`;
      if (!errorRows[fileName]?.[rowId]) {
        // If no errors for this row, do not allow updates
        return oldRow;
      }
      // Validate the updated row and update error state if necessary
      const rowErrors = validateRow(updatedRow, formType); // Implement validateRow to check for errors
      if (rowErrors) {
        setErrorRows(prevErrors => ({
          ...prevErrors,
          [fileName]: {...prevErrors[fileName], [updatedRow.id]: rowErrors},
        }));
      } else {
        // Remove errors for this row if they exist
        setErrorRows(prevErrors => {
          const newErrors = {...prevErrors};
          if (newErrors[fileName]?.[updatedRow.id]) {
            delete newErrors[fileName][updatedRow.id];
          }
          return newErrors;
        });
      }

      // Update the parsed data state
      setParsedData(prevData => ({
        ...prevData,
        [fileName]: {...prevData[fileName], [updatedRow.id]: updatedRow},
      }));

      return updatedRow;
    }, [setErrorRows, setParsedData, fileName, formType, validateRow]);

  let rows: GridRowsProp = tempRows;

  return (
    <Paper style={{height: '100%', width: '100%'}}>
      <StyledDataGrid
        sx={{display: 'flex', flex: 1, width: '100%'}}
        rows={rows}
        columns={columns}
        processRowUpdate={processRowUpdate}
        pageSizeOptions={[5, 10]}
        autoHeight
      />
    </Paper>
  );
};
export const DisplayParsedDataGridInline: React.FC<DisplayParsedDataProps> = (props: Readonly<DisplayParsedDataProps>) => {
  const {
    parsedData, setParsedData, errors,
    errorRows, setErrorRows, fileName, formType
  } = props;
  const singleFileData = parsedData[fileName] || {};

  const tableHeaders = TableHeadersByFormType[formType] || [];
  // Update the GridColDef to match your actual DataGrid library import
  const columns: GridColDef[] = tableHeaders.map((header) => ({
    field: header.label,
    headerName: header.label,
    flex: 1,
    renderCell: (params: GridCellParams) => {
      // Extract the numeric index from the id and construct the error key
      const rowIndex = params.id.toString().split('-')[1];
      const errorKey = `row-${rowIndex}`;
      const cellError = errors[fileName]?.[errorKey]?.[header.label];

      // Render the cell value and error message
      return (
        <Box sx={{display: 'flex', flex: 1, flexDirection: 'column', marginY: 1.5}}>
          {cellError ? (
            <><Typography sx={{
              whiteSpace: 'normal',
              lineHeight: 'normal'
            }}>{params.value !== undefined ? params.value?.toString() : ''}</Typography><Typography
              sx={{color: 'error.main', fontSize: '0.75rem', mt: 0.5, whiteSpace: 'normal', lineHeight: 'normal'}}>
              {cellError}
            </Typography></>
          ) : (
            <Typography sx={{
              whiteSpace: 'normal',
              lineHeight: 'normal'
            }}>{params.value !== undefined ? params.value?.toString() : ''}</Typography>
          )}
        </Box>
      );
    },
    editable: false,
  }));

  let tempRows: any[] = [];

  Object.entries(singleFileData).forEach(([rowKey, rowData], index) => {
    if (typeof rowData === 'object' && rowData !== null) {
      const row = {id: `${fileName}-${index}`, ...rowData};
      tempRows.push(row);
    }
  });

  const processRowUpdate = React.useCallback(
    async (newRow: GridRowModel, oldRow: GridRowModel): Promise<GridRowModel> => {
      const updatedRow = {...newRow};
      const rowId = `row-${newRow.id}`;
      if (!errorRows[fileName]?.[rowId]) {
        // If no errors for this row, do not allow updates
        return oldRow;
      }
      // Validate the updated row and update error state if necessary
      const rowErrors = validateRow(updatedRow, formType); // Implement validateRow to check for errors
      if (rowErrors) {
        setErrorRows(prevErrors => ({
          ...prevErrors,
          [fileName]: {...prevErrors[fileName], [updatedRow.id]: rowErrors},
        }));
      } else {
        // Remove errors for this row if they exist
        setErrorRows(prevErrors => {
          const newErrors = {...prevErrors};
          if (newErrors[fileName]?.[updatedRow.id]) {
            delete newErrors[fileName][updatedRow.id];
          }
          return newErrors;
        });
      }

      // Update the parsed data state
      setParsedData(prevData => ({
        ...prevData,
        [fileName]: {...prevData[fileName], [updatedRow.id]: updatedRow},
      }));

      return updatedRow;
    }, [setErrorRows, setParsedData, fileName, formType, validateRow]);

  let rows: GridRowsProp = tempRows;

  return (
    <Paper style={{height: '100%', width: '100%'}}>
      <StyledDataGrid
        sx={{display: 'flex', flex: 1, width: '100%'}}
        rows={rows}
        columns={columns}
        processRowUpdate={processRowUpdate}
        pageSizeOptions={[5, 10]}
        autoHeight
        getRowHeight={() => 'auto'}
      />
    </Paper>
  );
};