'use client';

import React from 'react';
import { Button, Chip, DialogActions, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Stack, Tooltip, Typography } from '@mui/joy';

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
 *
 * NOTE: Full Deletion is DISABLED because supporting data (quadrats, species,
 * taxonomy, personnel) is shared across all censuses. Deleting this data would
 * cause all other censuses to fail. Only measurements can be safely deleted
 * on a per-census basis.
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
            This will delete all measurement data for Census {census?.plotCensusNumber}:
          </Typography>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip color="warning" variant="soft">
                Delete Measurements
              </Chip>
              <Typography level="body-sm">
                Removes <strong>trees, stems, and measurements</strong> for this census
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.5 }}>
              <Chip color="neutral" variant="soft">
                Full Deletion
              </Chip>
              <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
                <em>Disabled</em> - Supporting data (quadrats, species, personnel) is shared across all censuses
              </Typography>
            </Stack>
          </Stack>
          <Typography level="body-xs" sx={{ mt: 2, color: 'text.tertiary' }}>
            Note: Quadrats, taxonomy, and personnel data cannot be deleted per-census as they are shared across all censuses.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ pt: 2 }}>
          <Button variant="solid" color="warning" onClick={handlePartialDelete} disabled={isDeleting} loading={isDeleting}>
            Delete Measurements
          </Button>
          <Tooltip title="Full deletion is disabled because supporting data is shared across all censuses" placement="top">
            <span>
              <Button variant="solid" color="neutral" disabled sx={{ opacity: 0.5 }}>
                Full Deletion
              </Button>
            </span>
          </Tooltip>
          <Button variant="plain" color="neutral" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
