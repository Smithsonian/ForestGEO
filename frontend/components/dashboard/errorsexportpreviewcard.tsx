'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, Box, Button, Card, CardContent, Divider, LinearProgress, Link as JoyLink, Stack, Tooltip, Typography } from '@mui/joy';
import ReportIcon from '@mui/icons-material/Report';
import { ContentSkeleton } from '@/components/loading';
import {
  BLOCKER_FIX_HINTS,
  CENSUS_OVERVIEW_TEXT,
  formatAffectedMeasurementsLine,
  formatBlockerRowCount,
  formatCount,
  formatExportedWithUnresolvedErrors,
  formatExportPreviewCounts,
  formatRemainingErrorTypes,
  formatSkipReason,
  type CensusOverviewSummary
} from '@/config/censusoverview';
import { buildErrorsExplorerMessageHref, ERRORS_EXPLORER_VIEW_ALL_HREF } from '@/config/errorsexplorer';

const FULL_BAR_PERCENT = 100;
const MESSAGE_COLUMN_SHARE = '45%';
const COUNT_COLUMN_MIN_WIDTH = 64;

export interface ErrorsExportPreviewCardProps {
  summary: CensusOverviewSummary | null;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
}

function PublishBlockerCallout({ blockers }: { blockers: CensusOverviewSummary['blockers'] }) {
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

function ErrorOverviewSection({ errorOverview }: { errorOverview: CensusOverviewSummary['errorOverview'] }) {
  const { affectedMeasurements, totalActiveMeasurements, topErrorTypes, remainingErrorTypeCount } = errorOverview;
  if (totalActiveMeasurements === 0 || affectedMeasurements === 0) {
    return (
      <Typography level="body-md" color="neutral" data-testid="census-overview-error-overview">
        {totalActiveMeasurements === 0 ? CENSUS_OVERVIEW_TEXT.noMeasurementsYet : CENSUS_OVERVIEW_TEXT.noUnresolvedErrors}
      </Typography>
    );
  }

  const largestCount = topErrorTypes.reduce((largest, errorType) => Math.max(largest, errorType.count), 0);
  return (
    <Stack spacing={1} data-testid="census-overview-error-overview">
      <Typography level="body-md">{formatAffectedMeasurementsLine(affectedMeasurements, totalActiveMeasurements)}</Typography>
      <Stack direction="row" justifyContent="space-between">
        <Typography level="title-sm">{CENSUS_OVERVIEW_TEXT.topErrorTypesHeading}</Typography>
        <Typography level="body-xs" color="neutral">
          {CENSUS_OVERVIEW_TEXT.rowsColumnHeading}
        </Typography>
      </Stack>
      {topErrorTypes.map(errorType => (
        <Stack key={errorType.message} direction="row" alignItems="center" spacing={2} data-testid="census-overview-error-type-row">
          <Tooltip title={errorType.message} placement="top-start">
            <JoyLink
              component={Link}
              href={buildErrorsExplorerMessageHref(errorType.message)}
              level="body-sm"
              sx={{ flex: `0 1 ${MESSAGE_COLUMN_SHARE}`, minWidth: 0, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {errorType.message}
            </JoyLink>
          </Tooltip>
          <LinearProgress determinate value={largestCount > 0 ? (errorType.count / largestCount) * FULL_BAR_PERCENT : 0} sx={{ flex: 1 }} />
          <Typography level="body-sm" sx={{ minWidth: COUNT_COLUMN_MIN_WIDTH, textAlign: 'right' }}>
            {formatCount(errorType.count)}
          </Typography>
        </Stack>
      ))}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography level="body-sm" color="neutral">
          {remainingErrorTypeCount > 0 ? formatRemainingErrorTypes(remainingErrorTypeCount) : null}
        </Typography>
        <JoyLink component={Link} href={ERRORS_EXPLORER_VIEW_ALL_HREF} level="body-sm">
          {CENSUS_OVERVIEW_TEXT.viewAllErrors}
        </JoyLink>
      </Stack>
    </Stack>
  );
}

function ExportPreviewSection({ exportPreview }: { exportPreview: CensusOverviewSummary['exportPreview'] }) {
  const visibleReasons = exportPreview.skipReasons.filter(reason => reason.count > 0);
  return (
    <Stack spacing={0.5} data-testid="census-overview-export-preview">
      <Typography level="title-sm">{CENSUS_OVERVIEW_TEXT.exportPreviewHeading}</Typography>
      <Typography level="body-md">{formatExportPreviewCounts(exportPreview.exportableCount, exportPreview.skippedCount)}</Typography>
      {exportPreview.skippedCount > 0 && visibleReasons.length > 0 && (
        <Typography level="body-sm" color="neutral" data-testid="census-overview-skip-reasons">
          {`${CENSUS_OVERVIEW_TEXT.skipReasonsPrefix} ${visibleReasons.map(reason => formatSkipReason(reason.kind, reason.count)).join(CENSUS_OVERVIEW_TEXT.listSeparator)}`}
        </Typography>
      )}
      {exportPreview.exportedWithUnresolvedErrorCount > 0 && (
        <Typography level="body-sm" color="neutral">
          {formatExportedWithUnresolvedErrors(exportPreview.exportedWithUnresolvedErrorCount)}
        </Typography>
      )}
    </Stack>
  );
}

/** Facts for the publish decision: blockers, unresolved errors and what a publish would carry. No verdict. */
export default function ErrorsExportPreviewCard({ summary, isLoading, errorMessage, onRetry }: ErrorsExportPreviewCardProps) {
  return (
    <Card variant="outlined" data-testid="errors-export-preview-card">
      <CardContent sx={{ gap: 2 }}>
        <Typography level="title-lg" sx={{ fontWeight: 600 }}>
          {CENSUS_OVERVIEW_TEXT.errorsBoxTitle}
        </Typography>
        {errorMessage !== null ? (
          <Alert
            color="danger"
            variant="soft"
            endDecorator={
              <Button size="sm" variant="solid" color="danger" onClick={onRetry}>
                {CENSUS_OVERVIEW_TEXT.retry}
              </Button>
            }
          >
            {errorMessage}
          </Alert>
        ) : isLoading || summary === null ? (
          <ContentSkeleton kind="dashboard-card" />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {summary.blockers.length > 0 && <PublishBlockerCallout blockers={summary.blockers} />}
            <ErrorOverviewSection errorOverview={summary.errorOverview} />
            <Divider />
            <ExportPreviewSection exportPreview={summary.exportPreview} />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
