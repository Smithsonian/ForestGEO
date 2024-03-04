"use client";

import React, {useEffect, useState} from 'react';
import {
  Box,
  Pagination,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import {CMError, FileRow, formatDate, ReviewStates, UploadValidationErrorDisplayProps} from '@/config/macros';
import {DetailedCMIDRow} from "@/components/uploadsystem/uploadparent";
import {Button, CircularProgress} from '@mui/joy';

function isFileRowKey(key: string, cmidRow: DetailedCMIDRow): boolean {
  return key in cmidRow.row;
}

interface FileGroupedRows {
  [fileName: string]: DetailedCMIDRow[];
}

const UploadValidationErrorDisplay: React.FC<UploadValidationErrorDisplayProps> = ({
                                                                                     uploadForm,
                                                                                     allRowToCMID,
                                                                                     setReviewState,
                                                                                     cmErrors,
                                                                                     setCMErrors
                                                                                   }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [groupedRows, setGroupedRows] = useState<FileGroupedRows>({});
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    // Group rows by fileName
    const grouped: FileGroupedRows = allRowToCMID.reduce((acc, row) => {
      acc[row.fileName] = acc[row.fileName] || [];
      acc[row.fileName].push(row);
      return acc;
    }, {} as FileGroupedRows);
    setGroupedRows(grouped);
  }, [allRowToCMID]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/validations/validationerrordisplay');
        if (!response.ok) {
          throw new Error('Error fetching CMError data');
        }
        const data = await response.json();
        setCMErrors(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData().catch(console.error);
  }, []);

  const handleChangePage = (event: React.ChangeEvent<unknown>, newPage: number) => {
    setCurrentPage(newPage);
  };

  // Updated tableHeaders to include new fields
  const tableHeaders = [
    {key: "tag", header: 'Tree'},
    {key: "stemtag", header: 'Stem'},
    {key: 'speciesName', header: 'Species'}, // for detailedCMIDRow
    {key: "plotName", header: 'Plot'}, // for detailedCMIDRow
    {key: "plotCensusNumber", header: 'Plot Census'}, // for detailedCMIDRow
    {key: "quadratName", header: 'Quadrat'}, // for detailedCMIDRow
    {key: "censusStart", header: 'Census Start'}, // for detailedCMIDRow
    {key: "date", header: 'Date'},
    {key: "censusEnd", header: 'Census End'}, // for detailedCMIDRow
    {key: "lx", header: 'X-coord'},
    {key: "ly", header: 'Y-coord'},
    {key: "personnelName", header: 'Personnel'},  // for detailedCMIDRow
    {key: "dbh", header: 'Diameter at Breast Height'},
    {key: "hom", header: "Height of Measure"},
    {key: "codes", header: 'Attributes'},
  ];

  const errorMapping: { [key: string]: string[] } = {
    '1': ["codes"],
    '2': ["dbh"],
    '3': ["hom"],
    '4': ["tag", "stemtag"],
    '5': ["tag", "stemtag", "quadratName"],
    '6': ["lx", "ly"],
    '7': ["speciesName"],
    '8': ["date"],
    '9': ["tag", "stemtag", "plotCensusNumber"],
    '10': ["tag", "stemtag", "plotCensusNumber"],
    '11': ["quadratName"],
    '12': ["speciesName"],
    '13': ["dbh"],
    '14': ["dbh"],
    '15': ["tag"],
    '16': ["quadratName"],
  };

  const getCellStyles = (cmError: CMError, key: string) => {
    if (!cmError) return {};
    let shouldHighlight = false;
    cmError.ValidationErrorIDs.forEach(errorID => {
      const errorFields = errorMapping[errorID.toString()] || [];
      if (errorFields.includes(key)) {
        shouldHighlight = true;
      }
    });
    return shouldHighlight ? {backgroundColor: '#eaf436', color: 'black', fontWeight: 'bold'} : {};
  };

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress/>
      </Box>
    );
  }

  const renderTableCell = (cmidRow: DetailedCMIDRow, itemKey: keyof DetailedCMIDRow | keyof FileRow, cmError: CMError | undefined) => {
    let cellValue;
    const itemKeyString = itemKey.toString(); // Convert itemKey to string

    if (isFileRowKey(itemKeyString, cmidRow)) {
      // 'itemKeyString' is now guaranteed to be a string
      cellValue = cmidRow.row[itemKeyString as keyof FileRow];
    } else {
      // 'itemKeyString' is used as a string key for DetailedCMIDRow
      cellValue = cmidRow[itemKeyString as keyof DetailedCMIDRow];
    }

    const cellStyle = cmError ? getCellStyles(cmError, itemKeyString) : undefined;
    return (
      <TableCell key={itemKeyString} style={cellStyle}>
        {itemKey === 'date' ? formatDate(cellValue) : cellValue}
      </TableCell>
    );
  };

  const handleProceedToUpdate = () => {
    setReviewState(ReviewStates.UPDATE);
  };


  const fileNames = Object.keys(groupedRows);
  const currentFileRows = groupedRows[fileNames[currentPage - 1]] || [];
  return (
    <Box sx={{width: '100%', p: 2, display: 'flex', flex: 1, flexDirection: 'column'}}>
      <Typography variant="h6">Core Measurement Errors</Typography>
      <Pagination count={fileNames.length} page={currentPage} onChange={handleChangePage}/>
      <TableContainer component={Paper}>
        <Table sx={{tableLayout: 'auto'}}>
          <TableHead>
            <TableRow>
              {tableHeaders.map(item => (
                <TableCell key={item.key}>{item.header}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {currentFileRows.map((cmidRow, rowIndex) => {
              const cmError = cmErrors.find(e => e.CoreMeasurementID === cmidRow.coreMeasurementID);
              const isErroneous = !!cmError;

              return (
                <>
                  <TableRow key={rowIndex}>
                    {tableHeaders.map(item => renderTableCell(cmidRow, item.key, cmError))}
                  </TableRow>
                  {isErroneous && cmError && (
                    <>
                      {cmError.Descriptions.map((description) => {
                        return (
                          <TableRow key={`error-${cmidRow.coreMeasurementID}`}
                                    sx={{backgroundColor: 'crimson', color: 'white', fontWeight: 'bold'}}>
                            <TableCell colSpan={tableHeaders.length}>
                              {description}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Button
        variant="outlined"
        color="primary"
        onClick={handleProceedToUpdate}
        sx={{ mt: 2, width: 'fit-content' }}
      >
        Proceed to Update
      </Button>
    </Box>
  );
};

export default UploadValidationErrorDisplay;
