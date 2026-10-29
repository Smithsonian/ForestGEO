'use client';

import React from 'react';
import { Box } from '@mui/joy';
import { type CensusOverviewSummary } from '@/config/censusoverview';
import ValidationErrorsCard from './validationerrorscard';
import PublishPreviewCard from './publishpreviewcard';

const PANEL_MIN_WIDTH_PX = 420;

export interface CensusSummaryPanelsProps {
  /** null while the summary loads. */
  summary: CensusOverviewSummary | null;
}

/** Validation Errors beside "If you publish now"; they stack when there is no room for both. */
export default function CensusSummaryPanels({ summary }: CensusSummaryPanelsProps) {
  return (
    <Box
      data-testid="census-summary-panels"
      sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${PANEL_MIN_WIDTH_PX}px), 1fr))`, gap: 2 }}
    >
      <ValidationErrorsCard errorOverview={summary?.errorOverview ?? null} />
      <PublishPreviewCard exportPreview={summary?.exportPreview ?? null} />
    </Box>
  );
}
