"use client";

import React, {useEffect, useState} from "react";
import {Box, Typography} from "@mui/material";
import {UploadFireProps} from "@/config/macros";
import CircularProgress from "@mui/joy/CircularProgress";

export interface UploadUpdateValidationsProps extends UploadFireProps {

}

export default function UploadUpdateValidations(props: Readonly<UploadUpdateValidationsProps>) {
  const {currentPlot, currentCensus} = props;
  const [updatedRowCount, setUpdatedRowCount] = useState(0);
  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState(false);
  const updateValidations = async () => {
    setIsUpdateValidationComplete(false);
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`);
    const result = await response.json();
    setUpdatedRowCount(result);
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
        <Typography>Updated rows: {updatedRowCount}</Typography>
      )}
    </Box>
  );

}