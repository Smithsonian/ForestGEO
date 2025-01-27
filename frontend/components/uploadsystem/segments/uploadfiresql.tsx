'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Box, LinearProgress, Stack, Typography } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
import PQueue from 'p-queue';
import Divider from '@mui/joy/Divider';
import 'moment-duration-format';

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
  const [userID, setUserID] = useState<number | null>(null);
  const chunkSize = 4096;
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

    const startTime = performance.now();
    let totalProcessingTime = 0;

    const updateETC = () => {
      if (completedChunks === 0) return 'Calculating...';
      const avgTimePerChunk = totalProcessingTime / completedChunks; // Average time per chunk
      const remainingChunks = totalChunks - completedChunks;
      const estimatedTimeLeft = avgTimePerChunk * remainingChunks;
      return moment.duration(estimatedTimeLeft, 'milliseconds').format('HH:mm:ss');
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
          const chunkStartTime = performance.now();
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
                totalProcessingTime += performance.now() - chunkStartTime;
                const etc = updateETC();
                console.log(`Estimated Time to Completion: ${etc}`);
                setETC(etc); // Assuming `setETC` updates a state or display
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
        uploadFiles()
          .then(() => {
            // force download of error rows:
            Object.entries(errorRows).forEach(([fileName, fileRowSet]) => {
              const rows: string[] = [];

              // Collect headers from the FileRowSet
              const headers = new Set<string>();
              Object.values(fileRowSet).forEach(fileRow => {
                Object.keys(fileRow).forEach(header => headers.add(header));
              });
              rows.push(Array.from(headers).join(',')); // Convert headers to a CSV row

              // Add data rows
              Object.values(fileRowSet).forEach(fileRow => {
                const row = Array.from(headers).map(header => {
                  const value = fileRow[header];
                  return value !== null && value !== undefined ? `"${value}"` : ''; // Wrap value in quotes and handle null/undefined
                });
                rows.push(row.join(',')); // Convert row array to a CSV row
              });

              // Convert rows array to a single CSV string
              const csvContent = rows.join('\n');

              // Create and download the CSV file for the current FileRowSet
              const blob = new Blob([csvContent], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;

              // Name the file based on the original file name (with `.csv` extension)
              a.download = `${fileName.replace(/\.[^/.]+$/, '')}_errors.csv`; // Replace extension with `_errors.csv`
              a.click();
              URL.revokeObjectURL(url);
            });
          })
          .then(() => {
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
                    LOADING: {`${((completedChunks / totalChunks) * 100).toFixed(2)}%`}
                    <br />
                    {completedChunks} completed out of {totalChunks}: {totalChunks - completedChunks} remaining
                  </Typography>
                </LinearProgress>
                <Divider sx={{ my: 2 }} />
                {failedChunks.size > 0 &&
                  Array.from(failedChunks).map(chunk => (
                    <Box key={chunk} sx={{ width: '100%', mb: 2 }}>
                      <Typography level={'body-md'} color={'success'}>
                        Completed retry for chunk {chunk + 1}/{totalChunks}
                      </Typography>
                      <LinearProgress
                        determinate
                        variant="plain"
                        color="success"
                        thickness={48}
                        value={100}
                        sx={{
                          '--LinearProgress-radius': '0px',
                          '--LinearProgress-progressThickness': '36px'
                        }}
                      >
                        <Typography level="body-xs" sx={{ fontWeight: 'xl', mixBlendMode: 'difference' }}>
                          Failed Chunk: {chunk}
                        </Typography>
                      </LinearProgress>
                    </Box>
                  ))}
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
