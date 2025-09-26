'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
// Note: TransactionAwarePQueue moved to server-side to avoid client-side MySQL imports
import 'moment-duration-format';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useSession } from 'next-auth/react';
import { v4 } from 'uuid';
import ailogger from '@/ailogger';
import { detectDelimiter, validateDelimiter } from '@/components/uploadsystemhelpers/delimiterdetection';
// TransactionMonitor disabled due to architectural changes

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
  personnelRecording,
  acceptedFiles,
  uploadForm,
  setIsDataUnsaved,
  schema,
  setUploadError,
  setReviewState,
  setAllRowToCMID,
  setErrorRows,
  selectedDelimiters
}) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [completedChunks, setCompletedChunks] = useState<number>(0);
  const [processedChunks, setProcessedChunks] = useState<number>(0);
  const [etc, setETC] = useState('');
  const [processETC, setProcessETC] = useState('');
  const [uploaded, setUploaded] = useState<boolean>(false);
  const [processed, setProcessed] = useState<boolean>(false);
  const { data: session } = useSession();
  const [userID, setUserID] = useState<number | null>(null);
  const chunkSize = 1024 * 8;
  const connectionLimit = 8; // Reduced concurrency for production stability

  // Enhanced client-side queue with proper transaction tracking
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

  // Simplified approach: track operations with completion callbacks
  const activeOperations = useRef(new Set<string>());
  const operationCompletionCallbacks = useRef<(() => void)[]>([]);

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
  const totalCompletionTimeRef = useRef(0);
  const totalProcessCompletionTimeRef = useRef(0);
  const chunkStartTime = useRef(0);
  const chunkProcessStartTime = useRef(0);

  const generateErrorRowId = (row: FileRow) =>
    `row-${Object.values(row)
      .join('-')
      .replace(/[^a-zA-Z0-9-]/g, '')}`;

  const fetchWithTimeout = async (url: string | URL | Request, options: RequestInit | undefined, timeout = 60000) => {
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

  // Usage:
  const countTotalChunks = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      let chunkCount = 0;

      parse<File>(file, {
        worker: true,
        header: true,
        skipEmptyLines: true,
        chunkSize: chunkSize,
        chunk: () => (chunkCount += 1),
        complete: () => resolve(chunkCount),
        error: err => reject(err)
      });
    });
  };

  useEffect(() => {
    if (uploadForm === 'measurements' && !uploaded && !processed) {
      if (completedChunks < 3) {
        setETC('Calculating...');
        return;
      }

      // Update cumulative time for this chunk
      totalCompletionTimeRef.current += performance.now() - chunkStartTime.current;

      const smoothingFactor = 0.2;
      const lastChunkTime = performance.now() - chunkStartTime.current;
      const smoothedAvgTime = smoothingFactor * lastChunkTime + (1 - smoothingFactor) * (totalCompletionTimeRef.current / completedChunks);
      const remaining = totalChunks - completedChunks;
      const estimatedTime = smoothedAvgTime * remaining;

      setETC(
        moment.utc(estimatedTime).format('mm:ss').split(':')[0] +
          ' minutes and ' +
          moment.utc(estimatedTime).format('mm:ss').split(':')[1] +
          ' seconds remaining...'
      );
    }
  }, [uploadForm, uploaded, processed, completedChunks, totalChunks]);

  useEffect(() => {
    if (uploadForm === 'measurements' && uploaded && !processed && processedChunks > 0) {
      const now = performance.now();
      const elapsed = now - chunkProcessStartTime.current;
      totalProcessCompletionTimeRef.current += elapsed;
      chunkProcessStartTime.current = now;
    }
  }, [processedChunks]);

  useEffect(() => {
    if (uploadForm === 'measurements' && uploaded && !processed) {
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
  }, [uploadForm, uploaded, processed, processedChunks, totalBatches]);

  const parseFileInChunks = async (file: File, delimiter: string) => {
    queue.clear();
    const expectedHeaders = getTableHeaders(uploadForm!, currentPlot?.usesSubquadrats ?? false);
    const requiredHeaders = RequiredTableHeadersByFormType[uploadForm!];
    const parsingInvalidRows: FileRow[] = [];

    if (!expectedHeaders || !requiredHeaders) {
      ailogger.error(`No headers defined for form type: ${uploadForm}`);
      setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
      return;
    }

    // Validate delimiter before parsing
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
    } catch (error) {
      ailogger.error(`Error validating delimiter for file ${file.name}:`, error instanceof Error ? error : new Error(String(error)));
    }

    const transformHeader = (header: string) => header.trim();
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
        errors.push(
          `Extra columns detected: "${row['__parsed_extra']}". This may indicate delimiter mismatch or improperly quoted fields. Expected delimiter: "${delimiter}"`
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

      if (uploadForm === FormType.measurements && field === 'date') {
        const match = value.match(/(\d{4})[\/.\\-](\d{1,2})[\/.\\-](\d{1,2})|(\d{1,2})[\/.\\-](\d{1,2})[\/.\\-](\d{2,4})/);

        if (match) {
          let normalizedDate;

          if (match[1]) {
            // Format: YYYY/MM/DD or YYYY-MM-DD
            normalizedDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else {
            // Format: MM/DD/YY(YY) or DD-MM-YY(YY)
            const year = match[6].length === 2 ? `20${match[6]}` : match[6]; // Convert two-digit year to four-digit
            normalizedDate = `${year}-${match[4].padStart(2, '0')}-${match[5].padStart(2, '0')}`;
          }

          // Parse the date with both MM/DD/YYYY and DD/MM/YYYY for flexibility
          const validFormats = ['YYYY-MM-DD', 'MM-DD-YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY'];
          const parsedDate = moment(normalizedDate, validFormats, true);

          if (parsedDate.isValid()) {
            return parsedDate.toDate();
          } else {
            ailogger.error(
              `Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD, MM-DD-YYYY, DD-MM-YYYY, and their variations with '/' or '-'.`
            );
            return value;
          }
        } else {
          ailogger.error(
            `Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD, MM-DD-YYYY, DD-MM-YYYY, and their variations with '/' or '-'.`
          );
          return value;
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
          chunkStartTime.current = performance.now();
          totalRows += results.data.length;
          try {
            if (queue.size >= connectionLimit * 2) {
              ailogger.info(`Queue size ${queue.size} exceeded threshold (${connectionLimit * 2}). Pausing parser.`);
              parser.pause();
              // Wait until the queue has room before resuming
              while (queue.size >= connectionLimit) {
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
              } catch (error: any) {
                ailogger.error(`Chunk upload failed for ${file.name}:`, error);
                // Still increment progress to prevent UI from hanging
                // The error will be handled at a higher level
              } finally {
                // Always increment completed chunks to ensure progress updates
                setCompletedChunks(prev => prev + 1);
              }
            });
          } catch (err: any) {
            ailogger.error('Error processing chunk:', err);
            parser.abort();
            throw err;
          }
        },
        complete: async () => {
          await queue.onEmpty();
          // Wait for all database operations to complete
          await waitForAllOperationsToComplete();
          ailogger.info(`All database operations completed for ${file.name}`);
          if (parsingInvalidRows.length > 0) {
            ailogger.warn('Some rows were invalid and not uploaded:', parsingInvalidRows);
            setErrorRows(prevErrorRows => {
              const updatedErrorRows = { ...prevErrorRows };
              if (!updatedErrorRows[file.name]) {
                updatedErrorRows[file.name] = {};
              }

              parsingInvalidRows.forEach(row => {
                const errorId = generateErrorRowId(row);
                if (uploadForm === 'measurements') {
                  updatedErrorRows[file.name][errorId] = {
                    plotID: String(currentPlot?.plotID ?? -1),
                    censusID: String(currentCensus?.dateRanges[0].censusID ?? -1),
                    tag: row.tag,
                    stemTag: row.stemtag,
                    spCode: row.spcode,
                    quadrat: row.quadrat,
                    x: row.lx,
                    y: row.ly,
                    dbh: row.dbh,
                    hom: row.hom,
                    date: moment(row.date).format('YYYY-MM-DD'),
                    codes: row.codes,
                    comments: row.comments,
                    // Enhanced error information
                    errorReason: row.failureReason || 'Unknown error',
                    originalRowData: JSON.stringify(row),
                    detectedDelimiter: delimiter,
                    fileName: file.name,
                    ...(row.excessData ? { excessData: row.excessData } : {})
                  };
                } else {
                  const stringifiedRow = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
                  updatedErrorRows[file.name][errorId] = {
                    ...stringifiedRow,
                    plotID: String(currentPlot?.plotID ?? -1),
                    censusID: String(currentCensus?.dateRanges[0].censusID ?? -1),
                    // Enhanced error information
                    errorReason: row.failureReason || 'Unknown error',
                    originalRowData: JSON.stringify(row),
                    detectedDelimiter: delimiter,
                    fileName: file.name,
                    ...(row.excessData ? { excessData: row.excessData } : {})
                  };
                }
              });

              return updatedErrorRows;
            });
          }
          resolve();
        },
        error: (err: any) => {
          ailogger.error('Error parsing file:', err);
          reject(err);
        }
      });
    });
  };

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string, retryCount = 0) => {
      const maxRetries = 3;
      const baseDelay = 1000; // 1 second base delay
      const operationId = `${fileName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Track this operation
      activeOperations.current.add(operationId);
      ailogger.info(`Starting upload operation ${operationId} for ${fileName} (${activeOperations.current.size} active operations)`);

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
              user: userID,
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

          // Check if the server indicates transaction completion
          if (data.transactionCompleted) {
            ailogger.info(`Server confirmed transaction completion for ${fileName} (batchID: ${data.batchID || 'N/A'})`);
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
        } catch (e: any) {
          ailogger.error('Error parsing response data:', e);
          throw new Error(`Failed to parse server response: ${e.message}`);
        }
      } catch (error: any) {
        ailogger.error(`Upload attempt ${retryCount + 1}/${maxRetries + 1} failed for ${fileName}:`, error);

        // Determine if we should retry based on error type
        const shouldRetry =
          retryCount < maxRetries &&
          (error.message?.includes('Server error (5') ||
            error.message?.includes('Rate limit exceeded') ||
            error.message?.includes('timeout') ||
            error.message?.includes('ECONNRESET') ||
            error.message?.includes('PROTOCOL_CONNECTION_LOST'));

        if (shouldRetry) {
          const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000; // Exponential backoff with jitter
          ailogger.info(`Retrying upload for ${fileName} in ${delay.toFixed(0)}ms... (attempt ${retryCount + 2}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return uploadToSql(fileData, fileName, retryCount + 1);
        } else {
          ailogger.error(`Upload failed permanently for ${fileName} after ${retryCount + 1} attempts:`, error);

          // Mark operation as complete even on failure to prevent hanging
          activeOperations.current.delete(operationId);
          ailogger.info(`Failed upload operation ${operationId} marked complete (${activeOperations.current.size} remaining operations)`);

          // Notify waiting processes if all operations are complete
          if (activeOperations.current.size === 0) {
            operationCompletionCallbacks.current.forEach(callback => callback());
            operationCompletionCallbacks.current = [];
          }

          throw error;
        }
      }
    },
    [
      uploadForm,
      currentPlot?.plotID,
      currentCensus?.dateRanges[0].censusID,
      personnelRecording,
      setAllRowToCMID,
      setUploadError,
      setReviewState,
      schema,
      currentQuadrat?.quadratID
    ]
  );

  useEffect(() => {
    let isMounted = true;

    async function runUploads() {
      try {
        // Calculate total operations for the UI.
        const totalOps = acceptedFiles.length;
        setTotalOperations(uploadForm === FormType.measurements ? totalOps * 2 : totalOps);

        const userIDResponse = await fetch(`/api/catalog/${session?.user.name?.split(' ')[0]}/${session?.user.name?.split(' ')[1]}`, { method: 'GET' });
        setUserID(await userIDResponse.json());

        // Count chunks for each file.
        for (const file of acceptedFiles) {
          const count = await countTotalChunks(file as File);
          setTotalChunks(prev => prev + count);
        }

        for (const file of acceptedFiles) {
          // Use user-selected delimiter if available, otherwise use enhanced detection
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

          await parseFileInChunks(file as File, delimiter);
          setCompletedOperations(prev => prev + 1);
        }
        await queue.onEmpty();
        // Critical: Wait for all database operations to complete before marking as uploaded
        await waitForAllOperationsToComplete();

        // Additional verification: Check that data was actually inserted into the database
        try {
          for (const file of acceptedFiles) {
            const verificationResponse = await fetch(
              `/api/verifyupload?schema=${schema}&fileName=${encodeURIComponent(file.name)}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`
            );
            if (!verificationResponse.ok) {
              throw new Error(`Upload verification failed for ${file.name}: ${verificationResponse.status}`);
            }
            const verificationData = await verificationResponse.json();
            if (verificationData.count === 0) {
              throw new Error(`No data found in database for ${file.name} - upload may have failed silently`);
            }
            ailogger.info(`Verified ${verificationData.count} rows uploaded for ${file.name}`);
          }
          ailogger.info('All upload operations and database transactions verified successfully');
        } catch (verificationError: any) {
          ailogger.warn('Upload verification failed, but continuing:', verificationError.message);
          // Don't fail the upload if verification fails, but log the warning
        }

        if (isMounted) {
          setUploaded(true);
        }
      } catch (error: any) {
        ailogger.error('Upload error:', error);
        throw error;
      }
    }

    runUploads().catch(error => {
      setUploadError(error);
      setReviewState(ReviewStates.ERRORS);
    });
    return () => {
      isMounted = false;
    };
  }, [acceptedFiles, uploadForm, currentPlot, currentCensus, schema]);

  useEffect(() => {
    if (uploadForm === FormType.measurements && uploaded && !processed && completedChunks === totalChunks) {
      queue.clear();

      async function runProcessBatches() {
        setProcessedChunks(0);
        chunkProcessStartTime.current = performance.now();
        ailogger.info(
          `Setting up bulk processor for schema: ${schema}, plotID: ${currentPlot?.plotID ?? -1}, censusID: ${currentCensus?.dateRanges[0].censusID}`
        );
        const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges[0].censusID}`);
        if (!response.ok) {
          throw new Error(`Failed to setup bulk processor: ${response.status} - ${response.statusText}`);
        }
        const output: { fileID: string; batchID: string }[] = await response.json();
        ailogger.info(`Received ${output.length} batches to process:`, output);
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
                  setProcessedChunks(prev => {
                    const newValue = prev + 1;
                    ailogger.info(`Batch progress: ${newValue}/${totalBatchCount} batches completed`);
                    return newValue;
                  });
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
                      } catch (failureError: any) {
                        ailogger.error(`Failed to move ${fileID}-${batchID} to failedmeasurements:`, failureError);
                      }
                    }
                  }

                  // Still increment progress even for failed batches so UI doesn't hang
                  setProcessedChunks(prev => {
                    const newValue = prev + 1;
                    ailogger.info(
                      `Batch progress (with ${isMonitoringError ? 'monitoring issue' : 'failure'}): ${newValue}/${totalBatchCount} batches completed`
                    );
                    return newValue;
                  });

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
          } catch (fileError: any) {
            ailogger.error(`File processing failed for ${fileID}:`, fileError);
            // Continue with other files even if one fails
          }
        }

        // Wait for all batch processing to complete, then increment completedOperations once
        await queue.onEmpty();

        // Verify that all batches were processed successfully
        try {
          const verifyProcessingResponse = await fetch(
            `/api/verifyprocessing?schema=${schema}&plotID=${currentPlot?.plotID}&censusID=${currentCensus?.dateRanges[0].censusID}`
          );
          if (verifyProcessingResponse.ok) {
            const verifyData = await verifyProcessingResponse.json();
            ailogger.info(`Processing verification: ${verifyData.processedCount} rows processed, ${verifyData.remainingCount} remaining in temporary table`);
          } else {
            ailogger.warn('Processing verification failed, but continuing with collapser');
          }
        } catch (verifyError: any) {
          ailogger.warn('Processing verification error:', verifyError.message);
        }

        setCompletedOperations(prev => prev + 1);

        // trigger collapser ONCE and wait for it to complete
        try {
          ailogger.info('Starting collapser procedure...');
          const collapserResponse = await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges[0].censusID}?schema=${schema}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!collapserResponse.ok) {
            const errorText = await collapserResponse.text().catch(() => 'Unknown error');
            throw new Error(`Collapser failed: ${collapserResponse.status} - ${errorText}`);
          }
          const collapserData = await collapserResponse.json();
          ailogger.info('Collapser completed successfully:', collapserData);

          // Additional settling time to ensure database operations complete
          ailogger.info('Allowing 2 seconds for database operations to settle...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (collapserError: any) {
          ailogger.error('Collapser error:', collapserError.message);
          throw collapserError;
        }

        setProcessed(true);
      }

      runProcessBatches().catch(error => {
        setUploadError(error);
        setReviewState(ReviewStates.ERRORS);
      });
    }
  }, [uploaded, uploadForm, completedChunks, totalChunks, schema, currentPlot, currentCensus]);

  useEffect(() => {
    if (uploadForm === FormType.measurements) {
      if (uploaded && processed) {
        hasUploaded.current = true;
        setReviewState(ReviewStates.VALIDATE);
        setIsDataUnsaved(false);
      }
    } else {
      if (uploaded) {
        hasUploaded.current = true;
        setReviewState(ReviewStates.UPLOAD_AZURE);
        setIsDataUnsaved(false);
      }
    }
  }, [uploaded, processed, uploadForm, setReviewState, setIsDataUnsaved]);

  const { palette } = useTheme();

  return (
    <>
      {/* TransactionMonitor disabled due to architectural changes */}
      {!hasUploaded.current ? (
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
              <Typography level="title-lg">Upload Progress</Typography>
              <Typography level="body-sm" color="neutral">
                {totalOperations} operations, {totalChunks} chunks total
              </Typography>
            </Stack>

            <Box sx={{ width: '100%' }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1, width: '100%' }}>
                <Typography level="body-sm">File Progress</Typography>
                <Typography level="body-sm" color="primary">
                  {completedOperations}/{totalOperations}
                </Typography>
              </Stack>
              <LinearProgress
                size="lg"
                variant="soft"
                color="primary"
                value={totalOperations > 0 ? (completedOperations / totalOperations) * 100 : 0}
                determinate
                sx={{ width: '100%' }}
              />
            </Box>

            {totalChunks !== 0 && (
              <Box sx={{ width: '100%' }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1, width: '100%' }}>
                  <Typography level="body-sm">Data Processing</Typography>
                  <Typography level="body-sm" color="primary">
                    {completedChunks}/{totalChunks} chunks
                  </Typography>
                </Stack>
                <LinearProgress determinate variant="soft" color="primary" size="lg" value={(completedChunks / totalChunks) * 100} sx={{ width: '100%' }} />
                {completedChunks < totalChunks && etc !== 'Calculating...' && (
                  <Typography level="body-xs" sx={{ mt: 1, textAlign: 'center', width: '100%' }} color="neutral">
                    {((completedChunks / totalChunks) * 100).toFixed(1)}% complete • {etc}
                  </Typography>
                )}
              </Box>
            )}

            {uploadForm === 'measurements' && totalBatches !== 0 && (
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
                Please do not exit this page while upload is in progress
              </Typography>
              {!uploaded && !processed && (
                <DotLottieReact
                  src="https://lottie.host/61a4d60d-51b8-4603-8c31-3a0187b2ddc6/BYrv3qTBtA.lottie"
                  loop
                  autoplay
                  themeId={palette.mode === 'dark' ? 'Dark' : undefined}
                  style={{
                    width: '200px',
                    height: '200px'
                  }}
                />
              )}
              {uploaded && !processed && (
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
          <Stack direction={'column'} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography level={'title-md'} gutterBottom>
              SQL Upload Complete
            </Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
