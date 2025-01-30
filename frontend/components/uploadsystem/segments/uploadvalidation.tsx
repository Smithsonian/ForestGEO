'use client';
import React, { useEffect, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { ReviewStates, UploadValidationProps } from '@/config/macros/uploadsystemmacros';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { CoreMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

const UploadValidation: React.FC<UploadValidationProps> = ({ setReviewState, schema }) => {
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [isValidationComplete, setIsValidationComplete] = useState(false);
  const [errorsFound, setErrorsFound] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [isUpdatingRows, setIsUpdatingRows] = useState<boolean>(false);
  const [rowsPassed, setRowsPassed] = useState<CoreMeasurementsRDS[]>([]);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const plotID = currentPlot?.plotID;

  useEffect(() => {
    fetch(`/api/validations/validationlist?schema=${currentSite?.schemaName}`, { method: 'GET' })
      .then(response => response.json())
      .then(data => {
        setValidationMessages(data.coreValidations);
        const initialProgress = Object.keys(data.coreValidations).reduce((acc, api) => ({ ...acc, [api]: 0 }), {});
        setValidationProgress(initialProgress);
      })
      .catch(error => {
        console.error('Error fetching validation messages:', error);
      });
  }, []);

  useEffect(() => {
    if (Object.keys(validationMessages).length > 0) {
      performValidations().catch(console.error);
    }
  }, [validationMessages]);

  const performValidations = async () => {
    try {
      const validationProcedureNames = Object.keys(validationMessages);

      const results = await Promise.all(
        validationProcedureNames.map(async procedureName => {
          const { id: validationProcedureID, definition: cursorQuery } = validationMessages[procedureName];

          try {
            const response = await fetch(`/api/validations/procedures/${procedureName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                schema: currentSite?.schemaName,
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
              throw new Error(`Error executing ${procedureName}`);
            }

            const result: boolean = await response.json();
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: 100
            }));

            return { procedureName, hasError: result };
          } catch (error: any) {
            console.error(`Error performing validation for ${procedureName}:`, error);
            setApiErrors(prev => [...prev, `Failed to execute ${procedureName}: ${error.message}`]);
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: -1
            }));
            return { procedureName, hasError: true };
          }
        })
      );

      const errorsExist = results.some(({ hasError }) => hasError);

      try {
        setIsUpdatingRows(true);
        const response = await fetch(
          `/api/validations/updatepassedvalidations?schema=${currentSite?.schemaName}&plotID=${plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`,
          { method: 'GET' }
        );
        setRowsPassed(await response.json());
        setErrorsFound(errorsExist);
      } catch (error: any) {
        console.error('Error in updating validated rows:', error);
        setApiErrors(prev => [...prev, `Failed to update validated rows: ${error.message}`]);
      } finally {
        setIsUpdatingRows(false);
        setIsValidationComplete(true);
      }
    } catch (error) {
      console.error('Error during validation process:', error);
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
    if (isValidationComplete) setReviewState(ReviewStates.UPLOAD_AZURE);
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
