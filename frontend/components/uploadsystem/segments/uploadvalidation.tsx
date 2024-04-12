"use client";
import React, {useEffect, useState} from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  TextField,
  Typography
} from '@mui/material';
import {ReviewStates, UploadValidationProps} from "@/config/macros";
import {ValidationResponse} from "@/components/processors/processormacros";
import CircularProgress from "@mui/joy/CircularProgress";
import {useLoading} from '@/app/contexts/loadingprovider';
// Define the type for validation messages
type ValidationMessages = {
  [key: string]: string;
};
const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState,
                                                             currentPlot, currentCensus, schema
                                                           }) => {
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResponse>>({});
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [minMaxValues, setMinMaxValues] = useState<Record<string, { min?: number, max?: number }>>({});

  const [promptOpen, setPromptOpen] = useState<boolean>(false);
  const [currentPromptApi, setCurrentPromptApi] = useState<string>('');
  const [tempMinMax, setTempMinMax] = useState<{ min: number | string, max: number | string }>({min: '', max: ''});
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [useDefaultValues, setUseDefaultValues] = useState<boolean>(false);
  const [defaultValuesDialogOpen, setDefaultValuesDialogOpen] = useState<boolean>(true);
  // Add new state for countdown timer
  const [countdown, setCountdown] = useState(5);
  const {setLoading} = useLoading();

  const defaultMinMaxValues: Record<string, { min?: number, max?: number }> = {
    'ValidateScreenMeasuredDiameterMinMax': {min: undefined, max: undefined},
    'ValidateHOMUpperAndLowerBounds': {min: undefined, max: undefined},
    // ... [other default values]
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
      })
      .then(() => setLoading(false))
      .catch(error => console.error('Error fetching validation messages:', error));
  }, []);

  const handleDefaultValuesSelection = (useDefaults: boolean) => {
    setUseDefaultValues(useDefaults);
    setDefaultValuesDialogOpen(false);

    if (useDefaults) {
      setMinMaxValues(defaultMinMaxValues);
      showNextPrompt(0, false).catch(console.error);
    } else {
      promptForInput('ValidateScreenMeasuredDiameterMinMax');
    }
  };

  const promptForInput = (api: string) => {
    setCurrentPromptApi(api);
    setPromptOpen(true);
    setTempMinMax({min: '', max: ''}); // Reset input fields
  };

  const handlePromptClose = () => {
    const newMinMax = {min: Number(tempMinMax.min), max: Number(tempMinMax.max)};

    // Update minMaxValues for the current prompt
    setMinMaxValues(prev => ({...prev, [currentPromptApi]: newMinMax}));
    setPromptOpen(false);

    if (currentPromptApi === 'ValidateScreenMeasuredDiameterMinMax') {
      // Move to the HOM prompt next
      promptForInput('ValidateHOMUpperAndLowerBounds');
    } else if (currentPromptApi === 'ValidateHOMUpperAndLowerBounds') {
      // Start validations after both prompts are done
      showNextPrompt(0, false).catch(console.error);
    }
  };

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
    let queryParams = `schema=${schema}&plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`;
    if (!useDefaultValues && ['ValidateScreenMeasuredDiameterMinMax', 'ValidateHOMUpperAndLowerBounds'].includes(api)) {
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

  const renderPromptModal = () => {
    return (
      <Dialog open={promptOpen} onClose={handlePromptClose}>
        <DialogTitle>Enter Min and Max Values</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Please enter the minimum and maximum values for {currentPromptApi}.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="Min Value"
            type="number"
            fullWidth
            variant="outlined"
            value={tempMinMax.min}
            onChange={(e) => setTempMinMax({...tempMinMax, min: e.target.value})}
          />
          <TextField
            margin="dense"
            label="Max Value"
            type="number"
            fullWidth
            variant="outlined"
            value={tempMinMax.max}
            onChange={(e) => setTempMinMax({...tempMinMax, max: e.target.value})}
          />
        </DialogContent>
        <DialogActions>
          <Button sx={{width: 'fit-content'}} onClick={handlePromptClose}>Submit</Button>
        </DialogActions>
      </Dialog>
    );
  };

  const renderDefaultValuesDialog = () => {
    return (
      <Dialog open={defaultValuesDialogOpen} onClose={() => handleDefaultValuesSelection(false)}>
        <DialogTitle>Validation Parameters</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Would you like to use default values for validation parameters or provide them manually?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDefaultValuesSelection(true)}>Use Default Values</Button>
          <Button onClick={() => handleDefaultValuesSelection(false)}>Manual Input</Button>
        </DialogActions>
      </Dialog>
    );
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
          {renderDefaultValuesDialog()}
          {renderPromptModal()}

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