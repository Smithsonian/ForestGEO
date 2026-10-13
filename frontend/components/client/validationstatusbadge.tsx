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

async function fetchPersistedRun(schema: string, plotID: number, censusID: number) {
  const response = await fetch(`/api/validations/run?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
  const { run } = await response.json();
  return run;
}

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
  const { status, runID, progress, errors, notices, startValidationRun, updateValidationProgress, completeValidationRun, clearValidationRun } =
    useBackgroundValidationState();
  const [detailOpen, setDetailOpen] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumedScopeKeyRef = useRef<string | null>(null);

  // The store is not keyed by scope, so a switch must drop the previous scope's run before resuming the new one.
  useEffect(() => {
    if (!schema || !plotID || !censusID) return;
    const scopeKey = `${schema}:${plotID}:${censusID}`;
    if (resumedScopeKeyRef.current === scopeKey) return;
    if (ValidationRunner.isRunning()) return;

    const isScopeSwitch = resumedScopeKeyRef.current !== null;
    resumedScopeKeyRef.current = scopeKey;
    if (isScopeSwitch) clearValidationRun();
    ValidationRunner.resume({ schema, plotID, censusID }).catch((err: any) => {
      ailogger.error('[ValidationStatusBadge] Resume check failed:', err);
    });
  }, [schema, plotID, censusID, clearValidationRun]);

  // isRunning() is read per tick because the runner clears it outside React; runID ends the lifetime on a run handoff.
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
      if (ValidationRunner.isRunning() || fetchInFlight) return;

      fetchInFlight = true;
      try {
        const run = await fetchPersistedRun(schema, plotID, censusID);
        if (cancelled || !run || ValidationRunner.isRunning()) return;

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
