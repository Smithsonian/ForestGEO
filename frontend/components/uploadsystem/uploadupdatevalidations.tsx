import React, {useEffect, useRef, useState} from "react";
import {Box, Typography} from "@mui/material";
import CircularProgress from "@mui/joy/CircularProgress";
import {ReviewStates, UploadUpdateValidationsProps} from "@/config/macros";

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {
    currentPlot, currentCensus,
    setReviewState,
    allRowToCMID, handleReturnToStart
  } = props;

  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const [numValidations, setNumValidations] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const hasUpdated = useRef(false);

  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id.toString()}&censusID=${currentCensus?.censusID.toString()}`);
    const result = await response.json();
    setNumValidations(result.rowsValidated);
    setIsUpdateValidationComplete(true);
  };

  useEffect(() => {
    if (!hasUpdated.current) {
      updateValidations().catch(console.error);
      hasUpdated.current = true;
    }
  }, []);

  // Effect for handling countdown and state transition
  useEffect(() => {
    let timer: number; // Declare timer as a number

    if (isUpdateValidationComplete && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
      // Use 'window.setTimeout' and type assertion to treat the return as a number
    } else if (countdown === 0) {
      setReviewState(ReviewStates.UPLOAD_AZURE);
    }

    return () => clearTimeout(timer); // Clear timeout using the timer variable
  }, [countdown, setReviewState, isUpdateValidationComplete]);

  return (
    <Box sx={{width: '100%', p: 2}}>
      <Typography variant="h6">Update Validation-Passed Rows</Typography>
      {!isUpdateValidationComplete ? (
        <Box sx={{width: '100%', p: 2, flexDirection: 'column', display: 'flex', flex: 1}}>
          <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <CircularProgress/>
            <Typography>Updating Passed Rows</Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{width: '100%', p: 2, flexDirection: 'column', display: 'flex', flex: 1}}>
          <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <CircularProgress/>
            <Typography>{countdown} seconds remaining</Typography>
          </Box>
          <Typography variant="h6">CoreMeasurement Validation Status</Typography>
          <br/>
          <Typography variant={"body1"}>Rows Updated: {numValidations}</Typography>
        </Box>
      )}
    </Box>
  );
}
