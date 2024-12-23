'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { LinearProgress, Stack } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
import PQueue from 'p-queue';

interface IDToRow {
  coreMeasurementID: number;
  fileRow: FileRow;
}

const UploadFireSQL: React.FC<UploadFireProps> = ({
  personnelRecording,
  acceptedFiles,
  parsedData,
  uploadForm,
  setIsDataUnsaved,
  schema,
  uploadCompleteMessage,
  setUploadCompleteMessage,
  setUploadError,
  setReviewState,
  setAllRowToCMID
}) => {
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentQuadrat = useQuadratContext();
  const [loading, setLoading] = useState<boolean>(true);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState<string>('');
  const hasUploaded = useRef(false);
  const { data: session } = useSession();
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentlyParsing, setCurrentlyParsing] = useState<string>('');
  const [completedChunks, setCompletedChunks] = useState<number>(0);
  const [userID, setUserID] = useState<number | null>(null);
  const chunkSize = 2048;

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
    const connectionLimit = 100;
    const queue = new PQueue({ concurrency: connectionLimit });
    const expectedHeaders = getTableHeaders(uploadForm!, currentPlot?.usesSubquadrats ?? false);
    const requiredHeaders = RequiredTableHeadersByFormType[uploadForm!];

    if (!expectedHeaders || !requiredHeaders) {
      console.error(`No headers defined for form type: ${uploadForm}`);
      setReviewState(ReviewStates.FILE_MISMATCH_ERROR);
      return;
    }

    const transformHeader = (header: string) => header.trim();
    const transform = (value: string, field: string) => {
      if (uploadForm === FormType.measurements && field === 'date') {
        const match = value.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})|(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);

        if (match) {
          let normalizedDate;
          if (match[1]) {
            normalizedDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else {
            normalizedDate = `${match[6]}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
          }

          const parsedDate = moment(normalizedDate, 'YYYY-MM-DD', true);
          if (parsedDate.isValid()) {
            return parsedDate.toDate();
          } else {
            console.error(`Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD and DD-MM-YYYY.`);
            return value;
          }
        } else {
          console.error(`Invalid date format for value: ${value}. Accepted formats are YYYY-MM-DD and DD-MM-YYYY.`);
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
            if (activeTasks >= 5) parser.pause();
            // parser.pause();
            const fileRowSet: FileRowSet = {};
            const transformedChunk = results.data.map((row, index) => {
              const updatedRow: FileRow = { ...row };

              expectedHeaders.forEach(header => {
                const headerLabel = header.label;
                if (!(headerLabel in row)) {
                  updatedRow[header.label] = null;
                }
              });

              return updatedRow;
            });

            transformedChunk.forEach((row, index) => {
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
                console.error('Error uploading to SQL:', error);
                throw error;
              } finally {
                activeTasks--;
                setCompletedChunks(prev => prev + 1);
                if (activeTasks < connectionLimit / 10) {
                  parser.resume();
                }
              }
            });
            // parser.resume();
          } catch (err) {
            console.error('Error processing chunk:', err);
            reject(err);
          }
        },
        complete: async () => {
          await queue.onIdle();
          console.log('File parsing and upload complete');
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
        setCurrentlyRunning(`Uploading file "${fileName}" to SQL...`);
        const response = await fetch(`/api/sqlpacketload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schema: schema,
            formType: uploadForm,
            fileName: fileName,
            plot: currentPlot,
            census: currentCensus,
            user: userID,
            fileRowSet: fileData[fileName]
          })
        });
        if (!response.ok) throw new Error('SQLLOAD ERROR: ' + response.statusText);
        return response.ok ? 'SQL load successful' : 'SQL load failed';
      } catch (error) {
        setUploadError(error);
        setReviewState(ReviewStates.ERRORS);
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
        setCurrentlyParsing(file.name);

        await parseFileInChunks(file as File, delimiter);

        setCompletedOperations(prevCompleted => prevCompleted + 1);
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

      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      getUserID().then(() => {
        uploadFiles()
          .catch(console.error)
          .then(() => {
            hasUploaded.current = true;
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
  }, []);

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
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}, Total Chunks: ${totalChunks}`}</Typography>

            <Box sx={{ width: '100%', mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Total File Progress - Completed: {completedOperations}
              </Typography>
              <LinearProgress determinate value={(completedOperations / totalOperations) * 100} />
            </Box>

            {totalChunks !== 0 && (
              <Box sx={{ width: '100%', mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Total Parsing Progress - Completed: {completedChunks}
                </Typography>
                <LinearProgress determinate value={(completedChunks / totalChunks) * 100} />
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
            <Typography variant="h5" gutterBottom>
              SQL Upload Complete
            </Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
