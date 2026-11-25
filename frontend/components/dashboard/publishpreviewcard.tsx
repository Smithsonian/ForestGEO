'use client';

import React from 'react';
import { Box, Card, Stack, Typography } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import {
  CENSUS_OVERVIEW_TEXT,
  EXPORT_SKIP_REASON_ROW_LABELS,
  formatCount,
  formatExportedOfActive,
  formatExportedWithUnresolvedErrors,
  type CensusOverviewSummary
} from '@/config/censusoverview';

const HEADING_ID = 'census-overview-publish-preview-heading';
const SPLIT_BAR_HEIGHT_PX = 12;
const SPLIT_BAR_GAP_PX = 2;
const LEGEND_SWATCH_SIZE_PX = 10;
const EXPORTED_COLOR = 'success.500';
const SKIPPED_COLOR = 'neutral.500';

export interface PublishPreviewCardProps {
  /** null while the summary loads. */
  exportPreview: CensusOverviewSummary['exportPreview'] | null;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box aria-hidden sx={{ width: LEGEND_SWATCH_SIZE_PX, height: LEGEND_SWATCH_SIZE_PX, borderRadius: '2px', bgcolor: color }} />
      <Typography level="body-sm">{label}</Typography>
    </Box>
  );
}

function ExportSplit({ exportableCount, skippedCount }: { exportableCount: number; skippedCount: number }) {
  const exportedLabel = `${formatCount(exportableCount)} ${CENSUS_OVERVIEW_TEXT.exportedLegend}`;
  const skippedLabel = `${formatCount(skippedCount)} ${CENSUS_OVERVIEW_TEXT.skippedLegend}`;
  return (
    <>
      <Box
        role="img"
        aria-label={`${exportedLabel}, ${skippedLabel}`}
        sx={{ display: 'flex', gap: `${SPLIT_BAR_GAP_PX}px`, height: SPLIT_BAR_HEIGHT_PX, borderRadius: 'sm', overflow: 'hidden' }}
      >
        <Box sx={{ flex: `${exportableCount} 1 0`, bgcolor: EXPORTED_COLOR }} />
        <Box sx={{ flex: `${skippedCount} 1 0`, bgcolor: SKIPPED_COLOR }} />
      </Box>
      <Stack direction="row" spacing={2}>
        <LegendItem color={EXPORTED_COLOR} label={exportedLabel} />
        <LegendItem color={SKIPPED_COLOR} label={skippedLabel} />
      </Stack>
    </>
  );
}

function ExportPreviewBody({ exportPreview }: { exportPreview: CensusOverviewSummary['exportPreview'] }) {
  const { totalActiveMeasurements, exportableCount, skippedCount, skipReasons, exportedWithUnresolvedErrorCount } = exportPreview;
  const visibleReasons = skipReasons.filter(reason => reason.count > 0);
  return (
    <Stack spacing={1.5} data-testid="census-overview-export-preview">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography level="h3" component="p">
          {formatCount(exportableCount)}
        </Typography>
        <Typography level="body-md">{formatExportedOfActive(totalActiveMeasurements)}</Typography>
      </Box>
      {totalActiveMeasurements > 0 && <ExportSplit exportableCount={exportableCount} skippedCount={skippedCount} />}
      {skippedCount > 0 && visibleReasons.length > 0 && (
        <Stack spacing={0.75} data-testid="census-overview-skip-reasons" sx={{ pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography level="body-sm" color="neutral">
            {CENSUS_OVERVIEW_TEXT.skipReasonsHeading}
          </Typography>
          {visibleReasons.map(reason => (
            <Stack key={reason.kind} direction="row" justifyContent="space-between" data-testid="census-overview-skip-reason-row">
              <Typography level="body-sm">{EXPORT_SKIP_REASON_ROW_LABELS[reason.kind]}</Typography>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                {formatCount(reason.count)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {exportedWithUnresolvedErrorCount > 0 && (
        <Typography level="body-sm" color="neutral">
          {formatExportedWithUnresolvedErrors(exportedWithUnresolvedErrorCount)}
        </Typography>
      )}
    </Stack>
  );
}

/** What a publish would carry to the Smithsonian database right now. Facts only, no verdict. */
export default function PublishPreviewCard({ exportPreview }: PublishPreviewCardProps) {
  return (
    <Card variant="outlined" component="section" aria-labelledby={HEADING_ID} data-testid="publish-preview-card" sx={{ gap: 1.5 }}>
      <Box>
        <Typography id={HEADING_ID} level="title-lg" component="h2">
          {CENSUS_OVERVIEW_TEXT.publishPreviewTitle}
        </Typography>
        <Typography level="body-sm" color="neutral">
          {CENSUS_OVERVIEW_TEXT.publishPreviewSubtitle}
        </Typography>
      </Box>
      {exportPreview === null ? <ContentSkeleton kind="dashboard-card" /> : <ExportPreviewBody exportPreview={exportPreview} />}
    </Card>
  );
}
