"use client";
import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {Box, Button, LinearProgress, TextField, Typography} from '@mui/material';
import {Plot, ReviewStates} from "@/config/macros";
import {ValidationResponse} from "@/components/processors/processormacros";
import {Input, Stack} from "@mui/joy";
import {CensusRDS} from "@/config/sqlmacros";
import { NumberInput } from '@mui/base/Unstable_NumberInput/NumberInput';
import CircularProgress from "@mui/joy/CircularProgress";

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
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [currentValidationIndex, setCurrentValidationIndex] = useState(0);
  const [showMinMaxInputs, setShowMinMaxInputs] = useState(false);
  const [minValue, setMinValue] = useState<number | null>(null);
  const [maxValue, setMaxValue] = useState<number | null>(null);
  const [validationRunning, setValidationRunning] = useState(false);

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
  ];

  const updateProgress = () => {
    const progress = ((currentValidationIndex + 1) / validationAPIs.length) * 100;
    setValidationProgress(progress);
  };

  const getMinMaxRecommendations = (api: string) => {
    switch (api) {
      case 'screendbhminmax':
        return { min: 1.0, max: 500.0 };
      case 'screenhomminmax':
        return { min: 1.0, max: 1.5 };
      default:
        return { min: null, max: null };
    }
  };

  const currentRecommendations = getMinMaxRecommendations(validationAPIs[currentValidationIndex]);

  const performValidation = async (api: string) => {
    setValidationRunning(true);
    let queryParams = `plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`;
    if (['screendbhminmax', 'screenhomminmax'].includes(api)) {
      queryParams += `&minValue=${minValue}&maxValue=${maxValue}`;
    }
    try {
      const response = await fetch(`/api/validations/${api}?${queryParams}`);
      if (!response.ok) {
        throw new Error(`Error executing ${api}`);
      }
      const result = await response.json();
      setValidationResults(prev => ({ ...prev, [api]: result }));
    } catch (error: any) {
      console.error(error);
      setApiErrors(prev => [...prev, `Failed to execute ${api}: ${error.message}`]);
    } finally {
      if (['screendbhminmax', 'screenhomminmax'].includes(api)) {
        // Resetting minValue and maxValue for next validation
        setMinValue(null);
        setMaxValue(null);
      }
      if (currentValidationIndex < validationAPIs.length) {
        // Update progress for the next validation
        updateProgress();
      }
      setValidationRunning(false);
    }
  };

  const continueValidation = () => {
    if (currentValidationIndex < validationAPIs.length) {
      const api = validationAPIs[currentValidationIndex];
      if (['screendbhminmax', 'screenhomminmax'].includes(api) && (minValue == null || maxValue == null)) {
        setShowMinMaxInputs(true);
      } else {
        performValidation(api).then();
        setCurrentValidationIndex(prev => prev + 1);
      }
    } else {
      updateProgress(); // Ensure progress is 100% when complete
      setIsValidationComplete(true);
    }
  };

  const handleMinMaxSubmit = () => {
    setShowMinMaxInputs(false);
    continueValidation();
  };

  useEffect(() => {
    // Initial trigger
    continueValidation();
  }, []);

  useEffect(() => {
    let foundErrors = false;
    for (const api in validationResults) {
      const result = validationResults[api];
      if (result.failedRows > 0) {
        foundErrors = true;
        break;
      }
    }
    setErrorsFound(foundErrors);
  }, [validationResults]);

  return (
    <Box sx={{ width: '100%', p: 2, display: 'flex', flex: 1, flexDirection: 'column' }}>
      {!isValidationComplete && (
        <>
          <Typography variant="h6">Validation Progress</Typography>
          <LinearProgress variant="determinate" value={validationProgress} />
          <Typography variant="subtitle1">
            {currentValidationIndex < validationAPIs.length && `Current Validation: ${validationAPIs[currentValidationIndex]}`}
          </Typography>

          {showMinMaxInputs && (
            <Box sx={{display: 'flex', flex: 1, flexDirection: 'column'}}>
              <Typography>Enter Min and Max Values for {validationAPIs[currentValidationIndex]}</Typography>
              <Typography variant="caption">
                Recommended: Min - {currentRecommendations.min}, Max - {currentRecommendations.max}
              </Typography>
              <Stack direction={"row"}>
                <Stack direction={"column"}>
                  {/* Label and Input for Min Value */}
                  <Typography>Min Value</Typography>
                  <Input
                    type="number"
                    value={minValue ?? ''}
                    onChange={(e) => setMinValue(e.target.value ? Number(e.target.value) : null)}
                    placeholder={`Recommended: ${currentRecommendations.min}`}
                  />
                </Stack>
                <Stack direction={"column"}>
                  {/* Label and Input for Max Value */}
                  <Typography>Max Value</Typography>
                  <Input
                    type="number"
                    value={maxValue ?? ''}
                    onChange={(e) => setMaxValue(e.target.value ? Number(e.target.value) : null)}
                    placeholder={`Recommended: ${currentRecommendations.max}`}
                  />
                </Stack>
              </Stack>
              <Button onClick={handleMinMaxSubmit}>Continue Validation</Button>
            </Box>
          )}

          {!showMinMaxInputs && (
            <>
              {!validationRunning ? (
                <Button onClick={continueValidation}>Continue</Button>
              ) : (
                <CircularProgress />
              )}
            </>
          )}
        </>
      )}

      {isValidationComplete && (
        <Stack direction={"column"}>
          <Typography variant="h6">Validation Results</Typography>
          {apiErrors.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography color="error">Some validations could not be performed:</Typography>
              {apiErrors.map((error, index) => (
                <Typography key={error + index.toString()} color="error">- {error}</Typography>
              ))}
            </Box>
          )}
          {Object.entries(validationResults).map(([api, result]) => (
            <Box key={api} sx={{ mb: 2 }}>
              <Typography>{api}:</Typography>
              {result.failedRows > 0 ? (
                <>
                  <Typography color="error">- {result.message}</Typography>
                  <Typography color="error">Failed Core Measurement IDs: {result.failedCoreMeasurementIDs?.join(', ') ?? 'None'}</Typography>
                </>
              ) : (
                <Typography>Processed Rows: {result.failedRows}, Errors Detected: {result.totalRows}</Typography>
              )}
            </Box>
          ))}
          {errorsFound ? (
            <Stack direction={"column"}>
              <Typography variant={"h5"}>Erroneous rows were found when running validations. <br /> Please proceed to the error display to review errors found</Typography>
              <Button sx={{ width: 'fit-content' }} onClick={() => setReviewState(ReviewStates.VALIDATE_ERRORS_FOUND)}>Proceed</Button>
            </Stack>
          ) : (
            <Stack direction={"column"}>
              <Typography variant={"h5"}>All validations passed with no errors.</Typography>
              <Button sx={{ width: 'fit-content' }} onClick={() => setReviewState(ReviewStates.UPDATE)}>Complete Upload</Button>
            </Stack>
          )}
        </Stack>
      )}
    </Box>
  );
};

export default UploadValidation;