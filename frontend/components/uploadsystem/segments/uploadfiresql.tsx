'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/compat-hooks';
import Papa, { parse, ParseResult } from 'papaparse';
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
  setIsDataUnsaved,
  schema,
  setUploadError,
  setReviewState,
  selectedDelimiters
}) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  // Session tracking for client disconnection handling
  const {
    sessionId: _sessionId,
    createSession,
    updateState,
    completeSession,
    cancelSession,
    isSessionActive: _isSessionActive
  } = useUploadSession({
    schema,
    plotId: currentPlot?.plotID ?? -1,
    censusId: currentCensus?.dateRanges?.[0]?.censusID ?? -1
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
  const chunkSize = 1024 * 32; // Increased from 8KB to 32KB to reduce AJAX call count (4x reduction)
  const connectionLimit = 1; // Process batches sequentially to prevent lock contention (file-level locks require serial processing)
  const uploadStartedRef = useRef<boolean>(false);
  const batchProcessingStartedRef = useRef<boolean>(false);

  // Transaction-aware queue for managing concurrent operations
  const queue = useMemo(() => createTransactionAwareQueue(connectionLimit), [connectionLimit]);

  // Simplified approach: track operations with completion callbacks
  const activeOperations = useRef(new Set<string>());
  const operationCompletionCallbacks = useRef<(() => void)[]>([]);

  // Track expected row counts per file for end-to-end verification
  const expectedRowCounts = useRef<Map<string, number>>(new Map());

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
    const controller = new AbortController();
    const timer = setTimeout(() => {
      ailogger.warn(`Request timeout after ${timeout}ms for ${url}`);
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });

      // Check if response indicates connection issues
      if (!response.ok && response.status >= 500) {
        ailogger.error(`Server error ${response.status} for ${url} - potential connection issue`);
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        ailogger.error(`Request aborted due to timeout for ${url}`);
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }, []);

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
          `/api/batchedupload/${schema}/${currentPlot?.plotID}/${currentCensus?.dateRanges?.[0]?.censusID}`,
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

  // Usage: Count total chunks using the SAME delimiter that will be used for actual parsing
  const countTotalChunks = useCallback(
    (file: File, delimiter: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        let chunkCount = 0;

        parse<File>(file, {
          worker: true,
          header: true,
          skipEmptyLines: true,
          chunkSize: chunkSize,
          delimiter: delimiter, // CRITICAL: Use same delimiter as actual parsing
          chunk: () => (chunkCount += 1),
          complete: () => resolve(chunkCount),
          error: err => reject(err)
        });
      });
    },
    [chunkSize]
  );

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
  useEffect(() => {
    if (uploadForm === 'measurements' && !processed) {
      const currentProgress = calculateOverallProgressValue();

      // Only calculate if we have some progress started
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
  }, [uploadForm, processed, calculateOverallProgressValue, completedChunks, processedChunks, verificationStep]);

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string, _retryCount = 0) => {
      const maxRetries = 3;
      const baseDelay = 1000; // 1 second base delay
      const operationId = `${fileName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Track this operation (once for all retries)
      activeOperations.current.add(operationId);
      ailogger.info(`Starting upload operation ${operationId} for ${fileName} (${activeOperations.current.size} active operations)`);

      // Use iterative retry loop instead of recursion to prevent stack overflow
      for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
        try {
          const response = await fetchWithTimeout(
            `/api/sqlpacketload`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                schema,
                formType: uploadForm,
                fileName,
                plot: currentPlot,
                census: currentCensus,
                user: session?.user?.name ?? null,
                fileRowSet: fileData[fileName]
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
              const errorText = await response.text().catch(() => 'Unknown client error');
              throw new Error(`Client error (${response.status}): ${errorText}`);
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
          ailogger.error(`Upload attempt ${retryCount + 1}/${maxRetries + 1} failed for ${fileName}:`, errorObj);

          // Determine if we should retry based on error type
          const shouldRetry =
            retryCount < maxRetries &&
            (errorMessage.includes('Server error (5') ||
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
    [uploadForm, currentPlot, currentCensus, session, schema, fetchWithTimeout]
  );

  const parseFileInChunks = useCallback(
    async (file: File, delimiter: string) => {
      queue.clear();
      const expectedHeaders = getTableHeaders(uploadForm!, currentPlot?.usesSubquadrats ?? false);
      const requiredHeaders = RequiredTableHeadersByFormType[uploadForm!];
      const parsingInvalidRows: FileRow[] = [];

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
          ailogger.info(`Header mapping: "${header}" -> "${mappedHeader}"`);
          return mappedHeader;
        }

        // If no mapping found, return original trimmed header
        ailogger.warn(`No mapping found for header: "${header}". Using as-is.`);
        return header.trim();
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
          // Log warning but don't reject row - extra columns are common when re-uploading
          // exported data that includes reference columns like stemID, treeID, errors
          ailogger.warn(
            `Row has extra columns (will be ignored): "${row['__parsed_extra']}". ` + `This is normal when re-uploading exported data with reference columns.`
          );
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
              ailogger.info(`Date "${value}" parsed successfully with format "${format}"`);
              return parsed.toDate();
            }
          }

          // Try moment's flexible parsing as fallback
          const flexible = moment(value.trim());
          if (flexible.isValid()) {
            ailogger.info(`Date "${value}" parsed with flexible format detection`);
            return flexible.toDate();
          }

          ailogger.error(`Unable to parse date "${value}" with any known format`);
          return value; // Return original value if parsing fails
        }

        // Enhanced coordinate precision handling
        if (uploadForm === FormType.measurements && (field === 'lx' || field === 'ly')) {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            // Round to 6 decimal places for coordinate precision
            const rounded = Math.round(numValue * 1000000) / 1000000;
            if (rounded !== numValue) {
              ailogger.info(`Coordinate ${field} value ${numValue} rounded to ${rounded} for precision`);
            }
            return rounded;
          }
        }

        // Enhanced numeric field handling
        if (uploadForm === FormType.measurements && (field === 'dbh' || field === 'hom')) {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            // Round to 2 decimal places for measurement precision
            const rounded = Math.round(numValue * 100) / 100;
            if (rounded !== numValue) {
              ailogger.info(`Measurement ${field} value ${numValue} rounded to ${rounded} for precision`);
            }
            return rounded;
          }
        }

        return value;
      };

      let totalRows = 0;

      await new Promise<void>((resolve, reject) => {
        Papa.parse<FileRow>(file, {
          delimiter: delimiter,
          header: true,
          skipEmptyLines: true,
          chunkSize: chunkSize,
          transformHeader,
          transform,
          async chunk(results: ParseResult<FileRow>, parser) {
            totalRows += results.data.length;
            try {
              if (queue.size >= connectionLimit * 2) {
                ailogger.info(`Queue size ${queue.size} exceeded threshold (${connectionLimit * 2}). Pausing parser.`);
                parser.pause();
                // Wait until the queue has room before resuming (with timeout protection)
                const maxWaitTime = 60000; // 60 seconds timeout
                const startTime = Date.now();
                while (queue.size >= connectionLimit) {
                  if (Date.now() - startTime > maxWaitTime) {
                    ailogger.error(`Queue wait timeout: queue size ${queue.size} did not drop below ${connectionLimit} within ${maxWaitTime}ms`);
                    throw new Error(`Queue processing stalled - timeout after ${maxWaitTime}ms`);
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
                try {
                  await uploadToSql(fileCollectionRowSet, file.name);
                } catch (error: unknown) {
                  const errorObj = error instanceof Error ? error : new Error(String(error));
                  ailogger.error(`Chunk upload failed for ${file.name}:`, errorObj);
                  // Still increment progress to prevent UI from hanging
                  // The error will be handled at a higher level
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
              ailogger.error('Error processing chunk:', errObj);
              parser.abort();
              throw errObj;
            }
          },
          complete: async () => {
            await queue.onEmpty();
            // Wait for all database operations to complete
            await waitForAllOperationsToComplete();
            ailogger.info(`All database operations completed for ${file.name}`);
            if (parsingInvalidRows.length > 0) {
              ailogger.warn(`Found ${parsingInvalidRows.length} invalid rows from ${file.name}, pushing directly to failedmeasurements table`);
              // Push error rows directly to failedmeasurements table instead of storing in component state
              await pushErrorRowsToFailedMeasurements(parsingInvalidRows, file.name);
            }

            // Store expected row count for end-to-end verification
            expectedRowCounts.current.set(file.name, totalRows);

            // Enhanced processing summary
            const validRowsCount = totalRows - parsingInvalidRows.length;
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
      currentPlot?.usesSubquadrats,
      setReviewState,
      queue,
      connectionLimit,
      chunkSize,
      uploadToSql,
      setCompletedChunks,
      pushErrorRowsToFailedMeasurements,
      waitForAllOperationsToComplete
    ]
  );

  useEffect(() => {
    // Use ref-based mount tracking to survive Fast Refresh during development
    // This ensures async operations can safely check mount state even after HMR
    isMountedRef.current = true;

    async function runUploads() {
      try {
        // Clear expected row counts from any previous upload
        expectedRowCounts.current.clear();

        // Validate required data before proceeding
        if (!currentPlot || !currentCensus || !schema || !session?.user?.name) {
          const contextStatus = `currentPlot: ${!!currentPlot}, currentCensus: ${!!currentCensus}, schema: ${!!schema}, session: ${!!session?.user?.name}`;
          ailogger.error(`Missing required context for upload: ${contextStatus}`);
          setUploadError(new Error('Missing required context. Please ensure a plot and census are selected.'));
          setReviewState(ReviewStates.ERRORS);
          return;
        }

        // Create upload session for tracking and cleanup on disconnection
        // Note: We use the first file name as the fileId for simplicity
        // The session tracks the overall upload, not individual files
        const primaryFileName = acceptedFiles[0]?.name || 'unknown';
        try {
          await createSession(primaryFileName, acceptedFiles.length);
          ailogger.info(`Upload session created for ${acceptedFiles.length} files, primary: ${primaryFileName}`);
          // Transition to 'uploading' state now that we're about to start uploading
          updateState('uploading').catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            ailogger.warn(`Failed to update session state to uploading: ${message}`);
          });
        } catch (sessionError: unknown) {
          const message = sessionError instanceof Error ? sessionError.message : String(sessionError);
          ailogger.warn(`Failed to create upload session (continuing anyway): ${message}`);
        }

        // Calculate total operations for the UI.
        const totalOps = acceptedFiles.length;
        setTotalOperations(uploadForm === FormType.measurements ? totalOps * 2 : totalOps);

        // CRITICAL FIX: Detect delimiters FIRST, then count chunks and parse
        // This ensures chunk count matches actual parsing
        const fileDelimiters: Map<string, string> = new Map();

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

        // Step 2: Count chunks using the SAME delimiters that will be used for parsing
        for (const file of acceptedFiles) {
          const delimiter = fileDelimiters.get(file.name)!;
          const count = await countTotalChunks(file as File, delimiter);
          ailogger.info(`File ${file.name}: Counted ${count} chunks with delimiter "${delimiter}"`);
          setTotalChunks(prev => prev + count);
        }

        // Step 3: Parse files using the detected delimiters
        for (const file of acceptedFiles) {
          const delimiter = fileDelimiters.get(file.name)!;
          await parseFileInChunks(file as File, delimiter);
          setCompletedOperations(prev => prev + 1);
        }
        await queue.onEmpty();
        // Critical: Wait for all database operations to complete before marking as uploaded
        await waitForAllOperationsToComplete();

        // Start upload verification process with UI feedback
        if (isMountedRef.current) {
          setIsVerifying(true);
          setTotalVerificationSteps(acceptedFiles.length + 1); // Files + final sync check
          setVerificationStep(0);
          setVerificationStatus('Preparing upload verification...');
        }

        // Synchronization checkpoint: Ensure all operations are complete
        ailogger.info('Upload verification checkpoint: Ensuring all database operations are synchronized...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause for synchronization

        // Additional verification: Check that data was actually inserted into the database
        try {
          if (isMountedRef.current) {
            setVerificationStatus('Verifying uploaded data integrity...');
          }

          for (let i = 0; i < acceptedFiles.length; i++) {
            const file = acceptedFiles[i];
            if (isMountedRef.current) {
              setVerificationStep(i + 1);
              setVerificationStatus(`Verifying file ${i + 1} of ${acceptedFiles.length}: ${file.name}...`);
            }

            const verificationResponse = await fetch(
              `/api/verifyupload?schema=${schema}&fileName=${encodeURIComponent(file.name)}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges?.[0]?.censusID}`
            );
            if (!verificationResponse.ok) {
              throw new Error(`Upload verification failed for ${file.name}: ${verificationResponse.status}`);
            }
            const verificationData = await verificationResponse.json();
            if (verificationData.count === 0) {
              throw new Error(`No data found in database for ${file.name} - upload may have failed silently`);
            }
            ailogger.info(`Verified ${verificationData.count} rows uploaded for ${file.name}`);

            // Brief pause between file verifications for better UX
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          if (isMountedRef.current) {
            setVerificationStep(acceptedFiles.length + 1);
            setVerificationStatus('Upload verification completed successfully');
          }
          ailogger.info('All upload operations and database transactions verified successfully');
        } catch (verificationError: unknown) {
          const message = verificationError instanceof Error ? verificationError.message : String(verificationError);
          if (isMountedRef.current) {
            setVerificationStatus(`Upload verification warning: ${message}`);
          }
          ailogger.warn(`Upload verification failed, but continuing: ${message}`);
          // Don't fail the upload if verification fails, but log the warning
        }

        // Final synchronization checkpoint before marking as uploaded
        ailogger.info('Final upload synchronization checkpoint...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (isMountedRef.current) {
          setIsVerifying(false);
        }

        if (isMountedRef.current) {
          ailogger.info('Setting uploaded to true - processing should begin');
          // Update session state to uploaded (ready for processing)
          updateState('uploaded').catch((err: unknown) => {
            const errMessage = err instanceof Error ? err.message : String(err);
            ailogger.warn(`Failed to update session state to uploaded: ${errMessage}`);
          });
          setUploaded(true);
        } else {
          ailogger.warn('Component unmounted before upload could complete');
        }
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ailogger.error('Upload error:', errorObj);
        throw errorObj;
      }
    }

    // Only run uploads once using ref
    if (!uploadStartedRef.current && !uploaded && !processed) {
      uploadStartedRef.current = true;
      runUploads().catch(error => {
        // Filter out Application Insights monitoring errors
        if (isApplicationInsightsError(error)) {
          ailogger.warn('Application Insights monitoring error detected (not a data processing error):', error);
          ailogger.info('Upload process continuing despite monitoring system limitation');
          // Don't set error state or change review state for monitoring errors
          return;
        }

        ailogger.error('runUploads failed:', error);
        // Cancel the session on error to allow cleanup
        cancelSession().catch(cancelErr => {
          ailogger.warn(`Failed to cancel upload session: ${cancelErr.message}`);
        });

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
      // Set isMountedRef to false on cleanup to prevent state updates after unmount
      // Note: The uploadStartedRef guard above ensures upload only starts once,
      // and async operations check isMountedRef.current before updating state
      // Using a ref instead of local variable survives Fast Refresh during development
      isMountedRef.current = false;
    };
    // Empty dependency array - upload runs once on mount via uploadStartedRef guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setProcessedChunks(0);

        // Update session state to processing
        updateState('processing').catch(err => {
          ailogger.warn(`Failed to update session state to processing: ${err.message}`);
        });

        ailogger.info(
          `Setting up bulk processor for schema: ${schema}, plotID: ${currentPlot?.plotID ?? -1}, censusID: ${currentCensus?.dateRanges?.[0]?.censusID}`
        );
        const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges?.[0]?.censusID}`);
        if (!response.ok) {
          throw new Error(`Failed to setup bulk processor: ${response.status} - ${response.statusText}`);
        }
        const output: { fileID: string; batchID: string }[] = await response.json();
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
            updateState('collapsing').catch(err => {
              ailogger.warn(`Failed to update session state to collapsing: ${err.message}`);
            });

            const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            });
            if (!collapserResponse.ok) {
              const errorText = await collapserResponse.text().catch(() => 'Unknown error');
              throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorText}`);
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
            await new Promise(resolve => setTimeout(resolve, 2000));

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
                { method: 'GET' },
                480000 // 8 minute timeout to match backend enhancement
              )
                .then(async response => {
                  if (!response.ok) {
                    throw new Error(`API returned status ${response.status} for batch ${fileID}-${batchID}`);
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

                  // Check if this is an Application Insights monitoring error, not a data processing error
                  const isMonitoringError =
                    errorMessage.includes('Maximum ajax per page view limit') ||
                    errorMessage.includes('AI (Internal)') ||
                    errorMessage.includes('Failed to calculate the duration of the fetch call');

                  if (isMonitoringError) {
                    ailogger.warn(`Batch ${fileID}-${batchID} encountered monitoring system error (not data error): ${errorMessage}`);
                    // Don't try to move to failedmeasurements for monitoring errors
                  } else {
                    ailogger.error(`Error processing batch ${fileID}-${batchID}:`, e);
                    // Only move to failedmeasurements if not already handled internally and it's a real processing error
                    if (!errorMessage.includes('handled internally')) {
                      try {
                        ailogger.warn(`Moving ${fileID}-${batchID} to failedmeasurements due to unhandled error: ${errorMessage}`);
                        const failureResponse = await fetch(
                          `/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`
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
                  if (isMountedRef.current) {
                    setProcessedChunks(prev => {
                      const newValue = prev + 1;
                      ailogger.info(
                        `Batch progress (with ${isMonitoringError ? 'monitoring issue' : 'failure'}): ${newValue}/${totalBatchCount} batches completed`
                      );
                      return newValue;
                    });
                  }

                  // Don't re-throw for monitoring errors or internally handled batches
                  if (!isMonitoringError && !errorMessage.includes('handled internally')) {
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

        // Synchronization checkpoint: Ensure all batch operations are complete
        ailogger.info('Processing verification checkpoint: Ensuring all batch operations are synchronized...');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Longer pause for batch synchronization

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

        // Synchronization checkpoint before collapser
        await new Promise(resolve => setTimeout(resolve, 1000));

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
          updateState('collapsing').catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            ailogger.warn(`Failed to update session state to collapsing: ${errMsg}`);
          });

          const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges?.[0]?.censusID}?schema=${schema}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!collapserResponse.ok) {
            const errorText = await collapserResponse.text().catch(() => 'Unknown error');
            throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorText}`);
          }
          const collapserData = await collapserResponse.json();

          // Check mount status after collapser
          if (!isMountedRef.current) {
            ailogger.warn('Component unmounted after collapser - skipping completion');
            return;
          }

          setVerificationStatus('Data consolidation completed successfully');
          ailogger.info('Collapser completed successfully:', collapserData);

          // Additional settling time to ensure database operations complete
          setVerificationStep(3);
          setVerificationStatus('Finalizing database operations...');
          ailogger.info('Allowing 2 seconds for database operations to settle...');
          await new Promise(resolve => setTimeout(resolve, 2000));

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

        // Final processing synchronization checkpoint
        ailogger.info('Final processing synchronization checkpoint...');
        await new Promise(resolve => setTimeout(resolve, 1000));

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
        // Filter out Application Insights monitoring errors
        if (isApplicationInsightsError(error)) {
          ailogger.warn('Application Insights monitoring error detected during batch processing (not a data processing error):', error);
          ailogger.info('Batch processing continuing despite monitoring system limitation');
          // Don't set error state or change review state for monitoring errors
          return;
        }

        // Cancel the session on processing error to allow cleanup
        cancelSession().catch(cancelErr => {
          ailogger.warn(`Failed to cancel upload session after processing error: ${cancelErr.message}`);
        });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- acceptedFiles, cancelSession, updateState intentionally excluded to prevent re-renders; batchProcessingStartedRef guards execution
  }, [
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
          setReviewState(ReviewStates.VALIDATE);
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
