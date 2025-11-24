/**
 * Enhanced Dashboard Page
 *
 * Modern, visually engaging dashboard with:
 * - Gradient metric cards
 * - Animated progress indicators
 * - Skeleton loaders
 * - Responsive grid layout
 * - Toast notifications
 */

'use client';

import { Box, Typography, Stack, Card, CardContent, Alert, Chip, Avatar } from '@mui/joy';
import { useSession } from 'next-auth/react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useCallback, useEffect, useState } from 'react';
import { UnifiedChangelogRDS } from '@/config/sqlrdsdefinitions/core';
import moment from 'moment';
import ailogger from '@/ailogger';

// Enhanced Components
import MetricCard from '@/components/dashboard/metriccard';
import ProgressCard, { ProgressCardSkeleton } from '@/components/dashboard/progresscard';
import { designTokens } from '@/config/design-tokens';

// Icons
import NatureIcon from '@mui/icons-material/Nature';
import ParkIcon from '@mui/icons-material/Park';
import PeopleIcon from '@mui/icons-material/People';
import CategoryIcon from '@mui/icons-material/Category';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';

interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

interface StemTypesType {
  CountOldStems: number;
  CountMultiStems: number;
  CountNewRecruits: number;
}

export default function EnhancedDashboardPage() {
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const userName = session?.user?.name;

  const [changelogHistory, setChangelogHistory] = useState<UnifiedChangelogRDS[]>(Array(5));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressTacho, setProgressTacho] = useState<ProgressTachoType>({
    TotalQuadrats: 0,
    PopulatedPercent: 0,
    PopulatedQuadrats: 0,
    UnpopulatedQuadrats: []
  });
  const [activeUsers, setActiveUsers] = useState(0);
  const [countStems, setCountStems] = useState(0);
  const [countTrees, setCountTrees] = useState(0);
  const [stemTypes, setStemTypes] = useState<StemTypesType>({
    CountOldStems: 0,
    CountMultiStems: 0,
    CountNewRecruits: 0
  });

  /**
   * Aggregated Dashboard Metrics Loader
   */
  const loadAllDashboardMetrics = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges[0].censusID) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dashboardmetrics/all/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`);

      if (!response.ok) {
        throw new Error(`Failed to load dashboard data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      setProgressTacho({
        TotalQuadrats: data.progressTachometer.TotalQuadrats,
        PopulatedQuadrats: data.progressTachometer.PopulatedQuadrats,
        PopulatedPercent: data.progressTachometer.PopulatedPercent,
        UnpopulatedQuadrats: data.progressTachometer.UnpopulatedQuadrats ? data.progressTachometer.UnpopulatedQuadrats.split(';') : []
      });

      setActiveUsers(data.activeUsers.CountActiveUsers);
      setCountTrees(data.countTrees.CountTrees);
      setCountStems(data.countStems.CountStems);
      setStemTypes({
        CountOldStems: data.stemTypes.CountOldStems,
        CountMultiStems: data.stemTypes.CountMultiStems,
        CountNewRecruits: data.stemTypes.CountNewRecruits
      });

      ailogger.info('Dashboard metrics loaded successfully via aggregated API');
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load dashboard data. Please try again.';
      setError(errorMessage);
      ailogger.error('Aggregated dashboard metrics error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currentSite, currentPlot, currentCensus]);

  const loadChangelogHistory = useCallback(async () => {
    try {
      if (!currentSite || !currentPlot || !currentCensus) {
        setChangelogHistory(Array(5).fill({}));
        return;
      }
      const response = await fetch(
        `/api/changelog/overview/unifiedchangelog/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}?schema=${currentSite?.schemaName}`,
        { method: 'GET' }
      );
      const results: UnifiedChangelogRDS[] = await response.json();
      const paddedResults = [...results];
      while (paddedResults.length < 5) {
        paddedResults.push({});
      }
      setChangelogHistory(paddedResults);
    } catch (error: any) {
      ailogger.error('Failed to load changelog history', error);
      setChangelogHistory(Array(5).fill({}));
    }
  }, [currentSite, currentPlot, currentCensus]);

  // Reset data when contexts are cleared
  useEffect(() => {
    if (!currentSite || !currentPlot || !currentCensus) {
      setProgressTacho({
        TotalQuadrats: 0,
        PopulatedPercent: 0,
        PopulatedQuadrats: 0,
        UnpopulatedQuadrats: []
      });
      setActiveUsers(0);
      setCountStems(0);
      setCountTrees(0);
      setStemTypes({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
      setChangelogHistory(Array(5));
    }
  }, [currentSite, currentPlot, currentCensus]);

  useEffect(() => {
    if (currentSite && currentPlot && currentCensus) {
      loadAllDashboardMetrics().catch(ailogger.error);
      loadChangelogHistory().catch(ailogger.error);
    }
  }, [currentSite, currentPlot, currentCensus, loadAllDashboardMetrics, loadChangelogHistory]);

  const hasData = progressTacho.PopulatedQuadrats > 0 || countStems > 0;

  return (
    <Box
      role="region"
      aria-label="Dashboard page container"
      sx={{
        display: 'flex',
        flexGrow: 1,
        width: '100%',
        flexDirection: 'column',
        p: { xs: 2, sm: 3, md: 4 },
        gap: 3
      }}
    >
      {/* Error Alert */}
      {error && (
        <Alert color="danger" variant="soft" sx={{ animation: 'slideDown 0.3s ease' }}>
          {error}
        </Alert>
      )}

      {/* Welcome Header */}
      <Box>
        <Typography level="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Welcome back, {userName}! 👋
        </Typography>
        <Typography level="body-md" color="neutral">
          Here's what's happening with your census data
        </Typography>
      </Box>

      {/* Main Metrics Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(2, 1fr)',
            lg: 'repeat(4, 1fr)'
          },
          gap: 3
        }}
      >
        {/* Trees Count */}
        <MetricCard
          title="Total Trees"
          value={countTrees}
          icon={<ParkIcon sx={{ fontSize: 32 }} />}
          gradient="primary"
          isLoading={isLoading}
          trend={{
            value: hasData ? 'Current census' : 'No data',
            direction: 'neutral'
          }}
        />

        {/* Stems Count */}
        <MetricCard
          title="Total Stems"
          value={countStems}
          icon={<NatureIcon sx={{ fontSize: 32 }} />}
          gradient="success"
          isLoading={isLoading}
          trend={{
            value: hasData ? `${(countStems / Math.max(countTrees, 1)).toFixed(1)} per tree` : 'No data',
            direction: 'neutral'
          }}
        />

        {/* Active Personnel */}
        <MetricCard
          title="Active Personnel"
          value={activeUsers}
          icon={<PeopleIcon sx={{ fontSize: 32 }} />}
          gradient="info"
          isLoading={isLoading}
          trend={{
            value: activeUsers > 0 ? 'Currently active' : 'No activity',
            direction: activeUsers > 0 ? 'up' : 'neutral'
          }}
        />

        {/* New Recruits */}
        <MetricCard
          title="New Recruits"
          value={stemTypes.CountNewRecruits}
          icon={<CategoryIcon sx={{ fontSize: 32 }} />}
          gradient="warning"
          isLoading={isLoading}
          trend={{
            value: hasData ? 'This census' : 'No data',
            direction: 'neutral'
          }}
        />
      </Box>

      {/* Progress and Details Section */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: '2fr 3fr'
          },
          gap: 3
        }}
      >
        {/* Progress Card */}
        {isLoading ? (
          <ProgressCardSkeleton />
        ) : (
          <ProgressCard
            totalQuadrats={progressTacho.TotalQuadrats}
            populatedQuadrats={progressTacho.PopulatedQuadrats}
            populatedPercent={progressTacho.PopulatedPercent}
            unpopulatedQuadrats={progressTacho.UnpopulatedQuadrats}
            isLoading={isLoading}
          />
        )}

        {/* Changelog History */}
        <Card
          variant="outlined"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.3s ease',
            '&:hover': {
              boxShadow: designTokens.shadows.md,
              borderColor: 'primary.outlinedBorder'
            }
          }}
        >
          <CardContent sx={{ gap: 2 }}>
            <Typography level="h4" sx={{ fontWeight: 600 }}>
              Recent Activity
            </Typography>
            <Typography level="body-sm" color="neutral" sx={{ mb: 2 }}>
              Latest changes to census data
            </Typography>

            {changelogHistory.filter(log => log.changeID).length > 0 ? (
              <Stack spacing={2}>
                {changelogHistory
                  .filter(log => log.changeID)
                  .slice(0, 5)
                  .map((log, index) => (
                    <Box
                      key={index}
                      sx={{
                        p: 2,
                        borderRadius: 'sm',
                        bgcolor: 'background.level1',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          bgcolor: 'background.level2',
                          transform: 'translateX(4px)'
                        }
                      }}
                    >
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Avatar size="sm" alt={log.changedBy || 'Unknown User'} sx={{ bgcolor: 'primary.softBg', color: 'primary.solidBg' }}>
                          {log.changedBy?.[0]?.toUpperCase() || '?'}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                            {log.changedBy || 'Unknown User'}
                          </Typography>
                          <Typography level="body-xs" color="neutral">
                            {log.operation || 'Update'} · {moment(log.changeTimestamp).fromNow()}
                          </Typography>
                        </Box>
                        <Chip size="sm" variant="soft" color="primary">
                          {log.tableName || 'Data'}
                        </Chip>
                      </Stack>
                    </Box>
                  ))}
              </Stack>
            ) : (
              <Box
                sx={{
                  textAlign: 'center',
                  py: 6,
                  color: 'neutral.400'
                }}
              >
                <Typography level="body-md" color="neutral">
                  No recent activity
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Empty State */}
      {!hasData && !isLoading && currentSite && currentPlot && currentCensus && (
        <Card
          variant="outlined"
          sx={{
            textAlign: 'center',
            py: 8,
            px: 3,
            mt: 2
          }}
        >
          <Avatar
            alt="No census data available"
            sx={{
              width: 80,
              height: 80,
              bgcolor: 'primary.softBg',
              color: 'primary.solidBg',
              margin: '0 auto',
              mb: 3
            }}
          >
            <HelpOutlineOutlinedIcon sx={{ fontSize: 40 }} />
          </Avatar>
          <Typography level="h3" sx={{ mb: 2 }}>
            No Census Data Yet
          </Typography>
          <Typography level="body-md" color="neutral" sx={{ mb: 3 }}>
            Start by uploading measurement data or creating a new census
          </Typography>
        </Card>
      )}
    </Box>
  );
}
