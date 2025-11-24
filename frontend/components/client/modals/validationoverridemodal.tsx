'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { DialogContent, DialogTitle, Modal, ModalClose, ModalDialog } from '@mui/joy';
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
  const [overrideProgress, setOverrideProgress] = useState<number | null>(null); // track override progress
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const triggerOverride = useCallback(async () => {
    const clearCMVQuery = `DELETE cmv
      FROM ${currentSite?.schemaName}.cmverrors AS cmv
      JOIN ${currentSite?.schemaName}.coremeasurements AS cm
          ON cmv.CoreMeasurementID = cm.CoreMeasurementID
      JOIN ${currentSite?.schemaName}.census AS c
          ON c.CensusID = cm.CensusID
      WHERE c.CensusID IN (SELECT CensusID from ${currentSite?.schemaName}.census WHERE PlotID = ${currentPlot?.plotID} AND PlotCensusNumber = ${currentCensus?.plotCensusNumber})
        AND c.PlotID = ${currentPlot?.plotID}
        AND (cm.IsValidated = FALSE OR cm.IsValidated IS NULL);`;
    const query = `UPDATE ${currentSite?.schemaName}.coremeasurements AS cm
      JOIN ${currentSite?.schemaName}.census AS c ON c.CensusID = cm.CensusID
      SET cm.IsValidated = TRUE
      WHERE c.CensusID IN (SELECT CensusID from ${currentSite?.schemaName}.census WHERE PlotID = ${currentPlot?.plotID} AND PlotCensusNumber = ${currentCensus?.plotCensusNumber}) AND c.PlotID = ${currentPlot?.plotID} AND cm.IsValidated = FALSE OR cm.IsValidated IS NULL`;
    const clearCMVResponse = await fetch(`/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clearCMVQuery)
    });
    const clearCMVResultPacket = await clearCMVResponse.json();
    if (clearCMVResultPacket.affectedRows === 0) throw new Error('CMV clear op failed');
    const response = await fetch(`/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    const resultPacket = await response.json();
    if (resultPacket.affectedRows === 0) throw new Error('validation override failed');
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
        {/*<DialogContent>{overrideProgress === null ? <CircularProgress /> : <CircularProgress determinate />}</DialogContent>*/}
      </ModalDialog>
    </Modal>
  );

  /*return (
    <>

      {isOverrideConfirmed && (
        <Modal
          open={isValidationOverrideModalOpen}
          onClose={handleValidationOverrideModalClose}
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <ModalDialog role={'alertdialog'}>
            <ModalClose />
            <DialogTitle>Overriding...</DialogTitle>
            <DialogContent>{overrideProgress === null ? <CircularProgress /> : <CircularProgress determinate />}</DialogContent>
          </ModalDialog>
        </Modal>
      )}
    </>
  );*/
}
