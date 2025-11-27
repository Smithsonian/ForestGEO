/**
 * Enhanced Progress Card Component
 *
 * Displays census progress with animated circular progress indicator
 * Shows populated vs unpopulated quadrats with visual hierarchy
 */

'use client';

import { Card, Box, Typography, CircularProgress, Chip, Stack, Tooltip, Skeleton } from '@mui/joy';
import { designTokens } from '@/config/design-tokens';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import React from 'react';

export interface ProgressCardProps {
  totalQuadrats: number;
  populatedQuadrats: number;
  populatedPercent: number | string;
  unpopulatedQuadrats: string[];
  isLoading?: boolean;
  onViewUnpopulated?: () => void;
}

function ProgressCard({ totalQuadrats, populatedQuadrats, populatedPercent, unpopulatedQuadrats, isLoading = false, onViewUnpopulated }: ProgressCardProps) {
  if (isLoading) {
    return <ProgressCardSkeleton />;
  }

  const percentValue = typeof populatedPercent === 'string' ? parseFloat(populatedPercent) : populatedPercent;
  const unpopulatedCount = unpopulatedQuadrats.filter(q => q.trim().length > 0).length;

  return (
    <Card
      variant="outlined"
      sx={{
        minHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        p: 3,
        transition: 'all 0.3s ease',
        '&:hover': {
          boxShadow: designTokens.shadows.md,
          borderColor: 'primary.outlinedBorder'
        }
      }}
    >
      <Box>
        <Typography level="h4" sx={{ mb: 0.5, fontWeight: 600 }}>
          Census Progress
        </Typography>
        <Typography level="body-sm" color="neutral">
          Quadrat measurement completion
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          my: 2
        }}
      >
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <CircularProgress
            determinate
            value={100}
            size="lg"
            sx={{
              '--CircularProgress-size': '180px',
              '--CircularProgress-trackThickness': '12px',
              '--CircularProgress-progressThickness': '12px',
              color: 'neutral.outlinedBorder',
              position: 'absolute'
            }}
          />

          <CircularProgress
            determinate
            value={percentValue}
            size="lg"
            sx={{
              '--CircularProgress-size': '180px',
              '--CircularProgress-trackThickness': '12px',
              '--CircularProgress-progressThickness': '12px',
              '--CircularProgress-progressColor': percentValue >= 90 ? 'var(--joy-palette-success-500)' : 'var(--joy-palette-primary-500)',
              '& .MuiCircularProgress-progress': {
                strokeLinecap: 'round',
                transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
                animation: 'progressAnimation 1s ease-out'
              },
              '@keyframes progressAnimation': {
                '0%': { strokeDashoffset: '100' },
                '100%': { strokeDashoffset: `${100 - percentValue}` }
              }
            }}
          />

          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column'
            }}
          >
            <Typography
              level="h1"
              sx={{
                fontWeight: 700,
                fontSize: '2.5rem',
                color: percentValue >= 90 ? 'success.500' : 'primary.500',
                lineHeight: 1
              }}
            >
              {percentValue}%
            </Typography>
            <Typography level="body-sm" color="neutral" sx={{ mt: 0.5 }}>
              Complete
            </Typography>
          </Box>
        </Box>
      </Box>

      <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
        <Tooltip title="Quadrats with measurements" arrow>
          <Chip
            variant="soft"
            color="success"
            size="lg"
            startDecorator={<CheckCircleIcon />}
            sx={{
              px: 2,
              py: 1,
              fontWeight: 600,
              fontSize: '0.875rem'
            }}
          >
            {populatedQuadrats.toLocaleString()} / {totalQuadrats.toLocaleString()}
          </Chip>
        </Tooltip>

        {unpopulatedCount > 0 && (
          <Tooltip title="Quadrats without measurements" arrow>
            {onViewUnpopulated ? (
              <button
                type="button"
                onClick={onViewUnpopulated}
                aria-label={`View ${unpopulatedCount} unpopulated quadrats`}
                style={{
                  all: 'unset',
                  cursor: 'pointer'
                }}
              >
                <Chip
                  variant="soft"
                  color="warning"
                  size="lg"
                  startDecorator={<PendingIcon />}
                  sx={{
                    px: 2,
                    py: 1,
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: designTokens.shadows.sm
                    }
                  }}
                >
                  {unpopulatedCount} Pending
                </Chip>
              </button>
            ) : (
              <Chip
                variant="soft"
                color="warning"
                size="lg"
                startDecorator={<PendingIcon />}
                sx={{
                  px: 2,
                  py: 1,
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}
              >
                {unpopulatedCount} Pending
              </Chip>
            )}
          </Tooltip>
        )}
      </Stack>

      {unpopulatedCount > 0 && unpopulatedCount <= 10 && (
        <Box sx={{ mt: 1 }}>
          <Typography level="body-xs" color="neutral" sx={{ mb: 1 }}>
            Unpopulated quadrats:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {unpopulatedQuadrats
              .filter(q => q.trim().length > 0)
              .map((quadrat, index) => (
                <Chip key={index} variant="outlined" size="sm" sx={{ fontSize: '0.75rem' }}>
                  {quadrat}
                </Chip>
              ))}
          </Box>
        </Box>
      )}
    </Card>
  );
}

// Memoize ProgressCard to prevent unnecessary re-renders
export default React.memo(ProgressCard, (prevProps, nextProps) => {
  // Custom comparison function for optimal performance
  return (
    prevProps.totalQuadrats === nextProps.totalQuadrats &&
    prevProps.populatedQuadrats === nextProps.populatedQuadrats &&
    prevProps.populatedPercent === nextProps.populatedPercent &&
    prevProps.isLoading === nextProps.isLoading &&
    JSON.stringify(prevProps.unpopulatedQuadrats) === JSON.stringify(nextProps.unpopulatedQuadrats) &&
    prevProps.onViewUnpopulated === nextProps.onViewUnpopulated
  );
});

/**
 * Skeleton loader for progress card
 */
export function ProgressCardSkeleton() {
  return (
    <Card
      variant="outlined"
      sx={{
        minHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        p: 3,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
          animation: 'shimmer 2s infinite',
          pointerEvents: 'none'
        },
        '@keyframes shimmer': {
          '0%': { left: '-100%' },
          '100%': { left: '100%' }
        }
      }}
    >
      <Box>
        <Skeleton
          variant="text"
          width="60%"
          height={28}
          sx={{
            mb: 1,
            opacity: 0.3,
            backgroundColor: 'neutral.200'
          }}
        />
        <Skeleton
          variant="text"
          width="80%"
          height={20}
          sx={{
            opacity: 0.25,
            backgroundColor: 'neutral.200'
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
        <Skeleton
          variant="circular"
          width={180}
          height={180}
          sx={{
            opacity: 0.3,
            backgroundColor: 'neutral.200'
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        <Skeleton
          variant="rectangular"
          width={120}
          height={36}
          sx={{
            borderRadius: 'sm',
            opacity: 0.25,
            backgroundColor: 'neutral.200'
          }}
        />
        <Skeleton
          variant="rectangular"
          width={100}
          height={36}
          sx={{
            borderRadius: 'sm',
            opacity: 0.25,
            backgroundColor: 'neutral.200'
          }}
        />
      </Box>
    </Card>
  );
}
