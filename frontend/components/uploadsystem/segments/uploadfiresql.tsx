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
  const [failedRows, setFailedRows] = useState<{ [fileName: string]: Set<FileRow> }>({});
  const [failedChunks, setFailedChunks] = useState<Set<number>>(new Set());
  const [etc, setETC] = useState('');
  const [totalProcessingTime, setTotalProcessingTime] = useState(0);
  const [chunkStartTime, setChunkStartTime] = useState<number>(0);
  const [userID, setUserID] = useState<number | null>(null);
  const chunkSize = 4096 * 2;
  const connectionLimit = 10;
  const queue = new PQueue({ concurrency: connectionLimit });

  const generateErrorRowId = (row: FileRow) =>
    `row-${Object.values(row)
      .join('-')
      .replace(/[^a-zA-Z0-9-]/g, '')}`;

  const fetchWithTimeout = async (url: string | URL | Request, options: RequestInit | undefined, timeout = 60000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
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
    if (completedChunks < 3) {
      setETC('Calculating...');
      return;
    }

    // Track cumulative processing time
    setTotalProcessingTime(prev => prev + (performance.now() - chunkStartTime));

    // Calculate exponential moving average for smoother chunk time estimation
    const smoothingFactor = 0.2; // Adjust between 0 and 1 for desired smoothing (higher = more reactive)
    const lastChunkTime = performance.now() - chunkStartTime;
    const smoothedAvgTimePerChunk = smoothingFactor * lastChunkTime + (1 - smoothingFactor) * (totalProcessingTime / completedChunks);

    // Calculate remaining chunks and ETC
    const remainingChunks = totalChunks - completedChunks;
    const estimatedTimeLeft = smoothedAvgTimePerChunk * remainingChunks;

    setETC(
      moment.utc(estimatedTimeLeft).format('mm:ss').split(':')[0] +
        ' minutes and ' +
        moment.utc(estimatedTimeLeft).format('mm:ss').split(':')[1] +
        ' seconds remaining...'
    );
  }, [completedChunks, totalChunks]);

  const parseFileInChunks = async (file: File, delimiter: string) => {
    let activeTasks = 0;
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
          setChunkStartTime(performance.now());
          try {
            if (activeTasks >= connectionLimit) {
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

            activeTasks++;

            await queue.add(async () => {
              try {
                await uploadToSql(fileCollectionRowSet, file.name);
              } catch (error) {
                console.error('Chunk rollback triggered. Error uploading to SQL:', error);
                if (failedChunks.has(completedChunks)) {
                  return;
                }
                // single retry -- add this chunk back to the queue
                await queue.add(async () => {
                  try {
                    await uploadToSql({ [file.name]: fileRowSet } as FileCollectionRowSet, file.name);
                  } catch (e) {
                    console.error('catatrophic error on retry: ', e);
                    setFailedChunks(prev => new Set(prev).add(completedChunks));
                  }
                });
                //
                // try {
                //   try {
                //     parser.pause();
                //     queue.pause();
                //   } catch (e: any) {
                //     console.error('Error pausing parser or queue:', e.message);
                //   } finally {
                //     await queue.onIdle(); // Ensure all pending tasks finish before proceeding
                //   }
                //
                //   const batchErrorRows = await processFailedChunk(fileRowSet, file.name);
                //
                //   setErrorRows(prev => ({
                //     ...prev,
                //     [file.name]: {
                //       ...prev[file.name],
                //       ...batchErrorRows
                //     }
                //   }));
                //
                //   setFailedChunks(prev => new Set(prev).add(completedChunks));
                // } catch (error) {
                //   console.error('Critical error during chunk error handling:', error);
                // } finally {
                //   parser.resume();
                //   queue.start();
                // }
              } finally {
                activeTasks--;
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

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string) => {
      try {
        const response = await fetchWithTimeout(`/api/sqlpacketload`, {
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
        } catch (e) {
          console.error('no failing rows returned. unforeseen error');
          throw e;
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
    const calculateTotalOperations = () => {
      const totalOps = acceptedFiles.length;

      setTotalOperations(totalOps);
    };

    async function getUserID() {
      const userIDResponse = await fetch(`/api/catalog/${session?.user.name?.split(' ')[0]}/${session?.user.name?.split(' ')[1]}`, { method: 'GET' });
      setUserID(await userIDResponse.json());
    }

    const uploadFiles = async () => {
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        const count = await countTotalChunks(file as File);
        setTotalChunks(prev => prev + count);
      }

      for (const file of acceptedFiles) {
        const isCSV = file.name.endsWith('.csv');
        const delimiter = isCSV ? ',' : '\t';

        await parseFileInChunks(file as File, delimiter);

        // quickly add remaining rows to failed measurements counter, only if data is present
        if (failedRows[file.name].size > 0) {
          const batchID = v4();
          const rows = Object.values(failedRows[file.name] ?? []);
          const placeholders = rows.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
          const values = rows.flatMap(row => {
            const transformedRow = { ...row, date: row.date ? moment(row.date).format('YYYY-MM-DD') : row.date };
            return [file.name, batchID, currentPlot?.plotID ?? -1, currentCensus?.dateRanges[0].censusID ?? -1, ...Object.values(transformedRow)];
          });
          const insertSQL = `INSERT INTO ${schema}.ingest_failedmeasurements 
      (${file.name}, ${batchID}, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes) 
      VALUES ${placeholders}`;
          await fetch(`/api/formatrunquery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: insertSQL, params: values })
          });
          // remove submitted rows from failedrows
          setFailedRows(prev => {
            const { [file.name]: removed, ...rest } = prev;
            return rest;
          });
        }
        setCompletedOperations(prevCompleted => prevCompleted + 1);
      }

      await queue.onIdle();

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
    };

    if (!hasUploaded.current) {
      getUserID().then(() => {
        uploadFiles().then(() => {
          hasUploaded.current = true;
          // enforce timeout before continuing forward
          const timeout = setTimeout(() => {
            if (uploadForm === FormType.measurements) {
              setReviewState(ReviewStates.VALIDATE);
            } else {
              setReviewState(ReviewStates.UPLOAD_AZURE);
            }
          }, 500);

          return () => clearTimeout(timeout);
        });
      });
    }
  }, [hasUploaded.current, errorRows]);

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
