'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow, FileRowSet, FormType, getTableHeaders, RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import { Stack } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';
import { useSession } from 'next-auth/react';
import Papa, { parse, ParseResult } from 'papaparse';
import moment from 'moment';
import { LinearProgressWithLabel } from '@/components/client/clientmacros';

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
  const [totalRows, setTotalRows] = useState(0);
  const [currentlyParsing, setCurrentlyParsing] = useState<string>('');
  const [processedRows, setProcessedRows] = useState<number>(0);
  const [userID, setUserID] = useState<number | null>(null);

  const countTotalRows = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      let rowCount = 0;

      parse<File>(file, {
        worker: true,
        chunkSize: 1024,
        chunk: results => {
          rowCount += results.data.length;
        },
        complete: () => resolve(rowCount),
        error: err => reject(err)
      });
    });
  };

  const parseFileInChunks = async (file: File, delimiter: string) => {
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
        chunkSize: 1024 * 1024, // Process 1MB chunks
        transformHeader,
        transform,
        async chunk(results: ParseResult<FileRow>, parser) {
          try {
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
              const rowId = `row-${processedRows + index}`;
              fileRowSet[rowId] = row;
            });

            const fileCollectionRowSet: FileCollectionRowSet = {
              [file.name]: fileRowSet
            };

            await uploadToSql(fileCollectionRowSet, file.name);

            // Update processed rows
            setProcessedRows(prev => prev + results.data.length);
          } catch (err) {
            console.error('Error processing chunk:', err);
            reject(err);
          }
        },
        complete: () => {
          console.log('File parsing and upload complete');
          setCompletedOperations(prev => prev + 1);
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
        const response = await fetch(
          `/api/sqlload?schema=${schema}&formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.plotID?.toString().trim()}&census=${currentCensus?.dateRanges[0].censusID.toString().trim()}&quadrat=${currentQuadrat?.quadratID?.toString().trim()}&user=${userID}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fileData[fileName])
          }
        );
        if (!response.ok) throw new Error('SQLLOAD ERROR: ' + response.statusText);
        setCompletedOperations(prevCompleted => prevCompleted + 1);
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

      const fileUploadPromises = acceptedFiles.map(async file => {
        const isCSV = file.name.endsWith('.csv');
        const delimiter = isCSV ? ',' : '\t';

        setTotalRows(await countTotalRows(file as File));
        setCurrentlyParsing(file.name);

        await parseFileInChunks(file as File, delimiter);

        setCompletedOperations(prev => prev + 1);

        setTotalRows(0);
        setProcessedRows(0);
      });

      await Promise.all(fileUploadPromises);

      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      getUserID();
      uploadFiles()
        .catch(console.error)
        .then(() => {
          hasUploaded.current = true;
        });
    }
  }, [acceptedFiles, uploadToSql]);

  useEffect(() => {
    if (hasUploaded.current) {
      const timeout = setTimeout(() => {
        if (uploadForm === FormType.measurements) {
          setReviewState(ReviewStates.VALIDATE);
        } else {
          setReviewState(ReviewStates.UPLOAD_AZURE);
        }
      }, 500);

      return () => clearTimeout(timeout);
    }
  }, []);

  return (
    <>
      {loading ? (
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
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>

            {/* Overall Progress */}
            <Box sx={{ width: '100%', mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Overall Progress
              </Typography>
              <LinearProgressWithLabel
                variant={'determinate'}
                value={(completedOperations / totalOperations) * 100}
                currentlyrunningmsg={`Completed ${completedOperations} of ${totalOperations} files`}
              />
            </Box>

            {/* File-Specific Progress */}
            {totalRows !== 0 && (
              <Box sx={{ width: '100%', mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  File Progress
                </Typography>
                <LinearProgressWithLabel
                  variant={'determinate'}
                  value={(processedRows / totalRows) * 100}
                  currentlyrunningmsg={`Parsing ${currentlyParsing}`}
                />
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
              Upload Complete
            </Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
