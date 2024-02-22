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
import {Plot, ReviewStates} from "@/config/macros";
import {ValidationResponse} from "@/components/processors/processormacros";
import {CensusRDS} from "@/config/sqlmacros";

export interface UploadValidationProps {
  setReviewState: React.Dispatch<React.SetStateAction<ReviewStates>>;
  currentPlot: Plot;
  currentCensus: CensusRDS;
}

const UploadValidation: React.FC<UploadValidationProps> = ({
                                                             setReviewState,
                                                             currentPlot, currentCensus
                                                           }) => {
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResponse>>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [minMaxValues, setMinMaxValues] = useState<Record<string, { min: number, max: number }>>({});

  const [promptOpen, setPromptOpen] = useState<boolean>(false);
  const [currentPromptApi, setCurrentPromptApi] = useState<string>('');
  const [tempMinMax, setTempMinMax] = useState<{ min: number | string, max: number | string }>({min: '', max: ''});
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [currentValidationIndex, setCurrentValidationIndex] = useState(0);


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

  // Define the type for validation messages
  type ValidationMessages = {
    [key: string]: string;
  };

  // Mapping of API names to user-friendly messages
  const validationMessages: ValidationMessages = {
    'dbhgrowthexceedsmax': 'Checking if any DBH growth exceeds maximum rate of 65 cm',
    'dbhshrinkageexceedsmax': 'Checking if any DBH shrinkge exceeds maximum rate of 5%',
    'duplicatequadsbyname': 'Checking for Duplicate Quadrats by Name',
    'duptreestempercensus': 'Checking for duplicate tree/stem combinations within the current census',
    'invalidspeciescodes': 'Checking if any referenced species codes have not initialized',
    'outsidecensusdatebounds': 'Checking if any measurements were taken outside of the bounds of the current census',
    'screendbhminmax': 'Checking that all DBH measurements are within user-provided min/max values',
    'screenhomminmax': 'Checking that all HOM measurements are within user-provided min/max values',
    'screenstemsdeadattributes': 'Checking that stems with measurements are not classified as dead',
    'stemsoutsideplots': 'Checking that all stems assigned to a plot are located within that plot',
    'stemtreediffspecies': 'Checking that stem/tree combinations do not have different species designations',
    'treestemsdiffquadrats': 'Checking that stem/tree combinations are not in different quadrats'
  };

  useEffect(() => {
    const initialProgress = validationAPIs.reduce((acc, api) => ({ ...acc, [api]: 0 }), {});
    setValidationProgress(initialProgress);
    // Start with the first prompt for DBH
    promptForInput('screendbhminmax');
  }, []);

  const promptForInput = (api: string) => {
    setCurrentPromptApi(api);
    setPromptOpen(true);
    setTempMinMax({ min: '', max: '' }); // Reset input fields
  };

  const handlePromptClose = () => {
    const newMinMax = { min: Number(tempMinMax.min), max: Number(tempMinMax.max) };

    // Update minMaxValues for the current prompt
    setMinMaxValues(prev => ({ ...prev, [currentPromptApi]: newMinMax }));
    setPromptOpen(false);

    if (currentPromptApi === 'screendbhminmax') {
      // Move to the HOM prompt next
      promptForInput('screenhomminmax');
    } else if (currentPromptApi === 'screenhomminmax') {
      // Start validations after both prompts are done
      showNextPrompt(0);
    }
  };

  const showNextPrompt = (index: number) => {
    if (index >= validationAPIs.length) {
      setIsValidationComplete(true); // All validations are complete
      checkForErrors();
      return;
    }

    const api = validationAPIs[index];

    // Directly perform validations for screendbhminmax and screenhomminmax
    if (api === 'screendbhminmax' || api === 'screenhomminmax') {
      performValidation(api).then(result => {
        setValidationResults(prevResults => ({ ...prevResults, [api]: result }));
        setValidationProgress(prevProgress => ({ ...prevProgress, [api]: 100 }));
        showNextPrompt(index + 1);
      });
    } else {
      performValidation(api).then(result => {
        setValidationResults(prevResults => ({ ...prevResults, [api]: result }));
        setValidationProgress(prevProgress => ({ ...prevProgress, [api]: 100 }));
        showNextPrompt(index + 1);
      });
    }
  };

  const performValidation = async (api: string): Promise<ValidationResponse> => {
    let queryParams = `plotID=${currentPlot?.id}&censusID=${currentCensus?.censusID}`;
    if (['screendbhminmax', 'screenhomminmax'].includes(api)) {
      const values = minMaxValues[api];
      if (values) {
        queryParams += `&minValue=${values.min}&maxValue=${values.max}`;
      } else {
        console.error(`Validation values for ${api} are not set`);
        return { failedRows: 0, message: `Validation values for ${api} are not set`, totalRows: 0 };
      }
    }
    try {
      const response = await fetch(`/api/validations/${api}?${queryParams}`);
      if (!response.ok) {
        throw new Error(`Error executing ${api}`);
      }
      const result = await response.json();
      setValidationProgress(prevProgress => ({ ...prevProgress, [api]: 100 }));
      return result;
    } catch (error: any) {
      console.error(`Error performing validation for ${api}:`, error);
      setApiErrors(prev => [...prev, `Failed to execute ${api}: ${error.message}`]);
      setValidationProgress(prevProgress => ({ ...prevProgress, [api]: -1 }));
      return { failedRows: 0, message: error.message, totalRows: 0 };
    }
  };

  const checkForErrors = () => {
    const foundErrors = Object.values(validationResults).some(result => result.failedRows > 0);
    setErrorsFound(foundErrors);
  };
  const renderProgressBars = () => {
    return validationAPIs.map(api => (
      <Box key={api} sx={{mb: 2}}>
        <Typography variant="subtitle1">{validationMessages[api] || api}</Typography>
        <LinearProgress variant="determinate" value={validationProgress[api]} />
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
          <Button onClick={handlePromptClose}>Submit</Button>
        </DialogActions>
      </Dialog>
    );
  };

  return (
    <Box sx={{width: '100%', p: 2, display: 'flex', flex: 1, flexDirection: 'column'}}>
      {renderPromptModal() /* Render the modal dialog */}

      {!isValidationComplete ? (
        <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
          <Typography variant="h6">Validating data...</Typography>
          {renderProgressBars()}
        </Box>
      ) : (
        <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
          <Typography variant="h6">Validation Results</Typography>
          {apiErrors.length > 0 && (
            <Box sx={{mb: 2}}>
              <Typography color="error">Some validations could not be performed:</Typography>
              {apiErrors.map((error, index) => (
                <Typography key={index} color="error">- {error}</Typography>
              ))}
            </Box>
          )}
          {Object.entries(validationResults).map(([api, result], index) => (
            <Box key={index} sx={{mb: 2}}>
              <Typography>{api}:</Typography>
              {result.failedRows > 0 ? (
                <>
                  <Typography color="error">- {result.message}</Typography>
                  <Typography color="error">Failed Core Measurement
                    IDs: {result.failedCoreMeasurementIDs?.join(', ') ?? 'None'}</Typography>
                </>
              ) : (
                <Typography>Processed Rows: {result.totalRows}, Errors Detected: {result.failedRows}</Typography>
              )}
            </Box>
          ))}
          {errorsFound ? (
            <Button variant="contained" color="error" sx={{mt: 2}}
                    onClick={() => setReviewState(ReviewStates.VALIDATE_ERRORS_FOUND)}>
              Review Errors
            </Button>
          ) : (
            <Button variant="contained" color="success" sx={{mt: 2}}
                    onClick={() => setReviewState(ReviewStates.UPDATE)}>
              Complete Upload
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
};

export default UploadValidation;