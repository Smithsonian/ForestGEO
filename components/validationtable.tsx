import {Table, TableBody, TableCell, TableColumn, TableHeader, TableRow} from "@nextui-org/react";
import {parse} from 'papaparse';
import React, {useState} from 'react';
import {FileWithPath} from 'react-dropzone';
import '@/styles/validationtable.css';

export interface ValidationTableProps {
  /** An array of uploaded data. */
  uploadedData: FileWithPath[];
  /** If there are errors, these errors are indexed into the uploadedData field. */
  errorMessage: { [fileName: string]: { [currentRow: string]: string } };
  /** The headers for the table. */
  headers: { label: string }[];
  children?: React.ReactNode | React.ReactNode[];
}

export interface dataStructure {
  [key: string]: string;
}

/**
 * Shows a data table with the possibility of showing errors.
 */
export default function ValidationTable({
                                          uploadedData,
                                          errorMessage,
                                          headers,
                                        }: ValidationTableProps) {
  let tempData: {
    fileName: string;
    data: dataStructure[]
  }[] = [];
  const initState: {
    fileName: string;
    data: dataStructure[]
  }[] = [];
  let fileData: {
    fileName: string;
    data: dataStructure[]
  };
  const [data, setData] = useState(initState);
  try {
    uploadedData.forEach((file: FileWithPath) => {
      parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function (results: any) {
          try {
            // eslint-disable-next-line array-callback-return
            tempData.push({fileName: file.name, data: results.data});
            setData(tempData);
          } catch (e) {
            console.log(e);
          }
        },
      });
    });
    return (
      <>
        {Object.keys(errorMessage).map((fileName) => {
          fileData = data.find((file) => file.fileName === fileName) || {
            fileName: '',
            data: [],
          };
          return (
            <>
              <h3>file: {fileName}</h3>
              {!errorMessage[fileName]['headers'] && (
                <>
                  <Table>
                    <TableHeader>
                      {headers.map((row, index) => (<TableColumn key={index}>{row.label}</TableColumn>))}
                    </TableHeader>
                    <TableBody>
                      {fileData!.data.map((data: dataStructure, rowIdx) => {
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
                                <span
                                  className="errorMessage"
                                >
                                  ^ {errorMessage[fileName][rowIdx]}
                                </span>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          );
        })}
      </>
    );
  } catch (err: any) {
    console.log(err.message);
    return <><h1>{err.message}</h1></>
  }
}