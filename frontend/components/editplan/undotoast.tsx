'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Snackbar } from '@mui/joy';
import CloseIcon from '@mui/icons-material/Close';
import UndoIcon from '@mui/icons-material/Undo';

interface UndoToastProps {
  editOperationID: number;
  onUndo: () => Promise<void>;
  onDismiss: () => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12000;

export default function UndoToast({ editOperationID, onUndo, onDismiss, timeoutMs = DEFAULT_TIMEOUT_MS }: UndoToastProps) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const dismissCalledRef = useRef(false);

  const triggerDismiss = useCallback(() => {
    if (dismissCalledRef.current) return;
    dismissCalledRef.current = true;
    setOpen(false);
    onDismiss();
  }, [onDismiss]);

  const handleUndoClick = useCallback(async () => {
    if (busy || dismissCalledRef.current) return;
    setBusy(true);
    try {
      await onUndo();
    } finally {
      setBusy(false);
      triggerDismiss();
    }
  }, [busy, onUndo, triggerDismiss]);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    const timer = setTimeout(() => {
      triggerDismiss();
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs, triggerDismiss]);

  return (
    <Snackbar
      open={open}
      onClose={(_event, reason) => {
        if (reason === 'clickaway') return;
        triggerDismiss();
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      data-testid={`undo-toast-${editOperationID}`}
    >
      <Box sx={{ minWidth: 320, maxWidth: 480, position: 'relative' }}>
        <Alert
          variant="soft"
          color="neutral"
          startDecorator={<UndoIcon />}
          endDecorator={
            <Button size="sm" variant="solid" color="primary" onClick={handleUndoClick} loading={busy} data-testid="undo-toast-undo">
              Undo
            </Button>
          }
          sx={{ boxShadow: 'lg', pr: 5 }}
        >
          Edit #{editOperationID} applied.
        </Alert>
        <IconButton
          variant="plain"
          size="sm"
          onClick={triggerDismiss}
          sx={{ position: 'absolute', top: 8, right: 8 }}
          data-testid="undo-toast-dismiss"
          aria-label="Dismiss"
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </Snackbar>
  );
}
