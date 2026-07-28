'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, LinearProgress, Modal, ModalClose, Sheet, Stack, Typography } from '@mui/joy';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import ailogger from '@/ailogger';

const JOB_POLL_INTERVAL_MS = 10_000;
const TERMINAL_JOB_VISIBILITY_MS = 24 * 60 * 60 * 1000;

const CANCELLABLE_JOB_STATUSES = new Set(['queued', 'running', 'waiting_retry']);
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'cancel_requested', 'waiting_retry']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export interface UploadJobSummary {
  jobID: number;
  status: string;
  phase: string;
  percentComplete: number;
  totalFiles: number;
  processedRows: number;
  failedRows: number;
  lastError: string | null;
  updatedAt: string;
}

export function selectVisibleJobs(jobs: UploadJobSummary[], nowMs: number = Date.now()): UploadJobSummary[] {
  return jobs.filter(job => {
    if (ACTIVE_JOB_STATUSES.has(job.status)) return true;
    if (!TERMINAL_JOB_STATUSES.has(job.status)) return false;
    const updatedAtMs = new Date(job.updatedAt).getTime();
    return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= TERMINAL_JOB_VISIBILITY_MS;
  });
}

/**
 * Chooses the job the badge headline speaks for, and whether the badge reads as
 * failed.
 *
 * The list arrives ordered by UpdatedAt and terminal jobs stay visible for a
 * day, so `jobs[0]` is regularly a finished job standing in front of work that
 * is still running. Live work is what the badge exists to surface, so an active
 * job always outranks a terminal one, and a past failure only colours the badge
 * once nothing is in flight — otherwise one failed job paints a healthy running
 * upload red for the rest of the day.
 */
export function summarizeJobs(jobs: UploadJobSummary[]): { primaryJob: UploadJobSummary; hasFailure: boolean } {
  const activeJobs = jobs.filter(job => ACTIVE_JOB_STATUSES.has(job.status));
  return {
    primaryJob: activeJobs[0] ?? jobs[0],
    hasFailure: activeJobs.length === 0 && jobs.some(job => job.status === 'failed')
  };
}

function formatPhase(phase: string): string {
  return phase
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Status-derived label that overrides the phase text when set. */
function describeJobStatus(status: string): string | null {
  if (status === 'cancel_requested') return 'Cancelling…';
  if (status === 'waiting_retry') return 'Retrying soon';
  return null;
}

export default function UploadJobStatusBadge({ schema, plotID, censusID }: { schema?: string; plotID?: number; censusID?: number }) {
  const [jobs, setJobs] = useState<UploadJobSummary[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancellingJobIDs, setCancellingJobIDs] = useState<Set<number>>(new Set());
  // Bumped to force an immediate refetch outside the poll cadence (e.g. after
  // a cancel request was rejected, so stale local state resyncs right away).
  const [refetchNonce, setRefetchNonce] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleCancelJob(jobID: number) {
    if (!schema) {
      ailogger.warn(`[UploadJobStatusBadge] Cannot cancel job ${jobID}: no schema in scope`);
      return;
    }
    setCancellingJobIDs(prev => new Set(prev).add(jobID));
    try {
      const params = new URLSearchParams({ schema });
      const response = await fetch(`/api/uploadjobs/${jobID}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      if (!response.ok) {
        ailogger.warn(`[UploadJobStatusBadge] Cancel request for job ${jobID} returned HTTP ${response.status}`);
        // The job may have changed state since the last poll (e.g. finished or
        // already cancelled); refetch immediately so the UI resyncs instead of
        // showing a stale cancellable job until the next poll tick.
        setRefetchNonce(nonce => nonce + 1);
        return;
      }
      const payload = (await response.json()) as { success?: boolean; pending?: boolean };
      // pending=true means a running job flipped to cancel_requested and the
      // worker will finalize it; otherwise the job is already cancelled and
      // drops out of the active list immediately.
      setJobs(prev =>
        payload.pending ? prev.map(job => (job.jobID === jobID ? { ...job, status: 'cancel_requested' } : job)) : prev.filter(job => job.jobID !== jobID)
      );
    } catch (error) {
      ailogger.warn('[UploadJobStatusBadge] Failed to cancel upload job:', error instanceof Error ? error : new Error(String(error)));
    } finally {
      setCancellingJobIDs(prev => {
        const next = new Set(prev);
        next.delete(jobID);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!schema || !plotID || !censusID) {
      setJobs([]);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const schemaName = schema;

    async function fetchJobs() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const params = new URLSearchParams({
          schema: schemaName,
          plotID: String(plotID),
          censusID: String(censusID),
          activeOnly: 'false',
          limit: '25'
        });
        const response = await fetch(`/api/uploadjobs?${params.toString()}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: UploadJobSummary[] };
        if (!cancelled) {
          setJobs(selectVisibleJobs(payload.jobs ?? []));
        }
      } catch (error) {
        ailogger.warn('[UploadJobStatusBadge] Failed to poll upload jobs:', error instanceof Error ? error : new Error(String(error)));
      } finally {
        requestInFlight = false;
      }
    }

    fetchJobs();
    pollTimerRef.current = setInterval(fetchJobs, JOB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [schema, plotID, censusID, refetchNonce]);

  if (jobs.length === 0) return null;

  const { primaryJob, hasFailure } = summarizeJobs(jobs);
  const hasWaitingRetry = jobs.some(job => job.status === 'waiting_retry');
  const color = hasFailure ? 'danger' : hasWaitingRetry ? 'warning' : 'primary';
  const progressValue = Math.max(1, Math.round(primaryJob.percentComplete || 0));

  return (
    <>
      <Sheet
        variant="soft"
        color={color}
        role="button"
        tabIndex={0}
        onClick={() => setDetailOpen(true)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setDetailOpen(true);
          }
        }}
        aria-label="Open upload job progress details"
        sx={{
          width: '100%',
          borderRadius: 'sm',
          px: 1.25,
          py: 0.75,
          cursor: 'pointer',
          boxShadow: 'sm'
        }}
      >
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {hasFailure ? <ErrorOutline fontSize="small" /> : <CloudUploadOutlined fontSize="small" />}
            <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
              Upload job {primaryJob.jobID}: {describeJobStatus(primaryJob.status) ?? formatPhase(primaryJob.phase)}
            </Typography>
            <Chip variant="soft" color={color} size="sm">
              {jobs.length} recent
            </Chip>
            <Typography level="body-xs">{progressValue}%</Typography>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinearProgress determinate value={progressValue} color={color} sx={{ flex: 1 }} />
            <Typography level="body-xs" color="neutral">
              {primaryJob.processedRows} processed / {primaryJob.failedRows} failed
            </Typography>
          </Box>
        </Stack>
      </Sheet>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)}>
        <Sheet
          variant="outlined"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            minWidth: 320,
            maxWidth: 460,
            borderRadius: 'md',
            p: 3,
            boxShadow: 'lg'
          }}
        >
          <ModalClose />
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CloudUploadOutlined fontSize="small" />
              <Typography level="title-sm">Upload Jobs</Typography>
            </Stack>

            {jobs.map(job => (
              <Stack key={job.jobID} spacing={0.75}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Chip
                    variant="soft"
                    color={job.status === 'waiting_retry' || job.status === 'cancel_requested' ? 'warning' : job.status === 'failed' ? 'danger' : 'primary'}
                    size="sm"
                  >
                    Job {job.jobID}
                  </Chip>
                  <Typography level="body-xs" color="neutral">
                    {Math.round(job.percentComplete || 0)}%
                  </Typography>
                </Stack>
                <Typography level="body-xs" color="neutral">
                  {describeJobStatus(job.status) ?? formatPhase(job.phase)} - {job.totalFiles} file{job.totalFiles === 1 ? '' : 's'} - {job.processedRows}{' '}
                  processed - {job.failedRows} failed
                </Typography>
                {job.lastError && (
                  <Typography level="body-xs" color="danger">
                    {job.lastError}
                  </Typography>
                )}
                {CANCELLABLE_JOB_STATUSES.has(job.status) && (
                  <Button
                    size="sm"
                    variant="soft"
                    color="danger"
                    loading={cancellingJobIDs.has(job.jobID)}
                    onClick={() => handleCancelJob(job.jobID)}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Cancel
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </Sheet>
      </Modal>
    </>
  );
}
