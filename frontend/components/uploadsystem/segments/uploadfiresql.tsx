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

const UploadFireSQL: React.FC<UploadFireProps> = ({
  personnelRecording,
  acceptedFiles,
  uploadForm,
  setIsDataUnsaved,
  schema,
  setUploadError,
  setReviewState,
  setAllRowToCMID,
  errorRows,
  setErrorRows
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
  const chunkSize = 4096;
  const connectionLimit = 20;
  const queue = new PQueue({ concurrency: connectionLimit });
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
        errors.push('Extra columns detected. Likely caused by final column using commas instead of semicolons');
        extraData = true;
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

            await queue.add(async () => {
              try {
                await uploadToSql(fileCollectionRowSet, file.name);
                setCompletedChunks(prev => prev + 1);
              } catch (error: any) {
                ailogger.error('Chunk rollback triggered. Error uploading to SQL:', error);
                ailogger.info('starting retry...');
                // Single retry -- add this chunk back to the queue.
                await queue.add(async () => {
                  try {
                    await uploadToSql({ [file.name]: fileRowSet } as FileCollectionRowSet, file.name);
                    setCompletedChunks(prev => prev + 1);
                  } catch (e: any) {
                    ailogger.error('Catastrophic error on retry: ', e);
                  }
                });
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
                if (uploadForm === 'measurements') {
                  updatedErrorRows[file.name][generateErrorRowId(row)] = {
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
                    comments: row.comments
                  };
                } else {
                  const id = generateErrorRowId(row);
                  const stringifiedRow = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
                  updatedErrorRows[file.name][id] = {
                    ...stringifiedRow,
                    plotID: String(currentPlot?.plotID ?? -1),
                    censusID: String(currentCensus?.dateRanges[0].censusID ?? -1)
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
      try {
        const response = await fetch(`/api/sqlpacketload`, {
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
        });

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
          const isCSV = file.name.endsWith('.csv');
          const delimiter = isCSV ? ',' : '\t';
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
    };
  }, [acceptedFiles, uploadForm, currentPlot, currentCensus, schema]);

  useEffect(() => {
    if (uploadForm === FormType.measurements && uploaded && !processed && completedChunks === totalChunks) {
      queue.clear();

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
        for (const fileID in grouped) {
          ailogger.info(`Processing FileID: ${fileID}`);
          // Map each batchID to a queued task.
          const batchTasks = grouped[fileID].map(batchID =>
            queue.add(async () => {
              try {
                await fetch(`/api/setupbulkprocedure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`);
                setProcessedChunks(prev => prev + 1);
              } catch (e: any) {
                // unforeseen error OR max attempts exceeded. Move to failedmeasurements manually and try the next one
                await fetch(`/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${schema}`);
                throw e;
              }
            })
          );

          // Optionally, queue a follow-up task that updates file-level completion once all its batches are done.
          await queue.add(async () => {
            await Promise.all(batchTasks);
            setCompletedOperations(prev => prev + 1);
          });
        }
        await queue.onEmpty();
        // trigger collapser ONCE
        await fetch(`/api/setupbulkcollapser/${currentCensus?.dateRanges[0].censusID}?schema=${schema}`);
        setProcessed(true);
      }

      // runProcessBatches().catch(error => {
      //   setUploadError(error);
      //   setReviewState(ReviewStates.ERRORS);
      // });
    }
  }, [uploaded, uploadForm, completedChunks, totalChunks, schema, currentPlot, currentCensus]);

  useEffect(() => {
    if (uploaded) {
      hasUploaded.current = true;
      setReviewState(ReviewStates.UPLOAD_AZURE);
      setIsDataUnsaved(false);
    }
    // if (uploadForm === FormType.measurements) {
    //   if (uploaded && processed) {
    //     hasUploaded.current = true;
    //     setReviewState(ReviewStates.VALIDATE);
    //     setIsDataUnsaved(false);
    //   }
    // } else {
    //   if (uploaded) {
    //     hasUploaded.current = true;
    //     setReviewState(ReviewStates.UPLOAD_AZURE);
    //     setIsDataUnsaved(false);
    //   }
    // }
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
          <Stack direction={'column'} sx={{ width: '100%' }}>
            <Typography level={'title-md'} gutterBottom>{`Total Operations: ${totalOperations}, Total Chunks: ${totalChunks}`}</Typography>

            <Box sx={{ width: '100%', mb: 2 }}>
              <Typography level={'title-md'} gutterBottom>
                Total File Progress - Completed: {completedOperations}
              </Typography>
              <LinearProgress size={'lg'} variant="soft" color="primary">
                <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                  {completedOperations}/{totalOperations}
                </Typography>
              </LinearProgress>
            </Box>

            {totalChunks !== 0 && (
              <Box sx={{ width: '100%', mb: 2 }}>
                <Typography level={'title-md'} gutterBottom>
                  Total Parsing Progress - Completed: {completedChunks}
                </Typography>
                <LinearProgress
                  determinate
                  variant="plain"
                  color="primary"
                  thickness={48}
                  value={(completedChunks / totalChunks) * 100}
                  sx={{
                    '--LinearProgress-radius': '0px',
                    '--LinearProgress-progressThickness': '36px'
                  }}
                >
                  {completedChunks < totalChunks ? (
                    <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                      LOADING: {`${((completedChunks / totalChunks) * 100).toFixed(2)}%`} {' | '} {completedChunks} completed out of {totalChunks} {' | '}
                      {totalChunks - completedChunks} remaining
                      <br />
                      Estimated time to completion: {etc}
                    </Typography>
                  ) : (
                    <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                      COMPLETED
                    </Typography>
                  )}
                </LinearProgress>
                <Divider sx={{ my: 1 }} />
                {uploadForm === 'measurements' && totalBatches !== 0 && (
                  <>
                    <Typography level={'title-md'} gutterBottom>
                      Total Processing Progress - Completed: {processedChunks}
                    </Typography>
                    <LinearProgress
                      determinate
                      variant="plain"
                      color="primary"
                      thickness={48}
                      value={(processedChunks / totalBatches) * 100}
                      sx={{
                        '--LinearProgress-radius': '0px',
                        '--LinearProgress-progressThickness': '36px'
                      }}
                    >
                      {processedChunks < totalBatches ? (
                        <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                          LOADING: {`${((processedChunks / totalBatches) * 100).toFixed(2)}%`} {' | '} {processedChunks} completed out of {totalBatches} {' | '}
                          {totalBatches - processedChunks} remaining
                          <br />
                          Estimated time to completion: {processETC}
                        </Typography>
                      ) : (
                        <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                          PROCESSING COMPLETED
                        </Typography>
                      )}
                    </LinearProgress>
                  </>
                )}
                <Divider sx={{ my: 2 }} />
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    textAlign: 'center'
                  }}
                >
                  <Typography level="title-lg" fontWeight="bold" sx={{ mb: 2 }}>
                    Please do not exit this page! The upload will take some time to complete.
                  </Typography>
                  {!uploaded && !processed && (
                    <DotLottieReact
                      src="https://lottie.host/61a4d60d-51b8-4603-8c31-3a0187b2ddc6/BYrv3qTBtA.lottie"
                      loop
                      autoplay
                      themeId={palette.mode === 'dark' ? 'Dark' : undefined}
                      style={{
                        width: '40%',
                        height: '40%'
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
                        width: '40%',
                        height: '40%'
                      }}
                    />
                  )}
                </Box>
              </Box>
            )}
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
