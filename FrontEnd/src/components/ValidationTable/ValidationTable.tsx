import {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
  Paper,
  TableFooter,
} from '@mui/material';
import { parse } from 'papaparse';
import { useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import Button from '../Button';
import './ValidationTable.css';

export interface ValidationTableProps {
  /** An array of uploaded data. */
  uploadedData: FileWithPath[];
  /** If there is an error this is true. */
  error: boolean;
  /** If there are errors, these errors are indexed into the uploadedData field. */
  errorMessage: { [fileName: string]: { [currentRow: string]: string } };
  children?: React.ReactNode | React.ReactNode[];
}

export interface dataStructure {
  [key: string]: string;
}

// @todo: are these headers really fixed?
// @todo: Maybe these headers should be passed in as a prop?
const HEADERS = [
  { label: 'Tag' },
  { label: 'Subquadrat' },
  { label: 'SpCode' },
  { label: 'DBH' },
  { label: 'Htmeas' },
  { label: 'Codes' },
  { label: 'Comments' },
];

/**
 * Shows a data table with the possibility of showing errors.
 */
export default function ValidationTable({
  uploadedData,
  error,
  errorMessage,
}: ValidationTableProps): JSX.Element {
  let navigate = useNavigate();
  let tempData: { fileName: string; data: dataStructure[] }[] = [];
  const initState: { fileName: string; data: dataStructure[] }[] = [];
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
  let fileData: { fileName: string; data: dataStructure[] };

  return (
    <>
      {Object.keys(errorMessage).map((fileName) => {
        fileData = data.find((file) => file.fileName === fileName) || {
          fileName: '',
          data: [],
        };
        return (
          <TableContainer component={Paper}>
            <h3>file: {fileName}</h3>

            <Table>
              {errorMessage[fileName]['headers'] ? (
                <></>
              ) : (
                <>
                  <TableHead>
                    <TableRow>
                      {HEADERS.map((row, index) => {
                        return <TableCell key={index}>{row.label}</TableCell>;
                      })}
                    </TableRow>
                  </TableHead>

                  {fileData!.data.map((data: dataStructure) => {
                    return (
                      <TableBody>
                        <TableRow>
                          {HEADERS.map((header, i) => (
                            <TableCell key={i}>{data[header.label]}</TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    );
                  })}
                </>
              )}
              {errorMessage && (
                <TableFooter>
                  <TableRow className="errorMessage">
                    <TableCell colSpan={HEADERS.length}>
                      <Typography className="errorMessage" component={'span'}>
                        <ul>
                          {Object.keys(errorMessage[fileName]).map((row) => {
                            return (
                              <li key={parseInt(row[0])}>
                                Row {row}: {errorMessage[fileName][row]}
                              </li>
                            );
                          })}
                        </ul>
                      </Typography>
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableContainer>
        );
      })}
      <Button label="Return to main page" onClick={() => navigate('/')} />
    </>
  );
}
