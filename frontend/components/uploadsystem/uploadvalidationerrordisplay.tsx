"use client";

import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import {CMError, formatDate, ReviewStates} from '@/config/macros';
import { DetailedCMIDRow } from "@/components/uploadsystem/uploadparent";
import { CoreMeasurementsRDS } from "@/config/sqlmacros";
import { CircularProgress } from '@mui/joy';

interface UploadValidationErrorDisplayProps {
  uploadForm: string;
  allRowToCMID: DetailedCMIDRow[]; // Updated to use DetailedCMIDRow[]
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

function isFileRowKey(key: string, cmidRow: DetailedCMIDRow): boolean {
  return key in cmidRow.row;
}

const UploadValidationErrorDisplay: React.FC<UploadValidationErrorDisplayProps> = ({
                                                                                     uploadForm,
                                                                                     allRowToCMID,
                                                                                     setReviewState,
                                                                                   }) => {
  const [cmErrors, setCMErrors] = useState<CMError[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

  // Updated tableHeaders to include new fields
  const tableHeaders = [
    { key: "tag", header: 'Tree' },
    { key: "stemtag", header: 'Stem' },
    { key: 'speciesName', header: 'Species'}, // for detailedCMIDRow
    { key: "plotName", header: 'Plot' }, // for detailedCMIDRow
    { key: "plotCensusNumber", header: 'Plot Census' }, // for detailedCMIDRow
    { key: "quadratName", header: 'Quadrat' }, // for detailedCMIDRow
    { key: "censusStart", header: 'Census Start' }, // for detailedCMIDRow
    { key: "date", header: 'Date' },
    { key: "censusEnd", header: 'Census End' }, // for detailedCMIDRow
    { key: "lx", header: 'X-coord' },
    { key: "ly", header: 'Y-coord' },
    { key: "personnelName", header: 'Personnel' },  // for detailedCMIDRow
    { key: "dbh", header: 'Diameter at Breast Height' },
    { key: "hom", header: "Height of Measure" },
    { key: "codes", header: 'Attributes' },
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
    const errorFields = errorMapping[cmError.ValidationErrorIDs.toString()] || [];
    if (errorFields.includes(key)) {
      return { backgroundColor: '#eaf436', color: 'black', fontWeight: 'bold' };  // Highlight erroneous cells
    }
    return {};
  };

  if (isLoading) {
    return <CircularProgress size={"lg"}/>;
  }

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h6">Core Measurement Errors</Typography>
      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: 'auto' }}>
          <TableHead>
            <TableRow>
              {tableHeaders.map(item => (
                <TableCell key={item.key}>{item.header}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {allRowToCMID.map((cmidRow, rowIndex) => {
              const cmError = cmErrors.find(e => e.CoreMeasurementID === cmidRow.coreMeasurementID);
              const isErroneous = !!cmError;

              return (
                <>
                  <TableRow key={rowIndex}>
                    {tableHeaders.map((item, cellIndex) => {
                      let cellValue;
                      if (isFileRowKey(item.key, cmidRow)) {
                        cellValue = cmidRow.row[item.key];
                      } else {
                        cellValue = (cmidRow as any)[item.key];
                      }
                      return (
                        <TableCell key={cellIndex} style={cmError ? getCellStyles(cmError, item.key) : undefined}>
                          {item.key === 'date' ? formatDate(cellValue) : cellValue}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {isErroneous && (
                    <>
                      {cmError?.Descriptions.map((description) => {
                        return (
                          <TableRow key={`error-${cmidRow.coreMeasurementID}`} sx={{ backgroundColor: 'crimson', color: 'white', fontWeight: 'bold' }}>
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
    </Box>
  );
};

export default UploadValidationErrorDisplay;
