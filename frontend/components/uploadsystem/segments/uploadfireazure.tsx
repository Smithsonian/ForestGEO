'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { UploadFireAzureProps } from '@/config/macros/uploadsystemmacros';
import { FileWithPath } from 'react-dropzone';
import { Box, Typography } from '@mui/material';
import { Stack } from '@mui/joy';
import { LinearProgressWithLabel } from '@/components/client/clientmacros';
import CircularProgress from '@mui/joy/CircularProgress';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';

const UploadFireAzure: React.FC<UploadFireAzureProps> = ({
  acceptedFiles,
  uploadForm,
  setIsDataUnsaved,
  user,
  setUploadError,
  setErrorComponent,
  setReviewState,
  allRowToCMID,
  cmErrors
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState('');
  const hasUploaded = useRef(false);
  const [countdown, setCountdown] = useState(5);
  const [startCountdown, setStartCountdown] = useState(false);

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const mapCMErrorsToFileRowErrors = (fileName: string) => {
    return cmErrors
      .filter(error => allRowToCMID.some(row => row.fileName === fileName && row.coreMeasurementID === error.coreMeasurementID))
      .flatMap(error => {
        const relatedRow = allRowToCMID.find(row => row.coreMeasurementID === error.coreMeasurementID);
        return error.validationErrorIDs.map(validationErrorID => ({
          stemtag: relatedRow?.row.stemtag,
          tag: relatedRow?.row.tag,
          validationErrorID: validationErrorID
        }));
      });
  };

  const uploadToStorage = useCallback(
    async (file: FileWithPath) => {
      try {
        setCurrentlyRunning(`File ${file.name} uploading to Azure Storage...`);
        const formData = new FormData();
        formData.append(file.name, file);
        if (uploadForm === 'measurements') {
          const fileRowErrors = mapCMErrorsToFileRowErrors(file.name);
          formData.append('fileRowErrors', JSON.stringify(fileRowErrors)); // Append validation errors to formData
        }
        const response = await fetch(
          `/api/filehandlers/storageload?fileName=${file.name}&plot=${currentPlot?.plotName?.trim().toLowerCase()}&census=${currentCensus?.dateRanges[0].censusID ? currentCensus?.dateRanges[0].censusID.toString().trim() : 0}&user=${user}&formType=${uploadForm}`,
          {
            method: 'POST',
            body: formData
          }
        );
        // Increment completedOperations when an operation is completed
        setCompletedOperations(prevCompleted => prevCompleted + 1);
        return response.ok ? 'Storage load successful' : 'Storage load failed';
      } catch (error) {
        setUploadError(error);
        setErrorComponent('UploadFire');
        setReviewState(ReviewStates.ERRORS);
      }
    },
    [currentCensus?.dateRanges[0].censusID, currentPlot?.plotName, setErrorComponent, setReviewState, setUploadError, user, cmErrors, allRowToCMID]
  );

  useEffect(() => {
    const calculateTotalOperations = () => {
      let totalOps = 0;

      for (const _file of acceptedFiles) {
        // Increment totalOps for each file and each operation (SQL and storage)
        totalOps += 1;
      }

      // Set the total number of operations
      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      // Calculate the total number of operations
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        console.log(`file: ${file.name}`);
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, Storage: ${storageResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      uploadFiles().catch(console.error);
      hasUploaded.current = true;
    }
  }, []);

  // Effect for handling countdown and state transition
  useEffect(() => {
    let timer: number; // Declare timer as a number

    if (startCountdown && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000) as unknown as number;
      // Use 'window.setTimeout' and type assertion to treat the return as a number
    } else if (countdown === 0) {
      setReviewState(ReviewStates.COMPLETE);
    }

    return () => clearTimeout(timer); // Clear timeout using the timer variable
  }, [startCountdown, countdown, setReviewState]);

  useEffect(() => {
    if (!loading && completedOperations === totalOperations) {
      setStartCountdown(true); // Start countdown after upload is complete
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
            {results.map(result => (
              <Typography key={result}>{result}</Typography>
            ))}
            <Typography>Azure upload complete! Finalizing changes...</Typography>
            {startCountdown && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 0.5
                }}
              >
                <CircularProgress />
                <Typography>{countdown} seconds remaining</Typography>
              </Box>
            )}
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireAzure;
