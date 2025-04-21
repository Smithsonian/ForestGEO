'use client';

import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';
import IsolatedFailedMeasurementsDataGrid from '@/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid';
import { Dispatch, SetStateAction } from 'react';

interface FailedMeasurementsModalProps {
  open: boolean;
  setReingested: Dispatch<SetStateAction<boolean>>;
  handleCloseModal: () => Promise<void>;
}

export default function FailedMeasurementsModal(props: FailedMeasurementsModalProps) {
  const { open, setReingested, handleCloseModal } = props;

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
          <Button variant={'soft'} color={'danger'} onClick={handleCloseModal}>
            OK
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
