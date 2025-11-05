'use client';
import React from 'react';
import { Button, Modal, ModalDialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/joy';

interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  content: string;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ open, onClose, onConfirm, title, content }) => {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="alert-dialog-title" aria-describedby="alert-dialog-description">
        <DialogTitle id="alert-dialog-title">{title}</DialogTitle>
        <DialogContent>
          <Typography id="alert-dialog-description">{content}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="plain" color="neutral">
            Cancel
          </Button>
          <Button onClick={onConfirm} variant="solid" color="primary">
            Confirm
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default ConfirmationDialog;
