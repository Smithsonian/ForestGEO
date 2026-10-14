'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { Alert, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog } from '@mui/joy';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';
import CircularProgress from '@mui/joy/CircularProgress';
import ailogger from '@/ailogger';

interface VOMProps {
  isValidationOverrideModalOpen: boolean;
  handleValidationOverrideModalClose: (overridePerformed: boolean) => Promise<void>;
}

export default function ValidationOverrideModal(props: VOMProps) {
  const { isValidationOverrideModalOpen, handleValidationOverrideModalClose } = props;
  const [openConfirmOverrideModal, setOpenConfirmOverrideModal] = useState(true); // starting with confirmation
  const [isOverrideConfirmed, setIsOverrideConfirmed] = useState(false); // need confirmation for override
  const [startOverride, setStartOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideProgress, setOverrideProgress] = useState<number | null>(null); // track override progress
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const censusID = currentCensus?.dateRanges?.[0]?.censusID;

  const triggerOverride = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !censusID) {
      throw new Error('validation override requires a selected site, plot, and census');
    }
    const response = await fetch('/api/validations/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: currentSite.schemaName, plotID: currentPlot.plotID, censusID })
    });
    if (!response.ok) throw new Error(`Validation override failed with status ${response.status}`);
  }, [currentSite?.schemaName, currentPlot?.plotID, censusID]);

  // CRITICAL FIX: Store interval ref for cleanup to prevent memory leak
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (startOverride) {
      setOverrideError(null);
      setOverrideProgress(0);
      triggerOverride()
        .then(() => {
          // Simulate determinate progress completion
          let progress = 0;
          const interval = setInterval(() => {
            setOverrideProgress(progress);
            if (progress >= 100) {
              clearInterval(interval);
              progressIntervalRef.current = null;
              setTimeout(() => {
                setStartOverride(false);
                handleValidationOverrideModalClose(true).then(() => {});
              }, 1000); // Wait 1 second before closing
            }
            progress += 20;
          }, 200); // Increment progress every 200ms

          // Store interval ref for cleanup
          progressIntervalRef.current = interval;
        })
        .catch((error: unknown) => {
          ailogger.error('Override operation failed:', error instanceof Error ? error : undefined);
          setOverrideError('Override could not be confirmed. Close this dialog and refresh the census before retrying.');
          setStartOverride(false);
        });
    }

    // Cleanup interval on unmount
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [startOverride, handleValidationOverrideModalClose, triggerOverride]);

  useEffect(() => {
    if (isOverrideConfirmed) setStartOverride(true); // need to add toggle otherwise system will never get going
  }, [isOverrideConfirmed]);

  return (
    <Modal
      open={isValidationOverrideModalOpen}
      onClose={() => handleValidationOverrideModalClose(false)}
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
    >
      <ModalDialog role={'alertdialog'}>
        <ModalClose />
        <DialogTitle>Override All Validation Results?</DialogTitle>
        <DialogContent>
          {openConfirmOverrideModal && !isOverrideConfirmed && (
            <ConfirmationDialog
              open={openConfirmOverrideModal}
              onClose={() => {
                setOpenConfirmOverrideModal(false);
                handleValidationOverrideModalClose(false);
              }}
              onConfirm={() => {
                setOpenConfirmOverrideModal(false);
                setIsOverrideConfirmed(true);
              }}
              title={'WARNING: Confirm Validation Override?'}
              content={'Are you sure you want to override the validation status of all measurements in this census?'}
            />
          )}
          {startOverride && overrideProgress !== null && <CircularProgress determinate value={overrideProgress} />}
          {overrideError && <Alert color="danger">{overrideError}</Alert>}
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
