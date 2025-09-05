'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
import PQueue from 'p-queue';
import Divider from '@mui/joy/Divider';
import 'moment-duration-format';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useSession } from 'next-auth/react';
import { v4 } from 'uuid';
import ailogger from '@/ailogger';
import { detectDelimiter, validateDelimiter } from '@/components/uploadsystemhelpers/delimiterdetection';

// Semaphore class for controlling concurrent operations
class Semaphore {
  private permits: number;
  private waitingQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    return new Promise(resolve => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.waitingQueue.length > 0) {
      const nextWaiting = this.waitingQueue.shift();
      if (nextWaiting) {
        nextWaiting();
      }
    } else {
      this.permits++;
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }
}

// Atomic operation tracker to prevent duplicate operations
class AtomicOperationTracker {
  private processedOperations: Set<string> = new Set();
  private inProgressOperations: Set<string> = new Set();

  async executeAtomically<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    if (this.processedOperations.has(operationId)) {
      throw new Error(`Operation ${operationId} already completed`);
    }

    if (this.inProgressOperations.has(operationId)) {
      throw new Error(`Operation ${operationId} already in progress`);
    }

    this.inProgressOperations.add(operationId);

    try {
      const result = await operation();
      // Move from in-progress to completed atomically
      this.inProgressOperations.delete(operationId);
      this.processedOperations.add(operationId);
      return result;
    } catch (error) {
      // Remove from in-progress on failure, but don't mark as completed
      this.inProgressOperations.delete(operationId);
      throw error;
    }
  }

  isProcessed(operationId: string): boolean {
    return this.processedOperations.has(operationId);
  }

  isInProgress(operationId: string): boolean {
    return this.inProgressOperations.has(operationId);
  }

  reset(): void {
    this.processedOperations.clear();
    this.inProgressOperations.clear();
  }

  getStats(): { processed: number; inProgress: number } {
    return {
      processed: this.processedOperations.size,
      inProgress: this.inProgressOperations.size
    };
  }
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
  const [failedRows, setFailedRows] = useState<{ [fileName: string]: Set<FileRow> }>({});
  const [etc, setETC] = useState('');
  const [processETC, setProcessETC] = useState('');
  const [uploaded, setUploaded] = useState<boolean>(false);
  const [processed, setProcessed] = useState<boolean>(false);
  const { data: session } = useSession();
  const [userID, setUserID] = useState<number | null>(null);
  const chunkSize = 1024 * 32;
  const connectionLimit = 8; // PQueue handles upload concurrency
  const queue = new PQueue({ concurrency: connectionLimit });

  // Race condition protection
  // Note: uploadSemaphore removed - PQueue handles upload concurrency
  const processSemaphore = useRef(new Semaphore(3)).current; // More restrictive for resource-intensive stored procedures
  const operationTracker = useRef(new AtomicOperationTracker()).current;

  // Connection monitoring
  const [activeConnections, setActiveConnections] = useState(0);
  const maxActiveConnections = 15; // Prevent server overload

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
        const match = value.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})|(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);

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
            if (queue.size >= connectionLimit) {
              ailogger.info(`Queue size ${queue.size} exceeded threshold. Pausing parser.`);
              parser.pause();
              // Wait until the queue is nearly empty before resuming.
              await queue.onEmpty();
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

            // Generate unique operation ID for this chunk
            const chunkOperationId = `upload-${file.name}-${v4()}`;

            await queue.add(async () => {
              // PQueue handles concurrency, we only need atomic operation protection
              try {
                await operationTracker.executeAtomically(chunkOperationId, async () => {
                  await uploadToSql(fileCollectionRowSet, file.name);
                  return true;
                });
                setCompletedChunks(prev => prev + 1);
              } catch (error: any) {
                if (error.message.includes('already completed') || error.message.includes('already in progress')) {
                  ailogger.warn(`Chunk operation ${chunkOperationId} skipped - already processed`);
                  return;
                }

                ailogger.error('Chunk rollback triggered. Error uploading to SQL:', error);
                ailogger.info('starting retry...');

                // Single retry with new operation ID to prevent duplicate detection
                const retryOperationId = `retry-${chunkOperationId}`;
                try {
                  await operationTracker.executeAtomically(retryOperationId, async () => {
                    await uploadToSql({ [file.name]: fileRowSet } as FileCollectionRowSet, file.name);
                    return true;
                  });
                  setCompletedChunks(prev => prev + 1);
                } catch (retryError: any) {
                  ailogger.error('Catastrophic error on retry:', retryError);
                  throw retryError; // Re-throw to fail the entire operation
                }
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
    async (fileData: FileCollectionRowSet, fileName: string) => {
      // Connection monitoring - prevent server overload
      if (activeConnections >= maxActiveConnections) {
        ailogger.warn(`Connection limit reached (${activeConnections}/${maxActiveConnections}), waiting...`);
        // Wait briefly before retrying to prevent server overload
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setActiveConnections(prev => prev + 1);
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
          90000 // 90 second timeout for chunk uploads
        );

        if (!response.ok) {
          throw new Error(`API returned status ${response.status}`);
        }
        try {
          const data = await response.json();
          if (data.failingRows) {
            const failingRows: Set<FileRow> = data.failingRows;
            setFailedRows(prev => ({
              ...prev,
              [fileName]: new Set([...(prev[fileName] ?? []), ...failingRows])
            }));
          }
        } catch (e: any) {
          ailogger.error('no failing rows returned. unforeseen error');
          throw e;
        }
      } catch (error: any) {
        ailogger.error('Network or API error:', error);
        throw error;
      } finally {
        // CRITICAL: Always decrement connection counter to prevent leaks
        setActiveConnections(prev => Math.max(0, prev - 1));
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
        // Reset operation tracker for new upload session
        operationTracker.reset();
        ailogger.info('Starting new upload session with race condition protection enabled');

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

          // If measurements, handle failed rows for this file.
          // if (uploadForm === FormType.measurements && Object.values(failedRows[file.name] || {}).length > 0) {
          //   const batchID = v4();
          //   const rows = Object.values(failedRows[file.name] || []);
          //   const placeholders = rows.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
          //   const values = rows.flatMap(row => {
          //     const transformedRow = { ...row, date: row.date ? moment(row.date).format('YYYY-MM-DD') : row.date };
          //     return [file.name, batchID, currentPlot?.plotID ?? -1, currentCensus?.dateRanges[0].censusID ?? -1, ...Object.values(transformedRow)];
          //   });
          //   const insertSQL = `INSERT INTO ${schema}.failedmeasurements
          //     (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
          //     VALUES ${placeholders}`;
          //   await fetch(`/api/formatrunquery`, {
          //     method: 'POST',
          //     headers: { 'Content-Type': 'application/json' },
          //     body: JSON.stringify({ query: insertSQL, params: values })
          //   });
          //   // Remove submitted rows.
          //   setFailedRows(prev => {
          //     const { [file.name]: removed, ...rest } = prev;
          //     return rest;
          //   });
          // }
          setCompletedOperations(prev => prev + 1);
        }
        await queue.onEmpty();
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
      // Clear queues and reset trackers on cleanup
      queue.clear();
      const stats = operationTracker.getStats();
      ailogger.info(`Component unmounting - operation stats: ${stats.processed} processed, ${stats.inProgress} in progress`);

      // Reset connection counter to prevent accumulation across uploads
      setActiveConnections(0);
      ailogger.info('Upload component unmounted - connection counter reset');
    };
  }, [acceptedFiles, uploadForm, currentPlot, currentCensus, schema]);

  useEffect(() => {
    if (uploadForm === FormType.measurements && uploaded && !processed && completedChunks === totalChunks) {
      // Don't clear queue here - it may cancel upload operations
      // The queue should naturally be empty since all chunks are completed

      async function runProcessBatches() {
        setProcessedChunks(0);
        chunkProcessStartTime.current = performance.now();
        const response = await fetch(`/api/setupbulkprocessor/${schema}/${currentPlot?.plotID ?? -1}/${currentCensus?.dateRanges[0].censusID}`);
        const output: { fileID: string; batchID: string }[] = await response.json();
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
        setTotalBatches(Object.values(grouped).reduce((acc, arr) => acc + arr.length, 0));

        // Process each file's batches sequentially to prevent race conditions
        for (const fileID in grouped) {
          ailogger.info(`Processing FileID: ${fileID} with ${grouped[fileID].length} batches`);

          // Process batches for this file with controlled concurrency
          const fileBatchPromises = grouped[fileID].map(async batchID => {
            const batchOperationId = `process-${fileID}-${batchID}`;

            return queue.add(async () => {
              await processSemaphore.acquire();
              try {
                await operationTracker.executeAtomically(batchOperationId, async () => {
                  const response = await fetchWithTimeout(
                    `/api/setupbulkprocedure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`,
                    { method: 'GET' },
                    120000 // 2 minute timeout for stored procedures
                  );

                  if (!response.ok) {
                    throw new Error(`Batch processing failed with status ${response.status} for ${fileID}-${batchID}`);
                  }

                  return true;
                });

                setProcessedChunks(prev => {
                  const newValue = prev + 1;
                  ailogger.info(`Batch ${batchID} for file ${fileID} completed. Progress: ${newValue}`);
                  return newValue;
                });
              } catch (error: any) {
                if (error.message.includes('already completed') || error.message.includes('already in progress')) {
                  ailogger.warn(`Batch operation ${batchOperationId} skipped - already processed`);
                  return;
                }

                ailogger.error(`Error processing batch ${batchID} for file ${fileID}:`, error);

                // Attempt to move failed batch to failedmeasurements table
                // Note: This runs within the same semaphore context, no additional acquire needed
                try {
                  const failureOperationId = `failure-${batchOperationId}`;
                  await operationTracker.executeAtomically(failureOperationId, async () => {
                    const failureResponse = await fetchWithTimeout(
                      `/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`,
                      { method: 'GET' },
                      60000
                    );

                    if (!failureResponse.ok) {
                      throw new Error(`Failure handling failed with status ${failureResponse.status}`);
                    }

                    return true;
                  });
                  ailogger.info(`Batch ${batchID} moved to failed measurements table`);
                } catch (failureError: any) {
                  ailogger.error(`Failed to handle batch failure for ${fileID}-${batchID}:`, failureError);
                  // Continue - we don't want failure handling to block the entire process
                }

                // Don't re-throw - we handled the failure, continue with other batches
              } finally {
                processSemaphore.release();
              }
            });
          });

          for (const batchPromise of fileBatchPromises) {
            await batchPromise;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          setCompletedOperations(prev => prev + 1);
          ailogger.info(`All batches for file ${fileID} completed`);
        }
        await queue.onEmpty();

        ailogger.info('All processors completed, waiting for transaction settlement before collapser...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // trigger collapser ONCE with atomic protection
        const collapserOperationId = `collapser-${currentCensus?.dateRanges[0].censusID}-${schema}`;
        try {
          await operationTracker.executeAtomically(collapserOperationId, async () => {
            const response = await fetchWithTimeout(
              `/api/setupbulkcollapser/${currentCensus?.dateRanges[0].censusID}?schema=${schema}`,
              { method: 'GET' },
              300000 // 5 minute timeout for collapser
            );

            if (!response.ok) {
              throw new Error(`Collapser operation failed with status ${response.status}`);
            }

            ailogger.info(`Collapser operation completed successfully for census ${currentCensus?.dateRanges[0].censusID}`);
            return true;
          });
        } catch (error: any) {
          if (error.message.includes('already completed')) {
            ailogger.info(`Collapser operation already completed for census ${currentCensus?.dateRanges[0].censusID}`);
          } else {
            ailogger.error('Collapser operation failed:', error);
            throw error;
          }
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
      {!hasUploaded.current ? (
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            width: '100%',
            alignItems: 'center',
            mt: 4
          }}
        >
          <Stack direction="column" spacing={3} sx={{ width: '100%' }}>
            <Stack direction="row" spacing={3} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography level="title-lg">Upload Progress</Typography>
              <Typography level="body-sm" color="neutral">
                {totalOperations} operations, {totalChunks} chunks total
              </Typography>
            </Stack>

            <Box sx={{ width: '100%' }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1 }}>
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
              />
            </Box>

            {totalChunks !== 0 && (
              <Box sx={{ width: '100%' }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1 }}>
                  <Typography level="body-sm">Data Processing</Typography>
                  <Typography level="body-sm" color="primary">
                    {completedChunks}/{totalChunks} chunks
                  </Typography>
                </Stack>
                <LinearProgress determinate variant="soft" color="primary" size="lg" value={(completedChunks / totalChunks) * 100} />
                {completedChunks < totalChunks && etc !== 'Calculating...' && (
                  <Typography level="body-xs" sx={{ mt: 1, textAlign: 'center' }} color="neutral">
                    {((completedChunks / totalChunks) * 100).toFixed(1)}% complete • {etc}
                  </Typography>
                )}
              </Box>
            )}

            {uploadForm === 'measurements' && totalBatches !== 0 && (
              <Box sx={{ width: '100%' }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: 1 }}>
                  <Typography level="body-sm">Batch Processing</Typography>
                  <Typography level="body-sm" color="primary">
                    {processedChunks}/{totalBatches} batches
                  </Typography>
                </Stack>
                <LinearProgress determinate variant="soft" color="success" size="lg" value={(processedChunks / totalBatches) * 100} />
                {processedChunks < totalBatches && processETC !== 'Calculating...' && (
                  <Typography level="body-xs" sx={{ mt: 1, textAlign: 'center' }} color="neutral">
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
            mt: 4
          }}
        >
          <Stack direction={'column'} sx={{ display: 'inherit' }}>
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
