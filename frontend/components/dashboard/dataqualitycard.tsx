/**
 * Data Quality Card Component
 *
 * Displays post-census validation statistics in the dashboard.
 * Shows quality metrics, validation status, and quick summaries
 * from executed post-validation queries.
 *
 * Implements Option D: Card-Based Inline Integration
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack, Avatar, LinearProgress, Tooltip, IconButton, Divider } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import { designTokens } from '@/config/design-tokens';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import PendingIcon from '@mui/icons-material/Pending';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import VerifiedIcon from '@mui/icons-material/Verified';
import BugReportIcon from '@mui/icons-material/BugReport';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import moment from 'moment';
import { PostValidationQueriesRDS } from '@/lib/db/definitions/validations';

// ============================================================================
// Types
// ============================================================================

export interface DataQualityStats {
  /** Total number of validation queries */
  totalQueries: number;
  /** Number of queries that passed (returned results) */
  passedQueries: number;
  /** Number of queries that failed */
  failedQueries: number;
  /** Number of queries not yet run */
  pendingQueries: number;
  /** Last run timestamp */
  lastRunAt?: Date;
  /** Individual query results */
  queries: PostValidationQueriesRDS[];
}

export interface DataQualityCardProps {
  /** Schema name for API calls */
  schema?: string;
  /** Plot ID for context */
  plotID?: number;
  /** Census ID for context */
  censusID?: number;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Pre-loaded stats (if already fetched) */
  stats?: DataQualityStats;
  /** Callback when refresh is triggered */
  onRefresh?: () => Promise<void>;
  /** Whether to show expanded details */
  defaultExpanded?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

export interface QueryStatusIndicatorProps {
  status: 'success' | 'failure' | 'pending';
  size?: 'sm' | 'md';
}

// ============================================================================
// Helper Functions
// ============================================================================

const QUERY_RUN_SUCCESS = 'success';
const QUERY_RUN_FAILURE = 'failure';

function buildPostValidationQueriesUrl(schema: string, plotID?: number, censusID?: number): string {
  return `/api/fetchall/postvalidationqueries/${plotID ?? 0}/${censusID ?? 0}?schema=${encodeURIComponent(schema)}`;
}

function hasMatchingRunContext(query: PostValidationQueriesRDS, plotID?: number, censusID?: number): boolean {
  return plotID !== undefined && censusID !== undefined && query.lastRunPlotID === plotID && query.lastRunCensusID === censusID;
}

function parseQueryResults(query: PostValidationQueriesRDS, plotID?: number, censusID?: number): { count: number; status: 'success' | 'failure' | 'pending' } {
  if (!query.lastRunStatus || !hasMatchingRunContext(query, plotID, censusID)) {
    return { count: 0, status: 'pending' };
  }

  if (query.lastRunStatus === QUERY_RUN_FAILURE) {
    return { count: 0, status: 'failure' };
  }

  try {
    const results = query.lastRunResult ? JSON.parse(query.lastRunResult) : [];
    return { count: Array.isArray(results) ? results.length : 0, status: 'success' };
  } catch {
    return { count: 0, status: 'success' };
  }
}

function getOverallStatus(stats: DataQualityStats): 'excellent' | 'good' | 'warning' | 'issues' | 'pending' {
  if (stats.pendingQueries === stats.totalQueries) return 'pending';
  if (stats.failedQueries > 0) return 'issues';
  if (stats.pendingQueries === 0 && stats.passedQueries === stats.totalQueries) return 'excellent';

  // Pass rate is over queries that actually RAN: never-run (pending) queries are
  // not failures, so a partially-run census with zero failed queries must not
  // degrade to 'warning'.
  const ranQueries = stats.totalQueries - stats.pendingQueries;
  const passRate = ranQueries > 0 ? stats.passedQueries / ranQueries : 0;
  if (passRate >= 0.8) return 'good';
  return 'warning';
}

const STATUS_CONFIG = {
  excellent: {
    label: 'Excellent',
    color: 'success' as const,
    icon: <VerifiedIcon />,
    description: 'All validations passed'
  },
  good: {
    label: 'Good',
    color: 'success' as const,
    icon: <CheckCircleIcon />,
    description: 'Most validations passed'
  },
  warning: {
    label: 'Attention Needed',
    color: 'warning' as const,
    icon: <WarningIcon />,
    description: 'Some validations need review'
  },
  issues: {
    label: 'Issues Found',
    color: 'danger' as const,
    icon: <ErrorIcon />,
    description: 'Validation failures detected'
  },
  pending: {
    label: 'Not Run',
    color: 'neutral' as const,
    icon: <PendingIcon />,
    description: 'Validations have not been executed'
  }
};

// ============================================================================
// Sub-components
// ============================================================================

function QueryStatusIndicator({ status, size = 'sm' }: QueryStatusIndicatorProps) {
  const config = {
    success: { icon: <CheckCircleIcon />, color: 'success.500', label: 'Passed' },
    failure: { icon: <ErrorIcon />, color: 'danger.500', label: 'Failed' },
    pending: { icon: <PendingIcon />, color: 'neutral.400', label: 'Pending' }
  };

  const { icon, color, label } = config[status];
  const iconSize = size === 'sm' ? 14 : 18;

  return (
    <Tooltip title={label}>
      <Box sx={{ display: 'flex', alignItems: 'center', color }}>{React.cloneElement(icon, { sx: { fontSize: iconSize } })}</Box>
    </Tooltip>
  );
}

function QueryListItem({ query, plotID, censusID }: { query: PostValidationQueriesRDS; plotID?: number; censusID?: number }) {
  const { count, status } = parseQueryResults(query, plotID, censusID);
  const isCurrentRun = hasMatchingRunContext(query, plotID, censusID);

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
      <QueryStatusIndicator status={status} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          level="body-xs"
          sx={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {query.queryName}
        </Typography>
      </Box>
      {status === 'success' && count > 0 && (
        <Chip size="sm" variant="soft" color="primary" sx={{ fontSize: '0.625rem', minHeight: 18 }}>
          {count} results
        </Chip>
      )}
      {isCurrentRun && query.lastRunAt && (
        <Typography level="body-xs" color="neutral" sx={{ fontSize: '0.6rem' }}>
          {moment(query.lastRunAt).fromNow()}
        </Typography>
      )}
    </Stack>
  );
}

function DataQualitySkeleton() {
  return <ContentSkeleton kind="dashboard-card" />;
}

// ============================================================================
// Main Component
// ============================================================================

export default function DataQualityCard({
  schema,
  plotID,
  censusID,
  isLoading = false,
  stats: preloadedStats,
  onRefresh,
  defaultExpanded = false,
  compact = false
}: DataQualityCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [localStats, setLocalStats] = useState<DataQualityStats | null>(preloadedStats || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!schema) return;

    try {
      setFetchError(null);
      const response = await fetch(buildPostValidationQueriesUrl(schema, plotID, censusID), { method: 'GET' });

      if (!response.ok) {
        throw new Error(`Failed to fetch validation queries (HTTP ${response.status})`);
      }

      const queries: PostValidationQueriesRDS[] = await response.json();

      const enabledQueries = queries.filter(q => q.isEnabled);
      const passed = enabledQueries.filter(q => hasMatchingRunContext(q, plotID, censusID) && q.lastRunStatus === QUERY_RUN_SUCCESS).length;
      const failed = enabledQueries.filter(q => hasMatchingRunContext(q, plotID, censusID) && q.lastRunStatus === QUERY_RUN_FAILURE).length;
      const pending = enabledQueries.length - passed - failed;

      const lastRun = enabledQueries
        .filter(q => hasMatchingRunContext(q, plotID, censusID) && q.lastRunAt)
        .sort((a, b) => new Date(b.lastRunAt!).getTime() - new Date(a.lastRunAt!).getTime())[0];

      setLocalStats({
        totalQueries: enabledQueries.length,
        passedQueries: passed,
        failedQueries: failed,
        pendingQueries: pending,
        lastRunAt: lastRun?.lastRunAt,
        queries: enabledQueries
      });
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    }
  }, [schema, plotID, censusID]);

  useEffect(() => {
    if (!preloadedStats && schema) {
      fetchStats();
    }
  }, [preloadedStats, schema, fetchStats]);

  const stats = preloadedStats || localStats;
  const status = stats ? getOverallStatus(stats) : 'pending';
  const statusConfig = STATUS_CONFIG[status];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setFetchError(null);
      if (onRefresh) {
        await onRefresh();
      }
      await fetchStats();
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  // Calculate progress percentage
  const progressPercent = useMemo(() => {
    if (!stats || stats.totalQueries === 0) return 0;
    return Math.round(((stats.passedQueries + stats.failedQueries) / stats.totalQueries) * 100);
  }, [stats]);

  if (isLoading) {
    return <DataQualitySkeleton />;
  }

  if (fetchError) {
    return (
      <Card variant="outlined" color="danger">
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar color="danger" variant="soft" size="sm" alt="Error">
              <BugReportIcon />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography level="title-sm">Data Quality Check Failed</Typography>
              <Typography level="body-xs" color="neutral">
                {fetchError}
              </Typography>
            </Box>
            <IconButton size="sm" variant="soft" color="neutral" onClick={() => fetchStats()} aria-label="Retry">
              <RefreshIcon />
            </IconButton>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: 2, textAlign: 'center' }}>
          <Typography level="body-sm" color="neutral">
            No validation data available
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{
        transition: 'all 0.3s ease',
        '&:hover': {
          boxShadow: designTokens.shadows.md,
          borderColor: `${statusConfig.color}.outlinedBorder`
        }
      }}
    >
      <CardContent sx={{ p: compact ? 2 : 2.5 }}>
        {/* Header */}
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Avatar color={statusConfig.color} variant="soft" size={compact ? 'sm' : 'md'} alt="Data Quality">
            <QueryStatsIcon />
          </Avatar>

          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography level={compact ? 'title-sm' : 'title-md'} sx={{ fontWeight: 600 }}>
                Data Quality
              </Typography>
              <Chip size="sm" variant="soft" color={statusConfig.color} startDecorator={statusConfig.icon}>
                {statusConfig.label}
              </Chip>
            </Stack>
            <Typography level="body-xs" color="neutral">
              {statusConfig.description}
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Refresh validations">
              <IconButton size="sm" variant="soft" color="neutral" onClick={handleRefresh} loading={isRefreshing} aria-label="Refresh validations">
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
            >
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Stack>
        </Stack>

        {/* Progress Bar */}
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
            <Typography level="body-xs" color="neutral">
              Validation Progress
            </Typography>
            <Typography level="body-xs" sx={{ fontWeight: 600 }}>
              {progressPercent}%
            </Typography>
          </Stack>
          <LinearProgress
            determinate
            value={progressPercent}
            color={statusConfig.color}
            sx={{ '--LinearProgress-thickness': '6px' }}
            aria-label={`Validation progress: ${progressPercent}%`}
          />
        </Box>

        {/* Stats Summary */}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <Tooltip title="Validations that passed">
            <Chip size="sm" variant="soft" color="success" startDecorator={<CheckCircleIcon sx={{ fontSize: 14 }} />}>
              {stats.passedQueries} passed
            </Chip>
          </Tooltip>
          {stats.failedQueries > 0 && (
            <Tooltip title="Validations that failed">
              <Chip size="sm" variant="soft" color="danger" startDecorator={<ErrorIcon sx={{ fontSize: 14 }} />}>
                {stats.failedQueries} failed
              </Chip>
            </Tooltip>
          )}
          {stats.pendingQueries > 0 && (
            <Tooltip title="Validations not yet run">
              <Chip size="sm" variant="soft" color="neutral" startDecorator={<PendingIcon sx={{ fontSize: 14 }} />}>
                {stats.pendingQueries} pending
              </Chip>
            </Tooltip>
          )}
          <Chip size="sm" variant="outlined" color="neutral">
            {stats.totalQueries} total
          </Chip>
        </Stack>

        {/* Last Run Info */}
        {stats.lastRunAt && (
          <Typography level="body-xs" color="neutral" sx={{ mt: 1.5 }}>
            Last run: {moment(stats.lastRunAt).format('MMM D, YYYY h:mm A')} ({moment(stats.lastRunAt).fromNow()})
          </Typography>
        )}

        {/* Expanded Details */}
        {expanded && stats.queries.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ my: 1.5 }} />
            <Typography level="body-xs" sx={{ fontWeight: 600, mb: 1, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Validation Queries
            </Typography>
            <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
              {stats.queries.map((query, index) => (
                <QueryListItem key={query.queryID || index} query={query} plotID={plotID} censusID={censusID} />
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export { DataQualitySkeleton, QueryStatusIndicator };
