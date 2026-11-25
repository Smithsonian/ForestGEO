'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Card, Link as JoyLink, Stack, Table, Typography } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import {
  CENSUS_OVERVIEW_TEXT,
  formatAffectedOfActive,
  formatCount,
  formatErrorTypesFootnote,
  formatShareOfActive,
  formatShareOfActiveHeading,
  type CensusOverviewSummary
} from '@/config/censusoverview';
import { buildErrorsExplorerMessageHref, ERRORS_EXPLORER_VIEW_ALL_HREF } from '@/config/errorsexplorer';

const HEADING_ID = 'census-overview-validation-errors-heading';
const ROWS_COLUMN_WIDTH_PX = 64;
const SHARE_COLUMN_WIDTH_PX = 140;

export interface ValidationErrorsCardProps {
  /** null while the summary loads. */
  errorOverview: CensusOverviewSummary['errorOverview'] | null;
}

function ErrorTypesTable({ errorOverview }: { errorOverview: CensusOverviewSummary['errorOverview'] }) {
  const { totalActiveMeasurements, topErrorTypes } = errorOverview;
  return (
    <Table size="sm" sx={{ '& th, & td': { verticalAlign: 'top' } }}>
      <thead>
        <tr>
          <th>{CENSUS_OVERVIEW_TEXT.errorTypeColumnHeading}</th>
          <th style={{ width: ROWS_COLUMN_WIDTH_PX, textAlign: 'right' }}>{CENSUS_OVERVIEW_TEXT.errorRowsColumnHeading}</th>
          <th style={{ width: SHARE_COLUMN_WIDTH_PX, textAlign: 'right' }}>{formatShareOfActiveHeading(totalActiveMeasurements)}</th>
        </tr>
      </thead>
      <tbody>
        {topErrorTypes.map(errorType => (
          <tr key={errorType.message} data-testid="census-overview-error-type-row">
            <td style={{ whiteSpace: 'normal' }}>
              <JoyLink component={Link} href={buildErrorsExplorerMessageHref(errorType.message)} level="body-sm">
                {errorType.message}
              </JoyLink>
            </td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCount(errorType.count)}</td>
            <td style={{ textAlign: 'right' }}>{formatShareOfActive(errorType.count, totalActiveMeasurements)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ErrorOverviewBody({ errorOverview }: { errorOverview: CensusOverviewSummary['errorOverview'] }) {
  const { affectedMeasurements, totalActiveMeasurements, remainingErrorTypeCount } = errorOverview;
  if (affectedMeasurements === 0) {
    return (
      <Typography level="body-md" color="neutral" data-testid="census-overview-error-overview">
        {totalActiveMeasurements === 0 ? CENSUS_OVERVIEW_TEXT.noMeasurementsYet : CENSUS_OVERVIEW_TEXT.noUnresolvedErrors}
      </Typography>
    );
  }
  return (
    <Stack spacing={1.5} data-testid="census-overview-error-overview">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography level="h3" component="p" color="warning">
          {formatCount(affectedMeasurements)}
        </Typography>
        <Typography level="body-md">{formatAffectedOfActive(affectedMeasurements, totalActiveMeasurements)}</Typography>
      </Box>
      <ErrorTypesTable errorOverview={errorOverview} />
      <Typography level="body-sm" color="neutral">
        {formatErrorTypesFootnote(remainingErrorTypeCount)}
      </Typography>
    </Stack>
  );
}

/** Unresolved validation errors for the census: how many measurements, and which error types. */
export default function ValidationErrorsCard({ errorOverview }: ValidationErrorsCardProps) {
  return (
    <Card variant="outlined" component="section" aria-labelledby={HEADING_ID} data-testid="validation-errors-card" sx={{ gap: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={2}>
        <Typography id={HEADING_ID} level="title-lg" component="h2">
          {CENSUS_OVERVIEW_TEXT.validationErrorsTitle}
        </Typography>
        <JoyLink component={Link} href={ERRORS_EXPLORER_VIEW_ALL_HREF} level="body-sm" sx={{ whiteSpace: 'nowrap' }}>
          {CENSUS_OVERVIEW_TEXT.viewAllErrors}
        </JoyLink>
      </Stack>
      {errorOverview === null ? <ContentSkeleton kind="dashboard-card" /> : <ErrorOverviewBody errorOverview={errorOverview} />}
    </Card>
  );
}
