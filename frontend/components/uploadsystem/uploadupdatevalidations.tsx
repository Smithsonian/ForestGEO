"use client";

import React, {Dispatch, SetStateAction, useEffect, useState} from "react";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import {Plot, ReviewStates} from "@/config/macros";
import CircularProgress from "@mui/joy/CircularProgress";
import {Checkbox} from "@mui/joy";
import {CensusRDS} from "@/config/sqlmacros";

export interface UploadUpdateValidationsProps {
  validationPassedCMIDs: number[];
  setValidationPassedCMIDs: Dispatch<SetStateAction<number[]>>;
  validationPassedRowCount: number;
  setValidationPassedRowCount: Dispatch<SetStateAction<number>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  allRowToCMID: { fileName: string; coreMeasurementID: number; stemTag: string; treeTag: string; }[];
  handleReturnToStart: () => Promise<void>;
}

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {
    currentPlot, currentCensus, validationPassedCMIDs,
    setValidationPassedCMIDs,
    setValidationPassedRowCount,
    allRowToCMID, handleReturnToStart
  } = props;
  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id}&censusID=${currentCensus?.plotCensusNumber}`);
    const result = await response.json();
    setValidationPassedCMIDs(result.updatedIDs);
    setValidationPassedRowCount(result.rowsValidated);
    setIsUpdateValidationComplete(true);
  }

  useEffect(() => {
    updateValidations().catch(console.error);
  }, []);

  return (
    <Box sx={{width: '100%', p: 2}}>
      <Typography variant="h6">Update Validation-Passed Rows</Typography>
      {!isUpdateValidationComplete ? (
        <CircularProgress/>
      ) : (
        <Box sx={{width: '100%', p: 2}}>
          <Typography variant="h6">CoreMeasurement Validation Status</Typography>
          <TableContainer component={Paper}>
            <Table aria-label="validation status table">
              <TableHead>
                <TableRow>
                  <TableCell>File Name</TableCell>
                  <TableCell>CoreMeasurementID</TableCell>
                  <TableCell>StemTag</TableCell>
                  <TableCell>TreeTag</TableCell>
                  <TableCell>Validated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allRowToCMID.map((obj, index) => (
                  <TableRow key={index}>
                    <TableCell>{obj.fileName}</TableCell>
                    <TableCell>{obj.coreMeasurementID}</TableCell>
                    <TableCell>{obj.stemTag}</TableCell>
                    <TableCell>{obj.treeTag}</TableCell>
                    <TableCell>
                      <Checkbox
                        checked={validationPassedCMIDs.includes(obj.coreMeasurementID)}
                        disabled
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button onClick={handleReturnToStart} sx={{width: 'fit-content'}}>
            Return to Upload Start
          </Button>
        </Box>
      )}
    </Box>
  );

}