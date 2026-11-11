'use client';

import React, { useState } from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, Input, Modal, ModalDialog, Stack, Typography } from '@mui/joy';

export interface MeasurementReplacementConfirmDialogProps {
  open: boolean;
  /** Human-readable census identifier, e.g. "Census 3", for the confirmation copy. */
  censusLabel: string;
  /** Number of existing measurement rows the server reported for this plot + census. */
  existingRowCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

function confirmationPhrase(existingRowCount: number): string {
  return `DELETE ${existingRowCount}`;
}

/**
 * Type-to-confirm gate shown before a measurements Clean Re-Upload proceeds, when the
 * server reports existing rows for the plot + census being replaced (issue #504).
 * Cancel leaves the uploader exactly where they were -- no state is advanced here.
 */
export default function MeasurementReplacementConfirmDialog(props: MeasurementReplacementConfirmDialogProps) {
  const { open, censusLabel, existingRowCount, onCancel, onConfirm, busy = false } = props;
  const [typedConfirm, setTypedConfirm] = useState({ existingRowCount, text: '' });

  // Reset the typed text whenever a new count is being confirmed (mirrors
  // previewdialog.tsx's render-time reset keyed off plan identity), so a stale typed
  // phrase from a previous count can never satisfy a new one.
  const typedConfirmMatchesCurrentDelivery = typedConfirm.existingRowCount === existingRowCount;
  if (!typedConfirmMatchesCurrentDelivery) {
    setTypedConfirm({ existingRowCount, text: '' });
  }
  const confirmText = typedConfirmMatchesCurrentDelivery ? typedConfirm.text : '';

  const requiredPhrase = confirmationPhrase(existingRowCount);
  const typedConfirmSatisfied = confirmText.trim() === requiredPhrase;

  return (
    <Modal open={open} onClose={busy ? undefined : onCancel}>
      <ModalDialog
        role="alertdialog"
        aria-labelledby="measurement-replacement-confirm-title"
        aria-describedby="measurement-replacement-confirm-description"
        sx={{ minWidth: { xs: '92%', sm: 520 } }}
      >
        <DialogTitle id="measurement-replacement-confirm-title">Confirm measurement replacement</DialogTitle>
        <DialogContent id="measurement-replacement-confirm-description">
          <Stack spacing={2}>
            <Typography level="body-sm" color="danger">
              {censusLabel} currently has <strong>{existingRowCount}</strong> stored measurement{existingRowCount === 1 ? '' : 's'}. Continuing with a Clean
              Re-Upload will permanently delete all of them before inserting the uploaded file as the new source of truth. This cannot be undone.
            </Typography>
            <FormControl data-testid="measurement-replacement-typed-confirm">
              <FormLabel htmlFor="measurement-replacement-typed-confirm-input">
                Type <strong>{requiredPhrase}</strong> to confirm:
              </FormLabel>
              {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- FormLabel above is associated via htmlFor + id on the input slot */}
              <Input
                size="sm"
                value={confirmText}
                onChange={event => setTypedConfirm({ existingRowCount, text: event.target.value })}
                placeholder={requiredPhrase}
                disabled={busy}
                slotProps={{
                  input: {
                    id: 'measurement-replacement-typed-confirm-input',
                    'data-testid': 'measurement-replacement-typed-confirm-input',
                    'aria-label': `Type ${requiredPhrase} to confirm`
                  }
                }}
              />
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'flex-end' }}>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" color="neutral" onClick={onCancel} disabled={busy} data-testid="measurement-replacement-cancel">
              Cancel
            </Button>
            <Button
              variant="solid"
              color="danger"
              onClick={onConfirm}
              disabled={busy || !typedConfirmSatisfied}
              loading={busy}
              data-testid="measurement-replacement-confirm"
            >
              Delete and replace
            </Button>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
