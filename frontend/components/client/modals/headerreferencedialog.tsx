'use client';

import React from 'react';
import { Button, DialogActions, DialogTitle, Modal, ModalDialog } from '@mui/joy';
import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import { DatagridType } from '@/config/macros/formdetails';

const HEADER_REFERENCE_TITLE_ID = 'header-reference-dialog-title';
export const HEADER_REFERENCE_TITLE = 'Header reference';

export function headerReferenceGridType(gridType?: string): DatagridType | null {
  if (!gridType) return null;
  if (gridType === 'measurements' || gridType === 'measurementssummary') return DatagridType.measurementssummaryview;
  if (gridType === 'species') return DatagridType.alltaxonomiesview;
  return Object.values(DatagridType).includes(gridType as DatagridType) ? (gridType as DatagridType) : null;
}

export default function HeaderReferenceDialog({ open, onClose, datagridType }: { open: boolean; onClose: () => void; datagridType: DatagridType }) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby={HEADER_REFERENCE_TITLE_ID} sx={{ width: 'min(1100px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto' }}>
        <DialogTitle id={HEADER_REFERENCE_TITLE_ID}>{HEADER_REFERENCE_TITLE}</DialogTitle>
        <RenderGridFormExplanations datagridType={datagridType} />
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
