'use client';
import React, { useState } from 'react';
import { GridRowModel } from '@mui/x-data-grid';
import { Box, Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Typography } from '@mui/joy';

interface ReEnterDataModalProps {
  gridType: string;
  row: GridRowModel;
  handleClose: () => void;
  handleSave: (confirmedRow: GridRowModel) => void;
}

const SkipReEnterDataModal: React.FC<ReEnterDataModalProps> = ({ gridType, row, handleClose, handleSave }) => {
  const [isConfirmStep, setIsConfirmStep] = useState(false);

  const handleConfirm = () => {
    setIsConfirmStep(true);
  };

  const handleFinalConfirm = () => {
    handleSave(row); // Proceed to save the row directly without reentry
  };

  return (
    <Modal open onClose={handleClose}>
      <ModalDialog variant="outlined" sx={{ maxWidth: '90vw', overflow: 'auto' }}>
        <DialogTitle>Confirm Changes</DialogTitle>
        <DialogContent>
          {!isConfirmStep ? (
            <Typography level="body-md">You are about to save the following changes to the row. Please confirm to proceed.</Typography>
          ) : (
            <Box className="mt-4" sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography level="title-lg">Please confirm your changes:</Typography>
              <Typography level="body-md">Are you sure you want to save these changes to the selected row?</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {!isConfirmStep ? (
            <>
              <Button onClick={handleConfirm} color="primary">
                Confirm
              </Button>
              <Button onClick={handleClose} color="primary">
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleFinalConfirm} color="primary">
                Save Changes
              </Button>
              <Button onClick={handleClose} color="primary">
                Cancel
              </Button>
            </>
          )}
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default SkipReEnterDataModal;
