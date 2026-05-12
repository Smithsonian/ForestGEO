'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Alert, Box, Chip, CircularProgress, Sheet, Stack, Table, Typography } from '@mui/joy';

type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

interface RunRow {
  RunID: number;
  Status: RunStatus;
  StartedBy: string;
  StartedAt: string;
  FinishedAt: string | null;
  SiteName: string;
  SchemaName: string;
}

const STATUS_CHIP_COLOR: Record<RunStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  completed: 'success',
  failed: 'danger',
  running: 'warning',
  aborted: 'neutral'
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function ProvisioningRunsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        const res = await fetch('/api/admin/provision/list');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: RunRow[] = await res.json();
        if (!cancelled) setRuns(body);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load runs';
          setFetchError(message);
        }
      }
    }

    loadRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  if (sessionStatus === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!session?.user || session.user.userStatus !== 'global') {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Alert color="danger" variant="soft">
          Access denied. This page is only accessible to global administrators.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1000, mx: 'auto', width: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography level="h2">Provisioning Runs</Typography>
        <Link href="/admin/provision" style={{ textDecoration: 'none' }}>
          <Typography level="body-sm" sx={{ color: 'primary.500' }}>
            + New Provision Run
          </Typography>
        </Link>
      </Stack>

      {fetchError && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {fetchError}
        </Alert>
      )}

      {runs === null && !fetchError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {runs !== null && runs.length === 0 && (
        <Typography level="body-md" sx={{ color: 'neutral.500', mt: 2 }}>
          No provisioning runs yet.
        </Typography>
      )}

      {runs !== null && runs.length > 0 && (
        <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Run</th>
                <th>Site Name</th>
                <th>Schema Name</th>
                <th style={{ width: 110 }}>Status</th>
                <th>Started By</th>
                <th>Started At</th>
                <th>Finished At</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.RunID}>
                  <td>
                    <Link href={`/admin/provision/${run.RunID}`} aria-label={`View run ${run.RunID}`} style={{ textDecoration: 'none' }}>
                      <Typography level="body-sm" sx={{ color: 'primary.500', fontWeight: 'bold' }}>
                        #{run.RunID}
                      </Typography>
                    </Link>
                  </td>
                  <td>
                    <Typography level="body-sm">{run.SiteName}</Typography>
                  </td>
                  <td>
                    <Typography level="body-sm" sx={{ fontFamily: 'monospace' }}>
                      {run.SchemaName}
                    </Typography>
                  </td>
                  <td>
                    <Chip color={STATUS_CHIP_COLOR[run.Status]} size="sm" variant="soft">
                      {run.Status}
                    </Chip>
                  </td>
                  <td>
                    <Typography level="body-sm">{run.StartedBy}</Typography>
                  </td>
                  <td>
                    <Typography level="body-sm">{formatDate(run.StartedAt)}</Typography>
                  </td>
                  <td>
                    <Typography level="body-sm">{formatDate(run.FinishedAt)}</Typography>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
    </Box>
  );
}
