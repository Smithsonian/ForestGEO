"use client";
import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {Box, Button, LinearProgress, Typography} from '@mui/material';
import {ReviewStates, UploadFireProps} from "@/config/macros";

export interface UploadValidationProps extends UploadFireProps {
  validationResults: Record<string, ValidationResult>;
  setValidationResults: Dispatch<SetStateAction<Record<string, ValidationResult>>>;
}

interface ValidationResult {
  error: boolean;
  message: string;
  insertedRows?: number;
  expectedRows?: number;
}

const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState,
                                                             currentPlot, currentCensus,
                                                             validationResults, setValidationResults
                                                           }) => {
  const [validationProgress, setValidationProgress] = useState<number>(0);
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);

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
    let results: Record<string, ValidationResult> = {};
    let totalCalls = validationAPIs.length;
    let processedCalls = 0;

    for (const api of validationAPIs) {
      try {
        const response = await fetch(`/api/validations/${api}?plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`);
        const result = await response.json();
        if (!response.ok) {
          results[api] = {error: true, message: 'Validation API call failed.'};
        } else {
          results[api] = {error: false, message: 'Validation completed successfully.', ...result};
        }
      } catch (error) {
        results[api] = {error: true, message: 'Network or server error occurred.'};
      } finally {
        processedCalls++;
        setValidationProgress((processedCalls / totalCalls) * 100);
      }
    }
    setValidationResults(results);
    setIsValidationComplete(true);
  };

  useEffect(() => {
    performValidations().catch(console.error);
  }, []);
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
              {result.error ? (
                <Typography color="error">- {result.message}</Typography>
              ) : (
                <Typography>Processed Rows: {result.insertedRows}, Errors Detected: {result.expectedRows}</Typography>
              )}
            </Box>
          ))}
        </>
      ) : (
        <Typography>Validating...</Typography>
      )}
      <Button onClick={() => setReviewState(ReviewStates.COMPLETE)}>Complete Validation</Button>
    </Box>
  );
};

export default UploadValidation;
