import React, { useEffect, useState } from "react";
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
import CircularProgress from "@mui/joy/CircularProgress";
import {Checkbox} from "@mui/joy";
import {ReviewStates, UploadUpdateValidationsProps} from "@/config/macros";

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {
    currentPlot, currentCensus,
    setReviewState,
    allRowToCMID, handleReturnToStart
  } = props;

  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const [validationPassedCMIDs, setValidationPassedCMIDs] = useState<number[]>([]);
  const [numValidations, setNumValidations] = useState(0);

  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`);

    if (!response.ok) {
      console.error('Failed to update validations');
      setIsUpdateValidationComplete(true);
      return;
    }

    const result = await response.json();
    setValidationPassedCMIDs(result.updatedIDs);
    setNumValidations(result.rowsValidated)
    setIsUpdateValidationComplete(true);
  };

  useEffect(() => {
    updateValidations().catch(console.error);
  }, []);

  const handleCompleteUpload = () => {
    // Transition to the COMPLETE review state
    setReviewState(ReviewStates.UPLOAD_AZURE);
  };

  return (
    <Box sx={{width: '100%', p: 2}}>
      <Typography variant="h6">Update Validation-Passed Rows</Typography>
      {!isUpdateValidationComplete ? (
        <CircularProgress/>
      ) : (
        <Box sx={{width: '100%', p: 2, flexDirection: 'column', display: 'flex', flex: 1}}>
          <Typography variant="h6">CoreMeasurement Validation Status</Typography>
          <br />
          <Typography variant={"body1"}>Rows Updated: ${numValidations}</Typography>
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
                {allRowToCMID.map(({coreMeasurementID, fileName, row}, index) => (
                  <TableRow key={`${coreMeasurementID}-${index}`}>
                    <TableCell>{fileName}</TableCell>
                    <TableCell>{coreMeasurementID}</TableCell>
                    <TableCell>{row.stemtag}</TableCell>
                    <TableCell>{row.tag}</TableCell>
                    <TableCell>
                      <Checkbox
                        checked={validationPassedCMIDs.includes(coreMeasurementID)}
                        disabled
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button onClick={handleCompleteUpload} sx={{width: 'fit-content', mt: 2}}>
            Continue to Azure Upload
          </Button>
        </Box>
      )}
    </Box>
  );
}
