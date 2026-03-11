'use client';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, LinearProgress, Typography, CircularProgress, Stack, Chip } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import ailogger from '@/ailogger';
import { useAnimationCacheContext } from '@/app/contexts/animationcacheprovider';

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;
type ValidationExecutionResult = { procedureName: string; success: boolean; error?: string };

const DBH_GROWTH_PROCEDURE = 'ValidateDBHGrowthExceedsMax';
const DBH_SHRINKAGE_PROCEDURE = 'ValidateDBHShrinkageExceedsMax';
const QUADRAT_MISMATCH_PROCEDURE = 'ValidateQuadratMismatchAcrossCensuses';
const COORDINATE_DRIFT_PROCEDURE = 'ValidateCoordinateDriftAcrossCensuses';

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
  const [isLoadingValidationList, setIsLoadingValidationList] = useState<boolean>(true);

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { getAnimationUrl } = useAnimationCacheContext();

  const plotID = currentPlot?.plotID;

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMounted = useRef<boolean>(true);
  const hasCalledCompletionRef = useRef<boolean>(false);

  useEffect(() => {
    // Reset isMounted to true on mount (important for React StrictMode remounts)
    ailogger.info('[ValidationCore] Mount effect running, setting isMounted = true');
    isMounted.current = true;
    abortControllerRef.current = new AbortController();
    return () => {
      ailogger.info('[ValidationCore] Mount effect cleanup, setting isMounted = false');
      isMounted.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    // Guard: Don't fetch if schemaName is not available
    if (!currentSite?.schemaName) {
      ailogger.info('[ValidationCore] Skipping fetch - schemaName not available yet');
      return;
    }

    ailogger.info(`[ValidationCore] Starting fetch for schema: ${currentSite.schemaName}`);
    setIsLoadingValidationList(true);

    // Create a local abort controller for this effect
    const abortController = new AbortController();

    fetch(`/api/validations/validationlist?schema=${currentSite.schemaName}`, {
      signal: abortController.signal
    })
      .then(r => {
        ailogger.info(`[ValidationCore] Fetch response status: ${r.status}`);
        return r.json();
      })
      .then(data => {
        ailogger.info(`[ValidationCore] Parsed data, isMounted: ${isMounted.current}`);

        if (!isMounted.current) {
          ailogger.info('[ValidationCore] Component unmounted, skipping state update');
          return;
        }

        // Null safety: ensure coreValidations exists and is an object
        const coreValidations = data?.coreValidations || {};
        const validationCount = Object.keys(coreValidations).length;
        ailogger.info(`[ValidationCore] Found ${validationCount} validations`);

        // If no validations are defined, immediately call completion with success
        // Note: coreValidations is an object (Record<string, ...>), not an array, so use Object.keys()
        if (validationCount === 0) {
          ailogger.info('[ValidationCore] No validations, calling completion callback');
          setIsLoadingValidationList(false);
          if (onValidationComplete && !hasCalledCompletionRef.current) {
            hasCalledCompletionRef.current = true;
            ailogger.info('No validations defined for this schema. Completing validation with success.');
            onValidationComplete({
              success: true,
              hasFailedMeasurements: false,
              failedCount: 0,
              errors: []
            });
          }
          return; // Exit early - no validations to process or render
        }

        ailogger.info(`[ValidationCore] Setting validationMessages with ${validationCount} validations`);
        setValidationMessages(coreValidations);
        setValidationProgress(Object.keys(coreValidations).reduce((acc, api) => ({ ...acc, [api]: 0 }), {}));
        setIsLoadingValidationList(false);
        ailogger.info('[ValidationCore] State update complete, isLoadingValidationList set to false');
      })
      .catch((err: any) => {
        if (err.name !== 'AbortError') {
          ailogger.error('[ValidationCore] Error fetching validation list:', err);
          if (isMounted.current) {
            setIsLoadingValidationList(false);
          }
          // If fetch fails, call completion with error to avoid stuck blank state
          if (isMounted.current && onValidationComplete && !hasCalledCompletionRef.current) {
            hasCalledCompletionRef.current = true;
            onValidationComplete({
              success: false,
              hasFailedMeasurements: false,
              failedCount: 0,
              errors: [`Failed to fetch validation list: ${err.message || 'Unknown error'}`]
            });
          }
        } else {
          ailogger.info('[ValidationCore] Fetch aborted');
        }
      });

    // Cleanup: abort fetch on unmount or when dependencies change
    return () => {
      ailogger.info('[ValidationCore] Cleanup - aborting fetch');
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSite?.schemaName]);

  const performValidations = useCallback(async () => {
    try {
      const runSingleValidation = async (procedureName: string): Promise<ValidationExecutionResult[]> => {
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
              p_CensusID: currentCensus?.dateRanges?.[0]?.censusID,
              p_PlotID: plotID
            })
          });

          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            const serverError = payload?.error || `HTTP ${response.status}`;
            throw new Error(`Error executing ${procedureName}: ${serverError}`);
          }

          if (payload === false || payload?.success === false) {
            const serverError = payload?.error || 'unknown server error';
            throw new Error(`Validation returned failure for ${procedureName}: ${serverError}`);
          }

          if (isMounted.current) {
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [procedureName]: 100
            }));
          }

          return [{ procedureName, success: true }];
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

          return [{ procedureName, success: false, error: error.message }];
        }
      };

      const runCombinedDBHValidation = async (): Promise<ValidationExecutionResult[]> => {
        try {
          const response = await fetch('/api/validations/procedures/shared-dbh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortControllerRef.current?.signal,
            body: JSON.stringify({
              schema: currentSite?.schemaName,
              p_CensusID: currentCensus?.dateRanges?.[0]?.censusID,
              p_PlotID: plotID
            })
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.success === false) {
            const serverError = payload?.error || `HTTP ${response.status}`;
            throw new Error(`Error executing shared DBH validations: ${serverError}`);
          }

          if (isMounted.current) {
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [DBH_GROWTH_PROCEDURE]: 100,
              [DBH_SHRINKAGE_PROCEDURE]: 100
            }));
          }

          return [
            { procedureName: DBH_GROWTH_PROCEDURE, success: true },
            { procedureName: DBH_SHRINKAGE_PROCEDURE, success: true }
          ];
        } catch (error: any) {
          if (error.name === 'AbortError') {
            ailogger.info('Fetch aborted for shared DBH validations');
            throw error;
          }

          ailogger.warn(`Shared DBH validation path failed, falling back to individual calls: ${error.message}`);
          const fallbackResults = await Promise.all([
            runSingleValidation(DBH_GROWTH_PROCEDURE),
            runSingleValidation(DBH_SHRINKAGE_PROCEDURE)
          ]);
          return fallbackResults.flat();
        }
      };

      const runCombinedCrossCensusLocationValidation = async (): Promise<ValidationExecutionResult[]> => {
        try {
          const response = await fetch('/api/validations/procedures/shared-cross-census-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortControllerRef.current?.signal,
            body: JSON.stringify({
              schema: currentSite?.schemaName,
              p_CensusID: currentCensus?.dateRanges?.[0]?.censusID,
              p_PlotID: plotID
            })
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.success === false) {
            const serverError = payload?.error || `HTTP ${response.status}`;
            throw new Error(`Error executing shared cross-census location validations: ${serverError}`);
          }

          if (isMounted.current) {
            setValidationProgress(prevProgress => ({
              ...prevProgress,
              [QUADRAT_MISMATCH_PROCEDURE]: 100,
              [COORDINATE_DRIFT_PROCEDURE]: 100
            }));
          }

          return [
            { procedureName: QUADRAT_MISMATCH_PROCEDURE, success: true },
            { procedureName: COORDINATE_DRIFT_PROCEDURE, success: true }
          ];
        } catch (error: any) {
          if (error.name === 'AbortError') {
            ailogger.info('Fetch aborted for shared cross-census location validations');
            throw error;
          }

          ailogger.warn(`Shared cross-census location validation path failed, falling back to individual calls: ${error.message}`);
          const fallbackResults = await Promise.all([
            runSingleValidation(QUADRAT_MISMATCH_PROCEDURE),
            runSingleValidation(COORDINATE_DRIFT_PROCEDURE)
          ]);
          return fallbackResults.flat();
        }
      };

      const validationProcedureNames = Object.keys(validationMessages);
      const shouldUseCombinedDBHPath = Boolean(validationMessages[DBH_GROWTH_PROCEDURE] && validationMessages[DBH_SHRINKAGE_PROCEDURE]);
      const shouldUseCombinedCrossCensusLocationPath = Boolean(
        validationMessages[QUADRAT_MISMATCH_PROCEDURE] && validationMessages[COORDINATE_DRIFT_PROCEDURE]
      );
      const standaloneValidationNames = validationProcedureNames.filter(procedureName =>
        !(
          (shouldUseCombinedDBHPath &&
            (procedureName === DBH_GROWTH_PROCEDURE || procedureName === DBH_SHRINKAGE_PROCEDURE)) ||
          (shouldUseCombinedCrossCensusLocationPath &&
            (procedureName === QUADRAT_MISMATCH_PROCEDURE || procedureName === COORDINATE_DRIFT_PROCEDURE))
        )
      );

      const validationPromises = standaloneValidationNames.map(procedureName => runSingleValidation(procedureName));
      if (shouldUseCombinedDBHPath) {
        validationPromises.push(runCombinedDBHValidation());
      }
      if (shouldUseCombinedCrossCensusLocationPath) {
        validationPromises.push(runCombinedCrossCensusLocationValidation());
      }

      // Wait for all validations to complete (or fail)
      const results = await Promise.allSettled(validationPromises);

      // Check if any validation was aborted (indicating request cancellation)
      const wasAborted = results.some(result => result.status === 'rejected' && result.reason?.name === 'AbortError');

      if (wasAborted) {
        ailogger.info('Validation process was aborted');
        return;
      }

      // Log validation summary
      const flattenedResults = results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
      const successCount = flattenedResults.filter(result => result.success).length;
      const failCount = flattenedResults.filter(result => !result.success).length;
      ailogger.info(`Parallel validation complete: ${successCount} succeeded, ${failCount} failed`);

      try {
        if (isMounted.current) {
          setIsUpdatingRows(true);
        }
        await fetch(
          `/api/validations/updatepassedvalidations?schema=${currentSite?.schemaName}&plotID=${plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}`,
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
    if (!currentSite?.schemaName || !plotID || !currentCensus?.dateRanges?.[0]?.censusID) {
      ailogger.warn('Missing required context for checking failed measurements');
      return { hasFailures: false, count: 0 };
    }

    try {
      ailogger.info('Checking for failed measurements after validation...');
      const response = await fetch(`/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${plotID}/${currentCensus.dateRanges?.[0]?.censusID}`, {
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
      {/* Loading state while fetching validation list */}
      {isLoadingValidationList && (
        <Box
          component="section"
          sx={{
            width: '100%',
            p: 3,
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: { xs: '400px', sm: '500px', md: '600px' }
          }}
          role="status"
          aria-live="polite"
          aria-label="Loading validations"
        >
          <Stack spacing={3} sx={{ alignItems: 'center' }}>
            <CircularProgress size="lg" aria-label="Loading validation list" />
            <Typography level="h4">Preparing validations...</Typography>
            <Typography level="body-sm" color="neutral">
              Loading validation rules for this schema
            </Typography>
          </Stack>
        </Box>
      )}
      {!isLoadingValidationList && Object.keys(validationMessages).length > 0 && (
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
                src={getAnimationUrl('file-check.lottie')}
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
