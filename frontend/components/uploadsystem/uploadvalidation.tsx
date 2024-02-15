"use client";
import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {Box, Button, LinearProgress, Typography} from '@mui/material';
import {Plot, ReviewStates} from "@/config/macros";
import {ValidationResponse} from "@/components/processors/processormacros";
import {Stack} from "@mui/joy";
import {CensusRDS} from "@/config/sqlmacros";

export interface UploadValidationProps {
  validationResults: Record<string, ValidationResponse>;
  setValidationResults: Dispatch<SetStateAction<Record<string, ValidationResponse>>>;
  setReviewState: Dispatch<SetStateAction<ReviewStates>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
}


const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState,
                                                             currentPlot, currentCensus,
                                                             validationResults, setValidationResults
                                                           }) => {
  const [validationProgress, setValidationProgress] = useState<number>(0);
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState(false);

  const validationAPIs: string[] = [
    'dbhgrowthexceedsmax',
    'dbhshrinkageexceedsmax',
    'duplicatequadsbyname',
    'duptreestempercensus',
    'invalidspeciescodes',
    'outsidecensusdatebounds',
    'screendbhminmax',
    'screenhomminmax',
    'screenstemsdeadattributes',
    'stemsoutsideplots',
    'stemtreediffspecies',
    'treestemsdiffquadrats',
    'treeswithmultiprimarystem'
  ];

  const performValidations = async () => {
    let results: Record<string, ValidationResponse> = {};
    let totalCalls = validationAPIs.length;
    let processedCalls = 0;

    for (const api of validationAPIs) {
      const response = await fetch(`/api/validations/${api}?plotID=${currentPlot?.id}&censusID=${currentCensus?.plotCensusNumber}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(`unforeseen error in uploadvalidation -- attempting to run validation ${api}`);
      } else {
        results[api] = result;
      }
      processedCalls++;
      setValidationProgress((processedCalls / totalCalls) * 100);
    }
    setValidationResults(results);
  };

  useEffect(() => {
    performValidations().catch(console.error);
  }, []);

  useEffect(() => {
    if (validationResults) {
      for (const api in validationResults) {
        const result = validationResults[api];
        if (result.failedRows > 0) {
          setErrorsFound(true);
          break;
        }
      }
    }
    setIsValidationComplete(true);
    setValidationProgress(100);
  }, [validationResults]);

  return (
    <Box sx={{width: '100%', p: 2}}>
      <Typography variant="h6">Validation Progress</Typography>
      <LinearProgress variant="determinate" value={validationProgress}/>
      {isValidationComplete ? (
        <>
          <Typography variant="h6">Validation Results</Typography>
          {Object.entries(validationResults).map(([api, result]) => (
            <Box key={api} sx={{mb: 2}}>
              <Typography>{api}:</Typography>
              {result.failedRows > 0 ? (
                <>
                  <Typography color="error">- {result.message}</Typography>
                  <Typography color="error">Failed Core Measurement
                    IDs: {result.failedCoreMeasurementIDs?.join(', ') ?? 'None'}</Typography>
                </>
              ) : (
                <Typography>Processed Rows: {result.failedRows}, Errors Detected: {result.totalRows}</Typography>
              )}
            </Box>
          ))}
        </>
      ) : (
        <Typography>Validating...</Typography>
      )}
      {isValidationComplete && errorsFound ? (
        <Stack direction={"column"}>
          <Typography variant={"h5"}>Erroneous rows were found when running validations. <br/> Please proceed to the
            error display to review errors found</Typography>
          <Button sx={{width: 'fit-content'}}
                  onClick={() => setReviewState(ReviewStates.VALIDATE_ERRORS_FOUND)}>Proceed</Button>
        </Stack>
      ) : (
        <Stack direction={"column"}>
          <Typography variant={"h5"}>All validations passed with no errors.</Typography>
          <Button sx={{width: 'fit-content'}} onClick={() => setReviewState(ReviewStates.UPDATE)}>Complete
            Upload</Button>
        </Stack>
      )}
    </Box>
  );
};

export default UploadValidation;
