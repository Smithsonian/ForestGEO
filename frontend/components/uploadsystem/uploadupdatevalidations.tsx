"use client";

import React, {Dispatch, SetStateAction, useEffect, useState} from "react";
import {Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from "@mui/material";
import {UploadFireProps} from "@/config/macros";
import CircularProgress from "@mui/joy/CircularProgress";
import {UploadValidationProps} from "@/components/uploadsystem/uploadvalidation";
import {Checkbox} from "@mui/joy";

export interface UploadUpdateValidationsProps extends UploadValidationProps {
  validationPassedCMIDs: number[];
  setValidationPassedCMIDs: Dispatch<SetStateAction<number[]>>;
  validationPassedRowCount: number;
  setValidationPassedRowCount: Dispatch<SetStateAction<number>>;
}

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {currentPlot, currentCensus, validationPassedCMIDs,
    setValidationPassedCMIDs, validationPassedRowCount,
    setValidationPassedRowCount,
    allRowToCMID} = props;
  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`);
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
        <Box sx={{ width: '100%', p: 2 }}>
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
        </Box>
      )}
    </Box>
  );

}