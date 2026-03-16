'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography, Avatar } from '@mui/joy';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AssessmentIcon from '@mui/icons-material/Assessment';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import CloudCircleIcon from '@mui/icons-material/CloudCircle';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HistoryIcon from '@mui/icons-material/History';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/compat-hooks';
import { useRouter } from 'next/navigation';
import CensusStatsView from '@/components/dashboard/censusstatsview';
import DataQualityCard from '@/components/dashboard/dataqualitycard';
import ailogger from '@/ailogger';
import { useIsMounted } from '@/app/hooks/useismounted';

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

const CENSUS_HUB_LINKS = [
  { label: 'View Data', href: '/measurementshub/summary', icon: VisibilityIcon, description: 'Browse measurement records' },
  { label: 'View Errors', href: '/measurementshub/errors', icon: ErrorOutlineIcon, description: 'Review failed measurements' },
  { label: 'Post-Census Statistics', href: '/measurementshub/postvalidation', icon: AssessmentIcon, description: 'Validation results and quality checks' },
  { label: 'Recent Changes', href: '/measurementshub/recentchanges', icon: TrackChangesIcon, description: 'Changelog and activity history' },
  { label: 'Uploaded Files', href: '/measurementshub/uploadedfiles', icon: CloudCircleIcon, description: 'View uploaded data files' },
  { label: 'View All Historical Data', href: '/measurementshub/viewfulltable', icon: HistoryIcon, description: 'Full historical measurement data' },
  { label: 'Validations', href: '/measurementshub/validations', icon: FactCheckIcon, description: 'Data validation rules and results' }
];

export default function CensusOverviewPage() {
  const router = useRouter();
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const { isMountedRef } = useIsMounted();
  const metricsAbortControllerRef = useRef<AbortController | null>(null);

  const [countTrees, setCountTrees] = useState(0);
  const [countStems, setCountStems] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [stemTypes, setStemTypes] = useState<StemTypesType>({ CountOldStems: 0, CountMultiStems: 0, CountNewRecruits: 0 });
  const [progressTacho, setProgressTacho] = useState<ProgressTachoType>({ TotalQuadrats: 0, PopulatedQuadrats: 0, PopulatedPercent: 0, UnpopulatedQuadrats: [] });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return () => {
      metricsAbortControllerRef.current?.abort();
    };
  }, []);

  const loadMetrics = useCallback(async () => {
    if (!currentSite?.schemaName || !currentPlot?.plotID || !currentCensus?.dateRanges?.[0]?.censusID) return;

    metricsAbortControllerRef.current?.abort();
    metricsAbortControllerRef.current = new AbortController();
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/dashboardmetrics/all/${currentSite.schemaName}/${currentPlot.plotID}/${currentCensus.dateRanges[0].censusID}`,
        { signal: metricsAbortControllerRef.current.signal }
      );

      if (!isMountedRef.current) return;
      if (!response.ok) throw new Error(`Failed to load metrics: ${response.status}`);

      const data = await response.json();
      if (!isMountedRef.current) return;

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
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      ailogger.error('Census overview metrics error:', e);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.dateRanges?.[0]?.censusID]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  if (!currentSite || !currentPlot || !currentCensus) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography level="h4" color="neutral">
          Please select a site, plot, and census to view the census overview.
        </Typography>
      </Box>
    );
  }

  const startDate = currentCensus.dateRanges?.[0]?.startDate;
  const endDate = currentCensus.dateRanges?.[0]?.endDate;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2}>
        <Avatar
          alt="Census overview icon"
          sx={{ bgcolor: 'primary.softBg', color: 'primary.solidBg', width: 48, height: 48 }}
        >
          <CalendarMonthIcon />
        </Avatar>
        <Box>
          <Typography level="h3" sx={{ fontWeight: 600 }}>
            Census {currentCensus.plotCensusNumber} Overview
          </Typography>
          <Typography level="body-md" color="neutral">
            {currentPlot.plotName} &mdash; {currentSite.siteName}
            {startDate && ` &mdash; ${new Date(startDate).toLocaleDateString()}`}
            {endDate && ` to ${new Date(endDate).toLocaleDateString()}`}
          </Typography>
        </Box>
      </Stack>

      {/* Census Stats */}
      <CensusStatsView
        countTrees={countTrees}
        countStems={countStems}
        stemTypes={stemTypes}
        progressTacho={progressTacho}
        activeUsers={activeUsers}
        isLoading={isLoading}
      />

      {/* Data Quality */}
      <Box>
        <Typography level="title-lg" sx={{ fontWeight: 600, mb: 2 }}>
          Data Quality
        </Typography>
        <DataQualityCard
          schema={currentSite.schemaName}
          plotID={currentPlot.plotID}
          censusID={currentCensus.dateRanges?.[0]?.censusID}
          isLoading={isLoading}
          onRefresh={async () => {
            if (currentSite?.schemaName && currentPlot?.plotID && currentCensus?.dateRanges?.[0]?.censusID) {
              await fetch(`/api/refreshviews/measurementssummary/${currentSite.schemaName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  plotID: currentPlot.plotID,
                  censusID: currentCensus.dateRanges[0].censusID,
                  runPostValidation: true
                })
              });
            }
          }}
        />
      </Box>

      {/* Quick Navigation */}
      <Box>
        <Typography level="title-lg" sx={{ fontWeight: 600, mb: 2 }}>
          Census Tools
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 2
          }}
        >
          {CENSUS_HUB_LINKS.map(link => {
            const LinkIcon = link.icon;
            return (
              <Card
                key={link.href}
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    borderColor: 'primary.outlinedBorder',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    transform: 'translateY(-2px)'
                  }
                }}
                onClick={() => router.push(link.href)}
              >
                <CardContent sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Avatar size="sm" sx={{ bgcolor: 'primary.softBg', color: 'primary.500' }}>
                    <LinkIcon sx={{ fontSize: 18 }} />
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography level="title-sm" sx={{ fontWeight: 600 }}>
                      {link.label}
                    </Typography>
                    <Typography level="body-xs" color="neutral">
                      {link.description}
                    </Typography>
                  </Box>
                  <ArrowForwardIcon sx={{ fontSize: 16, color: 'neutral.400' }} />
                </CardContent>
              </Card>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
