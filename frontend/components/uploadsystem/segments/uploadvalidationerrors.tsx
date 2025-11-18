'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/joy';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { ErrorOutline, CheckCircleOutline, WarningAmber } from '@mui/icons-material';
import ailogger from '@/ailogger';

interface UploadValidationErrorsProps {
  setReviewState: (state: ReviewStates) => void;
  onViewFailedMeasurements?: () => void;
}

export default function UploadValidationErrors({ setReviewState, onViewFailedMeasurements }: UploadValidationErrorsProps) {
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const [failedCount, setFailedCount] = useState<number>(0);
  const [tempCount, setTempCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.error('Missing required context for fetching validation error counts');
      return;
    }

    setIsLoading(true);
    try {
      // Get failed measurements count
      const failedResponse = await fetch(
        `/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'GET' }
      );

      if (failedResponse.ok) {
        const failedData = await failedResponse.json();
        setFailedCount(failedData.recordCount || 0);
      }

      // Get temporary measurements count
      const tempResponse = await fetch(
        `/api/admin/clear/temporarymeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'GET' }
      );

      if (tempResponse.ok) {
        const tempData = await tempResponse.json();
        setTempCount(tempData.recordCount || 0);
      }
    } catch (error: any) {
      ailogger.error('Failed to fetch validation error counts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handleProceedAnyway = () => {
    ailogger.warn(`User chose to proceed despite ${failedCount} failed measurements`);
    setReviewState(ReviewStates.UPLOAD_AZURE);
  };

  const handleViewAndFix = () => {
    ailogger.info('User chose to view and fix failed measurements');
    if (onViewFailedMeasurements) {
      onViewFailedMeasurements();
    } else {
      // Fallback: just log that callback is missing
      ailogger.warn('onViewFailedMeasurements callback not provided');
    }
  };

  const handleCancelUpload = () => {
    ailogger.info('User cancelled upload due to validation failures');
    setReviewState(ReviewStates.START);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Stack spacing={2} alignItems="center">
          <Typography level="body-lg">Loading validation results...</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: '800px', margin: '0 auto', p: 3 }}>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <WarningAmber sx={{ fontSize: 40, color: 'warning.main' }} />
          <Typography level="h2">Validation Completed with Errors</Typography>
        </Box>

        <Typography level="body-lg" sx={{ color: 'text.secondary' }}>
          The validation process has completed, but some measurements failed validation and were moved to the failed measurements table.
        </Typography>
      </Stack>

      <Divider />

      <Stack spacing={2}>
        <Card variant="outlined" color="danger">
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <ErrorOutline sx={{ fontSize: 32, color: 'danger.main' }} />
              <Box>
                <Typography level="title-lg" color="danger">
                  {failedCount} Failed Measurements
                </Typography>
                <Typography level="body-sm">These measurements did not pass validation checks and require review.</Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {tempCount > 0 && (
          <Card variant="outlined" color="warning">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <WarningAmber sx={{ fontSize: 32, color: 'warning.main' }} />
                <Box>
                  <Typography level="title-lg" color="warning">
                    {tempCount} Measurements in Temporary Storage
                  </Typography>
                  <Typography level="body-sm">These measurements are still in the temporary table and may need processing.</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>

      <Divider />

      <Stack spacing={2}>
        <Typography level="title-md">What would you like to do?</Typography>

        <Stack spacing={2}>
          <Button size="lg" variant="solid" color="primary" onClick={handleViewAndFix} startDecorator={<ErrorOutline />} disabled={!onViewFailedMeasurements}>
            View and Fix Failed Measurements
          </Button>

          <Typography level="body-sm" sx={{ pl: 2, color: 'text.secondary' }}>
            Review the failed measurements in a modal, edit them, or reingest them after fixes.
          </Typography>

          <Button size="lg" variant="outlined" color="success" onClick={handleProceedAnyway} startDecorator={<CheckCircleOutline />}>
            Proceed Without Fixing
          </Button>

          <Typography level="body-sm" sx={{ pl: 2, color: 'text.secondary' }}>
            Continue with the upload process. Failed measurements will remain in the failed measurements table and can be reviewed later.
          </Typography>

          <Button size="lg" variant="outlined" color="neutral" onClick={handleCancelUpload}>
            Cancel Upload
          </Button>

          <Typography level="body-sm" sx={{ pl: 2, color: 'text.secondary' }}>
            Return to the beginning and start a new upload process.
          </Typography>
        </Stack>
      </Stack>

      <Divider />

      <Card variant="soft" color="neutral">
        <CardContent>
          <Typography level="body-sm" startDecorator={<WarningAmber fontSize="small" />}>
            <strong>Note:</strong> Failed measurements can always be accessed later from the Measurements Summary View by clicking the "Failed Measurements"
            button in the toolbar.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
