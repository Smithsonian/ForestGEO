'use client';
import React, { useEffect, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { updateValidatedRows } from '@/components/processors/processorhelperfunctions';
import { ValidationResponse } from '@/config/macros';

type ValidationMessages = {
  [key: string]: { description: string; definition: string };
};

const ValidationModal: React.FC = () => {
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResponse>>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [countdown, setCountdown] = useState(5);
  const [isUpdatingRows, setIsUpdatingRows] = useState<boolean>(false); // New state for row update status

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const schema = currentSite?.schemaName;
  const plotID = currentPlot?.plotID;

  useEffect(() => {
    console.log('Loading validation procedures...');
    fetch('/api/validations/validationlist', { method: 'GET' })
      .then(response => response.json())
      .then(data => {
        setValidationMessages(data);
        const initialProgress = Object.keys(data).reduce((acc, api) => ({ ...acc, [api]: 0 }), {});
        setValidationProgress(initialProgress);
      })
      .catch(error => {
        console.error('Error fetching validation messages:', error);
      });
  }, []);

  useEffect(() => {
    if (Object.keys(validationMessages).length > 0) {
      performNextValidation(0, false).catch(console.error);
    }
  }, [validationMessages]);

  const performNextValidation = async (index: number, foundError: boolean = false) => {
    if (index >= Object.keys(validationMessages).length) {
      try {
        setIsUpdatingRows(true); // Indicate that the update is starting
        await updateValidatedRows(schema!, { p_CensusID: currentCensus?.dateRanges[0]?.censusID, p_PlotID: currentPlot?.plotID }); // Call the updateValidatedRows
        // function
        // here
        setIsUpdatingRows(false); // Indicate that the update is complete
        setIsValidationComplete(true);
        setErrorsFound(foundError);
      } catch (error: any) {
        console.error('Error in updating validated rows:', error);
        setApiErrors(prev => [...prev, `Failed to update validated rows: ${error.message}`]);
        setIsUpdatingRows(false); // Ensure the flag is reset even on error
      }
      return;
    }

    const validationProcedureName = Object.keys(validationMessages)[index];
    const validationProcedureID = index + 1; // Assuming a 1-based index as an ID for simplicity; adjust as needed.
    const cursorQuery = validationMessages[validationProcedureName].definition;

    try {
      const { response, hasError } = await performValidation(validationProcedureName, validationProcedureID, cursorQuery);
      setValidationResults(prevResults => ({
        ...prevResults,
        [validationProcedureName]: response
      }));
      setValidationProgress(prevProgress => ({ ...prevProgress, [validationProcedureName]: 100 }));
      await performNextValidation(index + 1, foundError || hasError);
    } catch (error) {
      console.error(`Error in performNextValidation for ${validationProcedureName}:`, error);
    }
  };

  const performValidation = async (
    validationProcedureName: string,
    validationProcedureID: number,
    cursorQuery: string
  ): Promise<{ response: ValidationResponse; hasError: boolean }> => {
    try {
      const response = await fetch(`/api/validations/procedures/${validationProcedureName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema,
          validationProcedureID,
          cursorQuery,
          p_CensusID: currentCensus?.dateRanges[0].censusID,
          p_PlotID: plotID,
          minDBH: null, // Adjust these values as needed
          maxDBH: null,
          minHOM: null,
          maxHOM: null
        })
      });

      if (!response.ok) {
        throw new Error(`Error executing ${validationProcedureName}`);
      }

      const result = await response.json();
      const hasError = result.failedRows > 0;
      return { response: result, hasError };
    } catch (error: any) {
      console.error(`Error performing validation for ${validationProcedureName}:`, error);
      setApiErrors(prev => [...prev, `Failed to execute ${validationProcedureName}: ${error.message}`]);
      setValidationProgress(prevProgress => ({ ...prevProgress, [validationProcedureName]: -1 }));
      return {
        response: { failedRows: 0, message: error.message, totalRows: 0 },
        hasError: false
      };
    }
  };

  const renderProgressBars = () => {
    return Object.keys(validationMessages).map(validationProcedureName => (
      <Box key={validationProcedureName} sx={{ mb: 2 }}>
        <Typography variant="subtitle1">{validationMessages[validationProcedureName]?.description || validationProcedureName}</Typography>
        <LinearProgress variant="determinate" value={validationProgress[validationProcedureName]} />
      </Box>
    ));
  };

  useEffect(() => {
    let timer: number;

    if (isValidationComplete && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
    } else if (countdown === 0) {
      // Automatically close modal or perform any final actions needed after validation
      // Example: closeModal();
    }

    return () => clearTimeout(timer);
  }, [countdown, isValidationComplete]);

  return (
    <>
      {Object.keys(validationMessages).length > 0 && (
        <Box
          sx={{
            width: '100%',
            p: 2,
            display: 'flex',
            flex: 1,
            flexDirection: 'column'
          }}
        >
          {!isValidationComplete ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Typography variant="h6">Validating data...</Typography>
              {renderProgressBars()}
            </Box>
          ) : isUpdatingRows ? ( // Show updating message when update is in progress
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <CircularProgress />
              <Typography variant="h6">Updating validated rows...</Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <CircularProgress />
                <Typography>{countdown} seconds remaining</Typography>
              </Box>
              <Typography variant="h6">Validation Results</Typography>
              {apiErrors.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography color="error">Some validations could not be performed:</Typography>
                  {apiErrors.map(error => (
                    <Typography key={error} color="error">
                      - {error}
                    </Typography>
                  ))}
                </Box>
              )}
              {Object.entries(validationResults).map(([validationProcedureName, result]) => (
                <Box key={validationProcedureName} sx={{ mb: 2 }}>
                  <Typography>{validationProcedureName}:</Typography>
                  {result.failedRows > 0 ? (
                    <>
                      <Typography color="error">- {result.message}</Typography>
                      <Typography color="error">Failed Core Measurement IDs: {result.failedCoreMeasurementIDs?.join(', ') ?? 'None'}</Typography>
                    </>
                  ) : (
                    <Typography>
                      Processed Rows: {result.totalRows}, Errors Detected: {result.failedRows}
                    </Typography>
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

export default ValidationModal;
