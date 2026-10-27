'use client';

import React from 'react';
import { Box, Card, CardContent, Chip, Stack, Tooltip, Typography } from '@mui/joy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import { designTokens } from '@/config/design-tokens';

export interface QuadratCoverageCardProps {
  total: number;
  populated: number;
  percent: number;
  unpopulated: string[];
}

/**
 * Quadrat Coverage Card - Horizontal bar visualization
 */
export default function QuadratCoverageCard({ total, populated, percent, unpopulated }: QuadratCoverageCardProps) {
  const unpopulatedCount = unpopulated.filter(q => q.trim().length > 0).length;
  const isComplete = percent >= 100;
  const isNearComplete = percent >= 90;

  return (
    <Card
      variant="outlined"
      sx={{
        transition: 'all 0.3s ease',
        '&:hover': {
          boxShadow: designTokens.shadows.md,
          borderColor: isComplete ? 'success.outlinedBorder' : 'primary.outlinedBorder'
        }
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
          <Box>
            <Typography level="title-lg" sx={{ fontWeight: 600 }}>
              Quadrat Coverage
            </Typography>
            <Typography level="body-sm" color="neutral">
              Measurement completion across all quadrats
            </Typography>
          </Box>
          <Chip variant="soft" color={isComplete ? 'success' : isNearComplete ? 'primary' : 'warning'} size="lg" sx={{ fontWeight: 700 }}>
            {percent}%
          </Chip>
        </Stack>

        {/* Progress Bar Visualization */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', height: 32, borderRadius: 'md', overflow: 'hidden', bgcolor: 'neutral.100' }}>
            {/* Populated section */}
            <Box
              sx={{
                height: '100%',
                width: `${percent}%`,
                bgcolor: isComplete ? 'success.500' : isNearComplete ? 'success.400' : 'primary.500',
                transition: 'width 0.5s ease, background-color 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {percent > 15 && (
                <Typography level="body-xs" sx={{ color: 'white', fontWeight: 600 }}>
                  {populated} populated
                </Typography>
              )}
            </Box>

            {/* Unpopulated section label */}
            {percent < 85 && unpopulatedCount > 0 && (
              <Box
                sx={{
                  height: '100%',
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  pr: 1
                }}
              >
                <Typography level="body-xs" color="neutral">
                  {unpopulatedCount} remaining
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Stats Row */}
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Tooltip title="Quadrats with measurement data">
            <Chip variant="soft" color="success" startDecorator={<CheckCircleIcon sx={{ fontSize: 16 }} />}>
              {populated.toLocaleString()} with data
            </Chip>
          </Tooltip>
          <Tooltip title="Quadrats awaiting measurements">
            <Chip variant="soft" color="warning" startDecorator={<PendingIcon sx={{ fontSize: 16 }} />}>
              {unpopulatedCount.toLocaleString()} pending
            </Chip>
          </Tooltip>
          <Chip variant="outlined" color="neutral">
            {total.toLocaleString()} total
          </Chip>
        </Stack>

        {/* Unpopulated quadrat list (if small number) */}
        {unpopulatedCount > 0 && unpopulatedCount <= 12 && (
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography level="body-xs" color="neutral" sx={{ mb: 1 }}>
              Quadrats needing measurements:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {unpopulated
                .filter(q => q.trim().length > 0)
                .map((quadrat, idx) => (
                  <Chip key={idx} size="sm" variant="outlined" color="warning" sx={{ fontSize: '0.7rem' }}>
                    {quadrat}
                  </Chip>
                ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
