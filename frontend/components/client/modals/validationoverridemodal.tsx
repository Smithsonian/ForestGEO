'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { DialogContent, DialogTitle, Modal, ModalClose, ModalDialog } from '@mui/joy';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';
import CircularProgress from '@mui/joy/CircularProgress';
import ailogger from '@/ailogger';
import { createValidationOverrideQueries } from '@/components/datagrids/measurementscommonsutils';

const OVERRIDE_MARKER_STEP_INDEX = 2;

interface VOMProps {
  isValidationOverrideModalOpen: boolean;
  handleValidationOverrideModalClose: (overridePerformed: boolean) => Promise<void>;
}

export default function ValidationOverrideModal(props: VOMProps) {
  const { isValidationOverrideModalOpen, handleValidationOverrideModalClose } = props;
  const [openConfirmOverrideModal, setOpenConfirmOverrideModal] = useState(true); // starting with confirmation
  const [isOverrideConfirmed, setIsOverrideConfirmed] = useState(false); // need confirmation for override
  const [startOverride, setStartOverride] = useState(false);
  const [overrideProgress, setOverrideProgress] = useState<number | null>(null); // track override progress
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const triggerOverride = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.plotCensusNumber) {
      throw new Error('validation override requires a selected site, plot, and census');
    }
    const steps = createValidationOverrideQueries(currentSite.schemaName, currentPlot.plotID, currentCensus.plotCensusNumber);
    for (const [index, step] of steps.entries()) {
      const response = await fetch(`/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(step)
      });
      if (!response.ok) throw new Error(`validation override step ${index + 1} failed with status ${response.status}`);
      const resultPacket = await response.json();
      if (index === OVERRIDE_MARKER_STEP_INDEX && resultPacket.affectedRows === 0) throw new Error('validation override found no failed or pending rows');
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber]);

  // CRITICAL FIX: Store interval ref for cleanup to prevent memory leak
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (startOverride) {
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
        .catch((error: any) => {
          ailogger.error('Override operation failed:', error);
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
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
