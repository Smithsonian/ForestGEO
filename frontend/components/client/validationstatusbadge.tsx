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
  const { status, progress, errors, startValidationRun, updateValidationProgress, completeValidationRun } = useBackgroundValidationState();
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

  // Poll DB as a fallback while status is 'running' but the module-level
  // runner is NOT active (i.e. the page was hard-refreshed and the runner
  // died).  Writes the fetched state back into Zustand so the badge stays
  // accurate.
  useEffect(() => {
    if (status !== 'running' || !schema || !plotID || !censusID) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    // If the runner is active in this tab, Zustand is already being updated
    // directly — no need to poll.
    if (ValidationRunner.isRunning()) return;

    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/validations/run?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
        const { run } = await response.json();
        if (!run) return;

        // Write DB state back into Zustand
        if (run.Status === 'running') {
          updateValidationProgress({
            completed: run.CompletedSteps,
            total: run.TotalSteps,
            current: run.CurrentStep,
            errors: run.ErrorMessages ?? undefined
          });
        } else if (run.Status === 'completed' || run.Status === 'failed') {
          startValidationRun(run.RunID, run.TotalSteps);
          updateValidationProgress({
            completed: run.CompletedSteps,
            errors: run.ErrorMessages ?? undefined
          });
          completeValidationRun(run.Status, run.ErrorMessages ?? undefined);
          clearInterval(pollTimerRef.current!);
          pollTimerRef.current = null;
        }
      } catch {
        // Swallow polling errors
      }
    }, DB_POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [status, schema, plotID, censusID, startValidationRun, updateValidationProgress, completeValidationRun]);

  if (status === 'idle') return null;

  return (
    <>
      <IconButton size="sm" variant="plain" onClick={() => setDetailOpen(true)} aria-label="Validation status" sx={{ position: 'relative' }}>
        {status === 'running' && (
          <Badge badgeContent={`${progress.completed}/${progress.total}`} size="sm" color="primary">
            <CircularProgress size="sm" />
          </Badge>
        )}
        {status === 'completed' && <CheckCircleOutlined color="success" />}
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
              <Chip variant="soft" color="success" size="sm">
                All {progress.total} validations passed
              </Chip>
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
