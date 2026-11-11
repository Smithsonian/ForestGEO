'use client';

import React from 'react';
import { Box, Card, LinearProgress, Tooltip, Typography } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import {
  CENSUS_OVERVIEW_TEXT,
  formatCount,
  formatPercentOf,
  formatShareOfActive,
  formatStemsPerTree,
  toBarPercent,
  TREES_AND_STEMS_ROWS,
  type CensusOverviewSummary
} from '@/config/censusoverview';
import { FIRST_CENSUS_RECRUITS_SUBTITLE, INCOMPARABLE_METRIC_TOOLTIP, type CensusStatsViewProps } from './censusstatsview';

const STAT_TILE_MIN_WIDTH_PX = 220;
const FULL_COVERAGE_DISPLAY = '100%';

export interface CensusStatTilesProps extends Pick<CensusStatsViewProps, 'countTrees' | 'countStems' | 'stemTypes'> {
  isMetricsLoading: boolean;
  quadrats: { total: number; populated: number };
  errorOverview: CensusOverviewSummary['errorOverview'] | null;
  /** True while a scoped summary request is in flight; the errors tile is hidden when false and errorOverview is null. */
  isErrorOverviewLoading: boolean;
}

interface DetailSegment {
  text: string;
  description?: string;
}

interface StatTileProps {
  testId: string;
  label: string;
  value: number;
  total?: number;
  valueColor?: 'warning';
  bar?: { percent: number; color: 'success' | 'warning' };
  detail: DetailSegment[];
  isLoading: boolean;
}

function DetailLine({ segments }: { segments: DetailSegment[] }) {
  return (
    <Typography level="body-sm">
      {segments.map((segment, index) => (
        <React.Fragment key={segment.text}>
          {index > 0 && CENSUS_OVERVIEW_TEXT.listSeparator}
          {segment.description ? (
            <Tooltip title={segment.description} placement="top-start" describeChild>
              <span>{segment.text}</span>
            </Tooltip>
          ) : (
            <span>{segment.text}</span>
          )}
        </React.Fragment>
      ))}
    </Typography>
  );
}

function StatTile({ testId, label, value, total, valueColor, bar, detail, isLoading }: StatTileProps) {
  return (
    <Card variant="outlined" data-testid={testId} sx={{ gap: 0.75 }}>
      <Typography level="body-sm" color="neutral">
        {label}
      </Typography>
      {isLoading ? (
        <ContentSkeleton kind="dashboard-card" />
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography level="h2" component="p" color={valueColor}>
              {formatCount(value)}
            </Typography>
            {total !== undefined && (
              <Typography level="body-md" color="neutral">
                {`${CENSUS_OVERVIEW_TEXT.ofTotalPrefix} ${formatCount(total)}`}
              </Typography>
            )}
          </Box>
          {bar && <LinearProgress determinate value={bar.percent} color={bar.color} aria-label={label} />}
          <DetailLine segments={detail} />
        </>
      )}
    </Card>
  );
}

/** Census totals: trees, stems, quadrat coverage and affected measurements. Facts only, no verdict. */
export default function CensusStatTiles({
  countTrees,
  countStems,
  stemTypes,
  isMetricsLoading,
  quadrats,
  errorOverview,
  isErrorOverviewLoading
}: CensusStatTilesProps) {
  const treesDetail: DetailSegment[] = [
    { text: `${formatStemsPerTree(countTrees, countStems)} ${CENSUS_OVERVIEW_TEXT.stemsPerTreeSuffix}` },
    { text: `${formatCount(stemTypes.CountMultiStems)} ${CENSUS_OVERVIEW_TEXT.multiStemSuffix}`, description: TREES_AND_STEMS_ROWS.multiStemTrees.description }
  ];
  const stemsDetail: DetailSegment[] = [
    stemTypes.CountOldStems === null
      ? { text: CENSUS_OVERVIEW_TEXT.noPreviousCensus, description: INCOMPARABLE_METRIC_TOOLTIP }
      : {
          text: `${formatCount(stemTypes.CountOldStems)} ${CENSUS_OVERVIEW_TEXT.previouslyMeasuredSuffix}`,
          description: TREES_AND_STEMS_ROWS.previouslyMeasuredStems.description
        },
    {
      text: `${formatCount(stemTypes.CountNewRecruits)} ${CENSUS_OVERVIEW_TEXT.newRecruitsSuffix}`,
      description: stemTypes.isFirstCensus ? FIRST_CENSUS_RECRUITS_SUBTITLE : TREES_AND_STEMS_ROWS.newRecruitStems.description
    }
  ];
  const unmeasuredQuadrats = Math.max(quadrats.total - quadrats.populated, 0);
  const quadratsDetail: DetailSegment[] =
    quadrats.total > 0
      ? [
          { text: formatPercentOf(quadrats.populated, quadrats.total) ?? FULL_COVERAGE_DISPLAY },
          { text: `${formatCount(unmeasuredQuadrats)} ${CENSUS_OVERVIEW_TEXT.notYetMeasuredSuffix}` }
        ]
      : [{ text: CENSUS_OVERVIEW_TEXT.noQuadrats }];
  const showErrorsTile = errorOverview !== null || isErrorOverviewLoading;

  return (
    <Box
      component="section"
      aria-label={CENSUS_OVERVIEW_TEXT.censusTotalsLabel}
      sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${STAT_TILE_MIN_WIDTH_PX}px, 1fr))`, gap: 1.5 }}
    >
      <StatTile
        testId="census-stat-tile-trees"
        label={CENSUS_OVERVIEW_TEXT.treesTileLabel}
        value={countTrees}
        detail={treesDetail}
        isLoading={isMetricsLoading}
      />
      <StatTile
        testId="census-stat-tile-stems"
        label={CENSUS_OVERVIEW_TEXT.stemsTileLabel}
        value={countStems}
        detail={stemsDetail}
        isLoading={isMetricsLoading}
      />
      <StatTile
        testId="census-stat-tile-quadrats"
        label={CENSUS_OVERVIEW_TEXT.quadratsTileLabel}
        value={quadrats.populated}
        total={quadrats.total}
        bar={{ percent: toBarPercent(quadrats.populated, quadrats.total), color: 'success' }}
        detail={quadratsDetail}
        isLoading={isMetricsLoading}
      />
      {showErrorsTile && (
        <StatTile
          testId="census-stat-tile-errors"
          label={CENSUS_OVERVIEW_TEXT.errorsTileLabel}
          value={errorOverview?.affectedMeasurements ?? 0}
          total={errorOverview?.totalActiveMeasurements}
          valueColor="warning"
          bar={{ percent: toBarPercent(errorOverview?.affectedMeasurements ?? 0, errorOverview?.totalActiveMeasurements ?? 0), color: 'warning' }}
          detail={[
            {
              text: `${formatShareOfActive(errorOverview?.affectedMeasurements ?? 0, errorOverview?.totalActiveMeasurements ?? 0)} ${CENSUS_OVERVIEW_TEXT.ofActiveMeasurementsSuffix}`
            }
          ]}
          isLoading={errorOverview === null}
        />
      )}
    </Box>
  );
}
