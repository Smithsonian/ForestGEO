'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, LinearProgress, Typography, CircularProgress } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import ailogger from '@/ailogger';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

export type ValidationResult = {
  success: boolean;
  hasFailedMeasurements: boolean;
  failedCount: number;
  errors: string[];
};

type VCProps = {
  onValidationComplete?: (result: ValidationResult) => void;
};

export default function ValidationCore({ onValidationComplete }: VCProps) {
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
  const hasCalledCompletionRef = useRef<boolean>(false);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    return () => {
      isMounted.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetch(`/api/validations/validationlist?schema=${currentSite?.schemaName}`, {
      signal: abortControllerRef.current!.signal
    })
      .then(r => r.json())
      .then(data => {
        // If no validations are defined, immediately call completion with success
        if (data.coreValidations.length === 0) {
          if (onValidationComplete && !hasCalledCompletionRef.current) {
            hasCalledCompletionRef.current = true;
            onValidationComplete({
              success: true,
              hasFailedMeasurements: false,
              failedCount: 0,
              errors: []
            });
          }
        }
        setValidationMessages(data.coreValidations);
        setValidationProgress(Object.keys(data.coreValidations).reduce((acc, api) => ({ ...acc, [api]: 0 }), {}));
      })
      .catch((err: any) => {
        if (err.name !== 'AbortError') {
          ailogger.error('Error fetching validation list:', err);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite?.schemaName]);

  const performValidations = useCallback(async () => {
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
              p_PlotID: plotID
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
            ailogger.info(`Fetch aborted for ${procedureName}`);
            return; // Exit early if the request was aborted.
          }
          ailogger.error(`Error performing validation for ${procedureName}:`, error);
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
          ailogger.info('Update fetch aborted');
          return;
        }
        ailogger.error('Error in updating validated rows:', error);
        if (isMounted.current) {
          setApiErrors(prev => [...prev, `Failed to update validated rows: ${error.message}`]);
        }
      } finally {
        if (isMounted.current) {
          setIsUpdatingRows(false);
          setIsValidationComplete(true);
        }
      }
    } catch (error: any) {
      ailogger.error('Error during validation process:', error);
    } finally {
      setIsUpdatingRows(false);
      setIsValidationComplete(true);
    }
  }, [validationMessages, currentSite, currentCensus, plotID]);

  // Check for failed measurements after validation
  const checkForFailedMeasurements = useCallback(async (): Promise<{ hasFailures: boolean; count: number }> => {
    if (!currentSite?.schemaName || !plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.warn('Missing required context for checking failed measurements');
      return { hasFailures: false, count: 0 };
    }

    try {
      ailogger.info('Checking for failed measurements after validation...');
      const response = await fetch(`/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${plotID}/${currentCensus.dateRanges[0].censusID}`, {
        method: 'GET'
      });

      if (response.ok) {
        const data = await response.json();
        const count = data.recordCount || 0;
        ailogger.info(`Validation check: ${count} failed measurements found`);
        return { hasFailures: count > 0, count };
      } else {
        ailogger.error(`Failed to check for failed measurements: ${response.status}`);
        return { hasFailures: false, count: 0 };
      }
    } catch (error: any) {
      ailogger.error('Error checking for failed measurements:', error);
      return { hasFailures: false, count: 0 };
    }
  }, [currentSite?.schemaName, plotID, currentCensus?.dateRanges]);

  // Reset completion guard when new validation messages arrive (new validation cycle)
  useEffect(() => {
    if (Object.keys(validationMessages).length > 0) {
      hasCalledCompletionRef.current = false;
    }
  }, [validationMessages]);

  // Start validation when validation messages are loaded
  useEffect(() => {
    if (Object.keys(validationMessages).length > 0) {
      performValidations().catch(ailogger.error);
    }
  }, [validationMessages, performValidations]);

  // Check for failures and notify parent when validation is complete
  useEffect(() => {
    if (isValidationComplete && !isUpdatingRows && !hasCalledCompletionRef.current) {
      // Check for failed measurements before calling completion callback
      checkForFailedMeasurements()
        .then(failureCheck => {
          // Guard against duplicate callback execution
          if (hasCalledCompletionRef.current) return;
          hasCalledCompletionRef.current = true;

          const result: ValidationResult = {
            success: apiErrors.length === 0,
            hasFailedMeasurements: failureCheck.hasFailures,
            failedCount: failureCheck.count,
            errors: apiErrors
          };

          if (failureCheck.hasFailures) {
            ailogger.warn(`Validation completed with ${failureCheck.count} failed measurements. User should review failed measurements.`);
          } else {
            ailogger.info('Validation completed successfully with no failures.');
          }

          // Call parent callback with validation results
          if (onValidationComplete) {
            onValidationComplete(result);
          }
        })
        .catch(error => {
          // Guard against duplicate callback execution
          if (hasCalledCompletionRef.current) return;
          hasCalledCompletionRef.current = true;

          ailogger.error('Error during validation completion check:', error);
          // Still call completion callback even if check fails
          if (onValidationComplete) {
            onValidationComplete({
              success: apiErrors.length === 0,
              hasFailedMeasurements: false,
              failedCount: 0,
              errors: [...apiErrors, 'Failed to check for validation failures']
            });
          }
        });
    }
  }, [isValidationComplete, isUpdatingRows, onValidationComplete, checkForFailedMeasurements, apiErrors]);

  const renderProgressBars = () => {
    return Object.keys(validationMessages).map(validationProcedureName => {
      const progress = validationProgress[validationProcedureName] || 0;
      const progressId = `progress-${validationProcedureName.replace(/\s+/g, '-').toLowerCase()}`;
      const descId = `desc-${validationProcedureName.replace(/\s+/g, '-').toLowerCase()}`;

      return (
        <Box key={validationProcedureName} sx={{ mb: 2 }} role="group" aria-labelledby={progressId}>
          <Typography level="body-md" id={progressId}>
            {validationProcedureName}
          </Typography>
          <Typography level="body-md" id={descId}>
            {validationMessages[validationProcedureName]?.description}
          </Typography>
          <LinearProgress
            determinate
            value={progress}
            aria-labelledby={progressId}
            aria-describedby={descId}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${Math.round(progress)}% complete`}
          />
          <div className="sr-only">
            {validationProcedureName}: {Math.round(progress)}% complete
          </div>
        </Box>
      );
    });
  };

  return (
    <>
      {Object.keys(validationMessages).length > 0 && (
        <Box
          component="section"
          sx={{
            width: '100%',
            p: 2,
            display: 'flex',
            flex: 1,
            flexDirection: 'column'
          }}
          role="status"
          aria-live="polite"
          aria-label="Data validation progress"
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
              <Typography level="title-lg" component="h2" id="validation-status">
                Validating data...
              </Typography>
              <div role="progressbar" aria-describedby="validation-status">
                {renderProgressBars()}
              </div>
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
              <CircularProgress aria-label="Updating validated rows" />
              <Typography level="title-lg" component="h2">
                Updating validated rows...
              </Typography>
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
              <Typography level="title-lg" component="h2">
                Validation Results
              </Typography>
              {apiErrors.length > 0 && (
                <Box sx={{ mb: 2 }} role="alert" aria-live="assertive">
                  <Typography color="danger" component="h3">
                    Some validations could not be performed:
                  </Typography>
                  <ul>
                    {apiErrors.map(error => (
                      <li key={error}>
                        <Typography color="danger">{error}</Typography>
                      </li>
                    ))}
                  </ul>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </>
  );
}
