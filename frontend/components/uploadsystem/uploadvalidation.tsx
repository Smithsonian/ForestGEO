"use client";
import React, { useState, useEffect } from 'react';
import { Box, Typography, LinearProgress, Button } from '@mui/material';
import {useCensusContext, usePlotContext} from "@/app/contexts/userselectionprovider";
import {ReviewStates} from "@/config/macros";

interface UploadValidationProps {
  plot: { id: number; name: string };
  currentCensus: { id: number; name: string };
  setReviewState: (state: string) => void;
}

interface ValidationResult {
  error: boolean;
  message: string;
  insertedRows?: number;
  expectedRows?: number;
}

const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState,
                                                           }) => {
  const [validationProgress, setValidationProgress] = useState<number>(0);
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult>>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [updatedRowCount, setUpdatedRowCount] = useState(0);
  const [isUpdateValidationComplete, setIsUpdateValidationComplete] = useState<boolean>(false);

  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();

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
          results[api] = { error: true, message: 'Validation API call failed.' };
        } else {
          results[api] = { error: false, message: 'Validation completed successfully.', ...result };
        }
      } catch (error) {
        results[api] = { error: true, message: 'Network or server error occurred.' };
      } finally {
        processedCalls++;
        setValidationProgress((processedCalls / totalCalls) * 100);
      }
    }

    setValidationResults(results);
    setIsValidationComplete(true);
  };

  const updateValidations = async () => {
    const response = await fetch(`/api/validations/updatepassedvalidations?plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`);
    const result = await response.json();
    setUpdatedRowCount(result);
  }

  useEffect(() => {
    performValidations().catch(console.error);
  }, []);

  useEffect(() => {
    if (isValidationComplete) {
      updateValidations().catch(console.error);
    }
  }, [isValidationComplete]);

  if (!isUpdateValidationComplete) {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        <Typography variant="h6">Validation Progress</Typography>
        <LinearProgress variant="determinate" value={validationProgress} />
        {isValidationComplete ? (
          <>
            <Typography variant="h6">Validation Results</Typography>
            {Object.entries(validationResults).map(([api, result]) => (
              <Box key={api} sx={{ mb: 2 }}>
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
        <Button onClick={() => setReviewState('COMPLETE')}>Complete Validation</Button>
      </Box>
    );
  } else {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        <Typography variant="h6">Validation Progress</Typography>
        <LinearProgress variant="determinate" value={validationProgress} />
        {isValidationComplete && (
          <>
            <Typography variant="h6">Validation Results</Typography>
            {Object.entries(validationResults).map(([api, result]) => (
              <Box key={api} sx={{ mb: 2 }}>
                <Typography>{api}:</Typography>
                {result.error ? (
                  <Typography color="error">- {result.message}</Typography>
                ) : (
                  <Typography>Processed Rows: {result.insertedRows}, Errors Detected: {result.expectedRows}</Typography>
                )}
              </Box>
            ))}
            <Typography variant={"h6"}>Number of rows that successfully passed validation: {updatedRowCount}</Typography>
            <Button onClick={() => setReviewState(ReviewStates.COMPLETE)}>Complete Validation</Button>
          </>
        )}
      </Box>
    );
  }


};

export default UploadValidation;
