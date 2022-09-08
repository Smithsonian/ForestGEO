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

  const display = (fileName: string) => {
    let data: dataStructure[] = [];
    uploadedData.forEach((file: FileWithPath) => {
      if (file.name === fileName)
        parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: function (results: any) {
            try {
              // eslint-disable-next-line array-callback-return
              results.data.map((i: dataStructure) => {
                data.push(i as dataStructure);
              });
              // console.log(data);
              // console.log('data was parsed');
            } catch (e) {
              console.log(e);
            }
          },
        });
    });
    return data;
  };
  return (
    <>
      {Object.keys(errorMessage).map((fileName) => {
        const data: dataStructure[] = display(fileName);
        const errorsList = Object.keys(errorMessage[fileName]).map((row) => {
          return (
            <li key={parseInt(row[0])}>
              Row {row}: {errorMessage[fileName][row]}
            </li>
          );
        });
        console.log('data for the table:', data);
        return (
          <TableContainer component={Paper}>
            <h3>file: {fileName}</h3>
            <Table>
              <TableHead>
                <TableRow>
                  {HEADERS.map((row, index) => {
                    return <TableCell>{row.label}</TableCell>;
                  })}
                </TableRow>
              </TableHead>
              {data.map((data: dataStructure) => {
                return (
                  <TableBody>
                    <TableRow>
                      {HEADERS.map((header) => (
                        <TableCell>{data[header.label]}</TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                );
              })}
              {error && errorMessage && (
                <TableRow className="errorMessage">
                  <TableCell colSpan={HEADERS.length}>
                    <Typography className="errorMessage" component={'span'}>
                      <ul>{errorsList}</ul>
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </Table>
          </TableContainer>
        );
      })}
      <Button label="Return to main page" onClick={() => navigate('/')} />
    </>
  );
}
