'use client';

import React from 'react';
import { Box, Card, CardContent, Divider, Stack, Tooltip, Typography } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import { CENSUS_OVERVIEW_TEXT, formatCount, formatStemsPerTree, TREES_AND_STEMS_ROWS } from '@/config/censusoverview';
import { FIRST_CENSUS_RECRUITS_SUBTITLE, INCOMPARABLE_METRIC_PLACEHOLDER, INCOMPARABLE_METRIC_TOOLTIP, type CensusStatsViewProps } from './censusstatsview';

export type TreesAndStemsCardProps = Pick<CensusStatsViewProps, 'countTrees' | 'countStems' | 'stemTypes' | 'isLoading'>;

interface StemCountRowProps {
  label: string;
  description: string;
  /** null = no previous census to compare against. */
  value: number | null;
  subtitle?: string;
}

function StemCountRow({ label, description, value, subtitle }: StemCountRowProps) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} data-testid="trees-and-stems-row">
      {/* describeChild keeps the label as the accessible name; the description is supplementary. */}
      <Tooltip title={description} placement="top-start" describeChild>
        <Typography level="body-md">{label}</Typography>
      </Tooltip>
      <Box sx={{ textAlign: 'right' }}>
        {value === null ? (
          <Tooltip title={INCOMPARABLE_METRIC_TOOLTIP}>
            <Typography level="title-md">{INCOMPARABLE_METRIC_PLACEHOLDER}</Typography>
          </Tooltip>
        ) : (
          <Typography level="title-md">{formatCount(value)}</Typography>
        )}
        {subtitle && (
          <Typography level="body-xs" color="neutral">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/** Trees, stems and the three stem classifications. The rows are not parts of the stem total. */
export default function TreesAndStemsCard({ countTrees, countStems, stemTypes, isLoading = false }: TreesAndStemsCardProps) {
  return (
    <Card variant="outlined" data-testid="trees-and-stems-card">
      <CardContent sx={{ gap: 2 }}>
        <Typography level="title-lg" sx={{ fontWeight: 600 }}>
          {CENSUS_OVERVIEW_TEXT.treesAndStemsTitle}
        </Typography>
        {isLoading ? (
          <ContentSkeleton kind="dashboard-card" />
        ) : (
          <>
            <Stack direction="row" spacing={4}>
              <Box>
                <Typography level="h2" sx={{ fontWeight: 700 }}>
                  {formatCount(countTrees)}
                </Typography>
                <Typography level="body-sm" color="neutral">
                  {CENSUS_OVERVIEW_TEXT.treesUnit}
                </Typography>
              </Box>
              <Box>
                <Typography level="h2" sx={{ fontWeight: 700 }}>
                  {formatCount(countStems)}
                </Typography>
                <Typography level="body-sm" color="neutral">
                  {CENSUS_OVERVIEW_TEXT.stemsUnit}
                </Typography>
                <Typography level="body-xs" color="neutral">
                  {`${formatStemsPerTree(countTrees, countStems)} ${CENSUS_OVERVIEW_TEXT.stemsPerTreeSuffix}`}
                </Typography>
              </Box>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <StemCountRow {...TREES_AND_STEMS_ROWS.previouslyMeasuredStems} value={stemTypes.CountOldStems} />
              <StemCountRow
                {...TREES_AND_STEMS_ROWS.newRecruitStems}
                value={stemTypes.CountNewRecruits}
                subtitle={stemTypes.isFirstCensus ? FIRST_CENSUS_RECRUITS_SUBTITLE : undefined}
              />
              <StemCountRow {...TREES_AND_STEMS_ROWS.multiStemTrees} value={stemTypes.CountMultiStems} />
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
