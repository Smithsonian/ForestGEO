"use client";
import {Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,} from '@mui/material';
import {parse} from 'papaparse';
import React, {useEffect, useState} from 'react';
import {FileWithPath} from 'react-dropzone';
import '@/styles/validationtable.css';
import {FileErrors, TableHeadersByFormType} from "@/config/macros";
import {DataGrid, GridCellParams, GridColDef} from "@mui/x-data-grid";

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

export function DisplayErrorTable({
                                    fileName,
                                    fileData,
                                    errorMessage,
                                    formType,
                                  }: Readonly<DisplayErrorTableProps>) {
  const tableHeaders = TableHeadersByFormType[formType] || [];

  return (
    <TableContainer component={Paper}>
      <h3>file: {fileName}</h3>
      <Table>
        <TableHead>
          <TableRow>
            {tableHeaders.map((header) => (
              <TableCell key={header.label}>{header.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {fileData.data.map((data: DataStructure, rowIndex: number) => (
            <TableRow key={`row-${data.id}`}>
              {tableHeaders.map((header) => {
                const cellKey = `cell-${rowIndex}-${header.label}`;
                const cellData = data[header.label];
                const cellError = errorMessage[fileName] && errorMessage[fileName][rowIndex.toString()];
                if (cellData === '') {
                  return (
                    <TableCell key={cellKey} sx={cellError ? {backgroundColor: 'red'} : undefined}>
                      {cellError ? (
                        <span>{cellData}<br/>{cellError}</span>
                      ) : (
                        cellData
                      )}
                    </TableCell>
                  );
                } else {
                  return (
                    <TableCell key={cellKey} sx={cellError ? {color: 'red', fontWeight: 'bold'} : undefined}>
                      {cellError ? (
                        <span>{cellData}<br/>{cellError}</span>
                      ) : (
                        cellData
                      )}
                    </TableCell>
                  );
                }
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}


export function DisplayErrorGrid({
                                   fileName,
                                   fileData,
                                   errorMessage,
                                   formType,
                                 }: DisplayErrorTableProps): JSX.Element {
  const tableHeaders = TableHeadersByFormType[formType] || [];


  const columns: GridColDef[] = tableHeaders.map((header) => ({
    field: header.label,
    headerName: header.label,
    flex: 1,
    renderCell: (params: GridCellParams) => {
      const rowId = params.id.toString();
      const cellError = errorMessage[fileName]?.[rowId];

      // Safely convert value to a string for rendering
      const cellValue = params.value == null ? '' : params.value.toString();

      return (
        <div style={cellError ? { backgroundColor: 'red', color: 'white' } : undefined}>
          {cellValue}
          {cellError && <div>{cellError}</div>}
        </div>
      );
    },
  }));

  const rows = fileData.data.map((data, index) => ({
    id: data.id ?? index, // Use data.id if available, otherwise use index
    ...data,
  }));

  return (
    <Paper style={{ height: 400, width: '100%' }}>
      <h3>file: {fileName}</h3>
      <DataGrid
        rows={rows}
        columns={columns}
        autoHeight
        disableColumnMenu
        disableColumnSelector
        disableRowSelectionOnClick
        density="compact"
      />
    </Paper>
  );
}

/**
 * Shows a data table with the possibility of showing errors.
 */


export function DisplayParsedData(fileData: { fileName: string; data: DataStructure[] }, formType: string) {
  const tableHeaders = TableHeadersByFormType[formType] || [];

  return (
    <TableContainer component={Paper} key={fileData.fileName}>
      <h3>file: {fileData.fileName}, form: {formType}</h3>
      <Table>
        <TableHead>
          <TableRow>
            {tableHeaders.map((header) => (
              <TableCell key={header.label}>{header.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {fileData.data.map((data: DataStructure) => (
            <TableRow key={data.id}>
              {tableHeaders.map((header) => (
                <TableCell key={`${data.id}-${header.label}`}>
                  {data[header.label]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function ValidationTable({uploadedData, errorMessage, formType}: Readonly<ValidationTableProps>) {
  const [data, setData] = useState<{ fileName: string; data: DataStructure[] }[]>([]);
  const tableHeaders = TableHeadersByFormType[formType] || [];

  useEffect(() => {
    let tempData: { fileName: string; data: DataStructure[] }[] = [];
    uploadedData.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          tempData.push({fileName: file.name, data: results.data});
        },
      });
    });
    setData(tempData);
  }, [uploadedData]);

  const displayError = (fileName: string, data: DataStructure, headerLabel: string, errors: FileErrors) => {
    const errorInfo = errors[fileName]?.[data.id];

    if (errorInfo) {
      const errorMessage = errorInfo;

      if (errorMessage.includes(`Invalid Row Format: Empty Headers`)) {
        const emptyHeadersMessage = errorMessage.split('-')[1].trim();
        if (emptyHeadersMessage.includes(headerLabel)) {
          return (
            <>
              {headerLabel} <br/>
              <span style={{color: 'red', fontWeight: 'bold'}}>Missing Value!</span>
            </>
          );
        }
      } else if (errorMessage.includes(`Invalid DBH Value`)) {
        if (headerLabel === 'DBH') {
          return (
            <>
              {headerLabel} <br/>
              <span style={{color: 'red', fontWeight: 'bold'}}>Invalid DBH Value</span>
            </>
          );
        }
      }
    }

    return data[headerLabel];
  };


  return (
    <>
      {data.map(({fileName, data: fileData}) => (
        <TableContainer component={Paper} key={fileName}>
          <h3>file: {fileName}, form: {formType}</h3>
          <Table>
            <TableHead>
              <TableRow>
                {tableHeaders.map((header) => (
                  <TableCell key={header.label}>{header.label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {fileData.map((data) => (
                <TableRow key={data.id}>
                  {tableHeaders.map((header) => (
                    <TableCell key={`${data.id}-${header.label}`}>
                      {displayError(fileName, data, header.label, errorMessage)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ))}
    </>
  );
}