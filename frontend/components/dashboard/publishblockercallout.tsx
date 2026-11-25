'use client';

import React from 'react';
import { Alert, Stack, Typography } from '@mui/joy';
import ReportIcon from '@mui/icons-material/Report';
import { BLOCKER_FIX_HINTS, CENSUS_OVERVIEW_TEXT, formatBlockerRowCount, type CensusOverviewSummary } from '@/config/censusoverview';

export interface PublishBlockerCalloutProps {
  blockers: CensusOverviewSummary['blockers'];
}

/** The only "stop" on the page: publish preconditions that would make the export fail. */
export default function PublishBlockerCallout({ blockers }: PublishBlockerCalloutProps) {
  if (blockers.length === 0) return null;
  return (
    <Alert color="danger" variant="soft" startDecorator={<ReportIcon />} sx={{ alignItems: 'flex-start' }} data-testid="census-overview-blocker-callout">
      <Stack spacing={1} sx={{ width: '100%' }}>
        <Typography level="title-sm" color="danger">
          {CENSUS_OVERVIEW_TEXT.blockerCalloutTitle}
        </Typography>
        {blockers.map(blocker => {
          const fixHint = BLOCKER_FIX_HINTS[blocker.kind];
          return (
            <Stack key={blocker.kind} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }} data-testid="census-overview-blocker-row">
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                {fixHint.label}
              </Typography>
              {blocker.count !== null && (
                <Typography level="body-sm" data-testid="census-overview-blocker-count">
                  {formatBlockerRowCount(blocker.count)}
                </Typography>
              )}
              <Typography level="body-sm" color="neutral">
                {fixHint.hint}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Alert>
  );
}
