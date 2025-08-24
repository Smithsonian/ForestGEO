'use client';

import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography, Stack, CircularProgress } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { Dispatch, SetStateAction, useState } from 'react';
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
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();

  const handleReingestAll = async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0]?.censusID) {
      ailogger.error('Missing required context for reingestion');
      return;
    }

    setIsReingesting(true);
    try {
      ailogger.info('Starting bulk reingestion of all failed measurements');

      // First, run reviewfailed to update failure reasons
      await fetch('/api/runquery', {
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
              The following measurements failed to be uploaded. You can edit individual measurements in this table, or click "Reingest All" to automatically
              retry all rows.
            </Typography>
            <IsolatedFailedMeasurementsDataGrid />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Stack direction="row" spacing={2} sx={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button
              variant="solid"
              color="primary"
              loading={isReingesting}
              loadingPosition="start"
              startDecorator={isReingesting ? <CircularProgress size="sm" /> : null}
              onClick={handleReingestAll}
              disabled={isReingesting}
              sx={{ minWidth: 160 }}
            >
              {isReingesting ? 'Reingesting...' : 'Reingest All Rows'}
            </Button>
            <Button variant="soft" color="neutral" onClick={handleCloseModal} disabled={isReingesting} sx={{ minWidth: 100 }}>
              Close
            </Button>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
