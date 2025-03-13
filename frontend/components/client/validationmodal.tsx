'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { Modal, ModalDialog } from '@mui/joy';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

interface VMProps {
  isValidationModalOpen: boolean;
  handleCloseValidationModal: () => Promise<void>;
}

function ValidationModal(props: VMProps) {
  const { isValidationModalOpen, handleCloseValidationModal } = props;
  const [validationMessages, setValidationMessages] = useState<ValidationMessages>({});
  const [isValidationComplete, setIsValidationComplete] = useState<boolean>(false);
  const [apiErrors, setApiErrors] = useState<string[]>([]);
  const [validationProgress, setValidationProgress] = useState<Record<string, number>>({});
  const [isUpdatingRows, setIsUpdatingRows] = useState<boolean>(false);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const plotID = currentPlot?.plotID;

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMounted = useRef<boolean>(true);

  useEffect(() => {
    // Create an AbortController instance when the component mounts
    abortControllerRef.current = new AbortController();

    // Cleanup function: mark as unmounted and abort any pending requests
    return () => {
      isMounted.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (Object.keys(validationMessages).length > 0) {
      performValidations().catch(console.error);
    } else {
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
    }
  }, [validationMessages]);

  const performValidations = async () => {
    try {
      const validationProcedureNames = Object.keys(validationMessages);

      for (const procedureName of validationProcedureNames) {
        const { id: validationProcedureID, definition: cursorQuery } = validationMessages[procedureName];

        try {
          const response = await fetch(`/api/validations/procedures/${procedureName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortControllerRef.current?.signal,
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
          setValidationProgress(prevProgress => ({
            ...prevProgress,
            [procedureName]: 100
          }));
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.log(`Fetch aborted for ${procedureName}`);
            return; // Exit early if the request was aborted.
          }
          console.error(`Error performing validation for ${procedureName}:`, error);
          if (isMounted.current) {
            setApiErrors(prev => [...prev, `Failed to execute ${procedureName}: ${error.message}`]);
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: -1
            }));
          }
        }
      }

      try {
        if (isMounted.current) {
          setIsUpdatingRows(true);
        }
        await fetch(
          `/api/validations/updatepassedvalidations?schema=${currentSite?.schemaName}&plotID=${plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`,
          { method: 'GET', signal: abortControllerRef.current?.signal }
        );
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('Update fetch aborted');
          return;
        }
        console.error('Error in updating validated rows:', error);
        if (isMounted.current) {
          setApiErrors(prev => [...prev, `Failed to update validated rows: ${error.message}`]);
        }
      } finally {
        if (isMounted.current) {
          setIsUpdatingRows(false);
          setIsValidationComplete(true);
        }
      }
    } catch (error) {
      console.error('Error during validation process:', error);
    } finally {
      setIsUpdatingRows(false);
      setIsValidationComplete(true);
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

  return (
    <Modal open={isValidationModalOpen} onClose={handleCloseValidationModal}>
      <ModalDialog
        sx={{
          width: '80%',
          borderRadius: 'md',
          p: 2,
          boxShadow: 'lg',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
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
            ) : isUpdatingRows ? (
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
              </Box>
            )}
          </Box>
        )}
      </ModalDialog>
    </Modal>
  );
}

export default ValidationModal;
