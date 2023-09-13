// import {Table, TableBody, TableCell, TableRow} from "@nextui-org/react";
import Table from '@mui/joy/Table';
import {parse} from 'papaparse';
import {useState} from 'react';
import {FileWithPath} from 'react-dropzone';
import '@/styles/validationtable.css';
import Typography from "@mui/joy/Typography";

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
  const [data, setData] = useState(initState);
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
  let fileData: {
    fileName: string;
    data: dataStructure[]
  };
  
  return (
    <>
      {Object.keys(errorMessage).map((fileName) => {
        fileData = data.find((file) => file.fileName === fileName) || {
          fileName: '',
          data: [],
        };
        return (
          <><h3>file: {fileName}</h3><Table>
            {errorMessage[fileName]['headers'] ? (
              <></>
            ) : (
              <>
                <thead>
                  <tr>
                    {headers.map((row, index) => {
                      return <th colSpan={headers.length} key={index}>{row.label}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {fileData!.data.map((data: dataStructure, rowIdx) => {
                    return (
                      <>
                        <tr>
                          {headers.map((header, i) => (
                            <td colSpan={headers.length} key={i}>
                              {data[header.label]}
                            </td>
                          ))}
                        </tr>
                        
                        {errorMessage[fileName][rowIdx] && (
                          <tr className="errorMessage">
                            <td colSpan={headers.length}>
                              <Typography
                                className="errorMessage"
                                component={'span'}
                              >
                                ^ {errorMessage[fileName][rowIdx]}
                              </Typography>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </>
            )}
          </Table></>
        );
      })}
    </>
  );
}