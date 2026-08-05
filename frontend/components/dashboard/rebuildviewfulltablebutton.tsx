'use client';

/**
 * "Rebuild ViewFullTable" — operator-triggered reporting-view rebuild on the
 * Smithsonian database. `ctfsweb_webuser` below is a real destination schema
 * name, not the historical export misnomer.
 *
 * Decoupled from Publish census (D5): the publish artifact no longer rebuilds
 * ViewFullTable. Operators confirm a successful load first, then rebuild on
 * demand via this button. The rebuild is slow for large plots, so it is gated
 * behind a confirmation modal. The downloaded artifact targets whichever
 * destination DATABASE() it is run against and requires creating_ViewFullTable.sql
 * to be installed in ctfsweb_webuser.
 */

import { useCallback, useState } from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import WarningIcon from '@mui/icons-material/Warning';
import ailogger from '@/ailogger';

interface RebuildViewFullTableButtonProps {
  schema: string;
  disabled?: boolean;
}

type Status = 'idle' | 'pending' | 'success' | 'error';

export default function RebuildViewFullTableButton({ schema, disabled = false }: RebuildViewFullTableButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (status === 'pending') return;
    setIsOpen(false);
    setStatus('idle');
    setErrorMessage(null);
  }, [status]);

  const handleRebuild = useCallback(async () => {
    setStatus('pending');
    setErrorMessage(null);
    const url = `/api/export/ctfs-rebuild-view/${encodeURIComponent(schema)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        let message = `Rebuild artifact failed with HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body; keep the HTTP-status message
        }
        setStatus('error');
        setErrorMessage(message);
        return;
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename=([^;]+)/i.exec(disposition);
      const filename = match ? match[1].trim() : 'smithsonian-rebuild-viewfulltable.sql';
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setStatus('success');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      ailogger.error('Rebuild ViewFullTable failed', error, { schema });
      setStatus('error');
      setErrorMessage(error.message);
    }
  }, [schema]);

  return (
    <>
      <Button
        variant="outlined"
        color="neutral"
        startDecorator={<AutorenewIcon />}
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        sx={{ alignSelf: 'flex-start' }}
      >
        Rebuild ViewFullTable
      </Button>

      <Modal open={isOpen} onClose={handleClose}>
        <ModalDialog sx={{ minWidth: 480, maxWidth: 640 }}>
          <DialogTitle>Rebuild ViewFullTable</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Typography level="body-sm">
                Generates a <code>.sql</code> artifact that rebuilds the <code>ViewFullTable</code> reporting view on the destination. Run it after confirming a
                successful publish. This rebuild can be slow for large plots, so it runs only when you trigger it. The destination must have{' '}
                <code>creating_ViewFullTable.sql</code> sourced into <code>ctfsweb_webuser</code>.
              </Typography>
              {status === 'error' && (
                <Alert color="danger" variant="soft" startDecorator={<WarningIcon />}>
                  {errorMessage ?? 'Rebuild artifact failed'}
                </Alert>
              )}
              {status === 'success' && (
                <Alert color="success" variant="soft">
                  Artifact downloaded. Run it against the destination MySQL when ready.
                </Alert>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="solid" color="primary" onClick={handleRebuild} loading={status === 'pending'} disabled={status === 'success'}>
              Download rebuild artifact
            </Button>
            <Button variant="plain" color="neutral" onClick={handleClose} disabled={status === 'pending'}>
              Close
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </>
  );
}
