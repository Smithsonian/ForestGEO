"use client";
import React, {useEffect, useState} from "react";
import {Box, Typography} from "@mui/material";
import {ReviewStates, UploadUpdateValidationsProps} from "@/config/macros";

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {
    currentPlot, currentCensus, setReviewState, schema,
  } = props;

  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const [numValidations, setNumValidations] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [ellipsis, setEllipsis] = useState('');

  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?schema=${schema}&plotID=${currentPlot?.id.toString()}&censusID=${currentCensus?.censusID.toString()}`);
    const result = await response.json();
    console.log('rows validated: ', result.rowsValidated);
    setIsUpdateValidationComplete(true);
  };

  useEffect(() => {
    updateValidations().catch(console.error);
  }, []);

  useEffect(() => {
    let timer: number;

    if (isUpdateValidationComplete && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    } else if (countdown === 0) {
      setReviewState(ReviewStates.UPLOAD_AZURE);
    }

    return () => clearTimeout(timer);
  }, [countdown, isUpdateValidationComplete, setReviewState]);

  useEffect(() => {
    if (!isUpdateValidationComplete) {
      const ellipsisTimer = setInterval(() => {
        setEllipsis(prev => (prev.length < 4 ? prev + '.' : ''));
      }, 500);

      return () => clearInterval(ellipsisTimer);
    }
  }, [isUpdateValidationComplete]);

  return (
    <Box sx={{display: 'flex', flex: 1, width: '100%', p: 2}}>
      {!isUpdateValidationComplete ? (
        <Box sx={{width: '100%', p: 2, flexDirection: 'column', display: 'flex', flex: 1}}>
          <Typography variant="h6">Finalizing Validations{ellipsis}</Typography>
        </Box>
      ) : (
        <Box sx={{width: '100%', p: 2, flexDirection: 'column', display: 'flex', flex: 1}}>
          <Typography variant="h6">Complete!</Typography>
          <Typography variant={"body1"}>Continuing to Azure upload in {countdown} seconds.</Typography>
        </Box>
      )}
    </Box>
  );
}
