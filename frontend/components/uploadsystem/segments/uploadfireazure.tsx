'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReviewStates, UploadFireAzureProps } from '@/config/macros/uploadsystemmacros';
import { FileWithPath } from 'react-dropzone';
import { Box, Button, Typography, Stack } from '@mui/joy';
import { LinearProgressWithLabel } from '@/components/client/clientmacros';
import { useOrgCensusContext, usePlotContext } from '@/app/contexts/userselectionprovider';
import ailogger from '@/ailogger';

const UploadFireAzure: React.FC<UploadFireAzureProps> = ({
  acceptedFiles,
  uploadForm,
  setIsDataUnsaved,
  user,
  setUploadError,
  setErrorComponent,
  setReviewState
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState('');
  const [refreshError, setRefreshError] = useState<string | null>(null); // For tracking refresh errors
  const [continueDisabled, setContinueDisabled] = useState<boolean>(true); // To control the Continue button

  const hasUploaded = useRef(false);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const uploadToStorage = useCallback(
    async (file: FileWithPath) => {
      try {
        setCurrentlyRunning(`File ${file.name} uploading to Azure Storage...`);
        const formData = new FormData();
        formData.append(file.name, file);
        if (uploadForm === 'measurements') {
          // this is causing massive slowdown. removing for now
          // const fileRowErrors = mapCMErrorsToFileRowErrors(file.name);
          // formData.append('fileRowErrors', JSON.stringify(fileRowErrors)); // Append validation errors to formData
        }
        const censusID = currentCensus?.dateRanges?.[0]?.censusID;
        const response = await fetch(
          `/api/files/upload?fileName=${file.name}&plot=${currentPlot?.plotName?.trim().toLowerCase()}&census=${censusID ? censusID.toString().trim() : 0}&user=${user}&formType=${uploadForm}`,
          {
            method: 'POST',
            body: formData
          }
        );
        setCompletedOperations(prevCompleted => prevCompleted + 1);
        return response.ok ? 'Storage load successful' : 'Storage load failed';
      } catch (error) {
        setUploadError(error);
        setErrorComponent('UploadFire');
        setReviewState(ReviewStates.ERRORS);
      }
    },
    [currentCensus?.dateRanges, currentPlot?.plotName, setErrorComponent, setReviewState, setUploadError, uploadForm, user]
  );

  useEffect(() => {
    const calculateTotalOperations = () => {
      let totalOps = acceptedFiles.length; // Count each file as 1 operation for uploading
      if (uploadForm === 'measurements') {
        totalOps += acceptedFiles.length * 2; // For measurements, add 2 more operations per file for the refresh views
      }
      setTotalOperations(totalOps);
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      // Calculate the total number of operations
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, Storage: ${storageResult}`);
      }

      setResults(uploadResults);
      setLoading(false);
      setIsDataUnsaved(false);
    };

    if (!hasUploaded.current) {
      uploadFiles()
        .catch(ailogger.error)
        .then(() => {
          hasUploaded.current = true;
          setReviewState(ReviewStates.COMPLETE);
        });
    }
  }, [acceptedFiles, uploadToStorage, uploadForm, setIsDataUnsaved, setReviewState]);

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
          role="status"
          aria-live="polite"
        >
          <Stack direction={'column'} sx={{ width: '100%' }}>
            <Typography level="title-lg" id="upload-operations-label">
              {`Total Operations: ${totalOperations}`}
            </Typography>
            <LinearProgressWithLabel
              variant={'determinate'}
              value={(completedOperations / totalOperations) * 100}
              currentlyrunningmsg={currentlyRunning}
              aria-label="File upload progress"
              aria-describedby="upload-operations-label"
            />
          </Stack>
        </Box>
      ) : refreshError ? (
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
            <Typography level="h4">Some errors occurred during refresh:</Typography>
            <Typography color="danger">{refreshError}</Typography>
            <Button
              variant="solid"
              onClick={() => {
                setRefreshError(null); // Clear the error
                setContinueDisabled(true); // Enable the continuation
                setReviewState(ReviewStates.COMPLETE); // Finalize the process
              }}
              disabled={continueDisabled}
            >
              Continue
            </Button>
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
            <Typography level="h4">Upload Complete</Typography>
            {results.map(result => (
              <Typography key={result}>{result}</Typography>
            ))}
            <Typography>Azure upload complete! Finalizing changes...</Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireAzure;
