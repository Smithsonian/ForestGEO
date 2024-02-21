"use client";

import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {
  Box,
  Button,
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
import {CMError, FileCollectionRowSet, FileRow, ReviewStates} from '@/config/macros';
import {saveAs} from 'file-saver';
import {Stack} from "@mui/joy";
import {CMIDRow} from "@/components/uploadsystem/uploadparent";

interface UploadValidationErrorDisplayProps {
  allRowToCMID: CMIDRow[];
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
}

const UploadValidationErrorDisplay: React.FC<UploadValidationErrorDisplayProps> = ({
                                                                                     allRowToCMID,
                                                                                     setReviewState
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

  const renderRowData = (rowData: FileRow) => {
    return (
      <Stack direction={"column"}>
        <Typography key={"tag"}>
          <b>Identification: </b>{`Tree Tag: ${rowData.tag}, \tStem Tag: ${rowData.stemtag}`}
        </Typography>
        <Typography key={"measurements"}>
          <b>Measurement: </b>{`DBH: ${rowData.dbh} at \tHOM: ${rowData.hom}`}
        </Typography>
        <Typography key={"date"}>
          <b>Measurement Date: </b>{`${rowData.date}`}
        </Typography>
      </Stack>
    );
  };

  const saveDataToFile = () => {
    const dataStr = JSON.stringify(cmErrors, null, 2);
    const blob = new Blob([dataStr], {type: "application/json"});
    saveAs(blob, `validationErrors_${new Date().toString()}.json`);
  };

  const printTable = () => {
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow?.document.write('<html><head><title>Print CM Errors</title>');
    printWindow?.document.write('</head><body >');
    printWindow?.document.write(document?.getElementById('cmErrorTable')!.outerHTML);
    printWindow?.document.write('</body></html>');
    printWindow?.document.close();
    printWindow?.print();
  };

  if (isLoading) {
    return <CircularProgress/>;
  }

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  return (
    <Box sx={{width: '100%', flexDirection: 'column'}}>
      <Typography variant="h6">Core Measurement Errors</Typography>
      <Button onClick={saveDataToFile} variant="outlined" sx={{marginRight: 1}}>Save Data</Button>
      <Button onClick={printTable} variant="outlined">Print Table</Button>
      <TableContainer component={Paper} id="cmErrorTable">
        <Table aria-label="cm errors table">
          <TableHead>
            <TableRow>
              <TableCell>CoreMeasurement ID</TableCell>
              <TableCell>Error Description</TableCell>
              <TableCell>Error Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cmErrors.map((error) => {
              const rowData = allRowToCMID.find(item => item.coreMeasurementID === error.CoreMeasurementID)?.row;
              return (
                <TableRow key={error.CoreMeasurementID}>
                  <TableCell>{error.CoreMeasurementID}</TableCell>
                  <TableCell>{error.Description}</TableCell>
                  <TableCell>
                    {rowData ? renderRowData(rowData) : 'Row data not found'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction={"column"}>
        <Typography variant={"h5"}>Press the Continue button to continue to the validation update menu.</Typography>
        <Typography variant={"h6"}>In order to complete the validation process, all rows that passed validation must be
          updated to reflect this.</Typography>
        <Button sx={{width: 'fit-content'}} onClick={() => setReviewState(ReviewStates.UPDATE)}>Continue</Button>
      </Stack>
    </Box>
  );
};

export default UploadValidationErrorDisplay;
