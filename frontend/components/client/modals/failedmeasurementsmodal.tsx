'use client';

import { Button, CircularProgress, DialogActions, DialogContent, DialogTitle, Divider, Modal, ModalDialog, Sheet, Stack, Typography } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import ailogger from '@/ailogger';

interface FailedMeasurementsModalProps {
  open: boolean;
  setReingested: Dispatch<SetStateAction<boolean>>;
  handleCloseModal: () => Promise<void>;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, setReingested, handleCloseModal } = props;
  const [isReingesting, setIsReingesting] = useState(false);
  const [isClearingFailed, setIsClearingFailed] = useState(false);
  const [isClearingTemp, setIsClearingTemp] = useState(false);
  const [confirmClearFailed, setConfirmClearFailed] = useState(false);
  const [confirmClearTemp, setConfirmClearTemp] = useState(false);
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [tempCount, setTempCount] = useState<number | null>(null);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();

  const fetchRecordCounts = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      return;
    }

    try {
      // Get failed measurements count
      const failedResponse = await fetch(
        `/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'GET' }
      );
      if (failedResponse.ok) {
        const failedData = await failedResponse.json();
        setFailedCount(failedData.recordCount);
      }

      // Get temporary measurements count
      const tempResponse = await fetch(
        `/api/admin/clear/temporarymeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'GET' }
      );
      if (tempResponse.ok) {
        const tempData = await tempResponse.json();
        setTempCount(tempData.recordCount);
      }
    } catch (error: any) {
      ailogger.error('Failed to fetch record counts:', error);
    }
  };

  const handleClearFailedMeasurements = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.error('Missing required context for clearing failed measurements');
      return;
    }

    setIsClearingFailed(true);
    try {
      const response = await fetch(
        `/api/admin/clear/failedmeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error(`Failed to clear failed measurements: ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Failed measurements cleared:', result);

      setReingested(true);
      setConfirmClearFailed(false);

      // Refresh counts
      await fetchRecordCounts();

      // Close modal if no records remaining
      if (result.recordsCleared > 0) {
        await handleCloseModal();
      }
    } catch (error: any) {
      ailogger.error('Failed to clear failed measurements:', error);
    } finally {
      setIsClearingFailed(false);
    }
  };

  const handleClearTempMeasurements = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.error('Missing required context for clearing temporary measurements');
      return;
    }

    setIsClearingTemp(true);
    try {
      const response = await fetch(
        `/api/admin/clear/temporarymeasurements/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        {
          method: 'DELETE'
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to clear temporary measurements: ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Temporary measurements cleared:', result);

      setConfirmClearTemp(false);

      // Refresh counts
      await fetchRecordCounts();
    } catch (error: any) {
      ailogger.error('Failed to clear temporary measurements:', error);
    } finally {
      setIsClearingTemp(false);
    }
  };

  const handleReingestAll = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.error('Missing required context for reingestion');
      return;
    }

    setIsReingesting(true);
    try {
      ailogger.info('Starting bulk reingestion of all failed measurements');

      // First, run reviewfailed to update failure reasons
      await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(`CALL ${currentSite.schemaName}.reviewfailed();`)
      });

      // Then attempt reingestion of all rows
      const response = await fetch(`/api/reingest/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Reingestion failed with status ${response.status}`);
      }

      const result = await response.json();
      ailogger.info('Bulk reingestion completed:', result);

      // Show results to user
      const { totalProcessed, successfulReingestions, remainingFailures } = result;
      if (remainingFailures === 0) {
        ailogger.info(`All ${successfulReingestions} rows successfully reingested!`);
      } else {
        ailogger.info(`Reingestion completed: ${successfulReingestions}/${totalProcessed} successful, ${remainingFailures} still failing`);
      }

      setReingested(true);

      // Only close modal if all rows were successful, otherwise let user see remaining failures
      if (remainingFailures === 0) {
        await handleCloseModal();
      }
    } catch (error: any) {
      ailogger.error('Failed to reingest measurements:', error);
      // Don't close modal on error so user can see what happened
    } finally {
      setIsReingesting(false);
    }
  };

  // Fetch record counts when modal opens
  useEffect(() => {
    if (open) {
      fetchRecordCounts();
    }
  }, [open, currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges[0]?.censusID]);

  return (
    <Modal open={open} onClose={() => {}}>
      <ModalDialog
        size="lg"
        sx={{
          width: '95%',
          maxWidth: '1400px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        role="alertdialog"
      >
        <DialogTitle sx={{ pb: 1 }}>Failed Measurements</DialogTitle>
        <DialogContent sx={{ flex: 1, overflow: 'hidden', p: 0 }}>
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Typography level="body-sm" sx={{ px: 3, py: 1 }}>
              The following measurements failed to be uploaded. You can edit individual measurements in this table, reingest all rows, or clear failed records
              entirely.
            </Typography>
            <IsolatedFailedMeasurementsDataGrid />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Stack spacing={2} sx={{ width: '100%' }}>
            {/* Confirmation dialogs */}
            {confirmClearFailed && (
              <Sheet variant="soft" color="danger" sx={{ p: 2, borderRadius: 'sm' }}>
                <Stack spacing={1}>
                  <Typography level="title-sm" color="danger">
                    Confirm Clear Failed Measurements
                  </Typography>
                  <Typography level="body-sm">
                    This will permanently delete {failedCount || 0} failed measurement records. This action cannot be undone.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="soft" onClick={() => setConfirmClearFailed(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="solid" color="danger" loading={isClearingFailed} onClick={handleClearFailedMeasurements}>
                      {isClearingFailed ? 'Clearing...' : 'Confirm Delete'}
                    </Button>
                  </Stack>
                </Stack>
              </Sheet>
            )}

            {confirmClearTemp && (
              <Sheet variant="soft" color="warning" sx={{ p: 2, borderRadius: 'sm' }}>
                <Stack spacing={1}>
                  <Typography level="title-sm" color="warning">
                    Confirm Clear Temporary Measurements
                  </Typography>
                  <Typography level="body-sm">
                    This will delete {tempCount || 0} temporary measurement records. These are typically cleared automatically after processing.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="soft" onClick={() => setConfirmClearTemp(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="solid" color="warning" loading={isClearingTemp} onClick={handleClearTempMeasurements}>
                      {isClearingTemp ? 'Clearing...' : 'Confirm Clear'}
                    </Button>
                  </Stack>
                </Stack>
              </Sheet>
            )}

            <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Reset Controls */}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="soft"
                  color="danger"
                  size="sm"
                  disabled={isReingesting || isClearingFailed || isClearingTemp || failedCount === 0}
                  onClick={() => {
                    fetchRecordCounts().then(() => setConfirmClearFailed(true));
                  }}
                >
                  Clear Failed ({failedCount ?? '?'})
                </Button>
                <Button
                  variant="soft"
                  color="warning"
                  size="sm"
                  disabled={isReingesting || isClearingFailed || isClearingTemp || tempCount === 0}
                  onClick={() => {
                    fetchRecordCounts().then(() => setConfirmClearTemp(true));
                  }}
                >
                  Clear Temp ({tempCount ?? '?'})
                </Button>
              </Stack>

              <Divider orientation="vertical" />

              {/* Main Actions */}
              <Stack direction="row" spacing={2}>
                <Button
                  variant="solid"
                  color="primary"
                  loading={isReingesting}
                  loadingPosition="start"
                  startDecorator={isReingesting ? <CircularProgress size="sm" /> : null}
                  onClick={handleReingestAll}
                  disabled={isReingesting || isClearingFailed || isClearingTemp}
                  sx={{ minWidth: 160 }}
                >
                  {isReingesting ? 'Reingesting...' : 'Reingest All Rows'}
                </Button>
                <Button
                  variant="soft"
                  color="neutral"
                  onClick={handleCloseModal}
                  disabled={isReingesting || isClearingFailed || isClearingTemp}
                  sx={{ minWidth: 100 }}
                >
                  Close
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
