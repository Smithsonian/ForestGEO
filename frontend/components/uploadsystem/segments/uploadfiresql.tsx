'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Box, LinearProgress, Stack, Typography, useTheme } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
import PQueue from 'p-queue';
import Divider from '@mui/joy/Divider';
import 'moment-duration-format';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { v4 } from 'uuid';
import { useUploadProgress } from '@/app/contexts/uploadprogressprovider';

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
  const hasUploaded = useRef(false);
  const { data: session } = useSession();
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState<number>(0);
  const [failedChunks, setFailedChunks] = useState<Set<number>>(new Set());
  const [etc, setETC] = useState('');
  const [uploadStartTime, setUploadStartTime] = useState<number | null>(null);
  const [userID, setUserID] = useState<number | null>(null);
  const [uploadingChunks, setUploadingChunks] = useState<'idle' | 'uploading' | 'completed'>('idle');
  const [uploadingBatches, setUploadingBatches] = useState<'idle' | 'uploading' | 'completed'>('idle');
  const [activeTasks, setActiveTasks] = useState(0);
  const chunkSize = 40960;
  const connectionLimit = 10;
  const queue = new PQueue({ concurrency: connectionLimit });
  const { fileID, progress, isRunning, startPolling } = useUploadProgress();

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
    // If not enough chunks completed or upload hasn't started, show a placeholder
    if (completedChunks === 0 || !uploadStartTime) {
      setETC('Calculating...');
      return;
    }

    const elapsedTime = performance.now() - uploadStartTime;
    const averageChunkTime = elapsedTime / completedChunks;
    const remainingChunks = totalChunks - completedChunks;
    const estimatedTimeLeft = averageChunkTime * remainingChunks;

    const duration = moment.duration(estimatedTimeLeft);
    const minutes = duration.minutes();
    const seconds = duration.seconds();

    setETC(`${minutes} minutes and ${seconds} seconds remaining...`);
  }, [completedChunks, totalChunks, uploadStartTime]);

  useEffect(() => {
    if (progress === 0 || !fileID || !isRunning || !uploadStartTime) {
      setETC('Calculating...');
      return;
    }

    const elapsedProcessingTime = performance.now() - uploadStartTime;
    const avgProcessingTime = elapsedProcessingTime / progress;
    const estimatedProcessingTimeLeft = avgProcessingTime * (100 - progress);

    const processingDuration = moment.duration(estimatedProcessingTimeLeft);
    const processingMinutes = processingDuration.minutes();
    const processingSeconds = processingDuration.seconds();

    setETC(`${processingMinutes} minutes and ${processingSeconds} seconds remaining...`);
  }, [progress, uploadStartTime, isRunning, fileID]);

  const parseFileInChunks = async (file: File, delimiter: string) => {
    queue.clear();
    const expectedHeaders = getTableHeaders(uploadForm!, currentPlot?.usesSubquadrats ?? false);
    const requiredHeaders = RequiredTableHeadersByFormType[uploadForm!];
    const parsingInvalidRows: FileRow[] = [];

    if (!expectedHeaders || !requiredHeaders) {
      console.error(`No headers defined for form type: ${uploadForm}`);
      setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
      return;
    }

    const transformHeader = (header: string) => header.trim();
    const validateRow = (row: FileRow): boolean => {
      const missingFields = requiredHeaders.filter(header => {
        const value = row[header.label];
        return value === null || value === '' || value === 'NA' || value === 'NULL';
      });

      if (missingFields.length > 0) {
        parsingInvalidRows.push({
          ...row,
          failureReason: `Missing required fields: ${missingFields.map(f => f.label).join(', ')}`
        });
        return false;
      }
      return true;
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
            console.error(
              `Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD, MM-DD-YYYY, DD-MM-YYYY, and their variations with '/' or '-'.`
            );
            return value;
          }
        } else {
          console.error(
            `Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD, MM-DD-YYYY, DD-MM-YYYY, and their variations with '/' or '-'.`
          );
          return value;
        }
      }
      return value;
    };

    await new Promise<void>((resolve, reject) => {
      Papa.parse<FileRow>(file, {
        delimiter: delimiter,
        header: true,
        skipEmptyLines: true,
        chunkSize: chunkSize,
        transformHeader,
        transform,
        async chunk(results: ParseResult<FileRow>, parser) {
          try {
            if (activeTasks >= connectionLimit) {
              console.log('pausing upload. active tasks > connection limit');
              parser.pause();
              queue.pause();
            }

            const validRows: FileRow[] = [];
            results.data.forEach(row => {
              if (validateRow(row)) {
                validRows.push(row);
              }
            });

            if (validRows.length === 0) {
              parser.resume();
              return;
            }

            const fileRowSet: FileRowSet = {};
            validRows.forEach((row, index) => {
              const rowId = `row-${completedChunks + index}`;
              fileRowSet[rowId] = row;
            });

            const fileCollectionRowSet: FileCollectionRowSet = {
              [file.name]: fileRowSet
            };

            setActiveTasks(prev => prev + 1);

            await queue.add(async () => {
              try {
                await uploadToSql(fileCollectionRowSet, file.name);
              } catch (error) {
                console.error('Chunk rollback triggered. Error uploading to SQL:', error);
                if (failedChunks.has(completedChunks)) {
                  return;
                }

                try {
                  try {
                    parser.pause();
                    queue.pause();
                  } catch (e: any) {
                    console.error('Error pausing parser or queue:', e.message);
                  } finally {
                    await queue.onIdle(); // Ensure all pending tasks finish before proceeding
                  }

                  const batchErrorRows = await processFailedChunk(fileRowSet, file.name);

                  setErrorRows(prev => ({
                    ...prev,
                    [file.name]: {
                      ...prev[file.name],
                      ...batchErrorRows
                    }
                  }));

                  setFailedChunks(prev => new Set(prev).add(completedChunks));
                } catch (error) {
                  console.error('Critical error during chunk error handling:', error);
                } finally {
                  parser.resume();
                  queue.start();
                }
              } finally {
                setActiveTasks(prev => prev - 1);
                setCompletedChunks(prev => {
                  if (!failedChunks.has(prev)) {
                    return prev + 1;
                  }
                  return prev;
                });
                if (activeTasks < connectionLimit) {
                  parser.resume();
                  queue.start();
                }
              }
            });
          } catch (err) {
            console.error('Error processing chunk:', err);
            reject(err);
          }
        },
        complete: async () => {
          await queue.onIdle();
          console.log('File parsing and upload complete');
          if (parsingInvalidRows.length > 0) {
            console.warn('Some rows were invalid and not uploaded:', parsingInvalidRows);
            setErrorRows(prevErrorRows => {
              const updatedErrorRows = { ...prevErrorRows };
              if (!updatedErrorRows[file.name]) {
                updatedErrorRows[file.name] = {};
              }

              parsingInvalidRows.forEach(row => {
                updatedErrorRows[file.name][generateErrorRowId(row)] = row;
              });

              return updatedErrorRows;
            });
          }
          resolve();
        },
        error: err => {
          console.error('Error parsing file:', err);
          reject(err);
        }
      });
    });
  };

  const processFailedChunk = async (fileRowSet: FileRowSet, fileName: string) => {
    const batchErrorRows: FileRowSet = {};
    for (const [rowId, row] of Object.entries(fileRowSet)) {
      if (errorRows[fileName]?.[rowId]) {
        continue;
      }
      const singleRowSet: FileCollectionRowSet = {
        [fileName]: { [rowId]: row }
      };
      try {
        await uploadToSql(singleRowSet, fileName);
      } catch (rowError) {
        console.error(`Row ${rowId} failed during retry:`, rowError);
        batchErrorRows[rowId] = row;
      }
    }
    return batchErrorRows;
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
      } catch (error) {
        console.error('Network or API error:', error);
        throw error; // Re-throw to ensure retries or error reporting is triggered
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
    if (hasUploaded.current) return;
    const calculateTotalOperations = () => {
      const totalOps = acceptedFiles.length;

      setTotalOperations(totalOps * 2); // two ops per file
    };

    async function getUserID() {
      const userIDResponse = await fetch(`/api/catalog/${session?.user.name?.split(' ')[0]}/${session?.user.name?.split(' ')[1]}`, { method: 'GET' });
      setUserID(await userIDResponse.json());
    }

    const uploadFiles = async () => {
      if (!uploadStartTime) {
        setUploadStartTime(performance.now());
      }
      setUploadingChunks('uploading');
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        const count = await countTotalChunks(file as File);
        setTotalChunks(prev => prev + count);
      }

      for (const file of acceptedFiles) {
        const isCSV = file.name.endsWith('.csv');
        const delimiter = isCSV ? ',' : '\t';

        await parseFileInChunks(file as File, delimiter);
        setCompletedOperations(prevCompleted => prevCompleted + 1);
      }

      await queue.onIdle();
      setUploadingChunks('completed');
    };

    const processBatches = async () => {
      setUploadingBatches('uploading');
      setUploadStartTime(performance.now());
      for (const file of acceptedFiles) {
        const response = await fetch(`/api/runquery`, { method: 'POST', body: JSON.stringify(`SELECT COUNT(*) AS TempCount FROM ${schema}.ingest_temporarymeasurements`)});
        const data = await response.json();
        if (data[0].TempCount === 0) console.log('NO DATA IN TEMP TABLE/UPLOAD FAILED');
        console.log(`processBatches started for file: ${file}`);
        await fetch(`/api/backgroundupload?schema=${schema}`, { method: 'GET'});
        startPolling(file.name, schema);
        console.log('polling start function triggered.');
        while (progress < 100) {
          console.log(`Polling Status: isRunning=${isRunning}, progress=${progress}`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      const combinedQuery = `
        UPDATE ${schema}.census c
          JOIN (SELECT c1.PlotCensusNumber,
                       MIN(cm.MeasurementDate) AS FirstMeasurementDate,
                       MAX(cm.MeasurementDate) AS LastMeasurementDate
                FROM ${schema}.coremeasurements cm
                       JOIN ${schema}.census c1 ON cm.CensusID = c1.CensusID
                WHERE c1.PlotCensusNumber = ${currentCensus?.plotCensusNumber}
                GROUP BY c1.PlotCensusNumber) m ON c.PlotCensusNumber = m.PlotCensusNumber
        SET c.StartDate = m.FirstMeasurementDate,
            c.EndDate   = m.LastMeasurementDate
        WHERE c.PlotCensusNumber = ${currentCensus?.plotCensusNumber};`;
      await fetch(`/api/runquery`, { method: 'POST', body: JSON.stringify(combinedQuery) }); // updating census dates after upload

      setIsDataUnsaved(false);
      setCompletedOperations(prevCompleted => prevCompleted + 1);
      setUploadingBatches('completed');
    };

    let timeout: NodeJS.Timeout;
    let isMounted = true; // prevent state updates if component unmounts

    const runUpload = async () => {
      try {
        await getUserID();
        await uploadFiles();
        await processBatches();
        if (isMounted) {
          hasUploaded.current = true;
          timeout = setTimeout(() => {
            setReviewState(uploadForm === FormType.measurements ? ReviewStates.VALIDATE : ReviewStates.UPLOAD_AZURE);
          }, 500);
        }
      } catch (error) {
        console.error('Upload error:', error);
      }
    };

    if (!hasUploaded.current) {
      runUpload().catch(console.error);
    }

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [acceptedFiles]);

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

            {uploadingChunks === 'uploading' && (
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
                  <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                    LOADING: {`${((completedChunks / totalChunks) * 100).toFixed(2)}%`} {' | '} {completedChunks} completed out of {totalChunks} {' | '}
                    {totalChunks - completedChunks} remaining
                    <br />
                    Estimated time to completion: {etc}
                  </Typography>
                </LinearProgress>
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
                  <DotLottieReact
                    src="https://lottie.host/61a4d60d-51b8-4603-8c31-3a0187b2ddc6/BYrv3qTBtA.lottie"
                    loop
                    autoplay
                    themeId={palette.mode === 'dark' ? 'Dark' : undefined}
                    style={{
                      width: '25%',
                      height: '25%'
                    }}
                  />
                </Box>
              </Box>
            )}
            {uploadingChunks === 'completed' && uploadingBatches === 'uploading' && isRunning && progress < 100 && (
              <Box sx={{ width: '100%', mb: 2 }}>
                <Typography level={'title-md'} gutterBottom>
                  Processing Uploaded Batches...
                </Typography>
                <LinearProgress
                  determinate
                  variant="plain"
                  color="primary"
                  thickness={48}
                  value={progress}
                  sx={{
                    '--LinearProgress-radius': '0px',
                    '--LinearProgress-progressThickness': '36px'
                  }}
                >
                  <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                    LOADING: {progress}%
                    <br />
                    Estimated time to completion: {etc}
                  </Typography>
                </LinearProgress>
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
                  <DotLottieReact
                    src="https://lottie.host/a63eade6-f7ba-4e21-8575-2b9597dfe741/6F8LYdqlaK.lottie"
                    loop
                    autoplay
                    style={{
                      width: '25%',
                      height: '25%'
                    }}
                  />
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
