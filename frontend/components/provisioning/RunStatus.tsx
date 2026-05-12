'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, Divider, List, ListItem, Stack, Typography } from '@mui/joy';
import type { ProvisioningRunRecord, ProvisioningStepRecord, RunStatus as RunStatusType } from '@/lib/provisioning/types';

interface RunStatusProps {
  runId: number;
}

interface PollResponse {
  run: ProvisioningRunRecord;
  steps: ProvisioningStepRecord[];
  stuckStepIndex: number | null;
}

type ActionKey = 'retry' | 'abort' | 'mark-failed';

const POLL_INTERVAL_MS = 1000;

const TERMINAL_STATUSES: ReadonlySet<RunStatusType> = new Set(['completed', 'failed', 'aborted']);

function stepStatusIcon(status: ProvisioningStepRecord['status']): React.ReactNode {
  switch (status) {
    case 'pending':
      return <Typography sx={{ color: 'neutral.500', fontFamily: 'monospace' }}>○</Typography>;
    case 'running':
      return <CircularProgress size="sm" />;
    case 'completed':
      return <Typography sx={{ color: 'success.500', fontFamily: 'monospace', fontWeight: 'bold' }}>✓</Typography>;
    case 'failed':
      return <Typography sx={{ color: 'danger.500', fontFamily: 'monospace', fontWeight: 'bold' }}>✗</Typography>;
    case 'skipped':
      return <Typography sx={{ color: 'neutral.400', fontFamily: 'monospace' }}>–</Typography>;
  }
}

function humanizeStepKey(stepKey: string): string {
  return stepKey.replace(/_/g, ' ');
}

export default function RunStatus({ runId }: RunStatusProps) {
  const router = useRouter();
  const [data, setData] = useState<PollResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showStackFor, setShowStackFor] = useState<number | null>(null);
  const [actionInFlight, setActionInFlight] = useState<ActionKey | null>(null);

  // We use a ref so the poll callback can read the latest status without being
  // recreated on every state update, which would cause the interval to reset.
  const latestStatusRef = useRef<RunStatusType | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/provision/${runId}`);
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const body: PollResponse = await res.json();
      latestStatusRef.current = body.run.status;
      setData(body);
      setFetchError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      setFetchError(message);
    }
  }, [runId]);

  // Single polling effect: starts immediately, stops when the run reaches a
  // terminal status. We check the ref (not state) inside the interval so the
  // closure captures the stable ref rather than a stale status snapshot.
  useEffect(() => {
    let cancelled = false;

    async function safePoll() {
      if (cancelled) return;
      await poll();
    }

    safePoll();

    const intervalId = setInterval(() => {
      if (cancelled) return;
      if (latestStatusRef.current !== null && TERMINAL_STATUSES.has(latestStatusRef.current)) {
        clearInterval(intervalId);
        return;
      }
      safePoll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [poll]);

  async function handleRetry() {
    setActionInFlight('retry');
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/provision/${runId}/retry`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Retry failed (HTTP ${res.status})`);
        return;
      }
      // Optimistically mark as running so polling resumes immediately.
      latestStatusRef.current = 'running';
      setData(prev => (prev ? { ...prev, run: { ...prev.run, status: 'running' } } : prev));
    } finally {
      setActionInFlight(null);
    }
  }

  async function handleMarkFailedAndRetry(stepIndex: number) {
    setActionInFlight('mark-failed');
    setActionError(null);
    try {
      const markRes = await fetch(`/api/admin/provision/${runId}/mark-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIndex })
      });
      if (!markRes.ok) {
        const body = await markRes.json().catch(() => ({}));
        setActionError(body.error ?? `Mark-failed failed (HTTP ${markRes.status})`);
        return;
      }
    } finally {
      setActionInFlight(null);
    }
    // After marking failed, trigger retry (which sets its own actionInFlight).
    await handleRetry();
  }

  async function handleAbort() {
    if (!confirm('This will DROP the schema and delete the catalog row. Are you sure you want to abort?')) return;
    setActionInFlight('abort');
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/provision/${runId}/abort`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Abort failed (HTTP ${res.status})`);
        return;
      }
      // Next poll will reflect the aborted status.
    } finally {
      setActionInFlight(null);
    }
  }

  if (fetchError && !data) {
    return (
      <Alert color="danger" variant="soft" sx={{ mt: 2 }}>
        Failed to load run status: {fetchError}
      </Alert>
    );
  }

  if (!data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const { run, steps, stuckStepIndex } = data;
  const isTerminal = TERMINAL_STATUSES.has(run.status);

  return (
    <Stack spacing={3} sx={{ mt: 2 }}>
      {/* Run summary header */}
      <Box>
        <Typography level="body-sm" sx={{ color: 'neutral.500' }}>
          Schema: <strong>{run.schemaName}</strong> · Site: <strong>{run.siteName}</strong>
        </Typography>
        <Typography level="body-sm" sx={{ color: 'neutral.500' }}>
          Status:{' '}
          <Typography
            component="span"
            sx={{
              fontWeight: 'bold',
              color: run.status === 'completed' ? 'success.600' : run.status === 'failed' || run.status === 'aborted' ? 'danger.600' : 'primary.600'
            }}
          >
            {run.status}
          </Typography>
        </Typography>
      </Box>

      {/* Non-fatal fetch error during polling — show inline but don't destroy the checklist */}
      {fetchError && (
        <Alert color="warning" variant="soft" size="sm">
          Poll error: {fetchError} — retrying…
        </Alert>
      )}

      {/* Stuck-step banner */}
      {stuckStepIndex !== null && (
        <Alert
          color="warning"
          variant="soft"
          endDecorator={
            <Button
              size="sm"
              color="warning"
              variant="solid"
              loading={actionInFlight === 'mark-failed'}
              onClick={() => handleMarkFailedAndRetry(stuckStepIndex!)}
              disabled={actionInFlight !== null}
            >
              Mark failed &amp; retry
            </Button>
          }
        >
          Step {stuckStepIndex} appears stuck (running for &gt;5 minutes).
        </Alert>
      )}

      {/* Action error */}
      {actionError && (
        <Alert color="danger" variant="soft">
          {actionError}
        </Alert>
      )}

      {/* Step checklist */}
      <List
        sx={{
          '--ListItem-paddingY': '0.5rem',
          '--ListItem-paddingX': '0',
          borderRadius: 'sm',
          border: '1px solid',
          borderColor: 'neutral.outlinedBorder',
          p: 1
        }}
      >
        {steps.map((step, index) => (
          <React.Fragment key={step.stepId}>
            {index > 0 && <Divider component="li" />}
            <ListItem
              sx={{
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 0.5,
                backgroundColor: stuckStepIndex === step.stepIndex ? 'warning.softBg' : undefined,
                borderRadius: 'xs'
              }}
            >
              {/* Step header row */}
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                <Box sx={{ minWidth: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stepStatusIcon(step.status)}</Box>
                <Typography level="body-sm" sx={{ fontWeight: step.status === 'running' ? 'bold' : 'normal', flexGrow: 1 }}>
                  {humanizeStepKey(step.stepKey)}
                </Typography>
                <Typography level="body-xs" sx={{ color: 'neutral.400', fontFamily: 'monospace' }}>
                  #{step.stepIndex}
                </Typography>
              </Stack>

              {/* Failed step: error message + stack toggle */}
              {step.status === 'failed' && step.errorMessage && (
                <Box sx={{ pl: 4, width: '100%' }}>
                  <Alert color="danger" variant="soft" size="sm">
                    {step.errorMessage}
                  </Alert>
                  {step.errorStack && (
                    <Box sx={{ mt: 0.5 }}>
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={() => setShowStackFor(prev => (prev === step.stepIndex ? null : step.stepIndex))}
                      >
                        {showStackFor === step.stepIndex ? 'Hide details' : 'Show details'}
                      </Button>
                      {showStackFor === step.stepIndex && (
                        <Box
                          component="pre"
                          sx={{
                            mt: 0.5,
                            p: 1,
                            fontSize: '0.7rem',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            backgroundColor: 'neutral.100',
                            borderRadius: 'xs',
                            maxHeight: 200,
                            overflow: 'auto'
                          }}
                        >
                          {step.errorStack}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </ListItem>
          </React.Fragment>
        ))}
      </List>

      {/* Terminal-state action buttons */}
      {isTerminal && (
        <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
          {run.status === 'failed' && (
            <>
              <Button color="primary" loading={actionInFlight === 'retry'} disabled={actionInFlight !== null} onClick={handleRetry}>
                Retry from failed step
              </Button>
              <Button color="danger" variant="outlined" loading={actionInFlight === 'abort'} disabled={actionInFlight !== null} onClick={handleAbort}>
                Abort &amp; drop schema
              </Button>
            </>
          )}
          {run.status === 'completed' && (
            // Note: navigates to /dashboard; the user will need to select the new site manually.
            // A future task will wire up automatic site-selection state after provisioning.
            <Button color="success" onClick={() => router.push('/dashboard')}>
              Go to site
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
