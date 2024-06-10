"use client";
import React, {useEffect, useState} from 'react';
import {
  Box,
  LinearProgress,
  Typography
} from '@mui/material';
import {ReviewStates} from "@/config/macros/uploadsystemmacros";
import {UploadValidationProps} from "@/config/macros/uploadsystemmacros";
import {ValidationResponse} from "@/components/processors/processormacros";
import CircularProgress from "@mui/joy/CircularProgress";
import {useLoading} from '@/app/contexts/loadingprovider';
import {useOrgCensusContext, usePlotContext} from '@/app/contexts/userselectionprovider';
// Define the type for validation messages
type ValidationMessages = {
  [key: string]: string;
};
const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState, schema
                                                           }) => {
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResponse>>({});
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [minMaxValues, setMinMaxValues] = useState<Record<string, { min?: number, max?: number }>>({});


  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  // Add new state for countdown timer
  const [countdown, setCountdown] = useState(5);
  const {setLoading} = useLoading();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const defaultMinMaxValues: Record<string, { min?: number, max?: number }> = {
    'ValidateScreenMeasuredDiameterMinMax': {min: undefined, max: undefined},
    'ValidateHOMUpperAndLowerBounds': {min: undefined, max: undefined},
  };
  useEffect(() => {
    setLoading(true, 'Loading Validations...');
    fetch('/api/validations/validationlist', {method: 'GET'})
      .then(response => response.json())
      .then(data => {
        setValidationMessages(data);

        // Set initial progress after fetching validation messages
        const initialProgress = Object.keys(data).reduce((acc, api) => ({...acc, [api]: 0}), {});
        setValidationProgress(initialProgress);
        showNextPrompt(0).catch(console.error);
      })
      .then(() => setLoading(false))
      .catch(error => console.error('Error fetching validation messages:', error));
  }, []);


  const showNextPrompt = async (index: number, foundError: boolean = false) => {
    if (index >= Object.keys(validationMessages).length) {
      setIsValidationComplete(true); // All validations are complete
      setErrorsFound(foundError);
      return;
    }

    const api = Object.keys(validationMessages)[index];

    performValidation(api).then(({response, hasError}) => {
      setValidationResults(prevResults => ({...prevResults, [api]: response}));
      setValidationProgress(prevProgress => ({...prevProgress, [api]: 100}));
      showNextPrompt(index + 1, foundError || hasError);
    });
  };

  const performValidation = async (api: string): Promise<{ response: ValidationResponse, hasError: boolean }> => {
    let queryParams = `schema=${schema}&plotID=${currentPlot?.id}&censusID=${currentCensus?.dateRanges[0].censusID}`;
    if (['ValidateScreenMeasuredDiameterMinMax', 'ValidateHOMUpperAndLowerBounds'].includes(api)) {
      const values = minMaxValues[api] || defaultMinMaxValues[api];
      queryParams += `&minValue=${values.min}&maxValue=${values.max}`;
    }
    try {
      const response = await fetch(`/api/validations/${api}?${queryParams}`);
      if (!response.ok) {
        throw new Error(`Error executing ${api}`);
      }
      const result = await response.json();
      const hasError = result.failedRows > 0;
      return {response: result, hasError};
    } catch (error: any) {
      console.error(`Error performing validation for ${api}:`, error);
      setApiErrors(prev => [...prev, `Failed to execute ${api}: ${error.message}`]);
      setValidationProgress(prevProgress => ({...prevProgress, [api]: -1}));
      return {response: {failedRows: 0, message: error.message, totalRows: 0}, hasError: false};
    }
  };

  const renderProgressBars = () => {
    return Object.keys(validationMessages).map(api => (
      <Box key={api} sx={{mb: 2}}>
        <Typography variant="subtitle1">{validationMessages[api] || api}</Typography>
        <LinearProgress variant="determinate" value={validationProgress[api]}/>
      </Box>
    ));
  };


  // Effect for handling countdown and state transition
  useEffect(() => {
    let timer: number; // Declare timer as a number

    if (isValidationComplete && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
      // Use 'window.setTimeout' and type assertion to treat the return as a number
    } else if (countdown === 0) {
      setReviewState(ReviewStates.UPDATE);
    }

    return () => clearTimeout(timer); // Clear timeout using the timer variable
  }, [countdown, isValidationComplete, setReviewState]);

  return (
    <>
      {Object.keys(validationMessages).length > 0 && (
        <Box sx={{width: '100%', p: 2, display: 'flex', flex: 1, flexDirection: 'column'}}>
          {!isValidationComplete ? (
            <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
              <Typography variant="h6">Validating data...</Typography>
              {renderProgressBars()}
            </Box>
          ) : (
            <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
              <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <CircularProgress/>
                <Typography>{countdown} seconds remaining</Typography>
              </Box>
              <Typography variant="h6">Validation Results</Typography>
              {apiErrors.length > 0 && (
                <Box sx={{mb: 2}}>
                  <Typography color="error">Some validations could not be performed:</Typography>
                  {apiErrors.map((error) => (
                    <Typography key={error} color="error">- {error}</Typography>
                  ))}
                </Box>
              )}
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
                    <Typography>Processed Rows: {result.totalRows}, Errors
                      Detected: {result.failedRows}</Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </>
  );
};

export default UploadValidation;