'use client';

import { Dispatch, SetStateAction } from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';

interface FailedMeasurementsModalProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, setOpen } = props;
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  async function resubmitRows() {
    await fetch(`/api/formatrunquery`, {
      method: 'POST',
      body: JSON.stringify({
        query: `CALL ${currentSite?.schemaName}.reingestfailedrows(?, ?);`,
        params: [currentPlot?.plotID, currentCensus?.dateRanges[0].censusID]
      })
    });
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)}>
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
          <Button variant={'soft'} color={'danger'}>
            Close Modal
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
