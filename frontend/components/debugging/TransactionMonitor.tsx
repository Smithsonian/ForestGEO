'use client';
import React, { useEffect, useState } from 'react';
import { Box, Card, Chip, Stack, Typography } from '@mui/joy';
import TransactionAwarePQueue from '@/config/transactionawarequeue';

interface TransactionMonitorProps {
  queue?: TransactionAwarePQueue;
  refreshInterval?: number;
}

interface QueueStats {
  size: number;
  pending: number;
  concurrency: number;
  activeLocks: number;
  lockDetails: Array<{
    resource: string;
    ownerId: string;
    lockedAt: string;
    age: number;
  }>;
}

/**
 * TransactionMonitor
 *
 * A debugging component that displays real-time information about
 * the TransactionAwarePQueue and connection pool status.
 *
 * This helps identify deadlock issues, connection pool exhaustion,
 * and transaction bottlenecks during development and debugging.
 */
const TransactionMonitor: React.FC<TransactionMonitorProps> = ({ queue, refreshInterval = 2000 }) => {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show in development mode
    if (process.env.NODE_ENV === 'development') {
      setIsVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!queue || !isVisible) return;

    const updateStats = () => {
      try {
        const queueStats = queue.getStats();
        setStats(queueStats);
      } catch (error) {
        console.error('Error getting queue stats:', error);
      }
    };

    // Initial update
    updateStats();

    // Set up interval
    const interval = setInterval(updateStats, refreshInterval);

    return () => clearInterval(interval);
  }, [queue, refreshInterval, isVisible]);

  if (!isVisible || !stats) {
    return null;
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const getLockAgeColor = (ageMs: number): 'primary' | 'warning' | 'danger' => {
    if (ageMs < 30000) return 'primary'; // < 30s
    if (ageMs < 120000) return 'warning'; // < 2min
    return 'danger'; // > 2min
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        maxWidth: 350,
        backgroundColor: 'background.surface',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 'md',
        boxShadow: 'lg'
      }}
    >
      <Card variant="outlined">
        <Typography level="title-sm" sx={{ mb: 2 }}>
          🔍 Transaction Monitor
        </Typography>

        <Stack spacing={2}>
          {/* Queue Status */}
          <Box>
            <Typography level="body-sm" fontWeight="lg">
              Queue Status
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Chip size="sm" color="primary">
                Size: {stats.size}
              </Chip>
              <Chip size="sm" color="neutral">
                Pending: {stats.pending}
              </Chip>
              <Chip size="sm" color="success">
                Concurrency: {stats.concurrency}
              </Chip>
            </Stack>
          </Box>

          {/* Active Locks */}
          <Box>
            <Typography level="body-sm" fontWeight="lg">
              Active Locks ({stats.activeLocks})
            </Typography>
            {stats.lockDetails.length === 0 ? (
              <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                No active locks
              </Typography>
            ) : (
              <Stack spacing={0.5} sx={{ mt: 0.5, maxHeight: 120, overflow: 'auto' }}>
                {stats.lockDetails.map((lock, index) => (
                  <Box
                    key={index}
                    sx={{
                      p: 0.5,
                      backgroundColor: 'background.level1',
                      borderRadius: 'sm',
                      fontSize: '0.75rem'
                    }}
                  >
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography level="body-xs" fontWeight="lg">
                        {lock.resource}
                      </Typography>
                      <Chip size="sm" variant="soft" color={getLockAgeColor(lock.age)}>
                        {formatDuration(lock.age)}
                      </Chip>
                    </Stack>
                    <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                      Owner: {lock.ownerId.slice(0, 8)}...
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {/* Performance Indicators */}
          <Box>
            <Typography level="body-sm" fontWeight="lg">
              Performance
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Chip size="sm" color={stats.size > stats.concurrency * 2 ? 'warning' : 'success'}>
                Queue Load: {Math.round((stats.size / (stats.concurrency * 2)) * 100)}%
              </Chip>
              <Chip size="sm" color={stats.activeLocks > 5 ? 'warning' : 'primary'}>
                Lock Usage: {stats.activeLocks}
              </Chip>
            </Stack>
          </Box>
        </Stack>
      </Card>
    </Box>
  );
};

export default TransactionMonitor;
