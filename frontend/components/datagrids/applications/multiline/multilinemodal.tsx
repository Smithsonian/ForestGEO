'use client';

import { IconButton, Modal, ModalDialog } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import { ReactNode } from 'react';

interface MultilineModalProps {
  isManualEntryFormOpen: boolean;
  handleCloseManualEntryForm: () => void;
  formComponent: ReactNode;
}

export default function MultilineModal(props: MultilineModalProps) {
  const { isManualEntryFormOpen, handleCloseManualEntryForm, formComponent } = props;
  return (
    <>
      <Modal
        open={isManualEntryFormOpen}
        onClose={() => {}}
        aria-labelledby="upload-dialog-title"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <ModalDialog size="lg" sx={{ width: '100%', maxHeight: '100vh', overflow: 'auto' }} role="alertdialog">
          <IconButton aria-label="close" onClick={handleCloseManualEntryForm} sx={{ position: 'absolute', top: 8, right: 8 }}>
            <CloseIcon />
          </IconButton>
          {formComponent}
        </ModalDialog>
      </Modal>
    </>
  );
}
