/**
 * Censuses Overview Component
 *
 * Displays a read-only informational grid of censuses for the selected plot.
 * Users must use the sidebar to make selections - these cards are for display only.
 */

'use client';

import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack, Avatar, LinearProgress, IconButton } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import { OrgCensusRDS, CensusDateRange } from '@/config/sqlrdsdefinitions/timekeeping';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TimelineIcon from '@mui/icons-material/Timeline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import GridOnIcon from '@mui/icons-material/GridOn';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import moment from 'moment';

// Gradient colors for census cards - time-based progression colors
const CENSUS_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', // Blue - newest
  'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', // Violet
  'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', // Cyan
  'linear-gradient(135deg, #10b981 0%, #059669 100%)', // Emerald
  'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', // Amber
  'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', // Red
  'linear-gradient(135deg, #64748b 0%, #475569 100%)', // Slate - oldest
  'linear-gradient(135deg, #78716c 0%, #57534e 100%)' // Stone
];

export interface CensusWithStats extends OrgCensusRDS {
  treeCount?: number;
  stemCount?: number;
  quadratsCovered?: number;
  totalQuadrats?: number;
}

export interface CensusesOverviewProps {
  censuses: (OrgCensusRDS | CensusWithStats)[];
  plotName?: string;
  siteName?: string;
  isLoading?: boolean;
  onCensusDelete?: (census: OrgCensusRDS | CensusWithStats) => void;
  onAddCensus?: () => void;
  onSelectCensus?: (census: OrgCensusRDS | CensusWithStats) => void;
}

function CensusCardSkeleton() {
  return <ContentSkeleton kind="dashboard-card" />;
}

// Determine census status based on date ranges
function getCensusStatus(dateRanges: CensusDateRange[]): 'completed' | 'in-progress' | 'planned' {
  if (!dateRanges || dateRanges.length === 0) return 'planned';

  const now = new Date();
  const hasStarted = dateRanges.some(range => range.startDate && new Date(range.startDate) <= now);
  const allCompleted = dateRanges.every(range => range.endDate && new Date(range.endDate) <= now);

  if (allCompleted) return 'completed';
  if (hasStarted) return 'in-progress';
  return 'planned';
}

// Format date range for display
function formatDateRange(dateRanges: CensusDateRange[]): string {
  if (!dateRanges || dateRanges.length === 0) return 'Dates not set';

  // Get earliest start and latest end across all ranges
  const starts = dateRanges.filter(r => r.startDate).map(r => new Date(r.startDate!));
  const ends = dateRanges.filter(r => r.endDate).map(r => new Date(r.endDate!));

  const earliestStart = starts.length > 0 ? new Date(Math.min(...starts.map(d => d.getTime()))) : null;
  const latestEnd = ends.length > 0 ? new Date(Math.max(...ends.map(d => d.getTime()))) : null;

  if (earliestStart && latestEnd) {
    return `${moment(earliestStart).format('MMM YYYY')} - ${moment(latestEnd).format('MMM YYYY')}`;
  } else if (earliestStart) {
    return `Started ${moment(earliestStart).format('MMM YYYY')}`;
  }

  return 'Dates not set';
}

// Calculate duration in months
function calculateDuration(dateRanges: CensusDateRange[]): string | null {
  if (!dateRanges || dateRanges.length === 0) return null;

  const starts = dateRanges.filter(r => r.startDate).map(r => new Date(r.startDate!));
  const ends = dateRanges.filter(r => r.endDate).map(r => new Date(r.endDate!));

  if (starts.length === 0) return null;

  const earliestStart = new Date(Math.min(...starts.map(d => d.getTime())));
  const latestEnd = ends.length > 0 ? new Date(Math.max(...ends.map(d => d.getTime()))) : new Date();

  const months = moment(latestEnd).diff(moment(earliestStart), 'months');

  if (months < 1) {
    const days = moment(latestEnd).diff(moment(earliestStart), 'days');
    return `${days} day${days !== 1 ? 's' : ''}`;
  } else if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  } else {
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    if (remainingMonths === 0) {
      return `${years} year${years !== 1 ? 's' : ''}`;
    }
    return `${years}y ${remainingMonths}m`;
  }
}

interface CensusCardProps {
  census: OrgCensusRDS | CensusWithStats;
  index: number;
  onDelete?: (census: OrgCensusRDS | CensusWithStats) => void;
  onSelect?: (census: OrgCensusRDS | CensusWithStats) => void;
}

function CensusCard({ census, index, onDelete, onSelect }: CensusCardProps) {
  const gradient = CENSUS_GRADIENTS[index % CENSUS_GRADIENTS.length];
  const status = getCensusStatus(census.dateRanges);
  const duration = calculateDuration(census.dateRanges);

  // Cast to CensusWithStats to access optional extended properties
  const censusStats = census as CensusWithStats;

  const StatusIcon = status === 'completed' ? CheckCircleIcon : status === 'in-progress' ? PlayCircleIcon : PendingIcon;

  const statusConfig = {
    completed: { label: 'Completed', color: 'rgba(34, 197, 94, 0.9)', bgColor: 'rgba(34, 197, 94, 0.2)' },
    'in-progress': { label: 'In Progress', color: 'rgba(251, 191, 36, 0.9)', bgColor: 'rgba(251, 191, 36, 0.2)' },
    planned: { label: 'Planned', color: 'rgba(148, 163, 184, 0.9)', bgColor: 'rgba(148, 163, 184, 0.2)' }
  };

  // Calculate progress if stats available
  const progressPercent =
    censusStats.quadratsCovered !== undefined && censusStats.totalQuadrats !== undefined && censusStats.totalQuadrats > 0
      ? Math.round((censusStats.quadratsCovered / censusStats.totalQuadrats) * 100)
      : null;

  return (
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <Card
      component={onSelect ? 'div' : 'article'}
      variant="solid"
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`Census ${census.plotCensusNumber}. Status: ${statusConfig[status].label}. ${formatDateRange(census.dateRanges)}.${census.description ? ` Description: ${census.description}.` : ''}${onSelect ? ' Click to select.' : ''}`}
      onClick={onSelect ? () => onSelect(census) : undefined}
      onKeyDown={
        onSelect
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(census);
              }
            }
          : undefined
      }
      sx={{
        background: `linear-gradient(90deg, transparent calc(100% - 13px), rgba(255,255,255,0.1) calc(100% - 13px), rgba(255,255,255,0.1) calc(100% - 10px), transparent calc(100% - 10px)), linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.1) 100%), ${gradient}`,
        color: 'white',
        minHeight: 180,
        overflow: 'hidden',
        border: 'none',
        ...(onSelect && {
          cursor: 'pointer',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          '&:hover': {
            transform: 'translateY(-3px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
          }
        })
      }}
    >
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Avatar
            alt=""
            sx={{
              bgcolor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              width: 48,
              height: 48,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              fontSize: '1.25rem',
              fontWeight: 700
            }}
          >
            {census.plotCensusNumber}
          </Avatar>

          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip
              size="sm"
              variant="soft"
              startDecorator={<StatusIcon sx={{ fontSize: 12 }} />}
              sx={{
                bgcolor: statusConfig[status].bgColor,
                color: statusConfig[status].color,
                fontWeight: 600,
                backdropFilter: 'blur(4px)',
                fontSize: '0.75rem'
              }}
            >
              {statusConfig[status].label}
            </Chip>
            {onDelete && (
              <IconButton
                size="sm"
                variant="soft"
                color="danger"
                onClick={e => {
                  e.stopPropagation();
                  onDelete(census);
                }}
                aria-label={`Delete census ${census.plotCensusNumber}`}
                sx={{
                  bgcolor: 'rgba(239, 68, 68, 0.5)',
                  color: 'rgba(255, 255, 255, 1)',
                  backdropFilter: 'blur(4px)',
                  '&:hover': {
                    bgcolor: 'rgba(239, 68, 68, 0.7)'
                  }
                }}
              >
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Stack>
        </Box>

        <Typography
          level="h4"
          sx={{
            fontWeight: 700,
            mb: 0.25,
            textShadow: '0 2px 4px rgba(0,0,0,0.1)',
            fontSize: '1.125rem'
          }}
        >
          Census {census.plotCensusNumber}
        </Typography>

        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
          <CalendarMonthIcon sx={{ fontSize: 12, opacity: 0.9 }} />
          <Typography
            level="body-xs"
            sx={{
              color: 'rgba(255,255,255,0.9)',
              fontWeight: 500
            }}
          >
            {formatDateRange(census.dateRanges)}
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="flex-start" spacing={0.5} sx={{ mb: 1 }}>
          <DescriptionIcon sx={{ fontSize: 10, opacity: census.description ? 0.8 : 0.5, mt: 0.25 }} />
          <Typography
            level="body-xs"
            sx={{
              color: census.description ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: '0.6875rem',
              fontStyle: census.description ? 'normal' : 'italic'
            }}
          >
            {census.description || 'No description'}
          </Typography>
        </Stack>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {duration && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(0,0,0,0.15)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: '0.625rem',
                height: 'auto',
                py: 0.25
              }}
              startDecorator={<ScheduleIcon sx={{ fontSize: 10 }} />}
            >
              {duration}
            </Chip>
          )}

          {census.dateRanges && census.dateRanges.length > 1 && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(0,0,0,0.15)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: '0.625rem',
                height: 'auto',
                py: 0.25
              }}
              startDecorator={<TimelineIcon sx={{ fontSize: 10 }} />}
            >
              {census.dateRanges.length} Periods
            </Chip>
          )}
        </Box>

        {/* Progress indicator if stats available */}
        {progressPercent !== null && (
          <Box sx={{ mt: 'auto' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
              <Typography level="body-xs" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.625rem' }}>
                Quadrat Coverage
              </Typography>
              <Typography level="body-xs" sx={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontSize: '0.625rem' }}>
                {progressPercent}%
              </Typography>
            </Stack>
            <LinearProgress
              determinate
              value={progressPercent}
              color={progressPercent >= 90 ? 'success' : 'primary'}
              sx={{
                bgcolor: 'rgba(0,0,0,0.2)',
                '--LinearProgress-thickness': '4px',
                '--LinearProgress-radius': '2px',
                '--LinearProgress-progressColor': progressPercent >= 90 ? 'rgba(34, 197, 94, 0.9)' : 'rgba(255,255,255,0.8)'
              }}
              aria-label={`Quadrat coverage: ${progressPercent}%`}
            />
          </Box>
        )}

        {/* Stats badges */}
        {(censusStats.treeCount !== undefined || censusStats.stemCount !== undefined) && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 'auto', pt: 0.5 }}>
            {censusStats.treeCount !== undefined && (
              <Chip
                size="sm"
                variant="soft"
                sx={{
                  bgcolor: 'rgba(255,255,255,0.95)',
                  color: gradient.includes('#3b82f6') ? '#2563eb' : '#059669',
                  fontWeight: 600,
                  fontSize: '0.625rem'
                }}
              >
                {censusStats.treeCount.toLocaleString()} Trees
              </Chip>
            )}
            {censusStats.stemCount !== undefined && (
              <Chip
                size="sm"
                variant="soft"
                sx={{
                  bgcolor: 'rgba(255,255,255,0.95)',
                  color: gradient.includes('#3b82f6') ? '#2563eb' : '#059669',
                  fontWeight: 600,
                  fontSize: '0.625rem'
                }}
              >
                {censusStats.stemCount.toLocaleString()} Stems
              </Chip>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

// Card for adding a new census
function AddCensusCard({ onAdd }: { onAdd: () => void }) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAdd();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <Box
      component="button"
      type="button"
      onClick={onAdd}
      onKeyDown={handleKeyDown}
      aria-label="Start a new census"
      sx={{
        minHeight: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '2px dashed',
        borderColor: 'neutral.outlinedBorder',
        bgcolor: 'transparent',
        borderRadius: 'sm',
        transition: 'all 0.2s ease',
        width: '100%',
        '&:hover, &:focus-visible': {
          borderColor: 'primary.500',
          bgcolor: 'primary.softBg',
          transform: 'translateY(-2px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          outline: 'none'
        }
      }}
    >
      <Stack alignItems="center" spacing={1.5}>
        <Avatar
          alt=""
          sx={{
            width: 56,
            height: 56,
            bgcolor: 'primary.softBg',
            color: 'primary.500'
          }}
        >
          <AddIcon sx={{ fontSize: 28 }} />
        </Avatar>
        <Typography level="title-md" sx={{ fontWeight: 600, color: 'primary.700' }}>
          Start New Census
        </Typography>
        <Typography level="body-sm" color="neutral">
          Begin a new measurement period
        </Typography>
      </Stack>
    </Box>
  );
}

// Grid layout styles shared across sections
const gridStyles = {
  display: 'grid',
  gridTemplateColumns: {
    xs: '1fr',
    sm: 'repeat(2, 1fr)',
    lg: 'repeat(3, 1fr)',
    xl: 'repeat(4, 1fr)'
  },
  gap: 2,
  listStyle: 'none',
  padding: 0,
  margin: 0
};

export default function CensusesOverview({
  censuses,
  plotName,
  siteName,
  isLoading = false,
  onCensusDelete,
  onAddCensus,
  onSelectCensus
}: CensusesOverviewProps) {
  if (isLoading) {
    return (
      <Box component="section" aria-label="Loading censuses" aria-busy="true" sx={gridStyles}>
        {Array.from({ length: 6 }).map((_, index) => (
          <CensusCardSkeleton key={index} />
        ))}
      </Box>
    );
  }

  if (!censuses || censuses.length === 0) {
    return (
      <Box component="section" aria-label="No censuses available">
        <Card
          variant="outlined"
          sx={{
            textAlign: 'center',
            py: 6,
            px: 3,
            mb: onAddCensus ? 3 : 0
          }}
        >
          <Avatar
            alt=""
            sx={{
              width: 64,
              height: 64,
              bgcolor: 'neutral.softBg',
              color: 'neutral.solidBg',
              margin: '0 auto',
              mb: 2
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 32 }} />
          </Avatar>
          <Typography level="h4" sx={{ mb: 1 }}>
            No Censuses Available
          </Typography>
          <Typography level="body-md" color="neutral">
            {plotName ? `${plotName} doesn't have any censuses recorded yet.` : "This plot doesn't have any censuses recorded yet."} Start a new census to begin
            collecting measurement data.
          </Typography>
        </Card>
        {onAddCensus && (
          <Box sx={gridStyles}>
            <AddCensusCard onAdd={onAddCensus} />
          </Box>
        )}
      </Box>
    );
  }

  // Sort censuses by census number (newest first)
  const sortedCensuses = [...censuses].sort((a, b) => b.plotCensusNumber - a.plotCensusNumber);

  return (
    <Box component="section" aria-label={plotName ? `Censuses for ${plotName}` : 'Available censuses'}>
      {(siteName || plotName) && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          {siteName && (
            <>
              <Chip size="sm" variant="soft" color="neutral">
                {siteName}
              </Chip>
              <Typography level="body-sm" color="neutral">
                /
              </Typography>
            </>
          )}
          {plotName && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <GridOnIcon sx={{ color: 'primary.500', fontSize: 18 }} />
              <Typography level="title-md" sx={{ fontWeight: 600 }}>
                {plotName}
              </Typography>
            </Stack>
          )}
          <Chip size="sm" variant="soft" color="primary">
            {censuses.length} {censuses.length === 1 ? 'Census' : 'Censuses'}
          </Chip>
        </Stack>
      )}

      <Box component="ul" sx={gridStyles}>
        {sortedCensuses.map((census, index) => (
          <Box component="li" key={census.plotCensusNumber ?? index}>
            <CensusCard census={census} index={index} onDelete={onCensusDelete} onSelect={onSelectCensus} />
          </Box>
        ))}
      </Box>

      {/* Add new census card - always shown at the end if callback is provided */}
      {onAddCensus && (
        <Box sx={{ mt: 3 }}>
          <Box sx={gridStyles}>
            <Box component="div">
              <AddCensusCard onAdd={onAddCensus} />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export { CensusCard, CensusCardSkeleton };
