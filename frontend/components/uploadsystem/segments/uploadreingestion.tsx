'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
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
        processNext();
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

  const queue = createTransactionAwareQueue(connectionLimit);

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
    let isMounted = true;

    async function runProcessBatches() {
      try {
        setProcessedChunks(0);
        chunkProcessStartTime.current = performance.now();
        ailogger.info(
          `Setting up bulk processor for reingestion - schema: ${schema}, plotID: ${currentPlot?.plotID ?? -1}, censusID: ${currentCensus?.dateRanges[0].censusID}`
        );

        const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges[0].censusID}`);
        if (!response.ok) {
          throw new Error(`Failed to setup bulk processor: ${response.status} - ${response.statusText}`);
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
                    throw new Error(`API returned status ${response.status} for batch ${fileID}-${batchID}`);
                  }
                  const result = await response.json();

                  if (result.batchFailedButHandled) {
                    ailogger.info(`Batch ${fileID}-${batchID} was handled internally: ${result.message}`);
                  }

                  ailogger.info(`Successfully processed batch ${fileID}-${batchID}`);
                  setProcessedChunks(prev => {
                    const newValue = prev + 1;
                    ailogger.info(`Reingestion batch progress: ${newValue}/${totalBatchCount} batches completed`);
                    return newValue;
                  });
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
                          throw new Error(`Failed to move batch to failed measurements: ${failureResponse.status}`);
                        }
                      } catch (failureError: any) {
                        ailogger.error(`Failed to move ${fileID}-${batchID} to failedmeasurements:`, failureError);
                      }
                    }
                  }

                  setProcessedChunks(prev => {
                    const newValue = prev + 1;
                    ailogger.info(
                      `Batch progress (with ${isMonitoringError ? 'monitoring issue' : 'failure'}): ${newValue}/${totalBatchCount} batches completed`
                    );
                    return newValue;
                  });
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
        if (isMounted) {
          setIsVerifying(true);
          setTotalVerificationSteps(3);
          setVerificationStep(0);
          setVerificationStatus('Preparing reingestion verification...');
        }

        await new Promise(resolve => setTimeout(resolve, 1500));

        // Verify batch processing
        try {
          if (isMounted) {
            setVerificationStep(1);
            setVerificationStatus('Verifying reingestion batch processing...');
          }

          const verifyProcessingResponse = await fetch(
            `/api/verifyprocessing?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`
          );
          if (verifyProcessingResponse.ok) {
            const verifyData = await verifyProcessingResponse.json();
            if (isMounted) {
              setVerificationStatus(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
            }
            ailogger.info(`Reingestion verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining`);
          } else {
            if (isMounted) {
              setVerificationStatus('Reingestion verification failed, continuing...');
            }
            ailogger.warn('Reingestion verification failed, but continuing');
          }
        } catch (verifyError: any) {
          if (isMounted) {
            setVerificationStatus(`Reingestion verification error: ${verifyError.message}`);
          }
          ailogger.warn('Reingestion verification error:', verifyError.message);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Run collapser
        try {
          if (isMounted) {
            setVerificationStep(2);
            setVerificationStatus('Starting data consolidation...');
          }
          ailogger.info('Starting collapser for reingestion...');

          const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges[0].censusID}?schema=${schema}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!collapserResponse.ok) {
            const errorText = await collapserResponse.text().catch(() => 'Unknown error');
            throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorText}`);
          }
          const collapserData = await collapserResponse.json();
          if (isMounted) {
            setVerificationStatus('Reingestion data consolidation completed');
          }
          ailogger.info('Reingestion collapser completed successfully:', collapserData);

          if (isMounted) {
            setVerificationStep(3);
            setVerificationStatus('Finalizing reingestion...');
          }
          await new Promise(resolve => setTimeout(resolve, 2000));

          if (isMounted) {
            setVerificationStatus('Reingestion completed successfully');
          }
        } catch (collapserError: any) {
          if (isMounted) {
            setVerificationStatus(`Data consolidation error: ${collapserError.message}`);
          }
          ailogger.error('Reingestion collapser error:', collapserError.message);
          throw collapserError;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (isMounted) {
          setIsVerifying(false);
          setProcessed(true);
        }
      } catch (error: any) {
        ailogger.error('Reingestion processing error:', error);
        if (isMounted) {
          setReviewState(ReviewStates.ERRORS);
        }
      }
    }

    runProcessBatches();

    return () => {
      isMounted = false;
    };
  }, [schema, currentPlot, currentCensus]);

  useEffect(() => {
    if (processed) {
      setIsVerifying(false);
      setVerificationStatus('Reingestion completed successfully');
      setVerificationStep(0);
      setTotalVerificationSteps(0);
      setReviewState(ReviewStates.VALIDATE);
      setIsDataUnsaved(false);
    }
  }, [processed, setReviewState, setIsDataUnsaved]);

  const { palette } = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        mt: 4
      }}
    >
      <Stack direction="column" spacing={3} sx={{ width: '100%', maxWidth: '600px', alignItems: 'center' }}>
        <Stack direction="row" spacing={3} sx={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <Typography level="title-lg">Reingestion Progress</Typography>
          <Typography level="body-sm" color="neutral">
            {totalBatches} batches total
          </Typography>
        </Stack>

        {totalBatches !== 0 && (
          <Box sx={{ width: '100%' }}>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1, width: '100%' }}>
              <Typography level="body-sm">Batch Processing</Typography>
              <Typography level="body-sm" color="primary">
                {processedChunks}/{totalBatches} batches
              </Typography>
            </Stack>
            <LinearProgress determinate variant="soft" color="success" size="lg" value={(processedChunks / totalBatches) * 100} sx={{ width: '100%' }} />
            {processedChunks < totalBatches && processETC !== 'Calculating...' && (
              <Typography level="body-xs" sx={{ mt: 1, textAlign: 'center', width: '100%' }} color="neutral">
                {((processedChunks / totalBatches) * 100).toFixed(1)}% complete • {processETC}
              </Typography>
            )}
          </Box>
        )}

        {isVerifying && totalVerificationSteps > 0 && (
          <Box sx={{ width: '100%' }}>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1, width: '100%' }}>
              <Typography level="body-sm">Verification Process</Typography>
              <Typography level="body-sm" color="warning">
                {verificationStep}/{totalVerificationSteps} steps
              </Typography>
            </Stack>
            <LinearProgress
              determinate
              variant="soft"
              color="warning"
              size="lg"
              value={totalVerificationSteps > 0 ? (verificationStep / totalVerificationSteps) * 100 : 0}
              sx={{ width: '100%' }}
            />
            {verificationStatus && (
              <Typography level="body-xs" sx={{ mt: 1, textAlign: 'center', width: '100%' }} color="neutral">
                {verificationStatus}
              </Typography>
            )}
          </Box>
        )}

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            mt: 4
          }}
        >
          <Typography level="body-sm" color="neutral" sx={{ mb: 2 }}>
            {isVerifying ? 'Please do not exit this page while verification is in progress' : 'Please do not exit this page while reingestion is in progress'}
          </Typography>
          {!processed && !isVerifying && (
            <DotLottieReact
              src="https://lottie.host/a63eade6-f7ba-4e21-8575-2b9597dfe741/6F8LYdqlaK.lottie"
              loop
              autoplay
              themeId={palette.mode === 'dark' ? 'Dark' : undefined}
              style={{
                width: '200px',
                height: '200px'
              }}
            />
          )}
          {isVerifying && (
            <DotLottieReact
              src="https://lottie.host/61a4d60d-51b8-4603-8c31-3a0187b2ddc6/BYrv3qTBtA.lottie"
              loop
              autoplay
              themeId={palette.mode === 'dark' ? 'Dark' : undefined}
              style={{
                width: '200px',
                height: '200px',
                filter: 'hue-rotate(45deg)'
              }}
            />
          )}
        </Box>
      </Stack>
    </Box>
  );
};

export default UploadReingestion;
