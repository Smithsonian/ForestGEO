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

import './ValidationTable.css';

export interface ValidationTableProps {
  /** An array of uploaded data. */
  uploadedData: dataStructure[];
  /** If there is an error this is true. */
  error?: boolean;
  /** If there are errors, these errors are indexed into the uploadedData field. */
  errorMessage?: { [uploadedDataIndex: number]: string };
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
}: ValidationTableProps) {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            {HEADERS.map((row, index) => {
              return <TableCell>{row.label}</TableCell>;
            })}
          </TableRow>
        </TableHead>
        {uploadedData.map((data: dataStructure, index) => {
          return (
            <TableBody>
              <TableRow>
                {HEADERS.map((header) => (
                  <TableCell>{data[header.label]}</TableCell>
                ))}
              </TableRow>
              {error && errorMessage && errorMessage[index] && (
                <TableRow className="errorMessage">
                  <TableCell colSpan={HEADERS.length}>
                    <Typography className="errorMessage">
                      {errorMessage[index]}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          );
        })}
      </Table>
    </TableContainer>
  );
}
