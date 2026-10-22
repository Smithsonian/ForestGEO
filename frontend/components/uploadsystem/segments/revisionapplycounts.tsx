'use client';

import React from 'react';
import { Box, Typography } from '@mui/joy';
import type { RevisionApplyOutcomeCounts } from '@/config/macros/uploadoutcome';

export const DUPLICATE_CLEANUP_SURVIVOR_NOTE = 'Duplicate cleanup can still use a matched survivor row even when its field values were unchanged.';

export default function RevisionApplyCounts(props: Readonly<RevisionApplyOutcomeCounts>) {
  const { updatedCount, deletedDuplicateCount, insertedCount, failedRowCount, skippedCount, applyErrorCount, hasDuplicateCleanupOnlyRows } = props;
  return (
    <Box data-testid="revision-apply-counts">
      <Typography level="body-md">{updatedCount} measurement(s) updated</Typography>
      {deletedDuplicateCount > 0 && <Typography level="body-md">{deletedDuplicateCount} duplicate(s) deleted</Typography>}
      {insertedCount > 0 && <Typography level="body-md">{insertedCount} new measurement(s) inserted</Typography>}
      {failedRowCount > 0 && (
        <Typography level="body-md" color="warning" data-testid="revision-apply-failed-count">
          {failedRowCount} rejected row(s) recorded as failed measurements
        </Typography>
      )}
      {skippedCount > 0 && (
        <Typography level="body-md" color="neutral">
          {skippedCount} matched row(s) required no field updates
        </Typography>
      )}
      {deletedDuplicateCount > 0 && hasDuplicateCleanupOnlyRows && (
        <Typography level="body-sm" color="neutral">
          {DUPLICATE_CLEANUP_SURVIVOR_NOTE}
        </Typography>
      )}
      {applyErrorCount > 0 && (
        <Typography level="body-md" color="warning">
          {applyErrorCount} row(s) had errors and were skipped
        </Typography>
      )}
    </Box>
  );
}
