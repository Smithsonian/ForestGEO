'use client';

import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';
import { Dispatch, SetStateAction } from 'react';

interface FailedMeasurementsModalProps {
  open: boolean;
  setReingested: Dispatch<SetStateAction<boolean>>;
  handleCloseModal: () => Promise<void>;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, setReingested, handleCloseModal } = props;
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  async function resubmitRows() {
    await fetch(`/api/reingest/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.dateRanges[0].censusID}`, {
      method: 'GET'
    });
    setReingested(true);
    await handleCloseModal();
  }

  return (
    <Modal open={open} onClose={() => {}}>
      <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
        <DialogTitle>Failed Measurements</DialogTitle>
        <DialogContent>
          <Typography level={'title-sm'}>
            The following measurements failed to be uploaded. <br />
            Edit the measurements in this table and press the submit button to try again.
          </Typography>
          <IsolatedFailedMeasurementsDataGrid />
        </DialogContent>
        <DialogActions>
          <Button variant="solid" color="primary" onClick={resubmitRows}>
            Resubmit Rows
          </Button>
          <Button variant={'soft'} color={'danger'} onClick={handleCloseModal}>
            Close Modal
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
