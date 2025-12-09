'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import moment from 'moment';
import 'moment-duration-format';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import ailogger from '@/ailogger';

interface UploadReingestionProps {
  schema: string;
  setReviewState: (state: ReviewStates) => void;
  setIsDataUnsaved: (value: boolean) => void;
}

/**
 * UploadReingestion Component
 *
 * Handles reingestion of failed measurements by processing data already in temporarymeasurements table.
 * This component skips the file upload stage and goes directly to batch processing.
 *
 * Processing Flow:
 * 1. Queries temporarymeasurements for existing batches
 * 2. Processes batches sequentially to prevent race conditions
 * 3. Runs collapser to consolidate data
 * 4. Provides real-time progress updates
 */
const UploadReingestion: React.FC<UploadReingestionProps> = ({ schema, setReviewState, setIsDataUnsaved }) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const [totalBatches, setTotalBatches] = useState(0);
  const [processedChunks, setProcessedChunks] = useState<number>(0);
  const [processETC, setProcessETC] = useState('');
  const [processed, setProcessed] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationStep, setVerificationStep] = useState<number>(0);
  const [totalVerificationSteps, setTotalVerificationSteps] = useState<number>(0);
  const connectionLimit = 8;
  const totalProcessCompletionTimeRef = useRef(0);
  const chunkProcessStartTime = useRef(0);
  const batchProcessingStartedRef = useRef<boolean>(false);
  // Use a ref for isMounted to survive React 18 Strict Mode's double-effect execution
  const isMountedRef = useRef<boolean>(true);

  const fetchWithTimeout = async (url: string | URL | Request, options: RequestInit | undefined, timeout = 60000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      ailogger.warn(`Request timeout after ${timeout}ms for ${url}`);
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });

      if (!response.ok && response.status >= 500) {
        ailogger.error(`Server error ${response.status} for ${url}`);
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        ailogger.error(`Request aborted due to timeout for ${url}`);
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const createTransactionAwareQueue = (concurrency: number) => {
    let running = 0;
    let pending: (() => Promise<void>)[] = [];
    let isEmpty = true;
    let emptyResolvers: (() => void)[] = [];

    // Use iterative approach instead of recursion to prevent stack overflow on large queues
    const processNext = async () => {
      if (pending.length === 0) {
        if (running === 0) {
          isEmpty = true;
          emptyResolvers.forEach(resolve => resolve());
          emptyResolvers = [];
        }
        return;
      }

      const task = pending.shift()!;
      running++;
      isEmpty = false;

      try {
        await task();
      } catch (error) {
        ailogger.error('Task failed:', error instanceof Error ? error : new Error(String(error)));
      } finally {
        running--;
        // Use setTimeout to break recursion chain and prevent stack overflow
        if (pending.length > 0 && running < concurrency) {
          setTimeout(() => processNext(), 0);
        } else if (running === 0 && pending.length === 0) {
          isEmpty = true;
          emptyResolvers.forEach(resolve => resolve());
          emptyResolvers = [];
        }
      }
    };

    return {
      add: (task: () => Promise<void>) => {
        pending.push(task);
        if (running < concurrency) {
          processNext();
        }
      },
      clear: () => {
        pending = [];
      },
      onEmpty: () => {
        if (isEmpty && running === 0) {
          return Promise.resolve();
        }
        return new Promise<void>(resolve => {
          emptyResolvers.push(resolve);
        });
      },
      get size() {
        return pending.length;
      }
    };
  };

  const queue = useMemo(() => createTransactionAwareQueue(connectionLimit), [connectionLimit]);

  useEffect(() => {
    if (processedChunks > 0) {
      const now = performance.now();
      const elapsed = now - chunkProcessStartTime.current;
      totalProcessCompletionTimeRef.current += elapsed;
      chunkProcessStartTime.current = now;
    }
  }, [processedChunks]);

  useEffect(() => {
    if (!processed) {
      if (processedChunks < 3) {
        setProcessETC('Calculating...');
        return;
      }

      const smoothingFactor = 0.2;
      const currentElapsed = performance.now() - chunkProcessStartTime.current;
      const smoothedAvgProcessTime = smoothingFactor * currentElapsed + (1 - smoothingFactor) * (totalProcessCompletionTimeRef.current / processedChunks);
      const remainingProcessing = totalBatches - processedChunks;
      const estimatedProcessTime = smoothedAvgProcessTime * remainingProcessing;

      setProcessETC(
        moment.utc(estimatedProcessTime).format('mm:ss').split(':')[0] +
          ' minutes and ' +
          moment.utc(estimatedProcessTime).format('mm:ss').split(':')[1] +
          ' seconds remaining...'
      );
    }
  }, [processed, processedChunks, totalBatches]);

  useEffect(() => {
    // ALWAYS reset isMountedRef to true on mount, BEFORE any guard checks
    // This is critical because the guard may return early, but we still need
    // the ref to reflect that the component is currently mounted so any
    // ongoing async operations can continue their state updates
    isMountedRef.current = true;

    // Prevent re-initialization if already processing or if processing has completed
    // This guards against context changes (schema/plot/census) during reingestion
    if (batchProcessingStartedRef.current || processedChunks > 0 || processed) {
      ailogger.info('[REINGESTION GUARD] Skipping reingestion initialization - already processing or completed');
      return;
    }
    batchProcessingStartedRef.current = true;

    async function runProcessBatches() {
      try {
        setProcessedChunks(0);
        chunkProcessStartTime.current = performance.now();
        ailogger.info(
          `Setting up bulk processor for reingestion - schema: ${schema}, plotID: ${currentPlot?.plotID ?? -1}, censusID: ${currentCensus?.dateRanges?.[0]?.censusID}`
        );

        const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges?.[0]?.censusID}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: response.statusText }));
          throw new Error(`Failed to setup bulk processor: ${response.status} - ${errorData.message || response.statusText}`);
        }
        const output: { fileID: string; batchID: string }[] = await response.json();
        ailogger.info(`Received ${output.length} batches to process for reingestion:`, output);

        const grouped: Record<string, string[]> = output.reduce(
          (acc, { fileID, batchID }) => {
            if (!acc[fileID]) {
              acc[fileID] = [];
            }
            acc[fileID].push(batchID);
            return acc;
          },
          {} as Record<string, string[]>
        );
        const totalBatchCount = Object.values(grouped).reduce((acc, arr) => acc + arr.length, 0);
        setTotalBatches(totalBatchCount);

        if (totalBatchCount === 0) {
          ailogger.info('No batches to process for reingestion, proceeding to verification and consolidation');
          batchProcessingStartedRef.current = false;
          // Skip batch processing and go directly to verification
          if (isMountedRef.current) {
            setIsVerifying(true);
            setTotalVerificationSteps(3);
            setVerificationStep(0);
            setVerificationStatus('Preparing reingestion verification...');
          }

          await new Promise(resolve => setTimeout(resolve, 1500));

          // Verify batch processing
          try {
            if (isMountedRef.current) {
              setVerificationStep(1);
              setVerificationStatus('Verifying reingestion batch processing...');
            }

            const verifyProcessingResponse = await fetch(
              `/api/verifyprocessing?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}`
            );
            if (verifyProcessingResponse.ok) {
              const verifyData = await verifyProcessingResponse.json();
              if (isMountedRef.current) {
                setVerificationStatus(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
              }
              ailogger.info(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
            } else {
              if (isMountedRef.current) {
                setVerificationStatus('Reingestion verification failed, continuing...');
              }
              ailogger.warn('Reingestion verification failed, but continuing');
            }
          } catch (verifyError: any) {
            if (isMountedRef.current) {
              setVerificationStatus(`Reingestion verification error: ${verifyError.message}`);
            }
            ailogger.warn('Reingestion verification error:', verifyError.message);
          }

          await new Promise(resolve => setTimeout(resolve, 1000));

          // Run collapser
          try {
            if (isMountedRef.current) {
              setVerificationStep(2);
              setVerificationStatus('Starting data consolidation...');
            }
            ailogger.info('Starting collapser for reingestion...');

            const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            });
            if (!collapserResponse.ok) {
              const errorData = await collapserResponse.json().catch(() => ({ message: collapserResponse.statusText }));
              throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorData.message || collapserResponse.statusText}`);
            }
            const collapserData = await collapserResponse.json();
            if (isMountedRef.current) {
              setVerificationStatus('Reingestion data consolidation completed');
            }
            ailogger.info('Reingestion collapser completed successfully:', collapserData);

            if (isMountedRef.current) {
              setVerificationStep(3);
              setVerificationStatus('Finalizing reingestion...');
            }
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (isMountedRef.current) {
              setVerificationStatus('Reingestion completed successfully');
            }
          } catch (collapserError: any) {
            if (isMountedRef.current) {
              setVerificationStatus(`Data consolidation error: ${collapserError.message}`);
            }
            ailogger.error('Reingestion collapser error:', collapserError.message);
            throw collapserError;
          }

          await new Promise(resolve => setTimeout(resolve, 1000));

          if (isMountedRef.current) {
            setIsVerifying(false);
            setProcessed(true);
          }
          return;
        }

        for (const fileID in grouped) {
          ailogger.info(`Processing FileID: ${fileID} for reingestion`);

          const batchTasks = grouped[fileID].map(
            batchID => () =>
              fetchWithTimeout(
                `/api/setupbulkprocedure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`,
                { method: 'GET' },
                480000 // 8 minute timeout
              )
                .then(async response => {
                  if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: response.statusText }));
                    throw new Error(`API returned status ${response.status} for batch ${fileID}-${batchID}: ${errorData.message || response.statusText}`);
                  }
                  const result = await response.json();

                  if (result.batchFailedButHandled) {
                    ailogger.info(`Batch ${fileID}-${batchID} was handled internally: ${result.message}`);
                  }

                  ailogger.info(`Successfully processed batch ${fileID}-${batchID}`);
                })
                .catch(async (e: any) => {
                  const errorMessage = e?.message || e?.toString() || 'Unknown error';

                  const isMonitoringError =
                    errorMessage.includes('Maximum ajax per page view limit') ||
                    errorMessage.includes('AI (Internal)') ||
                    errorMessage.includes('Failed to calculate the duration of the fetch call');

                  if (isMonitoringError) {
                    ailogger.warn(`Batch ${fileID}-${batchID} encountered monitoring system error: ${errorMessage}`);
                  } else {
                    ailogger.error(`Error processing batch ${fileID}-${batchID}:`, e);
                    if (!errorMessage.includes('handled internally')) {
                      try {
                        ailogger.warn(`Moving ${fileID}-${batchID} to failedmeasurements due to error: ${errorMessage}`);
                        const failureResponse = await fetch(
                          `/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`
                        );
                        if (!failureResponse.ok) {
                          const errorData = await failureResponse.json().catch(() => ({ message: failureResponse.statusText }));
                          throw new Error(
                            `Failed to move batch to failed measurements: ${failureResponse.status} - ${errorData.message || failureResponse.statusText}`
                          );
                        }
                      } catch (failureError: any) {
                        ailogger.error(`Failed to move ${fileID}-${batchID} to failedmeasurements:`, failureError);
                      }
                    }
                  }
                })
                .finally(() => {
                  // Consolidate batch progress tracking to prevent double-counting
                  // Check mount state before updating to prevent state updates after unmount
                  if (isMountedRef.current) {
                    setProcessedChunks(prev => {
                      const newValue = prev + 1;
                      ailogger.info(`Reingestion batch progress: ${newValue}/${totalBatchCount} batches completed`);
                      return newValue;
                    });
                  }
                })
          );

          try {
            ailogger.info(`Starting reingestion batch processing for ${fileID} with ${batchTasks.length} batches`);
            for (const batchTask of batchTasks) {
              queue.add(async () => {
                await batchTask();
              });
            }
          } catch (fileError: any) {
            ailogger.error(`File processing failed for ${fileID}:`, fileError);
          }
        }

        await queue.onEmpty();

        // Start processing verification
        if (isMountedRef.current) {
          setIsVerifying(true);
          setTotalVerificationSteps(3);
          setVerificationStep(0);
          setVerificationStatus('Preparing reingestion verification...');
        }

        await new Promise(resolve => setTimeout(resolve, 1500));

        // Verify batch processing
        try {
          if (isMountedRef.current) {
            setVerificationStep(1);
            setVerificationStatus('Verifying reingestion batch processing...');
          }

          const verifyProcessingResponse = await fetch(
            `/api/verifyprocessing?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}`
          );
          if (verifyProcessingResponse.ok) {
            const verifyData = await verifyProcessingResponse.json();
            if (isMountedRef.current) {
              setVerificationStatus(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
            }
            ailogger.info(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
          } else {
            if (isMountedRef.current) {
              setVerificationStatus('Reingestion verification failed, continuing...');
            }
            ailogger.warn('Reingestion verification failed, but continuing');
          }
        } catch (verifyError: any) {
          if (isMountedRef.current) {
            setVerificationStatus(`Reingestion verification error: ${verifyError.message}`);
          }
          ailogger.warn('Reingestion verification error:', verifyError.message);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Run collapser
        try {
          if (isMountedRef.current) {
            setVerificationStep(2);
            setVerificationStatus('Starting data consolidation...');
          }
          ailogger.info('Starting collapser for reingestion...');

          const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!collapserResponse.ok) {
            const errorData = await collapserResponse.json().catch(() => ({ message: collapserResponse.statusText }));
            throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorData.message || collapserResponse.statusText}`);
          }
          const collapserData = await collapserResponse.json();
          if (isMountedRef.current) {
            setVerificationStatus('Reingestion data consolidation completed');
          }
          ailogger.info('Reingestion collapser completed successfully:', collapserData);

          if (isMountedRef.current) {
            setVerificationStep(3);
            setVerificationStatus('Finalizing reingestion...');
          }
          await new Promise(resolve => setTimeout(resolve, 2000));

          if (isMountedRef.current) {
            setVerificationStatus('Reingestion completed successfully');
          }
        } catch (collapserError: any) {
          if (isMountedRef.current) {
            setVerificationStatus(`Data consolidation error: ${collapserError.message}`);
          }
          ailogger.error('Reingestion collapser error:', collapserError.message);
          throw collapserError;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (isMountedRef.current) {
          setIsVerifying(false);
          setProcessed(true);
        }
      } catch (error: any) {
        ailogger.error('Reingestion processing error:', error);
        if (isMountedRef.current) {
          setReviewState(ReviewStates.ERRORS);
        }
      } finally {
        // Ensure cleanup happens even if errors occur
        if (isMountedRef.current) {
          setIsVerifying(false);
        }
        // Don't reset batchProcessingStartedRef here to prevent re-triggering on state changes
        // It will be reset on unmount via cleanup function
      }
    }

    runProcessBatches();

    // Cleanup only on unmount - don't reset isMountedRef on re-renders
    // The guard at the top prevents re-initialization during re-renders
    // NOTE: Do NOT reset batchProcessingStartedRef here - it could allow re-initialization
    // on fast remount scenarios. The ref should only be reset when the parent component
    // fully unmounts and remounts the upload system.
    return () => {
      ailogger.info('[REINGESTION CLEANUP] Component unmounting, setting isMountedRef.current = false');
      isMountedRef.current = false;
      // Removed: batchProcessingStartedRef.current = false;
      // This was causing potential re-initialization issues on fast remounts
    };
    // Empty dependency array - only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (processed) {
      // Check mount state before state transition
      if (!isMountedRef.current) {
        ailogger.warn('[REINGESTION] Component unmounted before state transition - skipping');
        return;
      }

      ailogger.info('[REINGESTION COMPLETE] Reingestion finished successfully - transitioning to VALIDATE state');
      setIsVerifying(false);
      setVerificationStatus('Reingestion completed successfully');
      setVerificationStep(0);
      setTotalVerificationSteps(0);
      setReviewState(ReviewStates.VALIDATE);
      setIsDataUnsaved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed]);

  const { palette: _palette } = useTheme();

  // Determine which animation to show based on current stage
  // Reingestion skips the upload stage, so we use processing and verification animations
  // Use API route for reliable serving in standalone mode
  const getStageAnimation = (): string => {
    if (isVerifying) return '/api/animations/startup.lottie';
    return '/api/animations/data-processing.lottie'; // Processing stage
  };

  // Calculate overall progress percentage
  const calculateOverallProgress = (): number => {
    if (processed) return 100;
    if (totalBatches === 0) return 0;

    const processingWeight = 0.7;
    const verificationWeight = 0.3;

    let progress = 0;

    // Processing progress
    progress += (processedChunks / totalBatches) * 100 * processingWeight;

    // Verification progress (if in verification phase)
    if (isVerifying && totalVerificationSteps > 0) {
      progress += (verificationStep / totalVerificationSteps) * 100 * verificationWeight;
    } else if (processedChunks >= totalBatches) {
      // Processing complete, waiting for verification
      progress = processingWeight * 100;
    }

    return Math.min(progress, 100);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        mt: 4,
        px: 3,
        position: 'relative',
        minHeight: { xs: '400px', sm: '500px', md: '600px' },
        overflow: 'hidden'
      }}
    >
      {/* Background Animation Layer - Behind Everything */}
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
          key={getStageAnimation()} // Force re-render when animation changes
          src={getStageAnimation()}
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

      {/* Foreground Content - On Top of Animation */}
      <Stack
        direction="column"
        spacing={4}
        sx={{
          width: '100%',
          maxWidth: '600px',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1
        }}
      >
        {/* Header */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography level="h3" sx={{ mb: 1 }}>
            {processed ? 'Reingestion Complete' : isVerifying ? 'Finalizing Reingestion...' : 'Processing Data...'}
          </Typography>
          <Typography level="body-lg" color="primary" sx={{ fontWeight: 600 }}>
            {calculateOverallProgress().toFixed(0)}% Complete
          </Typography>
        </Box>

        {/* Main Progress Bar */}
        <Box sx={{ width: '100%' }}>
          <LinearProgress
            determinate
            size="lg"
            variant="soft"
            color="primary"
            value={calculateOverallProgress()}
            sx={{
              width: '100%',
              '--LinearProgress-thickness': '12px',
              '--LinearProgress-radius': '8px'
            }}
            aria-label="Overall reingestion progress"
            aria-valuenow={calculateOverallProgress()}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </Box>

        {/* Detailed Progress */}
        {totalBatches !== 0 && (
          <Typography level="body-md" color="neutral" sx={{ textAlign: 'center' }}>
            {processedChunks}/{totalBatches} batches processed
            {processedChunks < totalBatches && processETC !== 'Calculating...' && ` • ${processETC}`}
          </Typography>
        )}

        {/* Verification Status */}
        {isVerifying && verificationStatus && (
          <Typography level="body-sm" color="neutral" sx={{ textAlign: 'center' }}>
            {verificationStatus}
          </Typography>
        )}

        {/* Status Description */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography level="body-sm" color="neutral">
            {processed ? 'Reingestion complete!' : isVerifying ? 'Verifying data integrity...' : 'Processing data batches...'}
          </Typography>
          <Typography level="body-xs" color="neutral" sx={{ mt: 1, opacity: 0.7 }}>
            Please do not exit this page
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
};

export default UploadReingestion;
