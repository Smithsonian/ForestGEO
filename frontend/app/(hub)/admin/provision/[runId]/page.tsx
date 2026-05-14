'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Box, CircularProgress, Typography } from '@mui/joy';
import RunStatus from '@/components/provisioning/RunStatus';

export default function RunDetailPage() {
  const params = useParams();
  const runId = Number(params.runId);
  const { data: session, status } = useSession();

  if (status === 'loading') {
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

  if (!Number.isInteger(runId) || runId < 1) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert color="danger" variant="soft">
          Invalid run ID.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx: 'auto', width: '100%' }}>
      <Typography level="h2" sx={{ mb: 1 }}>
        Provisioning Run #{runId}
      </Typography>
      <RunStatus runId={runId} />
    </Box>
  );
}
