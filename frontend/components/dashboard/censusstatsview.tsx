/**
 * Census Statistics View Component
 *
 * Enhanced dashboard view showing detailed census statistics
 * Organized into logical groupings:
 * - Core Counts (Trees, Stems)
 * - Tree-Stem States (Old Trees, New Recruits, Multi-Stems)
 * - Census Coverage (Quadrat progress)
 * - Personnel (Active census personnel)
 */

'use client';

import React from 'react';
import { Box, Card, CardContent, Typography, Stack, Chip, Avatar, Tooltip } from '@mui/joy';
import { designTokens } from '@/config/design-tokens';
import ParkIcon from '@mui/icons-material/Park';
import NatureIcon from '@mui/icons-material/Nature';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import HistoryIcon from '@mui/icons-material/History';
import PeopleIcon from '@mui/icons-material/People';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import MetricCard from './metriccard';

export interface CensusStatsViewProps {
  // Core counts
  countTrees: number;
  countStems: number;

  // Stem type breakdown
  stemTypes: {
    CountOldStems: number;
    CountMultiStems: number;
    CountNewRecruits: number;
  };

  // Quadrat coverage
  progressTacho: {
    TotalQuadrats: number;
    PopulatedQuadrats: number;
    PopulatedPercent: number;
    UnpopulatedQuadrats: string[];
  };

  // Personnel
  activeUsers: number;

  // Loading state
  isLoading?: boolean;
}

/**
 * Stat Card - Smaller card for grouped statistics
 */
interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'success' | 'primary' | 'warning' | 'neutral' | 'danger';
  subtitle?: string;
}

function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  return (
    <Card
      variant="soft"
      color={color}
      sx={{
        flex: 1,
        minWidth: 140,
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: designTokens.shadows.sm
        }
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar size="sm" color={color} variant="soft" alt={title}>
            {icon}
          </Avatar>
          <Box>
            <Typography level="body-xs" color="neutral" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {title}
            </Typography>
            <Typography level="h3" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {value.toLocaleString()}
            </Typography>
            {subtitle && (
              <Typography level="body-xs" color="neutral">
                {subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Section Header
 */
function SectionHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
      <Avatar color="primary" variant="soft" size="sm" alt={title}>
        {icon}
      </Avatar>
      <Box>
        <Typography level="title-lg" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography level="body-sm" color="neutral">
          {subtitle}
        </Typography>
      </Box>
    </Stack>
  );
}

/**
 * Quadrat Coverage Card - Horizontal bar visualization
 */
function QuadratCoverageCard({ total, populated, percent, unpopulated }: { total: number; populated: number; percent: number; unpopulated: string[] }) {
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
          <Box sx={{ position: 'relative', height: 32, borderRadius: 'md', overflow: 'hidden', bgcolor: 'neutral.100' }}>
            {/* Populated section */}
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
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
                  position: 'absolute',
                  right: 8,
                  top: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center'
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

/**
 * Personnel Card
 */
function PersonnelCard({ activeCount }: { activeCount: number }) {
  return (
    <Card
      variant="outlined"
      sx={{
        transition: 'all 0.3s ease',
        '&:hover': {
          boxShadow: designTokens.shadows.md,
          borderColor: 'info.outlinedBorder'
        }
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar color="primary" variant="soft" size="lg" alt="Active Personnel">
            <PeopleIcon />
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography level="body-xs" color="neutral" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active Personnel
            </Typography>
            <Typography level="h2" sx={{ fontWeight: 700 }}>
              {activeCount.toLocaleString()}
            </Typography>
            <Typography level="body-sm" color="neutral">
              {activeCount === 1 ? 'person' : 'people'} assigned to this census
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Main Census Stats View Component
 */
export default function CensusStatsView({ countTrees, countStems, stemTypes, progressTacho, activeUsers, isLoading = false }: CensusStatsViewProps) {
  const stemsPerTree = countTrees > 0 ? (countStems / countTrees).toFixed(1) : '0';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Section 1: Core Counts - Trees & Stems */}
      <Box>
        <SectionHeader title="Core Counts" subtitle="Total trees and stems in this census" icon={<ParkIcon />} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            gap: 2
          }}
        >
          <MetricCard
            title="Total Trees"
            value={countTrees}
            icon={<ParkIcon sx={{ fontSize: 28 }} />}
            gradient="primary"
            isLoading={isLoading}
            trend={{
              value: 'Unique tagged trees',
              direction: 'neutral'
            }}
          />
          <MetricCard
            title="Total Stems"
            value={countStems}
            icon={<NatureIcon sx={{ fontSize: 28 }} />}
            gradient="success"
            isLoading={isLoading}
            trend={{
              value: `${stemsPerTree} stems per tree`,
              direction: 'neutral'
            }}
          />
        </Box>
      </Box>

      {/* Section 2: Tree-Stem States */}
      <Box>
        <SectionHeader title="Tree-Stem Classification" subtitle="Breakdown by measurement history" icon={<AccountTreeIcon />} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap: 2
          }}
        >
          <StatCard
            title="Old Trees"
            value={stemTypes.CountOldStems}
            icon={<HistoryIcon sx={{ fontSize: 18 }} />}
            color="neutral"
            subtitle="Previously measured"
          />
          <StatCard
            title="New Recruits"
            value={stemTypes.CountNewRecruits}
            icon={<FiberNewIcon sx={{ fontSize: 18 }} />}
            color="success"
            subtitle="First-time measurements"
          />
          <StatCard
            title="Multi-Stems"
            value={stemTypes.CountMultiStems}
            icon={<AccountTreeIcon sx={{ fontSize: 18 }} />}
            color="primary"
            subtitle="Trees with multiple stems"
          />
        </Box>
      </Box>

      {/* Section 3: Census Coverage & Personnel */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          gap: 3
        }}
      >
        {/* Quadrat Coverage */}
        <QuadratCoverageCard
          total={progressTacho.TotalQuadrats}
          populated={progressTacho.PopulatedQuadrats}
          percent={progressTacho.PopulatedPercent}
          unpopulated={progressTacho.UnpopulatedQuadrats}
        />

        {/* Personnel */}
        <PersonnelCard activeCount={activeUsers} />
      </Box>
    </Box>
  );
}
