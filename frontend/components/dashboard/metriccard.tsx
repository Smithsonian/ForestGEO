/**
 * Enhanced Metric Card Component
 *
 * Modern, visually engaging card for displaying dashboard metrics
 * Features: Gradient backgrounds, icons, hover animations, trend indicators
 */

'use client';

import { Card, Box, Typography, Avatar, Skeleton } from '@mui/joy';
import { designTokens } from '@/config/design-tokens';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { ReactNode } from 'react';

export interface MetricCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  gradient?: 'primary' | 'success' | 'warning' | 'info' | 'neutral';
  trend?: {
    value: string;
    direction: 'up' | 'down' | 'neutral';
  };
  isLoading?: boolean;
  onClick?: () => void;
}

const gradients = {
  primary: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
  success: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  neutral: 'linear-gradient(135deg, #57534e 0%, #44403c 100%)'
};

export default function MetricCard({ title, value, icon, gradient = 'primary', trend, isLoading = false, onClick }: MetricCardProps) {
  if (isLoading) {
    return <MetricCardSkeleton />;
  }

  const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (onClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onClick();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <Card
      variant="solid"
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      sx={{
        background: gradients[gradient],
        color: 'white',
        minHeight: '160px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        border: 'none',

        // Hover effect
        '&:hover': {
          transform: onClick ? 'translateY(-4px)' : 'translateY(-2px)',
          boxShadow: designTokens.shadows.xl,

          '& .metric-icon': {
            transform: 'scale(1.1) rotate(5deg)'
          }
        },

        // Active state
        '&:active': {
          transform: 'translateY(-1px)',
          boxShadow: designTokens.shadows.lg
        },

        // Subtle pattern overlay
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.1) 0%, transparent 50%)',
          pointerEvents: 'none'
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
        <Box>
          <Typography
            level="body-sm"
            sx={{
              opacity: 0.9,
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              fontSize: '0.75rem'
            }}
          >
            {title}
          </Typography>
          <Typography
            level="h2"
            sx={{
              fontWeight: 700,
              mt: 1.5,
              fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
              lineHeight: 1.2,
              textShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            {formattedValue}
          </Typography>
        </Box>

        <Avatar
          className="metric-icon"
          alt={title}
          sx={{
            bgcolor: 'rgba(255,255,255,0.2)',
            backdropFilter: 'blur(10px)',
            width: 56,
            height: 56,
            transition: 'all 0.3s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          {icon}
        </Avatar>
      </Box>

      {trend && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            mt: 2,
            position: 'relative',
            zIndex: 1
          }}
        >
          {trend.direction === 'up' && <TrendingUpIcon sx={{ fontSize: 18, opacity: 0.9 }} />}
          {trend.direction === 'down' && <TrendingDownIcon sx={{ fontSize: 18, opacity: 0.9 }} />}
          <Typography
            level="body-sm"
            sx={{
              opacity: 0.9,
              fontWeight: 500,
              fontSize: '0.875rem'
            }}
          >
            {trend.value}
          </Typography>
        </Box>
      )}
    </Card>
  );
}

/**
 * Skeleton loader for metric cards
 */
export function MetricCardSkeleton() {
  return (
    <Card
      variant="soft"
      sx={{
        minHeight: '160px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        '@keyframes shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="60%" height={20} sx={{ mb: 2 }} />
          <Skeleton variant="text" width="80%" height={40} />
        </Box>
        <Skeleton variant="circular" width={56} height={56} />
      </Box>

      <Skeleton variant="text" width="40%" height={20} />
    </Card>
  );
}
