'use client';
import React, { useEffect, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { ReviewStates, UploadValidationProps } from '@/config/macros/uploadsystemmacros';
import { ValidationResponse } from '@/components/processors/processormacros';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import { CoreMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';

type ValidationMessages = {
  [key: string]: { id: number; description: string; definition: string };
};

const UploadValidation: React.FC<UploadValidationProps> = ({ setReviewState, schema }) => {
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResponse>>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [isUpdatingRows, setIsUpdatingRows] = useState<boolean>(false); // New state for row update status
  const [rowsPassed, setRowsPassed] = useState<CoreMeasurementsRDS[]>([]);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const plotID = currentPlot?.plotID;

  useEffect(() => {
    console.log('Loading core validation procedures...');
    fetch(`/api/validations/validationlist?schema=${schema}`, { method: 'GET' })
      .then(response => response.json())
      .then(data => {
        setValidationMessages(data.coreValidations);
        const initialProgress = Object.keys(data.coreValidations).reduce((acc, api) => ({ ...acc, [api]: 0 }), {});
        setValidationProgress(initialProgress);

        // for now, site-specific validations are being ignored. Handling will be added later.
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
        const response = await fetch(
          `/api/validations/updatepassedvalidations?schema=${schema}&plotID=${plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`,
          {
            method: 'GET'
          }
        );
        setRowsPassed(await response.json());
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
    const validationProcedureID = validationMessages[validationProcedureName].id; // Retrieve the ID from the validationMessages object
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
      return;
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
          minDBH: null,
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
      throw new Error(`Error performing validation for ${validationProcedureName}:`, error);
      // return {
      //   response: { failedRows: 0, message: error.message, totalRows: 0 },
      //   hasError: false
      // };
    }
  };

  const renderProgressBars = () => {
    return Object.keys(validationMessages).map(validationProcedureName => (
      <Box key={validationProcedureName} sx={{ mb: 2 }}>
        <Typography variant="subtitle1">{validationProcedureName}</Typography>
        <Typography variant={'subtitle1'}>{validationMessages[validationProcedureName]?.description}</Typography>
        <LinearProgress variant="determinate" value={validationProgress[validationProcedureName]} />
      </Box>
    ));
  };

  useEffect(() => {
    if (isValidationComplete) setReviewState(ReviewStates.UPDATE);
  }, [isValidationComplete]);

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
              {rowsPassed.length > 0 &&
                rowsPassed.map(row => (
                  <Box key={row.id} sx={{ mb: 2 }}>
                    <Typography>Updated Row: {row.coreMeasurementID}</Typography>
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
