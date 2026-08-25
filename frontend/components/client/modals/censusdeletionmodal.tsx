'use client';

import React from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Typography } from '@mui/joy';

// Interface for census types that can be passed to this modal
// Supports OrgCensus, OrgCensusRDS, and CensusWithStats
interface CensusLike {
  plotCensusNumber: number;
  dateRanges: Array<{ censusID: number; startDate?: Date; endDate?: Date }>;
}

export interface CensusDeletionModalProps {
  open: boolean;
  onClose: () => void;
  onDelete: (deleteType: 'msmts' | 'full') => Promise<void>;
  census: CensusLike | null;
  isDeleting?: boolean;
}

/**
 * Shared Census Deletion Modal Component
 *
 * Used by both the sidebar census dropdown and the dashboard census overview
 * to explain the exact scope of the clearcensusmsmts procedure.
 */
export default function CensusDeletionModal({ open, onClose, onDelete, census, isDeleting = false }: CensusDeletionModalProps) {
  const handlePartialDelete = async () => {
    await onDelete('msmts');
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog variant="outlined" role="alertdialog" sx={{ minWidth: { xs: '90%', sm: 500, md: 600 }, p: 3 }}>
        <ModalClose />
        <DialogTitle>Delete Census {census?.plotCensusNumber}?</DialogTitle>
        <DialogContent>
          <Typography level="body-md" sx={{ mb: 2 }}>
            This permanently deletes the Census {census?.plotCensusNumber} record and all of its trees, stems, measurements, measurement attributes, and error
            logs.
          </Typography>
          <Typography level="body-sm" color="danger">
            This cannot be undone. Shared quadrats, taxonomy, and personnel records are not deleted.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ pt: 2 }}>
          <Button variant="solid" color="danger" onClick={handlePartialDelete} disabled={isDeleting} loading={isDeleting}>
            Delete Census
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
