'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText, FormLabel, Input, Modal, ModalDialog, Stack } from '@mui/joy';

interface AbortConfirmDialogProps {
  open: boolean;
  schemaName: string;
  inFlight: boolean;
  title: string;
  warning: React.ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function AbortConfirmDialog({ open, schemaName, inFlight, title, warning, confirmLabel, onCancel, onConfirm }: AbortConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  function handleCancel() {
    if (inFlight) return;
    setTyped('');
    onCancel();
  }

  const confirmDisabled = typed !== schemaName || inFlight;

  return (
    <Modal open={open} onClose={handleCancel}>
      <ModalDialog role="alertdialog" sx={{ maxWidth: 520 }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert color="danger" variant="soft">
              {warning}
            </Alert>
            <FormControl>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Joy's FormControl wires FormLabel↔Input internally; the Input also carries aria-label */}
              <FormLabel>Confirm schema name</FormLabel>
              <Input
                aria-label="Confirm schema name"
                value={typed}
                onChange={event => setTyped(event.target.value)}
                placeholder={schemaName}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- alertdialog confirm input; focus on open is intentional and matches the teardown dialog pattern
                autoFocus
                disabled={inFlight}
              />
              <FormHelperText>Type {schemaName} to confirm.</FormHelperText>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="danger" loading={inFlight} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="plain" color="neutral" disabled={inFlight} onClick={handleCancel}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
