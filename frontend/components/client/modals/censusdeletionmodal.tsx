'use client';

import React from 'react';
import { Button, Chip, DialogActions, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Stack, Typography } from '@mui/joy';

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
 * to provide consistent deletion options (partial vs full deletion).
 */
export default function CensusDeletionModal({
  open,
  onClose,
  onDelete,
  census,
  isDeleting = false
}: CensusDeletionModalProps) {
  const handlePartialDelete = async () => {
    await onDelete('msmts');
  };

  const handleFullDelete = async () => {
    await onDelete('full');
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog variant="outlined" role="alertdialog" sx={{ minWidth: { xs: '90%', sm: 500, md: 600 }, p: 3 }}>
        <ModalClose />
        <DialogTitle>
          Delete Census {census?.plotCensusNumber}?
        </DialogTitle>
        <DialogContent>
          <Typography level="body-md" sx={{ mb: 2 }}>
            Please choose from the following options:
          </Typography>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip color="warning" variant="soft">Partial Deletion</Chip>
              <Typography level="body-sm">
                Delete <strong>only measurements</strong> - keeps census structure
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip color="danger" variant="soft">Full Deletion</Chip>
              <Typography level="body-sm">
                Delete <strong>measurements and fixed data</strong> - complete removal
              </Typography>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ pt: 2 }}>
          <Button
            variant="solid"
            color="warning"
            onClick={handlePartialDelete}
            disabled={isDeleting}
            loading={isDeleting}
          >
            Partial Deletion
          </Button>
          <Button
            variant="solid"
            color="danger"
            onClick={handleFullDelete}
            disabled={isDeleting}
            loading={isDeleting}
          >
            Full Deletion
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
