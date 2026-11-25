'use client';

import React from 'react';
import { Alert, Button, Card, CircularProgress, LinearProgress, Stack, Typography } from '@mui/joy';
import { formatCount, toBarPercent } from '@/config/censusoverview';
import {
  ERROR_TILE_TEXT,
  formatAffectedTileCaption,
  formatAffectedTileUnit,
  formatContradictionCaption,
  VIEW_ERRORS_TEXT,
  type ErrorCensusTotals
} from '@/config/errorsexplorer';
import type { ErrorsExplorerRequestStatus } from '@/app/hooks/useerrorsexplorerrequest';

export interface ErrorsTotalsTilesProps {
  totals: ErrorCensusTotals | null;
  status: ErrorsExplorerRequestStatus;
  isStale: boolean;
  onRetry: () => void;
}

function TileNumber({ value, loading, label }: { value: number | undefined; loading: boolean; label: string }) {
  if (loading) return <CircularProgress size="sm" aria-label={`${VIEW_ERRORS_TEXT.loadingTotals}: ${label}`} />;
  return <Typography level="h3">{value === undefined ? VIEW_ERRORS_TEXT.unavailable : formatCount(value)}</Typography>;
}

function Tile({
  testID,
  label,
  value,
  loading,
  unit,
  caption,
  children
}: {
  testID: string;
  label: string;
  value: number | undefined;
  loading: boolean;
  unit?: string;
  caption?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Card variant="soft" data-testid={testID} sx={{ flex: 1, minWidth: 0 }}>
      <Typography level="body-xs">{label}</Typography>
      <Stack direction="row" spacing={0.75} alignItems="baseline">
        <TileNumber value={value} loading={loading} label={label} />
        {unit && !loading && value !== undefined && <Typography level="body-sm">{unit}</Typography>}
      </Stack>
      {children}
      {caption && !loading && value !== undefined && <Typography level="body-xs">{caption}</Typography>}
    </Card>
  );
}

export default function ErrorsTotalsTiles({ totals, status, isStale, onRetry }: ErrorsTotalsTilesProps) {
  const loading = totals === null && status !== 'error';
  const retry = (
    <Button size="sm" variant="soft" onClick={onRetry}>
      {VIEW_ERRORS_TEXT.retry}
    </Button>
  );
  return (
    <Stack spacing={1}>
      {totals === null && status === 'error' && (
        <Alert color="danger" role="alert" endDecorator={retry}>
          {VIEW_ERRORS_TEXT.totalsLoadFailed}
        </Alert>
      )}
      {totals !== null && isStale && (
        <Alert color="warning" role="alert" endDecorator={retry}>
          {VIEW_ERRORS_TEXT.totalsStale}
        </Alert>
      )}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <Tile
          testID="errors-tile-affected"
          label={ERROR_TILE_TEXT.affected.label}
          value={totals?.affectedMeasurements}
          loading={loading}
          unit={totals ? formatAffectedTileUnit(totals.activeMeasurements) : undefined}
          caption={totals ? formatAffectedTileCaption(totals.affectedMeasurements, totals.activeMeasurements) : null}
        >
          {totals && <LinearProgress determinate value={toBarPercent(totals.affectedMeasurements, totals.activeMeasurements)} sx={{ my: 0.5 }} />}
        </Tile>
        <Tile
          testID="errors-tile-validation"
          label={ERROR_TILE_TEXT.validation.label}
          value={totals?.validation}
          loading={loading}
          unit={ERROR_TILE_TEXT.validation.unit}
          caption={ERROR_TILE_TEXT.validation.caption}
        />
        <Tile
          testID="errors-tile-failed"
          label={ERROR_TILE_TEXT.failed.label}
          value={totals?.failedMeasurements}
          loading={loading}
          unit={ERROR_TILE_TEXT.failed.unit}
          caption={ERROR_TILE_TEXT.failed.caption}
        />
        <Tile
          testID="errors-tile-contradictions"
          label={ERROR_TILE_TEXT.contradictions.label}
          value={totals?.contradictions}
          loading={loading}
          unit={ERROR_TILE_TEXT.contradictions.unit}
          caption={totals ? formatContradictionCaption(totals.duplicateTagStem, totals.sameBatchConflict) : null}
        />
      </Stack>
    </Stack>
  );
}
