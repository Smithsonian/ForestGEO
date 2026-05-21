'use client';

/**
 * "Publish census" — UI affordance for the CTFS SQL export pipeline.
 *
 * This is a separate operator workflow from the legacy CSV form download
 * (`CTFSWebForms` in the upload selector). Both remain available:
 *   - The legacy CSV export emits the historical 10-column ctfsweb measurement
 *     file. Keep using it for downstream consumers that still parse the CSV.
 *   - "Publish census" emits a destination-loadable `.sql` artifact targeting
 *     on-prem CTFS MySQL (`/api/export/ctfs-sql/...`). Run it against the
 *     destination MySQL after Suzanne's `creating_ViewFullTable.sql` is
 *     installed.
 *
 * The button calls the export endpoint, streams the response into a Blob, and
 * triggers a browser download. Server-side preconditions ("Finished Census"
 * checks) surface here as a structured 400 with a `reasons` array; the modal
 * lists each disqualifying CoreMeasurementID so operators can fix the row in
 * the app and retry.
 */

import { useCallback, useState } from 'react';
import { Alert, Box, Button, Checkbox, DialogActions, DialogContent, DialogTitle, Input, Modal, ModalDialog, Stack, Typography } from '@mui/joy';
import PublishIcon from '@mui/icons-material/Publish';
import WarningIcon from '@mui/icons-material/Warning';
import ailogger from '@/ailogger';

const DEFAULT_DESTINATION_PLOT_ID = '1';

interface PublishCensusButtonProps {
  schema: string;
  appPlotId: number;
  appCensusId: number;
  plotCensusNumber: string | number;
  /** Permits the elevated allowReload/reloadDryRun options. False for ordinary users. */
  canReload?: boolean;
  /** Disable the button when census/plot context is missing. */
  disabled?: boolean;
}

interface PreconditionFailure {
  kind: string;
  message: string;
  coreMeasurementIds: number[];
}

interface PreconditionErrorBody {
  error: string;
  reasons?: PreconditionFailure[];
}

type PublishStatus = 'idle' | 'pending' | 'success' | 'error';

export default function PublishCensusButton(props: PublishCensusButtonProps) {
  const { schema, appPlotId, appCensusId, plotCensusNumber, canReload = false, disabled = false } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [destinationPlotId, setDestinationPlotId] = useState(DEFAULT_DESTINATION_PLOT_ID);
  const [allowReload, setAllowReload] = useState(false);
  const [reloadDryRun, setReloadDryRun] = useState(false);
  const [status, setStatus] = useState<PublishStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reasons, setReasons] = useState<PreconditionFailure[]>([]);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
    setReasons([]);
  }, []);

  const handleClose = useCallback(() => {
    if (status === 'pending') return;
    setIsOpen(false);
    reset();
  }, [status, reset]);

  const handlePublish = useCallback(async () => {
    setStatus('pending');
    setErrorMessage(null);
    setReasons([]);

    const parsed = Number.parseInt(destinationPlotId, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== destinationPlotId) {
      setStatus('error');
      setErrorMessage('Destination CTFS Plot ID must be a non-negative integer.');
      return;
    }

    const query = new URLSearchParams({ destinationPlotID: String(parsed) });
    if (canReload && allowReload) query.set('allowReload', 'true');
    if (canReload && reloadDryRun) query.set('reloadDryRun', 'true');

    const url = `/api/export/ctfs-sql/${encodeURIComponent(schema)}/${appPlotId}/${appCensusId}?${query.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        let body: PreconditionErrorBody | undefined;
        try {
          body = (await response.json()) as PreconditionErrorBody;
        } catch {
          body = undefined;
        }
        setStatus('error');
        setErrorMessage(body?.error ?? `Export failed with HTTP ${response.status}`);
        setReasons(body?.reasons ?? []);
        return;
      }

      // Successful artifact — pull filename from Content-Disposition, fall back
      // to a deterministic name. The endpoint always sets attachment;filename=
      // for downloads.
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename=([^;]+)/i.exec(disposition);
      const filename = match ? match[1].trim() : `ctfs-export-${parsed}-${plotCensusNumber}.sql`;

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
        // Always revoke — even if click() throws.
        URL.revokeObjectURL(objectUrl);
      }
      setStatus('success');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      ailogger.error('Publish census export failed', error, { schema, appPlotId, appCensusId });
      setStatus('error');
      setErrorMessage(error.message);
    }
  }, [destinationPlotId, allowReload, reloadDryRun, canReload, schema, appPlotId, appCensusId, plotCensusNumber]);

  return (
    <>
      <Button
        variant="solid"
        color="primary"
        startDecorator={<PublishIcon />}
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        sx={{ alignSelf: 'flex-start' }}
      >
        Publish census
      </Button>

      <Modal open={isOpen} onClose={handleClose}>
        <ModalDialog sx={{ minWidth: 480, maxWidth: 720 }}>
          <DialogTitle>Publish census to CTFS</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Typography level="body-sm">
                Generates a <code>.sql</code> artifact you can run against the on-prem CTFS MySQL. The destination must already have{' '}
                <code>creating_ViewFullTable.sql</code> sourced into <code>ctfsweb_webuser</code>.
              </Typography>

              <Box>
                <Typography level="body-xs" sx={{ mb: 0.5 }}>
                  Source app census
                </Typography>
                <Typography level="body-sm">
                  Schema <code>{schema}</code>, PlotID <code>{appPlotId}</code>, CensusID <code>{appCensusId}</code> (PlotCensusNumber{' '}
                  <code>{plotCensusNumber}</code>)
                </Typography>
              </Box>

              <Box>
                <Typography level="body-xs" sx={{ mb: 0.5 }}>
                  Destination CTFS Plot ID
                </Typography>
                <Input
                  aria-label="Destination CTFS Plot ID"
                  value={destinationPlotId}
                  onChange={e => setDestinationPlotId(e.target.value)}
                  placeholder="1"
                  slotProps={{ input: { inputMode: 'numeric', pattern: '[0-9]*' } }}
                />
                <Typography level="body-xs" sx={{ mt: 0.5, color: 'neutral.500' }}>
                  Must match an existing PlotID on the destination MySQL. Most sites use <code>1</code>.
                </Typography>
              </Box>

              {canReload && (
                <Stack spacing={1}>
                  {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- Joy UI Checkbox `label` prop renders an associated <label> at runtime; the linter just doesn't parse the component */}
                  <Checkbox
                    label="Allow reload (DELETE+reinsert DBH/DBHAttributes for this census)"
                    checked={allowReload}
                    onChange={e => setAllowReload(e.target.checked)}
                  />
                  {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- Joy UI Checkbox `label` prop renders an associated <label> at runtime */}
                  <Checkbox label="Dry run (preview reload impact without writing)" checked={reloadDryRun} onChange={e => setReloadDryRun(e.target.checked)} />
                  {allowReload && (
                    <Alert color="warning" variant="soft" startDecorator={<WarningIcon />}>
                      Reload will DELETE existing DBH and DBHAttributes rows for this census on the destination. Identity rows (Tree, Stem) are not deleted.
                    </Alert>
                  )}
                </Stack>
              )}

              {status === 'error' && (
                <Alert color="danger" variant="soft" startDecorator={<WarningIcon />}>
                  <Box>
                    <Typography level="title-sm">{errorMessage ?? 'Export failed'}</Typography>
                    {reasons.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        {reasons.map(reason => (
                          <Box key={reason.kind} sx={{ mt: 1 }}>
                            <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                              {reason.kind}: {reason.message}
                            </Typography>
                            {reason.coreMeasurementIds.length > 0 && (
                              <Typography level="body-xs" sx={{ ml: 1, color: 'neutral.500' }}>
                                CoreMeasurementIDs: {reason.coreMeasurementIds.slice(0, 20).join(', ')}
                                {reason.coreMeasurementIds.length > 20 && ` (+${reason.coreMeasurementIds.length - 20} more)`}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
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
            <Button variant="solid" color="primary" onClick={handlePublish} loading={status === 'pending'} disabled={status === 'success'}>
              {reloadDryRun ? 'Download dry-run artifact' : 'Download SQL artifact'}
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
