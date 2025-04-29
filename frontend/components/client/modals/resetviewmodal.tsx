'use client';

import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';
import { Dispatch, SetStateAction } from 'react';

interface RVM {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  triggerResetView: () => Promise<void>;
}

export default function ResetViewModal(props: RVM) {
  const { open, setOpen, triggerResetView } = props;

  return (
    <Modal open={open} onClose={() => {}}>
      <ModalDialog>
        <DialogTitle>Reset View</DialogTitle>
        <DialogContent>
          <Typography level={'title-lg'}>Are you sure you want to reset this table?</Typography>
          <Typography level={'body-md'} fontWeight={'bold'} color={'danger'}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={triggerResetView}>Reset</Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
