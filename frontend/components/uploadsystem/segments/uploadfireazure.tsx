'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMounted } from '@/app/hooks/useismounted';
import { ReviewStates, UploadFireAzureProps } from '@/config/macros/uploadsystemmacros';
import { FileWithPath } from 'react-dropzone';
import { Box, Button, Typography, Stack, LinearProgress } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import ailogger from '@/ailogger';
import { useAnimationCacheContext } from '@/app/contexts/animationcacheprovider';

const UploadFireAzure: React.FC<UploadFireAzureProps> = ({
  acceptedFiles,
  uploadForm,
  sourceFormat,
  setIsDataUnsaved,
  setUploadError,
  setErrorComponent,
  setReviewState
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [_results, setResults] = useState<string[]>([]);
  const [totalOperations, setTotalOperations] = useState(0);
  const [completedOperations, setCompletedOperations] = useState<number>(0);
  const [currentlyRunning, setCurrentlyRunning] = useState('');
  const [refreshError, setRefreshError] = useState<string | null>(null); // For tracking refresh errors
  const [continueDisabled, setContinueDisabled] = useState<boolean>(true); // To control the Continue button

  const hasUploaded = useRef(false);
  const { isMountedRef } = useIsMounted();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { getAnimationUrl } = useAnimationCacheContext();

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
        const censusNumber = currentCensus?.plotCensusNumber;

        // Validate context before attempting upload
        if (!currentSite?.schemaName || !currentPlot?.plotName || !currentPlot?.plotID || !censusNumber || !uploadForm) {
          const errorMsg = 'Missing required context for upload (site, plot, census, or form type)';
          ailogger.error(errorMsg, new Error(errorMsg));
          throw new Error(errorMsg);
        }

        const params = new URLSearchParams({
          fileName: file.name,
          schema: currentSite.schemaName,
          plotID: currentPlot.plotID.toString(),
          plotName: currentPlot.plotName.trim(),
          census: censusNumber.toString(),
          formType: uploadForm,
          sourceFormat: sourceFormat ?? 'csv'
        });

        const response = await fetch(`/api/files/upload?${params.toString()}`, {
          method: 'POST',
          body: formData
        });
        if (isMountedRef.current) {
          setCompletedOperations(prevCompleted => prevCompleted + 1);
        }
        return response.ok ? 'Storage load successful' : 'Storage load failed';
      } catch (error) {
        ailogger.error(`Upload failed for ${file.name}:`, error instanceof Error ? error : new Error(String(error)));
        if (isMountedRef.current) {
          setUploadError(error);
          setErrorComponent('UploadFire');
          setReviewState(ReviewStates.ERRORS);
        }
      }
    },
    [
      currentCensus?.plotCensusNumber,
      currentPlot?.plotID,
      currentPlot?.plotName,
      currentSite?.schemaName,
      setErrorComponent,
      setReviewState,
      setUploadError,
      uploadForm,
      sourceFormat
    ]
  );

  useEffect(() => {
    const calculateTotalOperations = () => {
      let totalOps = acceptedFiles.length; // Count each file as 1 operation for uploading
      if (uploadForm === 'measurements') {
        totalOps += acceptedFiles.length * 2; // For measurements, add 2 more operations per file for the refresh views
      }
      if (isMountedRef.current) {
        setTotalOperations(totalOps);
      }
    };

    const uploadFiles = async () => {
      const uploadResults: string[] = [];

      // Calculate the total number of operations
      calculateTotalOperations();

      for (const file of acceptedFiles) {
        if (!isMountedRef.current) return; // Exit early if unmounted
        const storageResult = await uploadToStorage(file);
        uploadResults.push(`File: ${file.name}, Storage: ${storageResult}`);
      }

      if (isMountedRef.current) {
        setResults(uploadResults);
        setLoading(false);
        setIsDataUnsaved(false);
      }
    };

    if (!hasUploaded.current) {
      ailogger.info(`[UploadFireAzure] Starting upload, acceptedFiles count: ${acceptedFiles.length}`);
      uploadFiles()
        .catch(ailogger.error)
        .then(() => {
          hasUploaded.current = true;
          ailogger.info('[UploadFireAzure] Upload complete, transitioning to COMPLETE state');
          // Always call setReviewState — React 18+ safely ignores setState on
          // unmounted components, and guarding with isMountedRef caused a
          // StrictMode race where the transition was permanently skipped.
          setReviewState(ReviewStates.COMPLETE);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedFiles, uploadToStorage, uploadForm]);

  // Fallback: If upload completed during a previous mount (StrictMode), ensure we transition to COMPLETE
  useEffect(() => {
    if (hasUploaded.current && !loading) {
      ailogger.info('[UploadFireAzure] Fallback check: upload already completed, ensuring transition to COMPLETE');
      setReviewState(ReviewStates.COMPLETE);
    }
  }, [loading, setReviewState]);

  const progressPercent = totalOperations > 0 ? (completedOperations / totalOperations) * 100 : 0;

  return (
    <>
      {loading ? (
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            mt: 4,
            px: 3,
            position: 'relative',
            minHeight: { xs: '400px', sm: '500px', md: '600px' },
            overflow: 'hidden'
          }}
          role="status"
          aria-live="polite"
        >
          {/* Background Animation Layer - Behind Everything */}
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              bgcolor: '#000000',
              opacity: 0.3,
              zIndex: 0
            }}
          >
            <DotLottieReact
              src={getAnimationUrl('uploading.lottie')}
              loop
              autoplay
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '800px',
                maxHeight: '800px'
              }}
            />
          </Box>

          {/* Foreground Content - On Top of Animation */}
          <Stack
            direction="column"
            spacing={4}
            sx={{
              width: '100%',
              alignItems: 'center',
              position: 'relative',
              zIndex: 1
            }}
          >
            {/* Header */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography level="h3" sx={{ mb: 1 }}>
                Saving to cloud storage...
              </Typography>
              <Typography level="body-lg" color="primary" sx={{ fontWeight: 600 }}>
                {progressPercent.toFixed(0)}% Complete
              </Typography>
            </Box>

            {/* Progress Bar - Full Width */}
            <Box sx={{ width: '100%', maxWidth: '600px' }}>
              <LinearProgress
                determinate
                size="lg"
                variant="soft"
                color="primary"
                value={progressPercent}
                sx={{
                  width: '100%',
                  '--LinearProgress-thickness': '12px',
                  '--LinearProgress-radius': '8px'
                }}
                aria-label="File upload progress"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </Box>

            {/* Current file being uploaded */}
            {currentlyRunning && (
              <Typography level="body-md" color="neutral" sx={{ textAlign: 'center' }}>
                {currentlyRunning}
              </Typography>
            )}

            <Typography level="body-sm" color="neutral">
              Please do not close this window
            </Typography>
          </Stack>
        </Box>
      ) : refreshError ? (
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            mt: 4,
            px: 3
          }}
        >
          <Stack direction="column" spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography level="h4">Some errors occurred during upload</Typography>
            <Typography color="danger">{refreshError}</Typography>
            <Button
              variant="solid"
              onClick={() => {
                if (isMountedRef.current) {
                  setRefreshError(null);
                  setContinueDisabled(true);
                  setReviewState(ReviewStates.COMPLETE);
                }
              }}
              disabled={continueDisabled}
            >
              Continue Anyway
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
            justifyContent: 'center',
            mt: 4,
            px: 3
          }}
        >
          <Stack direction="column" spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Typography level="h3" color="success">
              Cloud Storage Upload Complete
            </Typography>
            <Typography level="body-md" color="neutral">
              {acceptedFiles.length} {acceptedFiles.length === 1 ? 'file' : 'files'} saved successfully
            </Typography>
            <Typography level="body-sm" color="neutral">
              Finalizing changes...
            </Typography>
          </Stack>
        </Box>
      )}
    </>
  );
};

export default UploadFireAzure;
