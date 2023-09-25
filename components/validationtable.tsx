import {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
  Paper,
} from '@mui/material';
import { parse } from 'papaparse';
import React, { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import '@/styles/validationtable.css';
import {tableHeaders} from "@/config/macros";

export interface ValidationTableProps {
  /** An array of uploaded data. */
  uploadedData: FileWithPath[];
  /** If there are errors, these errors are indexed into the uploadedData field. */
  errorMessage: { [fileName: string]: { [currentRow: string]: string } };
  /** The headers for the table. */
  headers: { label: string }[];
  children?: React.ReactNode | React.ReactNode[];
}

export interface DataStructure {
  [key: string]: string;
}

/**
 * Shows a data table with the possibility of showing errors.
 */
export function ValidationErrorTable({ uploadedData, errorMessage, headers, }: ValidationTableProps) {
  let tempData: { fileName: string; data: DataStructure[] }[] = [];
  const initState: { fileName: string; data: DataStructure[] }[] = [];
  const [data, setData] = useState(initState);
  
  const display = () => {
    // eslint-disable-next-line array-callback-return
    uploadedData.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          try {
            // eslint-disable-next-line array-callback-return
            tempData.push({ fileName: file.name, data: results.data });
            setData(tempData);
          } catch (e) {
            console.log(e);
          }
        },
      });
    });
  };
  display();
  let fileData: { fileName: string; data: DataStructure[] };
  
  return (
    <>
      {Object.keys(errorMessage).map((fileName) => {
        fileData = data.find((file) => file.fileName === fileName) || {
          fileName: '',
          data: [],
        };
        return (
          <TableContainer component={Paper} key={fileName}>
            <h3>file: {fileName}</h3>
            
            <Table>
              {errorMessage[fileName]['headers'] ? (
                <></>
              ) : (
                <>
                  <TableHead>
                    <TableRow>
                      {headers.map((row, index) => {
                        return <TableCell key={index}>{row.label}</TableCell>;
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fileData!.data.map((data: DataStructure, rowIdx) => {
                      return (
                        <>
                          <TableRow>
                            {headers.map((header, i) => (
                              <TableCell key={i}>
                                {data[header.label]}
                              </TableCell>
                            ))}
                          </TableRow>
                          
                          {errorMessage[fileName][rowIdx] && (
                            <TableRow className="errorMessage">
                              <TableCell colSpan={headers.length}>
                                <Typography
                                  className="errorMessage"
                                  component={'span'}
                                >
                                  ^ {errorMessage[fileName][rowIdx]}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </>
              )}
            </Table>
          </TableContainer>
        );
      })}
    </>
  );
}

export function DisplayParsedData(fileData: { fileName: string; data: DataStructure[] }) {
  return (
    <>
      <TableContainer component={Paper} key={fileData.fileName}>
        <Table>
          <TableHead>
            <TableRow>
              {tableHeaders.map((row, index) => {
                return <TableCell key={index}>{row.label}</TableCell>;
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {fileData!.data.map((data: DataStructure) => {
              return (
                <>
                  <TableRow>
                    {tableHeaders.map((header, i) => (
                      <TableCell key={i}>
                        {data[header.label]}
                      </TableCell>
                    ))}
                  </TableRow>
                </>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}