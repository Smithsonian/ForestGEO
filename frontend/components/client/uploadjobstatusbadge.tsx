'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Chip, LinearProgress, Modal, ModalClose, Sheet, Stack, Typography } from '@mui/joy';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import ailogger from '@/ailogger';

const JOB_POLL_INTERVAL_MS = 10_000;

interface UploadJobSummary {
  jobID: number;
  status: string;
  phase: string;
  percentComplete: number;
  totalFiles: number;
  processedRows: number;
  failedRows: number;
  lastError: string | null;
}

function formatPhase(phase: string): string {
  return phase
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function UploadJobStatusBadge({ schema, plotID, censusID }: { schema?: string; plotID?: number; censusID?: number }) {
  const [jobs, setJobs] = useState<UploadJobSummary[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!schema || !plotID || !censusID) {
      setJobs([]);
      return;
    }

    let cancelled = false;
    const schemaName = schema;

    async function fetchJobs() {
      try {
        const params = new URLSearchParams({
          schema: schemaName,
          plotID: String(plotID),
          censusID: String(censusID)
        });
        const response = await fetch(`/api/uploadjobs?${params.toString()}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: UploadJobSummary[] };
        if (!cancelled) {
          setJobs(payload.jobs ?? []);
        }
      } catch (error) {
        ailogger.warn('[UploadJobStatusBadge] Failed to poll upload jobs:', error instanceof Error ? error : new Error(String(error)));
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
  }, [schema, plotID, censusID]);

  if (jobs.length === 0) return null;

  const hasFailure = jobs.some(job => job.status === 'failed');
  const hasWaitingRetry = jobs.some(job => job.status === 'waiting_retry');
  const primaryJob = jobs[0];
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
              Upload job {primaryJob.jobID}: {formatPhase(primaryJob.phase)}
            </Typography>
            <Chip variant="soft" color={color} size="sm">
              {jobs.length} active
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
                  <Chip variant="soft" color={job.status === 'waiting_retry' ? 'warning' : hasFailure ? 'danger' : 'primary'} size="sm">
                    Job {job.jobID}
                  </Chip>
                  <Typography level="body-xs" color="neutral">
                    {Math.round(job.percentComplete || 0)}%
                  </Typography>
                </Stack>
                <Typography level="body-xs" color="neutral">
                  {formatPhase(job.phase)} - {job.totalFiles} file{job.totalFiles === 1 ? '' : 's'} - {job.processedRows} processed - {job.failedRows} failed
                </Typography>
                {job.lastError && (
                  <Typography level="body-xs" color="danger">
                    {job.lastError}
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        </Sheet>
      </Modal>
    </>
  );
}
