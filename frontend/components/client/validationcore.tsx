'use client';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, LinearProgress, Typography, CircularProgress, Stack, Chip } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import ailogger from '@/ailogger';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

/**
 * Converts camelCase or PascalCase validation names to human-readable format
 * e.g., "ValidateScreenMeasuredDiameter" -> "Validate Screen Measured Diameter"
 * e.g., "DBHGrowthExceedsMax" -> "DBH Growth Exceeds Max"
 */
function formatValidationName(name: string): string {
  // Handle common abbreviations that should stay together
  const _preserveAbbreviations = ['DBH', 'HOM', 'ID', 'SQL', 'API'];

  // First, insert spaces before capital letters (but not at the start)
  let formatted = name.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Also handle sequences of capitals followed by lowercase (e.g., "DBHGrowth" -> "DBH Growth")
  formatted = formatted.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Capitalize first letter
  formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);

  return formatted;
}

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
        if (!isMounted.current) return;
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

      // Run validations in parallel for better performance
      // Use Promise.allSettled to handle individual failures without stopping other validations
      const validationPromises = validationProcedureNames.map(async procedureName => {
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

          if (isMounted.current) {
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: 100
            }));
          }

          return { procedureName, success: true };
        } catch (error: any) {
          if (error.name === 'AbortError') {
            ailogger.info(`Fetch aborted for ${procedureName}`);
            throw error; // Re-throw abort errors
          }

          ailogger.error(`Error performing validation for ${procedureName}:`, error);
          if (isMounted.current) {
            setApiErrors(prev => [...prev, `Failed to execute ${procedureName}: ${error.message}`]);
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: -1
            }));
          }

          return { procedureName, success: false, error: error.message };
        }
      });

      // Wait for all validations to complete (or fail)
      const results = await Promise.allSettled(validationPromises);

      // Check if any validation was aborted (indicating request cancellation)
      const wasAborted = results.some(result => result.status === 'rejected' && result.reason?.name === 'AbortError');

      if (wasAborted) {
        ailogger.info('Validation process was aborted');
        return;
      }

      // Log validation summary
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failCount = results.filter(r => r.status === 'fulfilled' && !r.value?.success).length;
      ailogger.info(`Parallel validation complete: ${successCount} succeeded, ${failCount} failed`);

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
      if (isMounted.current) {
        setIsUpdatingRows(false);
        setIsValidationComplete(true);
      }
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

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    const progressValues = Object.values(validationProgress);
    if (progressValues.length === 0) return 0;
    const sum = progressValues.reduce((acc, val) => acc + (val >= 0 ? val : 0), 0);
    return sum / progressValues.length;
  }, [validationProgress]);

  // Count completed and failed validations
  const { completedCount, failedCount, totalCount } = useMemo(() => {
    const progressValues = Object.values(validationProgress);
    return {
      completedCount: progressValues.filter(v => v === 100).length,
      failedCount: progressValues.filter(v => v === -1).length,
      totalCount: progressValues.length
    };
  }, [validationProgress]);

  return (
    <>
      {Object.keys(validationMessages).length > 0 && (
        <Box
          component="section"
          sx={{
            width: '100%',
            p: 3,
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
            minHeight: { xs: '400px', sm: '500px', md: '600px' },
            overflow: 'hidden'
          }}
          role="status"
          aria-live="polite"
          aria-label="Data validation progress"
        >
          {/* Background Animation Layer - Behind Everything */}
          {!isValidationComplete && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                bgcolor: '#000000',
                opacity: 0.3,
                zIndex: 0
              }}
            >
              <DotLottieReact
                src="/animations/file-check.lottie"
                loop
                autoplay
                style={{
                  width: '100%',
                  height: '100%',
                  maxWidth: '800px',
                  maxHeight: '800px'
                }}
              />
            </Box>
          )}

          {!isValidationComplete ? (
            <Stack
              spacing={4}
              sx={{
                width: '100%',
                alignItems: 'center',
                position: 'relative',
                zIndex: 1
              }}
            >
              {/* Header */}
              <Box sx={{ textAlign: 'center' }}>
                <Typography level="h3" sx={{ mb: 1 }}>
                  Validating data...
                </Typography>
                <Typography level="body-lg" color="primary" sx={{ fontWeight: 600 }}>
                  {overallProgress.toFixed(0)}% Complete
                </Typography>
              </Box>

              {/* Main Progress Bar */}
              <Box sx={{ width: '100%', maxWidth: '600px' }}>
                <LinearProgress
                  determinate
                  size="lg"
                  variant="soft"
                  color="primary"
                  value={overallProgress}
                  sx={{
                    width: '100%',
                    height: 12,
                    borderRadius: 'md'
                  }}
                  aria-label="Overall validation progress"
                  aria-valuenow={overallProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </Box>

              {/* Status Summary */}
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Chip variant="soft" color="success" size="sm">
                  {completedCount} of {totalCount} checks complete
                </Chip>
                {failedCount > 0 && (
                  <Chip variant="soft" color="danger" size="sm">
                    {failedCount} failed
                  </Chip>
                )}
              </Stack>

              {/* Current validation being run - just show the name cleanly */}
              {Object.entries(validationProgress).find(([_, v]) => v > 0 && v < 100) && (
                <Typography level="body-sm" color="neutral" sx={{ textAlign: 'center' }}>
                  Running: {formatValidationName(Object.entries(validationProgress).find(([_, v]) => v > 0 && v < 100)?.[0] || '')}
                </Typography>
              )}

              <Typography level="body-sm" color="neutral">
                Please do not close this window
              </Typography>
            </Stack>
          ) : isUpdatingRows ? (
            <Stack spacing={3} sx={{ alignItems: 'center' }}>
              <CircularProgress size="lg" aria-label="Updating validated rows" />
              <Typography level="h4">Finalizing validation results...</Typography>
              <Typography level="body-sm" color="neutral">
                Please wait while we update the database
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <Typography level="h3" color={apiErrors.length > 0 ? 'warning' : 'success'}>
                {apiErrors.length > 0 ? 'Validation Completed with Issues' : 'Validation Complete'}
              </Typography>

              <Stack direction="row" spacing={2}>
                <Chip variant="soft" color="success" size="md">
                  {completedCount} checks passed
                </Chip>
                {failedCount > 0 && (
                  <Chip variant="soft" color="danger" size="md">
                    {failedCount} checks failed
                  </Chip>
                )}
              </Stack>

              {apiErrors.length > 0 && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'danger.softBg', borderRadius: 'md', maxWidth: '500px' }} role="alert">
                  <Typography level="body-sm" color="danger" sx={{ mb: 1, fontWeight: 600 }}>
                    Issues encountered:
                  </Typography>
                  {apiErrors.slice(0, 3).map((error, idx) => (
                    <Typography key={idx} level="body-xs" color="danger">
                      {error}
                    </Typography>
                  ))}
                  {apiErrors.length > 3 && (
                    <Typography level="body-xs" color="danger" sx={{ mt: 1 }}>
                      ...and {apiErrors.length - 3} more
                    </Typography>
                  )}
                </Box>
              )}
            </Stack>
          )}
        </Box>
      )}
    </>
  );
}
