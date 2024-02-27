"use client";

import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {
  Box,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import {CMError, ReviewStates, TableHeadersByFormType} from '@/config/macros';
import {CMIDRow} from "@/components/uploadsystem/uploadparent";
import {CoreMeasurementsRDS} from "@/config/sqlmacros";

interface UploadValidationErrorDisplayProps {
  uploadForm: string;
  allRowToCMID: CMIDRow[];
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
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

    const fetchRowData = async () => {
      let outputRows: CoreMeasurementsRDS[] = [];
    }
    fetchData().catch(console.error);
  }, []);

  const tableHeaders = [
    {key: "tag", header: 'Tag'},
    {key: "stemtag", header: 'Stem Tag'},
    {key: "spcode", header: 'Species Code'},
    {key: "quadrat", header: 'Quadrat'},
    {key: "lx", header: 'X-position'},
    {key: "ly", header: 'Y-position'},
    {key: "dbh", header: 'Diameter at Breast Height'},
    {key: "codes", header: 'Attribute Codes'},
    {key: "hom", header: "Height of Measure"},
    {key: "date", header: 'Date Measured'}
  ];

  if (isLoading) {
    return <CircularProgress/>;
  }

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  return (
    <Box sx={{width: '100%'}}>
      <Typography variant="h6">Core Measurement Errors</Typography>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              {tableHeaders.map(item => (
                <TableCell sx={{width: 'fit-content'}} key={item.key}>{item.header}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {allRowToCMID.map((cmidRow) => {
              const error = cmErrors.find(e => e.CoreMeasurementID === cmidRow.coreMeasurementID);
              const isErroneous = !!error;
              return (
                <>
                  <TableRow key={cmidRow.coreMeasurementID}>
                    {tableHeaders.map(item => (
                      <TableCell key={item.key}>
                        {cmidRow.row[item.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isErroneous && (
                    <TableRow key={`error`} style={{backgroundColor: 'lightcoral'}}>
                      <TableCell colSpan={tableHeaders.length}>
                        {error?.Description}
                      </TableCell>
                    </TableRow>
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
