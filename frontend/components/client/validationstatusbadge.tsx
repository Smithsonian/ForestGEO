'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Badge, Chip, CircularProgress, IconButton, Stack, Typography, Modal, ModalClose, Sheet } from '@mui/joy';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { useBackgroundValidationState } from '@/config/store/appstore';
import { ValidationRunner } from '@/config/validation-runner';
import ailogger from '@/ailogger';

const DB_POLL_INTERVAL_MS = 10_000;

/**
 * Persistent badge that shows background validation progress.
 *
 * Mount this in a long-lived component (sidebar).  On mount it checks the DB
 * for an existing run and restores state into Zustand, handling hard-refresh
 * recovery.  While running, it polls the DB as a fallback and writes the
 * fetched status back into Zustand so the UI stays in sync even if the
 * module-level runner was lost (e.g. full page reload).
 */
export default function ValidationStatusBadge({ schema, plotID, censusID }: { schema?: string; plotID?: number; censusID?: number }) {
  const { status, runID, progress, errors, notices, startValidationRun, updateValidationProgress, completeValidationRun } = useBackgroundValidationState();
  const [detailOpen, setDetailOpen] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasResumedRef = useRef(false);

  // On mount (or when context changes), check DB for an existing run and
  // restore its state into Zustand.  This handles hard-refresh recovery.
  useEffect(() => {
    if (!schema || !plotID || !censusID) return;
    if (hasResumedRef.current) return;
    // Don't resume if the module-level runner is already active
    if (ValidationRunner.isRunning()) return;

    hasResumedRef.current = true;
    ValidationRunner.resume({ schema, plotID, censusID }).catch((err: any) => {
      ailogger.error('[ValidationStatusBadge] Resume check failed:', err);
    });
  }, [schema, plotID, censusID]);

  // Reset resume flag when plot/census changes
  useEffect(() => {
    hasResumedRef.current = false;
  }, [plotID, censusID]);

  // Poll DB as a fallback while status is 'running'. The module-level
  // runner may be driving this tab's own run (in which case Zustand is
  // already being updated directly and this fallback should skip its
  // fetch), or it may not be — e.g. the page was hard-refreshed and the
  // runner died, or this tab is only *following* another tab/request's
  // persisted run after a scope-lock conflict (ValidationRunner.start()
  // clears its own activity flag in a non-reactive .finally(), so "is the
  // local runner active" can only be read fresh on each tick, never cached
  // for the lifetime of this effect). The timer is therefore always
  // installed while running, and `isRunning()` is checked inside each tick
  // instead of once at mount.
  //
  // `runID` is included below so this effect's lifetime — and the
  // `cancelled` guard it owns — ends whenever the run being followed
  // changes identity, even while `status` itself never leaves 'running'
  // (e.g. handing off from one followed run to another). Without that,
  // a slow response addressed to the previous run could still land after
  // the handoff and overwrite the new one. `fetchInFlight` additionally
  // keeps two ticks within the same lifetime from ever having requests in
  // flight at once, so a slower tick's response can't arrive out of order
  // after a faster, later tick's already has.
  useEffect(() => {
    if (status !== 'running' || !schema || !plotID || !censusID) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let fetchInFlight = false;

    pollTimerRef.current = setInterval(async () => {
      // Skip this tick's fetch if the local runner is actively driving its
      // own run — re-checked per tick, not once at mount, since it can
      // start or stop between ticks without this effect's dependencies
      // changing.
      if (ValidationRunner.isRunning()) return;
      if (fetchInFlight) return;

      fetchInFlight = true;
      try {
        const response = await fetch(`/api/validations/run?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
        const { run } = await response.json();

        // Discard a response that resolved after this effect's lifetime
        // ended (unmount, schema/plotID/censusID/runID changed) or after
        // the local runner picked up a new run while this fetch was in
        // flight — writing it into Zustand now would be stale.
        if (cancelled || !run || ValidationRunner.isRunning()) return;

        // Write DB state back into Zustand
        if (run.Status === 'running') {
          updateValidationProgress({
            completed: run.CompletedSteps,
            total: run.TotalSteps,
            current: run.CurrentStep,
            errors: run.ErrorMessages ?? [],
            notices: run.Notices ?? []
          });
        } else if (run.Status === 'completed' || run.Status === 'failed') {
          startValidationRun(run.RunID, run.TotalSteps);
          updateValidationProgress({
            completed: run.CompletedSteps,
            errors: run.ErrorMessages ?? [],
            notices: run.Notices ?? []
          });
          completeValidationRun(run.Status, run.ErrorMessages ?? [], run.Notices ?? []);
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      } catch {
        // Swallow polling errors
      } finally {
        fetchInFlight = false;
      }
    }, DB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [status, schema, plotID, censusID, runID, startValidationRun, updateValidationProgress, completeValidationRun]);

  if (status === 'idle') return null;

  const hasNotices = notices.length > 0;

  return (
    <>
      <IconButton size="sm" variant="plain" onClick={() => setDetailOpen(true)} aria-label="Validation status" sx={{ position: 'relative' }}>
        {status === 'running' && (
          <Badge badgeContent={`${progress.completed}/${progress.total}`} size="sm" color="primary">
            <CircularProgress size="sm" />
          </Badge>
        )}
        {status === 'completed' && (hasNotices ? <ErrorOutline color="warning" /> : <CheckCircleOutlined color="success" />)}
        {status === 'failed' && <ErrorOutline color="warning" />}
      </IconButton>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)}>
        <Sheet
          variant="outlined"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            minWidth: 300,
            maxWidth: 400,
            borderRadius: 'md',
            p: 3,
            boxShadow: 'lg'
          }}
        >
          <ModalClose />
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <ScienceOutlined fontSize="small" />
              <Typography level="title-sm">Background Validation</Typography>
            </Stack>

            {status === 'running' && (
              <>
                <Chip variant="soft" color="primary" size="sm">
                  {progress.completed} of {progress.total} steps complete
                </Chip>
                {progress.current && (
                  <Typography level="body-xs" color="neutral">
                    Running: {progress.current}
                  </Typography>
                )}
              </>
            )}

            {status === 'completed' && (
              <>
                <Chip variant="soft" color={hasNotices ? 'warning' : 'success'} size="sm">
                  {hasNotices ? 'Validation completed with notices' : `All ${progress.total} validations passed`}
                </Chip>
              </>
            )}

            {hasNotices && (
              <Stack spacing={1} role="status">
                {notices.map((notice, index) => (
                  <Typography key={index} level="body-xs" color="warning">
                    {notice}
                  </Typography>
                ))}
              </Stack>
            )}

            {status === 'failed' && (
              <>
                <Chip variant="soft" color="danger" size="sm">
                  {errors.length} validation{errors.length !== 1 ? 's' : ''} failed
                </Chip>
                {errors.slice(0, 3).map((err, idx) => (
                  <Typography key={idx} level="body-xs" color="danger">
                    {err}
                  </Typography>
                ))}
                {errors.length > 3 && (
                  <Typography level="body-xs" color="neutral">
                    ...and {errors.length - 3} more
                  </Typography>
                )}
              </>
            )}
          </Stack>
        </Sheet>
      </Modal>
    </>
  );
}
