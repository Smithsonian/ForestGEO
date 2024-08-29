'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { ReviewStates, UploadFireProps } from '@/config/macros/uploadsystemmacros';
import { FileCollectionRowSet, FileRow } from '@/config/macros/formdetails';
import { Stack } from '@mui/joy';
import { DetailedCMIDRow } from '@/components/uploadsystem/uploadparent';
import { LinearProgressWithLabel } from '@/components/client/clientmacros';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext, useQuadratContext } from '@/app/contexts/userselectionprovider';

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
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState<string>('');
  const hasUploaded = useRef(false);
  const [countdown, setCountdown] = useState(5);
  const [startCountdown, setStartCountdown] = useState(false);

  const uploadToSql = useCallback(
    async (fileData: FileCollectionRowSet, fileName: string) => {
      try {
        setCurrentlyRunning(`Uploading file "${fileName}" to SQL...`);
        const response = await fetch(
          `/api/sqlload?schema=${schema}&formType=${uploadForm}&fileName=${fileName}&plot=${currentPlot?.plotID?.toString().trim()}&census=${currentCensus?.dateRanges[0].censusID.toString().trim()}&quadrat=${currentQuadrat?.quadratID?.toString().trim()}&user=${personnelRecording}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fileData[fileName])
          }
        );
        if (!response.ok) throw new Error('SQLLOAD ERROR: ' + response.statusText);

        setCompletedOperations(prevCompleted => prevCompleted + 1);

        const result = await response.json();

        if (result.idToRows) {
          setCurrentlyRunning(`Fetching CMID details for file "${fileName}"...`);
          if (uploadForm === 'measurements') {
            Promise.all(
              result.idToRows.map(({ coreMeasurementID }: IDToRow) =>
                fetch(`/api/details/cmid?schema=${schema}&cmid=${coreMeasurementID}`).then(response => response.json())
              )
            )
              .then(details => {
                const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({ coreMeasurementID, fileRow }: IDToRow, index: number) => {
                  const detailArray = details[index];
                  if (Array.isArray(detailArray) && detailArray.length > 0) {
                    const detail = detailArray[0];
                    if ('plotName' in detail && 'quadratName' in detail && 'plotCensusNumber' in detail && 'speciesName' in detail) {
                      return {
                        coreMeasurementID,
                        fileName,
                        row: fileRow,
                        plotName: detail.plotName,
                        quadratName: detail.quadratName,
                        plotCensusNumber: detail.plotCensusNumber,
                        speciesName: detail.speciesName
                      };
                    } else {
                      throw new Error('Detail object missing required properties');
                    }
                  } else {
                    throw new Error('Invalid detail array structure');
                  }
                });
                setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
              })
              .catch(error => {
                console.error('Error fetching CMID details:', error);
                setUploadError(error);
                setReviewState(ReviewStates.ERRORS);
              });
          } else {
            const newRowToCMID: DetailedCMIDRow[] = result.idToRows.map(({ coreMeasurementID, fileRow }: IDToRow) => ({
              coreMeasurementID,
              fileName,
              row: fileRow
            }));
            setAllRowToCMID(prevState => [...prevState, ...newRowToCMID]);
          }
        }

        // Additional API calls for measurements
        if (uploadForm === 'measurements') {
          setCurrentlyRunning(`Refreshing measurement summary view for "${fileName}"...`);
          const refreshSummaryResponse = await fetch(`/api/refreshviews/measurementssummary/${schema}`, { method: 'POST' });
          if (!refreshSummaryResponse.ok) throw new Error('REFRESH ERROR: ' + refreshSummaryResponse.statusText);

          setCompletedOperations(prevCompleted => prevCompleted + 1);

          setCurrentlyRunning(`Refreshing full table view for "${fileName}"...`);
          const refreshViewResponse = await fetch(`/api/refreshviews/viewfulltable/${schema}`, { method: 'POST' });
          if (!refreshViewResponse.ok) throw new Error('REFRESH ERROR: ' + refreshViewResponse.statusText);

          setCompletedOperations(prevCompleted => prevCompleted + 1);
        }

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
      let totalOps = acceptedFiles.length;

      // Include additional steps if form type is measurements
      if (uploadForm === 'measurements') {
        totalOps += 2; // Two additional operations for refreshing views
      }

      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      calculateTotalOperations();

      for (const file of acceptedFiles) {
        const sqlResult = await uploadToSql(parsedData, file.name);
        uploadResults.push(`File: ${file.name}, SQL: ${sqlResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      uploadFiles().catch(console.error);
      hasUploaded.current = true;
    }
  }, [parsedData, uploadToSql]);

  useEffect(() => {
    let timer: number;

    if (startCountdown && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
    } else if (countdown === 0) {
      if (uploadForm === 'measurements') setReviewState(ReviewStates.VALIDATE);
      else setReviewState(ReviewStates.UPLOAD_AZURE);
    }

    return () => clearTimeout(timer);
  }, [startCountdown, countdown, uploadForm, setReviewState]);

  useEffect(() => {
    if (!loading && completedOperations === totalOperations) {
      setStartCountdown(true);
    }
  }, [loading, completedOperations, totalOperations]);

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
          <Stack direction={'column'}>
            <Typography variant="h6" gutterBottom>{`Total Operations: ${totalOperations}`}</Typography>
            <LinearProgressWithLabel variant={'determinate'} value={(completedOperations / totalOperations) * 100} currentlyrunningmsg={currentlyRunning} />
            <Typography variant="body2" sx={{ mt: 2 }}>{`Completed: ${completedOperations} of ${totalOperations} operations`}</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {currentlyRunning}
            </Typography>
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
            {startCountdown && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column'
                }}
              >
                <CircularProgress />
                <Typography>{countdown} seconds remaining</Typography>
                <Typography>{uploadCompleteMessage}</Typography>
              </Box>
            )}
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireSQL;
