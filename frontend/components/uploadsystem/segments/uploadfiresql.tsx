'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import {
  FileCollectionRowSet,
  FileRow,
  FileRowSet,
  FormType,
  getTableHeaders,
  RequiredTableHeadersByFormType,
  SourceFormat
} from '@/config/macros/formdetails';
import { chunkFileRowSet } from '@/lib/arcgis/chunk-rowset';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import Papa, { ParseResult } from 'papaparse';
import moment from 'moment';
import 'moment-duration-format';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useSession } from 'next-auth/react';
import { useAnimationCacheContext } from '@/app/contexts/animationcacheprovider';
import { v4 } from 'uuid';
import ailogger from '@/ailogger';
import { detectDelimiter, validateDelimiter } from '@/components/uploadsystemhelpers/delimiterdetection';
import { useUploadSession } from '@/app/hooks/useuploadsession';
import { ETACalculator, formatTimeRemaining, createTransactionAwareQueue } from '@/components/uploadsystemhelpers/uploadprocessingutils';
import {
  buildUploadSessionRestartRequiredError,
  getApiErrorMessage,
  isUploadSessionRestartRequiredError,
  parseUploadSessionConflict,
  readResponsePayload
} from '@/components/uploadsystemhelpers/uploadsessionconflicts';
import { abortChunkProcessingAfterPermanentUploadFailure, shouldTimeoutPausedParser } from '@/components/uploadsystemhelpers/uploadqueueguards';
import { generateShortBatchID } from '@/config/utils';
import { useBackgroundValidation } from '@/app/hooks/usebackgroundvalidation';

const ARCGIS_SUBMIT_CHUNK_SIZE = 1000;

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function waitForAbortableDelay(ms: number, signal: AbortSignal, label: string): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError(label));
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      reject(createAbortError(label));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * UploadFireSQL Component
 *
 * Handles bulk measurement data upload and processing with enhanced reliability features:
 *
 * Key Features:
 * - Sequential batch processing to prevent race conditions and data duplication
 * - Application-level deduplication before SQL insertion
 * - Transaction coordination between processors and collapser
 * - Comprehensive error handling and progress tracking
 *
 * Processing Flow:
 * 1. Uploads CSV data in chunks to temporarymeasurements table
 * 2. Processes batches sequentially (not parallel) to prevent contamination
 * 3. Waits for transaction settlement before running collapser
 * 4. Provides real-time progress updates and error reporting
 *
 * This component resolves the record count mismatches that occurred when
 * parallel processing caused duplicate insertions and race conditions.
 */
const UploadFireSQL: React.FC<UploadFireProps> = ({
  acceptedFiles,
  uploadForm,
  uploadMode,
  sourceFormat,
  setIsDataUnsaved,
  schema,
  setUploadError,
  setReviewState,
  selectedDelimiters,
  preparedRowSet
}) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentPlotID = currentPlot?.plotID ?? null;
  const currentCensusID = currentCensus?.dateRanges?.[0]?.censusID ?? null;
  const { startValidation } = useBackgroundValidation();
  const fatalUploadErrorRef = useRef<Error | null>(null);

  const markFatalUploadError = useCallback((error: Error): Error => {
    if (!fatalUploadErrorRef.current) {
      fatalUploadErrorRef.current = error;
    }
    return fatalUploadErrorRef.current;
  }, []);

  const handleUploadSessionExpired = useCallback(() => {
    markFatalUploadError(buildUploadSessionRestartRequiredError('the upload could continue'));
  }, [markFatalUploadError]);

  // Session tracking for client disconnection handling
  const {
    sessionId: _sessionId,
    getCurrentSessionId,
    createSession,
    updateState,
    completeSession,
    cancelSession,
    isSessionActive: _isSessionActive
  } = useUploadSession({
    schema,
    plotId: currentPlotID ?? -1,
    censusId: currentCensusID ?? -1,
    onSessionExpired: handleUploadSessionExpired
  });

  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [completedChunks, setCompletedChunks] = useState<number>(0);
  const [processedChunks, setProcessedChunks] = useState<number>(0);
  const [uploaded, setUploaded] = useState<boolean>(false);
  const [processed, setProcessed] = useState<boolean>(false);
  const [_verificationStatus, setVerificationStatus] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationStep, setVerificationStep] = useState<number>(0);
  const [totalVerificationSteps, setTotalVerificationSteps] = useState<number>(0);
  const { data: session } = useSession();
  const chunkSize = 1024 * 256; // 256KB chunks: reduces batch count ~8x vs 32KB (critical for 100k+ row uploads)
  const connectionLimit = 1; // Process batches sequentially to prevent lock contention (file-level locks require serial processing)
  const uploadStartedRef = useRef<boolean>(false);
  const uploadRunningRef = useRef<boolean>(false);
  const batchProcessingStartedRef = useRef<boolean>(false);
  const lastPreparedUploadAttemptRef = useRef<string>('');

  // Transaction-aware queue for managing concurrent operations
  const queue = useMemo(() => createTransactionAwareQueue(connectionLimit), [connectionLimit]);

  // Simplified approach: track operations with completion callbacks
  const activeOperations = useRef(new Set<string>());
  const operationCompletionCallbacks = useRef<(() => void)[]>([]);
  const recoveryVerificationAbortRef = useRef<AbortController | null>(null);

  // Track expected row counts per file for end-to-end verification
  const expectedRowCounts = useRef<Map<string, number>>(new Map());
  const expectedTemporaryRowCounts = useRef<Map<string, number>>(new Map());
  const measurementBatchIDs = useRef<Map<string, string>>(new Map());

  const getRequiredUploadSessionId = useCallback((): string => {
    if (fatalUploadErrorRef.current) {
      throw fatalUploadErrorRef.current;
    }

    const currentSessionId = getCurrentSessionId();
    if (!currentSessionId) {
      throw new Error('Upload session is not active');
    }
    return currentSessionId;
  }, [getCurrentSessionId]);

  // Function to wait for all active operations to complete
  const waitForAllOperationsToComplete = useCallback((): Promise<void> => {
    if (activeOperations.current.size === 0) {
      ailogger.info('No active operations to wait for');
      return Promise.resolve();
    }

    ailogger.info(`Waiting for ${activeOperations.current.size} active operations to complete...`);
    return new Promise<void>(resolve => {
      operationCompletionCallbacks.current.push(resolve);
    });
  }, []);

  // refs
  const hasUploaded = useRef(false);
  const { isMountedRef } = useIsMounted(); // Tracks component mount state for async operations

  const uploadAttemptKey = useMemo(() => {
    const fileSignature =
      acceptedFiles.map(file => `${file.name}:${file.size}:${file.lastModified}:${selectedDelimiters[file.name] ?? 'auto'}`).join('|') || 'no-files';
    return [
      uploadForm ?? 'no-form',
      uploadMode ?? 'no-mode',
      schema ?? 'no-schema',
      currentPlotID ?? 'no-plot',
      currentCensusID ?? 'no-census',
      fileSignature
    ].join('::');
  }, [acceptedFiles, currentCensusID, currentPlotID, schema, selectedDelimiters, uploadForm, uploadMode]);

  const _generateErrorRowId = (row: FileRow) =>
    `row-${Object.values(row)
      .join('-')
      .replace(/[^a-zA-Z0-9-]/g, '')}`;

  // Helper function to detect Application Insights monitoring errors
  const isApplicationInsightsError = useCallback((error: unknown): boolean => {
    const errorString = error instanceof Error ? error.message : String(error);
    return (
      errorString.includes('Maximum ajax per page view limit') ||
      errorString.includes('AI (Internal)') ||
      errorString.includes('Failed to calculate the duration of the fetch call') ||
      errorString.includes('maxAjaxCallsPerView') ||
      errorString.includes('ajax monitoring is paused')
    );
  }, []);

  const fetchWithTimeout = useCallback(async (url: string | URL | Request, options: RequestInit | undefined, timeout = 60000) => {
    const upstreamSignal = options?.signal;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromUpstream = () => {
      controller.abort(upstreamSignal?.reason);
    };

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
      }
    }

    const timer = setTimeout(() => {
      ailogger.warn(`Request timeout after ${timeout}ms for ${url}`);
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });

      // Check if response indicates connection issues
      if (!response.ok && response.status >= 500) {
        let serverMessage = '';
        try {
          const errorBody = await response.text();
          serverMessage = errorBody;
          ailogger.error(`Server error ${response.status} for ${url} - response body: ${errorBody}`);
        } catch {
          ailogger.error(`Server error ${response.status} for ${url} - could not read response body`);
        }
        throw new Error(`Server error ${response.status}: ${serverMessage}`);
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (timedOut) {
          ailogger.error(`Request aborted due to timeout for ${url}`);
          throw new Error(`Request timeout after ${timeout}ms`);
        }

        throw createAbortError(`Request aborted for ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
  }, []);

  const buildClientResponseError = useCallback(
    async (response: Response, context: string): Promise<Error> => {
      const payload = await readResponsePayload(response);
      const uploadSessionConflict = parseUploadSessionConflict(payload);

      if (response.status === 409 && uploadSessionConflict?.restartRequired) {
        return markFatalUploadError(buildUploadSessionRestartRequiredError(context, payload));
      }

      if (response.status === 409 && uploadSessionConflict) {
        return new Error(`Upload session conflict while ${context}: ${uploadSessionConflict.message}`);
      }

      const apiErrorMessage = getApiErrorMessage(payload);
      return new Error(`Client error (${response.status}): ${apiErrorMessage || response.statusText || 'Unknown client error'}`);
    },
    [markFatalUploadError]
  );

  const abortRecoveryVerification = useCallback(() => {
    const controller = recoveryVerificationAbortRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    recoveryVerificationAbortRef.current = null;
  }, []);

  const verifyBatchOutcomeAfterRequestFailure = useCallback(
    async (fileID: string, batchID: string, expectedRows: number) => {
      if (!schema || !currentPlotID || !currentCensusID) {
        return { handled: false, status: null as null | Record<string, any>, aborted: false };
      }

      const maxAttempts = expectedRows > 0 ? 24 : 1;
      let lastStatus: Record<string, any> | null = null;
      abortRecoveryVerification();
      const recoveryController = new AbortController();
      recoveryVerificationAbortRef.current = recoveryController;

      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (!isMountedRef.current || recoveryController.signal.aborted) {
            throw createAbortError(`Recovery verification aborted for ${fileID}-${batchID}`);
          }

          try {
            const response = await fetchWithTimeout(
              `/api/verifysession?schema=${schema}&plotID=${currentPlotID}&censusID=${currentCensusID}&fileID=${encodeURIComponent(fileID)}&batchID=${encodeURIComponent(batchID)}`,
              { method: 'GET', signal: recoveryController.signal },
              20000
            );

            if (response.ok) {
              const status = await response.json();
              lastStatus = status;

              const totalAccounted = Number(status.totalAccounted || 0);
              const remainingCount = Number(status.remainingCount || 0);

              if (remainingCount === 0 && (expectedRows === 0 || totalAccounted >= expectedRows)) {
                return { handled: true, status, aborted: false };
              }

              ailogger.warn(
                `Batch ${fileID}-${batchID} recovery check ${attempt}/${maxAttempts}: accounted ${totalAccounted}/${expectedRows}, remaining ${remainingCount}`
              );
            } else {
              ailogger.warn(`Batch ${fileID}-${batchID} recovery check ${attempt}/${maxAttempts} returned HTTP ${response.status}`);
            }
          } catch (verificationError: unknown) {
            if (verificationError instanceof Error && verificationError.name === 'AbortError') {
              throw verificationError;
            }

            const message = verificationError instanceof Error ? verificationError.message : String(verificationError);
            ailogger.warn(`Batch ${fileID}-${batchID} recovery check ${attempt}/${maxAttempts} failed: ${message}`);
          }

          if (attempt < maxAttempts) {
            await waitForAbortableDelay(5000, recoveryController.signal, `Recovery verification aborted for ${fileID}-${batchID}`);
          }
        }

        return { handled: false, status: lastStatus, aborted: false };
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          ailogger.info(`Stopped recovery polling for ${fileID}-${batchID} after cancellation`);
          return { handled: false, status: lastStatus, aborted: true };
        }

        throw error;
      } finally {
        if (recoveryVerificationAbortRef.current === recoveryController) {
          recoveryVerificationAbortRef.current = null;
        }
      }
    },
    [schema, currentPlotID, currentCensusID, fetchWithTimeout, isMountedRef, abortRecoveryVerification]
  );

  const pushErrorRowsToFailedMeasurements = useCallback(
    async (errorRows: FileRow[], fileName: string) => {
      if (errorRows.length === 0) return;

      try {
        const failedMeasurementsData = errorRows.map(row => ({
          plotID: currentPlot?.plotID ?? -1,
          censusID: currentCensus?.dateRanges?.[0]?.censusID ?? -1,
          tag: row.tag || null,
          stemTag: row.stemtag || null,
          spCode: row.spcode || null,
          quadrat: row.quadrat || null,
          x: row.lx || null,
          y: row.ly || null,
          dbh: row.dbh || null,
          hom: row.hom || null,
          date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
          codes: row.codes || null,
          comments: row.comments || null,
          failureReasons: row.failureReason || 'Unknown error'
        }));

        const response = await fetchWithTimeout(
          `/api/batchedupload/${schema}/${currentPlot?.plotID}/${currentCensus?.dateRanges?.[0]?.censusID}?fileID=${encodeURIComponent(fileName)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(failedMeasurementsData)
          },
          30000
        );

        if (!response.ok) {
          throw new Error(`Failed to push error rows to failedmeasurements: ${response.status}`);
        }

        ailogger.info(`Successfully pushed ${errorRows.length} error rows from ${fileName} to failedmeasurements table`);
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ailogger.error(`Failed to push error rows from ${fileName} to failedmeasurements:`, errorObj);
        // Don't throw - we don't want to stop the upload process because of error row insertion failures
      }
    },
    [currentPlot?.plotID, currentCensus?.dateRanges, schema, fetchWithTimeout]
  );

  const estimateChunkCount = useCallback((file: File): number => Math.max(1, Math.ceil(file.size / chunkSize)), [chunkSize]);

  // Unified ETA calculator for overall progress (0-100%)
  // Uses lower alpha for smoother estimates across all stages
  const unifiedETACalculator = useRef<ETACalculator>(new ETACalculator(0.15, 2));
  const [unifiedETA, setUnifiedETA] = useState<string>('Calculating...');

  // Calculate overall progress percentage (0-100) for unified progress bar and ETA calculation
  const calculateOverallProgressValue = useCallback((): number => {
    if (uploadForm !== 'measurements') {
      return totalOperations > 0 ? (completedOperations / totalOperations) * 100 : 0;
    }

    const uploadWeight = 0.4;
    const processingWeight = 0.5;
    const verificationWeight = 0.1;
    let progress = 0;

    if (totalChunks > 0) {
      const uploadProgress = (completedChunks / totalChunks) * 100;
      progress += uploaded ? uploadWeight * 100 : uploadWeight * uploadProgress;
    }

    if (uploaded && totalBatches > 0) {
      const batchProgress = (processedChunks / totalBatches) * 100;
      progress += processed ? processingWeight * 100 : processingWeight * batchProgress;
    }

    if (isVerifying && totalVerificationSteps > 0) {
      progress += verificationWeight * (verificationStep / totalVerificationSteps) * 100;
    } else if (processed) {
      progress += verificationWeight * 100;
    }

    return Math.min(progress, 100);
  }, [
    uploadForm,
    totalOperations,
    completedOperations,
    totalChunks,
    completedChunks,
    uploaded,
    totalBatches,
    processedChunks,
    processed,
    isVerifying,
    totalVerificationSteps,
    verificationStep
  ]);

  // Reset unified ETA calculator when starting fresh
  useEffect(() => {
    if (!uploaded && completedChunks === 0 && totalChunks > 0) {
      unifiedETACalculator.current.reset();
      setUnifiedETA('Calculating...');
    }
  }, [uploaded, completedChunks, totalChunks]);

  // Calculate unified ETA based on overall progress

  // omitted: its underlying values (completedChunks, processedChunks, verificationStep, etc.) are already
  // listed, and including the callback itself causes an infinite re-render loop because useCallback recreates
  // the reference whenever any of its 12 deps change, triggering this effect, which calls setUnifiedETA,
  // which re-renders, which may recreate the callback again.
  useEffect(() => {
    if (uploadForm === 'measurements' && !processed) {
      const currentProgress = calculateOverallProgressValue();

      if (currentProgress > 0 && currentProgress < 100) {
        const etaMs = unifiedETACalculator.current.update(currentProgress, 100);

        if (etaMs === null) {
          setUnifiedETA('Calculating...');
        } else {
          setUnifiedETA(formatTimeRemaining(etaMs));
        }
      } else if (currentProgress >= 100) {
        setUnifiedETA('Complete');
      }
    }
  }, [uploadForm, processed, completedChunks, processedChunks, verificationStep, uploaded, totalChunks, totalBatches, isVerifying, totalVerificationSteps]);

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string, batchID?: string, _retryCount = 0) => {
      if (!isMountedRef.current) {
        throw createAbortError(`Upload cancelled before starting ${fileName}`);
      }

      const maxRetries = 3;
      const baseDelay = 1000; // 1 second base delay
      const operationId = `${fileName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Track this operation (once for all retries)
      activeOperations.current.add(operationId);
      ailogger.info(`Starting upload operation ${operationId} for ${fileName} (${activeOperations.current.size} active operations)`);

      // Use iterative retry loop instead of recursion to prevent stack overflow
      for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
        try {
          if (!isMountedRef.current) {
            throw createAbortError(`Upload cancelled before retrying ${fileName}`);
          }

          const response = await fetchWithTimeout(
            `/api/sqlpacketload`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-upload-session-id': getRequiredUploadSessionId()
              },
              body: JSON.stringify({
                schema,
                formType: uploadForm,
                sourceFormat: sourceFormat ?? SourceFormat.csv,
                uploadMode,
                fileName,
                plot: currentPlot,
                census: currentCensus,
                user: session?.user?.name ?? null,
                fileRowSet: fileData[fileName],
                ...(batchID ? { batchID } : {})
              })
            },
            300000
          ); // 5 minute timeout for large batches

          if (!response.ok) {
            // Enhanced error handling for different HTTP status codes
            if (response.status >= 500) {
              throw new Error(`Server error (${response.status}): The server is experiencing issues. This may be temporary.`);
            } else if (response.status === 429) {
              throw new Error(`Rate limit exceeded (${response.status}): Too many requests. Please wait before retrying.`);
            } else if (response.status >= 400) {
              throw await buildClientResponseError(response, `uploading ${fileName}`);
            } else {
              throw new Error(`API returned status ${response.status}`);
            }
          }

          try {
            const data = await response.json();
            // Failing rows are now handled via enhanced error reporting in error rows
            if (data.failingRows) {
              ailogger.info(`Received ${data.failingRows.length} failing rows for ${fileName}`);
            }

            // CRITICAL: Check for data integrity warnings (silent row drops from INSERT IGNORE)
            if (data.dataIntegrityWarning) {
              ailogger.error(
                `DATA INTEGRITY WARNING for ${fileName} (batchID: ${data.batchID}): ` +
                  `Expected ${data.expectedCount} rows, only ${data.insertedCount} were inserted. ` +
                  `${data.droppedCount} row(s) were dropped and moved to failedmeasurements.`
              );
            }

            // Check if the server indicates transaction completion
            if (data.transactionCompleted) {
              ailogger.info(
                `Server confirmed transaction completion for ${fileName} (batchID: ${data.batchID || 'N/A'})` +
                  (data.dataIntegrityWarning ? ` - WARNING: ${data.droppedCount} rows dropped` : '')
              );
            }

            // Mark operation as complete
            activeOperations.current.delete(operationId);
            ailogger.info(`Completed upload operation ${operationId} for ${fileName} (${activeOperations.current.size} remaining operations)`);

            // Notify waiting processes if all operations are complete
            if (activeOperations.current.size === 0) {
              operationCompletionCallbacks.current.forEach(callback => callback());
              operationCompletionCallbacks.current = [];
            }

            return data;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            ailogger.error('Error parsing response data:', e instanceof Error ? e : new Error(message));
            throw new Error(`Failed to parse server response: ${message}`);
          }
        } catch (error: unknown) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          const errorMessage = errorObj.message;

          if (errorObj.name === 'AbortError') {
            activeOperations.current.delete(operationId);
            if (activeOperations.current.size === 0) {
              operationCompletionCallbacks.current.forEach(callback => callback());
              operationCompletionCallbacks.current = [];
            }
            throw errorObj;
          }

          ailogger.error(`Upload attempt ${retryCount + 1}/${maxRetries + 1} failed for ${fileName}: ${errorMessage}`, errorObj);
          const isRetriableServerError = /^Server error 5\d{2}:/i.test(errorMessage) || errorMessage.includes('Server error (5');

          // Determine if we should retry based on error type
          const shouldRetry =
            retryCount < maxRetries &&
            (isRetriableServerError ||
              errorMessage.includes('Rate limit exceeded') ||
              errorMessage.includes('timeout') ||
              errorMessage.includes('ECONNRESET') ||
              errorMessage.includes('PROTOCOL_CONNECTION_LOST'));

          if (shouldRetry) {
            const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000; // Exponential backoff with jitter
            ailogger.info(`Retrying upload for ${fileName} in ${delay.toFixed(0)}ms... (attempt ${retryCount + 2}/${maxRetries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // Continue to next iteration of retry loop
          } else {
            ailogger.error(`Upload failed permanently for ${fileName} after ${retryCount + 1} attempts:`, errorObj);

            // Mark operation as complete even on failure to prevent hanging
            activeOperations.current.delete(operationId);
            ailogger.info(`Failed upload operation ${operationId} marked complete (${activeOperations.current.size} remaining operations)`);

            // Notify waiting processes if all operations are complete
            if (activeOperations.current.size === 0) {
              operationCompletionCallbacks.current.forEach(callback => callback());
              operationCompletionCallbacks.current = [];
            }

            throw errorObj;
          }
        }
      }

      // If we reach here, all retries failed but error wasn't thrown (shouldn't happen)
      throw new Error(`Upload failed for ${fileName} after ${maxRetries + 1} attempts`);
    },
    [uploadForm, uploadMode, currentPlot, currentCensus, session, schema, fetchWithTimeout, getRequiredUploadSessionId, isMountedRef, buildClientResponseError]
  );

  const submitPreparedRows = useCallback(
    async (file: File, batchID?: string) => {
      const rowSet = preparedRowSet?.[file.name];
      if (!rowSet) {
        throw new Error(`ArcGIS submit failed: no prepared rows found for ${file.name}. Re-run the pre-flight step.`);
      }
      // Seed expected-row-count maps so the post-upload verification block and session
      // reconciliation cover ArcGIS uploads the same way they cover Papa-parsed CSV uploads.
      // Every prepared row is intended to reach temporarymeasurements (orphan stems were
      // already dropped during transform), so total and valid counts are identical here.
      const preparedRowCount = Object.keys(rowSet).length;
      expectedRowCounts.current.set(file.name, preparedRowCount);
      expectedTemporaryRowCounts.current.set(file.name, preparedRowCount);
      const chunks = chunkFileRowSet(rowSet, ARCGIS_SUBMIT_CHUNK_SIZE);
      for (const chunk of chunks) {
        queue.add(async () => {
          if (!isMountedRef.current || fatalUploadErrorRef.current) return;
          try {
            await uploadToSql({ [file.name]: chunk }, file.name, batchID);
          } finally {
            if (isMountedRef.current) setCompletedChunks(prev => prev + 1);
          }
        });
      }
      await queue.onEmpty();
    },
    [preparedRowSet, queue, uploadToSql, isMountedRef, fatalUploadErrorRef, setCompletedChunks]
  );

  const parseFileInChunks = useCallback(
    async (file: File, delimiter: string, estimatedChunkCount: number, fileBatchID?: string) => {
      queue.clear();
      if (sourceFormat === SourceFormat.arcgis_xlsx) {
        await submitPreparedRows(file, fileBatchID);
        return;
      }
      const expectedHeaders = getTableHeaders(uploadForm!, currentPlot?.usesSubquadrats ?? false);
      const requiredHeaders = RequiredTableHeadersByFormType[uploadForm!];
      const parsingInvalidRows: FileRow[] = [];
      const parsingDiagnostics = {
        extraColumnRows: 0,
        extraColumnSample: null as string | null,
        invalidDateCount: 0,
        invalidDateSamples: new Set<string>()
      };

      if (!expectedHeaders || !requiredHeaders) {
        ailogger.error(`No headers defined for form type: ${uploadForm}`);
        if (isMountedRef.current) {
          setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
        }
        return;
      }

      // Validate delimiter and headers before parsing
      try {
        const validation = await validateDelimiter(
          file,
          delimiter,
          expectedHeaders.map(h => h.label)
        );
        if (!validation.isValid) {
          ailogger.warn(`Delimiter validation issues for file ${file.name}:`, validation.issues);
          // Log issues but continue parsing - user may have non-standard format that still works
        }

        // Enhanced header validation with mapping feedback
        if (validation.preview && validation.preview.length > 0) {
          const csvHeaders = validation.preview[0];
          const requiredHeaderLabels = requiredHeaders.map(h => h.label);
          const mappingResults: string[] = [];
          const missingRequired: string[] = [];

          // Check which required headers can be mapped
          for (const requiredHeader of requiredHeaderLabels) {
            const normalizedRequired = requiredHeader.toLowerCase().replace(/[_\s-]/g, '');
            const found = csvHeaders.some(csvHeader => {
              const normalizedCsv = csvHeader.toLowerCase().replace(/[_\s-]/g, '');
              return normalizedCsv === normalizedRequired || normalizedCsv.includes(normalizedRequired) || normalizedRequired.includes(normalizedCsv);
            });

            if (found) {
              mappingResults.push(`✓ ${requiredHeader}`);
            } else {
              missingRequired.push(requiredHeader);
              mappingResults.push(`✗ ${requiredHeader} (not found)`);
            }
          }

          ailogger.info(`Header mapping preview for ${file.name}:`, mappingResults);

          if (missingRequired.length > 0) {
            ailogger.warn(`Missing required headers in ${file.name}: ${missingRequired.join(', ')}`);
            ailogger.info(`Available headers: ${csvHeaders.join(', ')}`);
            // Don't fail here - let the processing continue and handle missing fields during validation
          } else {
            ailogger.info(`All required headers found in ${file.name} - proceeding with enhanced parsing`);
          }
        }
      } catch (error) {
        ailogger.error(`Error validating delimiter for file ${file.name}:`, error instanceof Error ? error : new Error(String(error)));
      }

      const transformHeader = (header: string) => {
        const normalizedHeader = header
          .trim()
          .toLowerCase()
          .replace(/[_\s-]/g, '');

        // Map common header variations to expected field names
        const headerMappings: Record<string, string> = {
          tag: 'tag',
          treetag: 'tag',
          stemtag: 'stemtag',
          stem: 'stemtag',
          spcode: 'spcode',
          species: 'spcode',
          speciescode: 'spcode',
          sp: 'spcode',
          quadrat: 'quadrat',
          quad: 'quadrat',
          quadratname: 'quadrat',
          lx: 'lx',
          localx: 'lx',
          x: 'lx',
          xcoord: 'lx',
          ly: 'ly',
          localy: 'ly',
          y: 'ly',
          ycoord: 'ly',
          dbh: 'dbh',
          diameter: 'dbh',
          hom: 'hom',
          height: 'hom',
          heightofmeasurement: 'hom',
          date: 'date',
          measurementdate: 'date',
          dateof: 'date',
          codes: 'codes',
          code: 'codes',
          attributes: 'codes',
          attributecodes: 'codes',
          comments: 'comments',
          comment: 'comments',
          description: 'comments',
          notes: 'comments'
        };

        const mappedHeader = headerMappings[normalizedHeader];
        if (mappedHeader) {
          return mappedHeader;
        }

        // If no mapping found, return normalized header (lowercase, no underscores/spaces/hyphens)
        // This ensures consistent key names for processPersonnel, processSpecies, etc.
        return normalizedHeader;
      };
      const validateRow = (row: FileRow): boolean => {
        const errors: string[] = [];
        let extraData = false;

        const missingFields = requiredHeaders.filter(header => {
          const value = row[header.label];
          return value === null || value === '' || value === 'NA' || value === 'NULL';
        });
        if (missingFields.length > 0) {
          errors.push(`Missing required fields: ${missingFields.map(f => f.label).join(', ')}`);
        }

        if (row['__parsed_extra'] !== undefined) {
          // Extra columns are common when re-uploading exported data with
          // reference columns like stemID, treeID, or errors. Track once per file
          // instead of logging once per row.
          parsingDiagnostics.extraColumnRows += 1;
          if (!parsingDiagnostics.extraColumnSample) {
            parsingDiagnostics.extraColumnSample = JSON.stringify(row['__parsed_extra']);
          }
          extraData = true;
        }

        // Enhanced duplicate detection reporting
        if (uploadForm === 'measurements') {
          const { tag, stemtag } = row;
          if (tag && stemtag) {
            // Check for suspicious tag values that might indicate parsing issues
            const tagStr = String(tag);
            const stemtagStr = String(stemtag);

            if (tagStr.includes(delimiter) || stemtagStr.includes(delimiter)) {
              errors.push(`Tag values contain delimiter character "${delimiter}": tag="${tagStr}", stemtag="${stemtagStr}". This suggests parsing error.`);
            }

            if (tagStr.length > 50 || stemtagStr.length > 50) {
              errors.push(
                `Unusually long tag values detected: tag="${tagStr.slice(0, 30)}...", stemtag="${stemtagStr.slice(0, 30)}...". This may indicate concatenated fields due to parsing error.`
              );
            }
          }
        }

        for (const [key, value] of Object.entries(row)) {
          if (value !== null && !['tag', 'stemtag'].includes(key)) {
            // tags and stemtags are NOT decimals
            const num = parseFloat(value);
            if (!isNaN(num) && (num < 0 || num > 999999.999999)) {
              errors.push(`Decimal value for ${key} is out of range: ${value}`);
            }
          }
        }

        const rejectRow = errors.length > 0;
        if (rejectRow) {
          parsingInvalidRows.push({
            ...row,
            failureReason: errors.join('|'),
            ...(extraData ? { excessData: row['__parsed_extra'] } : {})
          });
        }

        return !rejectRow;
      };

      const transform = (value: string, field: string) => {
        if (value === 'NA' || value === 'NULL' || value === '') return null;

        // Enhanced date handling with multiple format support
        if (uploadForm === FormType.measurements && field === 'date') {
          const dateFormats = [
            'YYYY-MM-DD',
            'MM/DD/YYYY',
            'DD/MM/YYYY',
            'YYYY/MM/DD',
            'MM-DD-YYYY',
            'DD-MM-YYYY',
            'YYYY.MM.DD',
            'MM.DD.YYYY',
            'DD.MM.YYYY',
            'MMMM DD, YYYY',
            'MMM DD, YYYY',
            'DD MMM YYYY',
            'DD MMMM YYYY',
            'YYYY-MM-DD HH:mm:ss',
            'MM/DD/YYYY HH:mm:ss',
            'DD/MM/YYYY HH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss.SSS',
            'YYYY-MM-DDTHH:mm:ss.SSSZ'
          ];

          // Try each format
          for (const format of dateFormats) {
            const parsed = moment(value.trim(), format, true);
            if (parsed.isValid()) {
              return parsed.toDate();
            }
          }

          // Try moment's flexible parsing as fallback
          const flexible = moment(value.trim());
          if (flexible.isValid()) {
            return flexible.toDate();
          }

          parsingDiagnostics.invalidDateCount += 1;
          if (parsingDiagnostics.invalidDateSamples.size < 3) {
            parsingDiagnostics.invalidDateSamples.add(value);
          }
          return value; // Return original value if parsing fails
        }

        // Enhanced coordinate precision handling
        if (uploadForm === FormType.measurements && (field === 'lx' || field === 'ly')) {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            // Round to 6 decimal places for coordinate precision
            return Math.round(numValue * 1000000) / 1000000;
          }
        }

        // Enhanced numeric field handling
        if (uploadForm === FormType.measurements && (field === 'dbh' || field === 'hom')) {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            // Round to 2 decimal places for measurement precision
            return Math.round(numValue * 100) / 100;
          }
        }

        return value;
      };

      let totalRows = 0;
      let actualChunkCount = 0;
      let firstChunkUploadError: Error | null = null;
      let chunkProcessingError: Error | null = null;
      const chunkTasks = new Set<Promise<void>>();
      const queuePauseThreshold = Math.max(connectionLimit * 2, 1);
      const queueWaitTimeoutMs = 300000; // Match fetch timeout so slow chunk uploads do not abort parsing prematurely.

      await new Promise<void>((resolve, reject) => {
        Papa.parse<FileRow>(file, {
          delimiter: delimiter,
          header: true,
          skipEmptyLines: true,
          chunkSize: chunkSize,
          transformHeader,
          transform,
          chunk(results: ParseResult<FileRow>, parser) {
            actualChunkCount += 1;
            totalRows += results.data.length;
            const chunkTask = (async () => {
              try {
                if (!isMountedRef.current) {
                  parser.abort();
                  throw createAbortError(`Parsing cancelled for ${file.name}`);
                }

                if (fatalUploadErrorRef.current) {
                  parser.abort();
                  throw fatalUploadErrorRef.current;
                }

                if (queue.size >= queuePauseThreshold) {
                  ailogger.info(`Queue size ${queue.size} exceeded threshold (${queuePauseThreshold}). Pausing parser.`);
                  parser.pause();
                  // Wait until the queue has room before resuming (with timeout protection)
                  const startTime = Date.now();
                  while (queue.size >= queuePauseThreshold) {
                    if (fatalUploadErrorRef.current) {
                      parser.abort();
                      throw fatalUploadErrorRef.current;
                    }
                    if (shouldTimeoutPausedParser(queue.size, queuePauseThreshold, activeOperations.current.size, Date.now() - startTime, queueWaitTimeoutMs)) {
                      ailogger.error(`Queue wait timeout: queue size ${queue.size} did not drop below ${queuePauseThreshold} within ${queueWaitTimeoutMs}ms`);
                      throw new Error(`Queue processing stalled - timeout after ${queueWaitTimeoutMs}ms`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                  parser.resume();
                }

                const validRows: FileRow[] = [];
                results.data.forEach(row => {
                  if (validateRow(row)) {
                    validRows.push(row);
                  }
                });

                if (validRows.length === 0) {
                  // Increment completedChunks even if there is nothing to upload.
                  setCompletedChunks(prev => prev + 1);
                  parser.resume();
                  return;
                }

                const fileRowSet: FileRowSet = {};
                validRows.forEach(row => {
                  const rowId = `row-${v4()}`;
                  fileRowSet[rowId] = row;
                });

                const fileCollectionRowSet: FileCollectionRowSet = {
                  [file.name]: fileRowSet
                };

                queue.add(async () => {
                  if (!isMountedRef.current) {
                    return;
                  }

                  if (fatalUploadErrorRef.current) {
                    return;
                  }

                  try {
                    await uploadToSql(fileCollectionRowSet, file.name, fileBatchID);
                  } catch (error: unknown) {
                    const errorObj = error instanceof Error ? error : new Error(String(error));
                    if (errorObj.name === 'AbortError') {
                      return;
                    }
                    const fatalError = abortChunkProcessingAfterPermanentUploadFailure(errorObj, {
                      clearQueue: () => queue.clear(),
                      abortParser: () => parser.abort(),
                      markFatalUploadError
                    });
                    ailogger.error(`Chunk upload failed for ${file.name}:`, errorObj);
                    if (!firstChunkUploadError) {
                      firstChunkUploadError = fatalError;
                    }
                  } finally {
                    // Always increment completed chunks to ensure progress updates
                    // Check isMountedRef to prevent state updates after unmount
                    if (isMountedRef.current) {
                      setCompletedChunks(prev => prev + 1);
                    }
                  }
                });
              } catch (err: unknown) {
                const errObj = err instanceof Error ? err : new Error(String(err));
                if (errObj.name === 'AbortError') {
                  return;
                }
                if (isUploadSessionRestartRequiredError(errObj)) {
                  markFatalUploadError(errObj);
                }
                ailogger.error('Error processing chunk:', errObj);
                if (!chunkProcessingError) {
                  chunkProcessingError = fatalUploadErrorRef.current ?? errObj;
                }
                parser.abort();
                throw errObj;
              }
            })();

            chunkTasks.add(chunkTask);
            void chunkTask.finally(() => {
              chunkTasks.delete(chunkTask);
            });
          },
          complete: async () => {
            await Promise.allSettled(Array.from(chunkTasks));
            await queue.onEmpty();
            // Wait for all database operations to complete
            await waitForAllOperationsToComplete();

            if (!isMountedRef.current) {
              resolve();
              return;
            }

            if (chunkProcessingError) {
              reject(chunkProcessingError);
              return;
            }

            if (fatalUploadErrorRef.current) {
              reject(fatalUploadErrorRef.current);
              return;
            }

            if (firstChunkUploadError) {
              reject(firstChunkUploadError);
              return;
            }

            if (actualChunkCount !== estimatedChunkCount && isMountedRef.current) {
              const delta = actualChunkCount - estimatedChunkCount;
              setTotalChunks(prev => Math.max(actualChunkCount, prev + delta));
              ailogger.info(`Adjusted chunk estimate for ${file.name}: estimated ${estimatedChunkCount}, actual ${actualChunkCount}`);
            }

            ailogger.info(`All database operations completed for ${file.name}`);
            if (parsingInvalidRows.length > 0) {
              ailogger.warn(`Found ${parsingInvalidRows.length} invalid rows from ${file.name}, pushing directly to failedmeasurements table`);
              // Push error rows directly to failedmeasurements table instead of storing in component state
              await pushErrorRowsToFailedMeasurements(parsingInvalidRows, file.name);
            }

            if (parsingDiagnostics.extraColumnRows > 0) {
              ailogger.warn(
                `Ignored extra columns in ${parsingDiagnostics.extraColumnRows} row(s) from ${file.name}` +
                  (parsingDiagnostics.extraColumnSample ? `. Example payload: ${parsingDiagnostics.extraColumnSample}` : '')
              );
            }

            if (parsingDiagnostics.invalidDateCount > 0) {
              ailogger.warn(
                `Encountered ${parsingDiagnostics.invalidDateCount} unrecognized date value(s) in ${file.name}` +
                  (parsingDiagnostics.invalidDateSamples.size > 0 ? `. Sample values: ${Array.from(parsingDiagnostics.invalidDateSamples).join(', ')}` : '')
              );
            }

            // Store expected row count for end-to-end verification
            expectedRowCounts.current.set(file.name, totalRows);

            // Enhanced processing summary
            const validRowsCount = totalRows - parsingInvalidRows.length;
            expectedTemporaryRowCounts.current.set(file.name, validRowsCount);
            const processingEfficiency = totalRows > 0 ? ((validRowsCount / totalRows) * 100).toFixed(1) : '0';

            ailogger.info(`Enhanced CSV processing completed for ${file.name}:`);
            ailogger.info(`  • Total rows processed: ${totalRows} (stored for verification)`);
            ailogger.info(`  • Valid rows: ${validRowsCount}`);
            ailogger.info(`  • Invalid/rejected rows: ${parsingInvalidRows.length}`);
            ailogger.info(`  • Processing efficiency: ${processingEfficiency}%`);
            ailogger.info(`  • Header mapping: Enhanced (order-independent)`);
            ailogger.info(`  • Date format support: Multi-format enabled`);
            ailogger.info(`  • Coordinate precision: Auto-normalized`);

            resolve();
          },
          error: (err: Error) => {
            ailogger.error('Error parsing file:', err);
            reject(err);
          }
        });
      });
    },
    [
      uploadForm,
      sourceFormat,
      currentPlot?.usesSubquadrats,
      setReviewState,
      queue,
      connectionLimit,
      chunkSize,
      isMountedRef,
      uploadToSql,
      setCompletedChunks,
      setTotalChunks,
      pushErrorRowsToFailedMeasurements,
      waitForAllOperationsToComplete,
      markFatalUploadError,
      submitPreparedRows
    ]
  );

  useEffect(() => {
    const hasFiles = acceptedFiles.length > 0;
    const isFreshAttempt = lastPreparedUploadAttemptRef.current !== uploadAttemptKey;
    const isStaleZeroProgress =
      hasFiles &&
      uploadStartedRef.current &&
      !uploaded &&
      !processed &&
      !batchProcessingStartedRef.current &&
      totalChunks === 0 &&
      completedChunks === 0 &&
      processedChunks === 0;

    if (!hasFiles) {
      if (lastPreparedUploadAttemptRef.current || uploadStartedRef.current || batchProcessingStartedRef.current) {
        ailogger.info('Upload queue cleared; resetting upload lifecycle guards');
      }
      lastPreparedUploadAttemptRef.current = '';
      uploadStartedRef.current = false;
      batchProcessingStartedRef.current = false;
      fatalUploadErrorRef.current = null;
      measurementBatchIDs.current.clear();
      return;
    }

    if (isFreshAttempt) {
      lastPreparedUploadAttemptRef.current = uploadAttemptKey;
      uploadStartedRef.current = false;
      batchProcessingStartedRef.current = false;
      fatalUploadErrorRef.current = null;
      expectedRowCounts.current.clear();
      expectedTemporaryRowCounts.current.clear();
      measurementBatchIDs.current.clear();
      setTotalOperations(0);
      setCompletedOperations(0);
      setTotalChunks(0);
      setTotalBatches(0);
      setCompletedChunks(0);
      setProcessedChunks(0);
      setUploaded(false);
      setProcessed(false);
      setIsVerifying(false);
      setVerificationStatus('');
      setVerificationStep(0);
      setTotalVerificationSteps(0);
      ailogger.info(`Prepared fresh upload attempt: ${uploadAttemptKey}`);
      return;
    }

    if (isStaleZeroProgress && !uploadRunningRef.current) {
      ailogger.warn(`Detected stale upload start guard for ${uploadAttemptKey}; resetting client upload state`);
      uploadStartedRef.current = false;
      batchProcessingStartedRef.current = false;
    }
  }, [acceptedFiles.length, completedChunks, processed, processedChunks, totalChunks, uploadAttemptKey, uploaded]);

  useEffect(() => {
    // Use ref-based mount tracking to survive Fast Refresh during development
    // This ensures async operations can safely check mount state even after HMR
    isMountedRef.current = true;

    async function runUploads() {
      try {
        // Clear expected row counts from any previous upload
        expectedRowCounts.current.clear();
        expectedTemporaryRowCounts.current.clear();

        if (fatalUploadErrorRef.current) {
          throw fatalUploadErrorRef.current;
        }

        if (acceptedFiles.length === 0) {
          ailogger.error('UploadFireSQL mounted with no accepted files to process');
          setUploadError(new Error('No files are queued for upload. Please reselect the file and try again.'));
          setReviewState(ReviewStates.ERRORS);
          return;
        }

        // Validate required data before proceeding
        if (!currentPlotID || !currentCensusID || !schema || !session?.user?.name) {
          const contextStatus = `plotID: ${currentPlotID ?? 'missing'}, censusID: ${currentCensusID ?? 'missing'}, schema: ${!!schema}, session: ${!!session?.user?.name}`;
          ailogger.error(`Missing required context for upload: ${contextStatus}`);
          setUploadError(new Error('Missing required context. Please ensure a plot and census are selected.'));
          setReviewState(ReviewStates.ERRORS);
          return;
        }

        ailogger.info(`Starting upload bootstrap for ${acceptedFiles.length} file(s) on plot ${currentPlotID}, census ${currentCensusID}`);

        // Create upload session before any chunks are uploaded so every write path can prove scope ownership.
        const primaryFileName = acceptedFiles[0]?.name || 'unknown';
        ailogger.info(`Attempting upload session creation for ${primaryFileName}`);
        const createdSessionId = await createSession(primaryFileName, acceptedFiles.length, uploadAttemptKey, uploadMode);
        if (!createdSessionId) {
          throw new Error(`Failed to create upload session for ${primaryFileName}`);
        }
        ailogger.info(`Upload session ${createdSessionId} created for ${acceptedFiles.length} file(s), primary: ${primaryFileName}`);
        await updateState('uploading');

        // Calculate total operations for the UI.
        const totalOps = acceptedFiles.length;
        setTotalOperations(uploadForm === FormType.measurements ? totalOps * 2 : totalOps);

        // Detect delimiters first so the real parser uses the expected format.
        const fileDelimiters: Map<string, string> = new Map();
        const estimatedChunkCounts: Map<string, number> = new Map();

        // Step 1: Detect delimiters for all files
        for (const file of acceptedFiles) {
          let delimiter: string;

          if (selectedDelimiters[file.name]) {
            delimiter = selectedDelimiters[file.name];
            ailogger.info(`File ${file.name}: Using user-selected delimiter "${delimiter}"`);
          } else {
            // Enhanced delimiter detection for files without user selection
            try {
              const detectionResult = await detectDelimiter(file as File);
              delimiter = detectionResult.delimiter;

              ailogger.info(
                `File ${file.name}: Auto-detected delimiter "${delimiter}" with ${detectionResult.confidence.toFixed(1)}% confidence (${detectionResult.sampleRows} sample rows, avg ${detectionResult.avgColumnsPerRow.toFixed(1)} columns per row)`
              );

              // Fall back to extension-based detection if confidence is very low
              if (detectionResult.confidence < 30) {
                const extensionDelimiter = file.name.endsWith('.csv') ? ',' : '\t';
                ailogger.warn(`Low confidence delimiter detection for ${file.name}. Falling back to extension-based delimiter: "${extensionDelimiter}"`);
                delimiter = extensionDelimiter;
              }
            } catch (error) {
              // Fallback to original logic if detection fails
              ailogger.error(`Delimiter detection failed for ${file.name}:`, error instanceof Error ? error : new Error(String(error)));
              delimiter = file.name.endsWith('.csv') ? ',' : '\t';
            }
          }

          fileDelimiters.set(file.name, delimiter);
        }

        // Step 2: Estimate chunk counts from file size. The real parser adjusts
        // the total if PapaParse produces a different number of chunks.
        for (const file of acceptedFiles) {
          let estimatedCount: number;
          if (sourceFormat === SourceFormat.arcgis_xlsx) {
            const preparedCount = Object.keys(preparedRowSet?.[file.name] ?? {}).length;
            estimatedCount = Math.max(1, Math.ceil(preparedCount / ARCGIS_SUBMIT_CHUNK_SIZE));
            ailogger.info(`File ${file.name}: Estimated ${estimatedCount} chunk(s) from ${preparedCount} prepared row(s)`);
          } else {
            estimatedCount = estimateChunkCount(file as File);
            ailogger.info(`File ${file.name}: Estimated ${estimatedCount} chunk(s) from ${file.size} bytes`);
          }
          estimatedChunkCounts.set(file.name, estimatedCount);
          setTotalChunks(prev => prev + estimatedCount);
        }

        // Step 3: Parse files using the detected delimiters
        // For measurement uploads, generate one BatchID per file so all chunks share
        // the same batch. This lets bulkingestionprocess run once per file instead of
        // once per chunk, eliminating redundant setup/teardown overhead.
        for (const file of acceptedFiles) {
          const delimiter = fileDelimiters.get(file.name)!;
          const estimatedCount = estimatedChunkCounts.get(file.name) ?? 1;
          const fileBatchID = uploadForm === FormType.measurements ? generateShortBatchID() : undefined;
          if (fileBatchID) {
            measurementBatchIDs.current.set(file.name, fileBatchID);
            ailogger.info(`File ${file.name}: Using consolidated BatchID ${fileBatchID} for all chunks`);
          }
          await parseFileInChunks(file as File, delimiter, estimatedCount, fileBatchID);
          setCompletedOperations(prev => prev + 1);
        }
        await queue.onEmpty();
        // Critical: Wait for all database operations to complete before marking as uploaded
        await waitForAllOperationsToComplete();

        if (fatalUploadErrorRef.current) {
          throw fatalUploadErrorRef.current;
        }

        // Start upload verification process with UI feedback
        if (isMountedRef.current) {
          setIsVerifying(true);
          setTotalVerificationSteps(acceptedFiles.length + 1); // Files + final sync check
          setVerificationStep(0);
          setVerificationStatus('Preparing upload verification...');
        }

        // Additional verification: Check that data was actually inserted into the database
        // Only applies to measurements — fixed-data uploads (attributes, quadrats, species, personnel)
        // go directly to their target tables, not through temporarymeasurements.
        try {
          if (uploadForm === 'measurements') {
            if (isMountedRef.current) {
              setVerificationStatus('Verifying uploaded data integrity...');
            }

            for (let i = 0; i < acceptedFiles.length; i++) {
              const file = acceptedFiles[i];
              const expectedUploadedRows = expectedTemporaryRowCounts.current.get(file.name) || 0;
              const fileBatchID = measurementBatchIDs.current.get(file.name) || null;
              if (isMountedRef.current) {
                setVerificationStep(i + 1);
                setVerificationStatus(`Verifying file ${i + 1} of ${acceptedFiles.length}: ${file.name}...`);
              }

              if (expectedUploadedRows === 0) {
                ailogger.info(`Skipping temporary row verification for ${file.name}: no valid rows were expected to reach temporarymeasurements`);
                continue;
              }

              const verificationResponse = await fetch(
                `/api/verifyupload?schema=${schema}&fileName=${encodeURIComponent(file.name)}${fileBatchID ? `&batchID=${encodeURIComponent(fileBatchID)}` : ''}&plotID=${currentPlotID}&censusID=${currentCensusID}`
              );
              if (!verificationResponse.ok) {
                throw new Error(`Upload verification failed for ${file.name}: ${verificationResponse.status}`);
              }
              const verificationData = await verificationResponse.json();
              if (verificationData.count !== expectedUploadedRows) {
                throw new Error(
                  `Upload verification failed for ${file.name}${fileBatchID ? ` (${fileBatchID})` : ''}: expected ${expectedUploadedRows} row(s) in temporarymeasurements, found ${verificationData.count}`
                );
              }
              ailogger.info(
                `Verified ${verificationData.count}/${expectedUploadedRows} row(s) uploaded for ${file.name}${fileBatchID ? ` (${fileBatchID})` : ''}`
              );
            }
          } else {
            ailogger.info(`Skipping temporarymeasurements verification for fixed-data upload (${uploadForm})`);
          }

          if (isMountedRef.current) {
            setVerificationStep(acceptedFiles.length + 1);
            setVerificationStatus('Upload verification completed successfully');
          }
          ailogger.info('All upload operations and database transactions verified successfully');
        } catch (verificationError: unknown) {
          const message = verificationError instanceof Error ? verificationError.message : String(verificationError);
          if (isMountedRef.current) {
            setVerificationStatus(`Upload verification failed: ${message}`);
          }
          ailogger.error(`Upload verification failed: ${message}`);
          throw verificationError instanceof Error ? verificationError : new Error(message);
        }

        if (isMountedRef.current) {
          setIsVerifying(false);
        }

        if (isMountedRef.current) {
          ailogger.info('Setting uploaded to true - processing should begin');
          await updateState('uploaded');
          setUploaded(true);
        } else {
          ailogger.warn('Component unmounted before upload could complete');
        }
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        if (errorObj.name === 'AbortError') {
          ailogger.info(`Upload bootstrap aborted for ${uploadAttemptKey}`);
          return;
        }
        if (!isUploadSessionRestartRequiredError(errorObj)) {
          ailogger.error('Upload error:', errorObj);
        }
        throw errorObj;
      }
    }

    // Only run uploads once using ref.  Start synchronously (not via setTimeout)
    // so the cleanup function cannot cancel the upload before it begins.  The
    // guard useEffect resets several state variables on fresh attempts, and each
    // setState triggers a re-render that runs this cleanup.  A setTimeout(fn, 0)
    // is always cleared before it fires in that scenario, leaving the upload
    // permanently stuck at 0%.
    if (acceptedFiles.length > 0 && !uploadStartedRef.current && !uploadRunningRef.current && !uploaded && !processed) {
      ailogger.info(`Starting runUploads for attempt ${uploadAttemptKey}`);
      uploadStartedRef.current = true;
      uploadRunningRef.current = true;
      runUploads()
        .then(() => {
          uploadRunningRef.current = false;
        })
        .catch(error => {
          uploadRunningRef.current = false;
          if (error instanceof Error && error.name === 'AbortError') {
            ailogger.info(`runUploads aborted for attempt ${uploadAttemptKey}`);
            return;
          }

          // Filter out Application Insights monitoring errors
          if (isApplicationInsightsError(error)) {
            ailogger.warn('Application Insights monitoring error detected (not a data processing error):', error);
            ailogger.info('Upload process continuing despite monitoring system limitation');
            // Don't set error state or change review state for monitoring errors
            return;
          }

          ailogger.error('runUploads failed:', error);
          if (!isUploadSessionRestartRequiredError(error)) {
            // Cancel the session and clean up staged temp data on error.
            cancelSession(true).catch(cancelErr => {
              ailogger.warn(`Failed to cancel upload session: ${cancelErr.message}`);
            });
          }

          // CRITICAL: Only update state if component is still mounted
          // Updating state after unmount can cause React error #310
          if (isMountedRef.current) {
            setUploadError(error);
            setReviewState(ReviewStates.ERRORS);
          } else {
            ailogger.warn('Component unmounted during error handling - skipping state updates to prevent React error #310');
          }
        });
    }
    return () => {
      abortRecoveryVerification();
      // Set isMountedRef to false on cleanup to prevent state updates after unmount
      // Note: The uploadStartedRef guard above ensures upload only starts once,
      // and async operations check isMountedRef.current before updating state
      // Using a ref instead of local variable survives Fast Refresh during development
      isMountedRef.current = false;
    };
  }, [
    acceptedFiles,
    abortRecoveryVerification,
    cancelSession,
    createSession,
    currentCensus,
    currentCensusID,
    currentPlot,
    currentPlotID,
    estimateChunkCount,
    isApplicationInsightsError,
    isMountedRef,
    parseFileInChunks,
    preparedRowSet,
    processed,
    queue,
    schema,
    selectedDelimiters,
    session?.user?.name,
    setReviewState,
    setUploadError,
    updateState,
    uploadAttemptKey,
    uploaded,
    uploadForm,
    sourceFormat,
    waitForAllOperationsToComplete
  ]);

  useEffect(() => {
    // The processing condition now relies on 'uploaded' being true, which is only set
    // after all upload verification is complete. The totalChunks > 0 check ensures
    // we had actual data to upload (prevents false triggers on initial mount).
    // The completedChunks === totalChunks check is maintained as a safety measure.
    const shouldProcess =
      uploadForm === FormType.measurements &&
      uploaded &&
      !processed &&
      totalChunks > 0 &&
      completedChunks === totalChunks &&
      !batchProcessingStartedRef.current;

    ailogger.info('Processing useEffect triggered', {
      uploadForm,
      uploaded,
      processed,
      completedChunks,
      totalChunks,
      batchProcessingStarted: batchProcessingStartedRef.current,
      willProcess: shouldProcess
    });

    // Guard to prevent batch processing from running multiple times
    if (shouldProcess) {
      batchProcessingStartedRef.current = true;
      queue.clear();
      ailogger.info('Starting batch processing phase (guarded by ref)');

      async function runProcessBatches() {
        if (fatalUploadErrorRef.current) {
          throw fatalUploadErrorRef.current;
        }

        setProcessedChunks(0);

        // Update session state to processing
        await updateState('processing');

        ailogger.info(
          `Setting up bulk processor for schema: ${schema}, plotID: ${currentPlot?.plotID ?? -1}, censusID: ${currentCensus?.dateRanges?.[0]?.censusID}`
        );
        const exactBatchTargets = acceptedFiles
          .map(file => {
            const batchID = measurementBatchIDs.current.get(file.name);
            return batchID ? { fileID: file.name, batchID } : null;
          })
          .filter((target): target is { fileID: string; batchID: string } => target !== null);

        let output: { fileID: string; batchID: string }[];
        if (exactBatchTargets.length === acceptedFiles.length && exactBatchTargets.length > 0) {
          output = exactBatchTargets;
          ailogger.info(`Using ${output.length} client-tracked measurement batch(es) for processing`, output);
        } else {
          const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges?.[0]?.censusID}`, {
            headers: {
              'x-upload-session-id': getRequiredUploadSessionId()
            }
          });
          if (!response.ok) {
            throw await buildClientResponseError(response, 'discovering staged batches for processing');
          }
          output = await response.json();
          ailogger.warn(
            `Fell back to server batch discovery for processing because only ${exactBatchTargets.length}/${acceptedFiles.length} client batch IDs were available`
          );
        }
        ailogger.info(`Received ${output.length} batches to process:`, output);

        // If there are no batches to process, skip batch processing entirely
        if (output.length === 0) {
          ailogger.info('No batches to process - all data was processed directly or moved to failedmeasurements');

          // Check if component is still mounted
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted - skipping no-batches processing');
            return;
          }

          setTotalBatches(0);
          setProcessedChunks(0);
          setCompletedOperations(prev => prev + 1);

          // Skip to collapser
          try {
            setIsVerifying(true);
            setTotalVerificationSteps(2); // Collapser + Final sync
            setVerificationStep(0);
            setVerificationStatus('Starting data consolidation (no batches to process)...');
            ailogger.info('Starting collapser procedure (no batches)...');

            // Update session state to collapsing
            await updateState('collapsing');

            const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'x-upload-session-id': getRequiredUploadSessionId()
              }
            });
            if (!collapserResponse.ok) {
              throw await buildClientResponseError(collapserResponse, 'running data consolidation');
            }
            const collapserData = await collapserResponse.json();

            // Check mount status after async operation
            if (!isMountedRef.current) {
              ailogger.warn('Component unmounted during collapser (no batches) - skipping completion');
              return;
            }

            setVerificationStatus('Data consolidation completed successfully');
            ailogger.info('Collapser completed successfully (no batches):', collapserData);

            setVerificationStep(1);
            setVerificationStatus('Finalizing database operations...');

            // Final mount check
            if (!isMountedRef.current) {
              ailogger.warn('Component unmounted during final sync (no batches) - skipping completion');
              return;
            }

            setVerificationStatus('All processing verification completed');
            setVerificationStep(2);
          } catch (collapserError: unknown) {
            const message = collapserError instanceof Error ? collapserError.message : String(collapserError);
            if (isMountedRef.current) {
              setVerificationStatus(`Data consolidation error: ${message}`);
            }
            ailogger.error(`Collapser error (no batches): ${message}`);
            throw collapserError instanceof Error ? collapserError : new Error(message);
          }

          setIsVerifying(false);

          // Note: completeSession() is called in the final useEffect when processed becomes true
          setProcessed(true);
          return; // Exit early - no batches to process
        }

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
        ailogger.info(`Total batches to process: ${totalBatchCount}`);

        for (const fileID in grouped) {
          ailogger.info(`Processing FileID: ${fileID}`);

          // Create batch tasks for transaction-aware processing
          const batchTasks = grouped[fileID].map(
            batchID => () =>
              fetchWithTimeout(
                `/api/setupbulkprocedure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`,
                {
                  method: 'GET',
                  headers: {
                    'x-upload-session-id': getRequiredUploadSessionId()
                  }
                },
                900000 // 15 minute timeout to match backend for consolidated single-batch-per-file processing
              )
                .then(async response => {
                  if (!response.ok) {
                    throw await buildClientResponseError(response, `processing batch ${fileID}-${batchID}`);
                  }
                  const result = await response.json();

                  // Check if batch was handled internally (moved to failedmeasurements by the procedure)
                  if (result.batchFailedButHandled) {
                    ailogger.info(`Batch ${fileID}-${batchID} was handled internally: ${result.message}`);
                  }

                  ailogger.info(`Successfully processed batch ${fileID}-${batchID}`);
                  // Check isMountedRef to prevent state updates after unmount
                  if (isMountedRef.current) {
                    setProcessedChunks(prev => {
                      const newValue = prev + 1;
                      ailogger.info(`Batch progress: ${newValue}/${totalBatchCount} batches completed`);
                      return newValue;
                    });
                  }
                })
                .catch(async (e: any) => {
                  const errorMessage = e?.message || e?.toString() || 'Unknown error';
                  let handledAfterRecovery = false;
                  let recoveryAborted = false;

                  // Check if this is an Application Insights monitoring error, not a data processing error
                  const isMonitoringError =
                    errorMessage.includes('Maximum ajax per page view limit') ||
                    errorMessage.includes('AI (Internal)') ||
                    errorMessage.includes('Failed to calculate the duration of the fetch call');

                  if (isMonitoringError) {
                    ailogger.warn(`Batch ${fileID}-${batchID} encountered monitoring system error (not data error): ${errorMessage}`);
                    // Don't try to move to failedmeasurements for monitoring errors
                  } else if (isUploadSessionRestartRequiredError(e)) {
                    markFatalUploadError(e);
                    queue.clear();
                    ailogger.warn(`Stopping batch processing for ${fileID}-${batchID}: ${errorMessage}`);
                  } else {
                    ailogger.error(`Error processing batch ${fileID}-${batchID}:`, e);
                    // A dropped HTTP response does not necessarily mean the server-side batch failed.
                    // Verify batch accounting first because setupbulkprocedure may have already
                    // split and finished sub-batches after the client lost the connection.
                    const expectedBatchRows = expectedTemporaryRowCounts.current.get(fileID) || 0;
                    const recoveryResult = await verifyBatchOutcomeAfterRequestFailure(fileID, batchID, expectedBatchRows);

                    if (recoveryResult.handled) {
                      handledAfterRecovery = true;
                      ailogger.warn(
                        `Batch ${fileID}-${batchID} lost its request response, but server-side accounting completed: ` +
                          `${recoveryResult.status?.processedCount || 0} processed, ` +
                          `${recoveryResult.status?.failedCount || 0} unresolved, ` +
                          `${recoveryResult.status?.remainingCount || 0} remaining`
                      );
                    } else if (recoveryResult.aborted || !isMountedRef.current) {
                      recoveryAborted = true;
                      ailogger.info(`Stopped post-failure recovery work for ${fileID}-${batchID} after component unmount/cancel`);
                    } else if (!errorMessage.includes('handled internally')) {
                      try {
                        ailogger.warn(`Moving ${fileID}-${batchID} to failedmeasurements due to unhandled error: ${errorMessage}`);
                        const failureResponse = await fetch(
                          `/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}&reason=${encodeURIComponent(errorMessage.slice(0, 255))}`,
                          {
                            headers: {
                              'x-upload-session-id': getRequiredUploadSessionId()
                            }
                          }
                        );
                        if (!failureResponse.ok) {
                          throw new Error(`Failed to move batch to failed measurements: ${failureResponse.status}`);
                        }
                      } catch (failureError: unknown) {
                        const failErrObj = failureError instanceof Error ? failureError : new Error(String(failureError));
                        ailogger.error(`Failed to move ${fileID}-${batchID} to failedmeasurements:`, failErrObj);
                      }
                    }
                  }

                  // Still increment progress even for failed batches so UI doesn't hang
                  // Check isMountedRef to prevent state updates after unmount
                  if (isMountedRef.current && !isUploadSessionRestartRequiredError(e)) {
                    setProcessedChunks(prev => {
                      const newValue = prev + 1;
                      ailogger.info(
                        `Batch progress (with ${isMonitoringError ? 'monitoring issue' : 'failure'}): ${newValue}/${totalBatchCount} batches completed`
                      );
                      return newValue;
                    });
                  }

                  // Don't re-throw for monitoring errors or internally handled batches
                  if (!isMonitoringError && !errorMessage.includes('handled internally') && !handledAfterRecovery && !recoveryAborted) {
                    // Log but don't re-throw to prevent stopping other batches
                    ailogger.error(`Batch ${fileID}-${batchID} failed but continuing with other batches`);
                  }
                })
          );

          // Process batches for this file sequentially to maintain data integrity
          try {
            ailogger.info(`Starting batch processing for ${fileID} with ${batchTasks.length} batches`);
            for (const batchTask of batchTasks) {
              queue.add(async () => {
                if (fatalUploadErrorRef.current) {
                  return;
                }
                await batchTask();
              });
            }
            // Don't increment here - wait for all batches to complete
          } catch (fileError: unknown) {
            const fileErrObj = fileError instanceof Error ? fileError : new Error(String(fileError));
            ailogger.error(`File processing failed for ${fileID}:`, fileErrObj);
            // Continue with other files even if one fails
          }
        }

        // Wait for all batch processing to complete, then increment completedOperations once
        await queue.onEmpty();

        if (fatalUploadErrorRef.current) {
          throw fatalUploadErrorRef.current;
        }

        // Check if component is still mounted before continuing with verification
        if (!isMountedRef.current) {
          ailogger.warn('Component unmounted during batch processing - skipping verification');
          return;
        }

        // Start processing verification with UI feedback
        setIsVerifying(true);
        setTotalVerificationSteps(3); // Processing verification + Collapser + Final sync
        setVerificationStep(0);
        setVerificationStatus('Preparing processing verification...');

        // Verify that all batches were processed successfully
        try {
          setVerificationStep(1);
          setVerificationStatus('Verifying batch processing completion...');

          const verifyProcessingResponse = await fetch(
            `/api/verifyprocessing?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}`
          );
          if (verifyProcessingResponse.ok) {
            const verifyData = await verifyProcessingResponse.json();
            const totalAccountedFor = verifyData.processedCount + verifyData.failedCount;
            setVerificationStatus(
              `Verification: ${verifyData.processedCount} total in coremeasurements, ${verifyData.failedCount} total in failedmeasurements (${totalAccountedFor} cumulative for this census), ${verifyData.remainingCount} remaining to process`
            );
            ailogger.info(
              `Processing verification: ${verifyData.processedCount} cumulative rows in coremeasurements, ${verifyData.failedCount} cumulative rows in failedmeasurements, ${verifyData.remainingCount} remaining in temporarymeasurements. Note: Counts are cumulative for this plot/census combination.`
            );
          } else {
            setVerificationStatus('Processing verification failed, continuing with data consolidation...');
            ailogger.warn('Processing verification failed, but continuing with collapser');
          }

          // Note: Session-based verification moved to AFTER collapser completes
          // This ensures data has been moved from temporarymeasurements to coremeasurements
          ailogger.info('Pre-collapser verification complete. Data integrity check will run after collapser.');
        } catch (verifyError: unknown) {
          const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
          setVerificationStatus(`Processing verification error: ${message}`);
          ailogger.warn(`Processing verification error: ${message}`);
        }

        // Check if component is still mounted before collapser
        if (!isMountedRef.current) {
          ailogger.warn('Component unmounted during verification - skipping collapser');
          return;
        }

        setCompletedOperations(prev => prev + 1);

        // trigger collapser ONCE and wait for it to complete
        try {
          setVerificationStep(2);
          setVerificationStatus('Starting data consolidation (collapser procedure)...');
          ailogger.info('Starting collapser procedure...');

          // Update session state to collapsing
          await updateState('collapsing');

          const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'x-upload-session-id': getRequiredUploadSessionId()
            }
          });
          if (!collapserResponse.ok) {
            throw await buildClientResponseError(collapserResponse, 'running data consolidation');
          }
          const collapserData = await collapserResponse.json();

          // Check mount status after collapser
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted after collapser - skipping completion');
            return;
          }

          setVerificationStatus('Data consolidation completed successfully');
          ailogger.info('Collapser completed successfully:', collapserData);

          setVerificationStep(3);

          // Session-Based Verification: Verify each uploaded file AFTER collapser has moved data to coremeasurements
          if (isMountedRef.current) {
            setVerificationStatus('Performing final data integrity verification...');
            let totalSessionProcessed = 0;
            let totalSessionFailed = 0;
            let totalExpectedRows = 0;
            let dataIntegrityIssuesFound = false;

            for (let fileIndex = 0; fileIndex < acceptedFiles.length; fileIndex++) {
              const file = acceptedFiles[fileIndex];
              const fileID = file.name;

              // Get expected row count from parsing phase
              const expectedForFile = expectedRowCounts.current.get(fileID) || 0;
              totalExpectedRows += expectedForFile;

              try {
                const sessionVerifyResponse = await fetch(
                  `/api/verifysession?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}&fileID=${encodeURIComponent(fileID)}`
                );

                if (sessionVerifyResponse.ok) {
                  const sessionData = await sessionVerifyResponse.json();
                  totalSessionProcessed += sessionData.processedCount;
                  totalSessionFailed += sessionData.failedCount;

                  const actualTotal = sessionData.processedCount + sessionData.failedCount;
                  const discrepancy = expectedForFile - actualTotal;

                  if (discrepancy !== 0) {
                    dataIntegrityIssuesFound = true;
                    ailogger.warn(
                      `Data verification note for ${fileID}: Expected ${expectedForFile} rows from file, actual ${actualTotal} in database (${sessionData.processedCount} in coremeasurements + ${sessionData.failedCount} in failedmeasurements). Difference: ${discrepancy} row(s). This may be normal if rows were deduplicated or merged during processing.`
                    );
                  }

                  ailogger.info(
                    `File ${fileIndex + 1}/${acceptedFiles.length} (${fileID}): Expected ${expectedForFile}, Actual ${actualTotal} (${sessionData.processedCount} succeeded, ${sessionData.failedCount} failed)${discrepancy !== 0 ? ` - Difference: ${discrepancy} rows` : ' ✓'}`
                  );
                } else {
                  ailogger.warn(`Session verification request failed for file ${fileID}`);
                }
              } catch (sessionError: unknown) {
                const message = sessionError instanceof Error ? sessionError.message : String(sessionError);
                ailogger.warn(`Error during session verification for ${fileID}: ${message}`);
              }
            }

            const totalSessionAccounted = totalSessionProcessed + totalSessionFailed;
            const totalDiscrepancy = totalExpectedRows - totalSessionAccounted;

            // Log verification results - note that discrepancies may be normal due to deduplication
            if (dataIntegrityIssuesFound || totalDiscrepancy !== 0) {
              setVerificationStatus(
                `Verification complete: ${totalSessionAccounted} rows in database (${totalSessionProcessed} succeeded, ${totalSessionFailed} failed). Note: ${Math.abs(totalDiscrepancy)} row difference from expected ${totalExpectedRows} - this may be due to deduplication or data merging.`
              );
              ailogger.info(
                `Upload verification summary: Expected ${totalExpectedRows} rows from input files, ${totalSessionAccounted} rows in database. Difference of ${totalDiscrepancy} rows may be due to deduplication, merged stems, or data consolidation during processing.`
              );
            } else {
              setVerificationStatus(
                `✓ Verification complete: ${totalSessionProcessed} rows succeeded, ${totalSessionFailed} rows failed (${totalSessionAccounted} total - matches expected ${totalExpectedRows})`
              );
              ailogger.info(
                `Upload verification summary: ${totalSessionProcessed} rows succeeded, ${totalSessionFailed} rows failed. Total: ${totalSessionAccounted} rows. Expected: ${totalExpectedRows} rows. ✓ Perfect match.`
              );
            }
          }

          if (isMountedRef.current) {
            setVerificationStatus('All processing verification completed');
          }
        } catch (collapserError: unknown) {
          const message = collapserError instanceof Error ? collapserError.message : String(collapserError);
          if (isMountedRef.current) {
            setVerificationStatus(`Data consolidation error: ${message}`);
          }
          ailogger.error(`Collapser error: ${message}`);
          throw collapserError instanceof Error ? collapserError : new Error(message);
        }

        // Final mount check before completing
        if (!isMountedRef.current) {
          ailogger.warn('Component unmounted during final sync - skipping completion');
          return;
        }

        setIsVerifying(false);

        // Note: completeSession() is called in the final useEffect when processed becomes true
        setProcessed(true);
      }

      runProcessBatches().catch(error => {
        if (error instanceof Error && error.name === 'AbortError') {
          ailogger.info('Batch processing aborted before completion');
          return;
        }

        // Filter out Application Insights monitoring errors
        if (isApplicationInsightsError(error)) {
          ailogger.warn('Application Insights monitoring error detected during batch processing (not a data processing error):', error);
          ailogger.info('Batch processing continuing despite monitoring system limitation');
          // Don't set error state or change review state for monitoring errors
          return;
        }

        // Cancel the session and clean up staged temp data on processing error.
        if (!isUploadSessionRestartRequiredError(error)) {
          cancelSession(true).catch(cancelErr => {
            ailogger.warn(`Failed to cancel upload session after processing error: ${cancelErr.message}`);
          });
        }

        // CRITICAL: Only update state if component is still mounted
        // Updating state after unmount can cause React error #310
        if (isMountedRef.current) {
          setUploadError(error);
          setReviewState(ReviewStates.ERRORS);
        } else {
          ailogger.warn('Component unmounted during batch processing error handling - skipping state updates to prevent React error #310');
        }
      });
    }
  }, [
    acceptedFiles,
    cancelSession,
    uploaded,
    uploadForm,
    completedChunks,
    totalChunks,
    schema,
    currentPlot,
    currentCensus,
    processed,
    queue,
    setReviewState,
    setUploadError,
    fetchWithTimeout,
    buildClientResponseError,
    getRequiredUploadSessionId,
    markFatalUploadError,
    updateState,
    verifyBatchOutcomeAfterRequestFailure,
    isApplicationInsightsError
  ]);

  useEffect(() => {
    // Use async IIFE to properly await completeSession before state transition
    // This prevents race condition where unmount cleanup fires before session is marked complete
    const handleUploadComplete = async () => {
      if (uploadForm === FormType.measurements) {
        if (uploaded && processed) {
          // Check mount state before proceeding
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted before upload completion - skipping state transition');
            return;
          }

          // Final synchronization checkpoint: Ensure all verification states are clean
          setIsVerifying(false);
          setVerificationStatus('All operations completed successfully');
          setVerificationStep(0);
          setTotalVerificationSteps(0);

          // Complete the upload session to stop heartbeat and mark as done
          // MUST await to ensure sessionIdRef is cleared before state transition triggers unmount
          try {
            await completeSession();
          } catch (err: unknown) {
            ailogger.warn(`Failed to complete upload session: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Check mount state again after async operation
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted after session completion - skipping state transition');
            return;
          }

          hasUploaded.current = true;
          // Trigger background validation instead of blocking on VALIDATE state
          if (schema && currentPlotID && currentCensusID) {
            startValidation({ schema, plotID: currentPlotID, censusID: currentCensusID });
          }
          setReviewState(ReviewStates.UPLOAD_AZURE);
          setIsDataUnsaved(false);
        }
      } else {
        if (uploaded) {
          // Check mount state before proceeding
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted before upload completion - skipping state transition');
            return;
          }

          // Final synchronization checkpoint for non-measurements uploads
          setIsVerifying(false);
          setVerificationStatus('Upload completed successfully');
          setVerificationStep(0);
          setTotalVerificationSteps(0);

          // Complete the upload session to stop heartbeat and mark as done
          // MUST await to ensure sessionIdRef is cleared before state transition triggers unmount
          try {
            await completeSession();
          } catch (err: unknown) {
            ailogger.warn(`Failed to complete upload session: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Check mount state again after async operation
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted after session completion - skipping state transition');
            return;
          }

          hasUploaded.current = true;
          setReviewState(ReviewStates.UPLOAD_AZURE);
          setIsDataUnsaved(false);
        }
      }
    };

    handleUploadComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploaded, processed, uploadForm]);

  const { palette: _palette } = useTheme();

  // Get cached animation URLs for reliable loading in production
  const { getAnimationUrl } = useAnimationCacheContext();

  // Get current phase description for user
  const getCurrentPhaseDescription = (): string => {
    if (isVerifying) return 'Finalizing upload...';
    if (uploaded && !processed) return 'Processing data...';
    if (!uploaded) return 'Uploading data...';
    return 'Complete';
  };

  // Determine which animation to show based on current stage
  // Uses cached blob URLs from IndexedDB for reliable loading in production
  const getStageAnimation = (): string => {
    if (!uploaded) return getAnimationUrl('growing-plant.lottie');
    if (uploaded && !processed && !isVerifying) return getAnimationUrl('data-processing.lottie');
    if (isVerifying) return getAnimationUrl('startup.lottie');
    return getAnimationUrl('growing-plant.lottie'); // fallback
  };

  return (
    <>
      {!hasUploaded.current ? (
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
              alignItems: 'center',
              position: 'relative',
              zIndex: 1
            }}
            role="status"
            aria-live="polite"
          >
            {/* Header */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography level="h3" sx={{ mb: 1 }}>
                {getCurrentPhaseDescription()}
              </Typography>
              <Typography level="body-lg" color="primary" sx={{ fontWeight: 600 }}>
                {calculateOverallProgressValue().toFixed(0)}% Complete
              </Typography>
            </Box>

            {/* Main Progress Bar - Full Width */}
            <Box sx={{ width: '100%', maxWidth: '600px' }}>
              <LinearProgress
                determinate
                size="lg"
                variant="soft"
                color="primary"
                value={calculateOverallProgressValue()}
                sx={{
                  width: '100%',
                  '--LinearProgress-thickness': '12px',
                  '--LinearProgress-radius': '8px'
                }}
                aria-label="Overall upload progress"
                aria-valuenow={calculateOverallProgressValue()}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </Box>

            {/* Unified Time Estimate */}
            {!processed && (
              <Typography level="body-md" color="neutral" sx={{ textAlign: 'center' }}>
                {unifiedETA === 'Calculating...' || unifiedETA === 'Complete'
                  ? unifiedETA === 'Complete'
                    ? 'Finalizing...'
                    : 'Calculating time remaining...'
                  : `Estimated time remaining: ${unifiedETA}`}
              </Typography>
            )}

            {/* Status Description */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography level="body-sm" color="neutral">
                {processed
                  ? 'Processing complete!'
                  : isVerifying
                    ? 'Verifying data integrity...'
                    : uploaded
                      ? 'Processing data batches...'
                      : 'Uploading to cloud storage...'}
              </Typography>
              <Typography level="body-xs" color="neutral" sx={{ mt: 1, opacity: 0.7 }}>
                Please do not close this window
              </Typography>
            </Box>
          </Stack>
        </Box>
      ) : (
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
          <Stack direction="column" sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography level="title-md">Upload Complete</Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
